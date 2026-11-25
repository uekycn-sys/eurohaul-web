import { BuiltMap, CompiledRoadSegment } from '../map/MapBuilder';

interface GraphEdge {
  toNodeId: string;
  segment: CompiledRoadSegment;
  reverse: boolean;
  cost: number;
}

export interface RoutePoint {
  x: number;
  z: number;
}

export interface ActiveRoute {
  points: RoutePoint[];
  totalDistanceMeters: number;
}

export interface NavigationGuidance {
  distanceMeters: number;
  etaSeconds: number;
  instruction: string;
  routePoints: RoutePoint[];
}

/**
 * Road-network shortest-path planner (Dijkstra) and real-time turn-by-turn guidance.
 */
export class NavigationSystem {
  private readonly builtMap: BuiltMap;
  private readonly adj = new Map<string, GraphEdge[]>();

  constructor(builtMap: BuiltMap) {
    this.builtMap = builtMap;
    this.buildGraph();
  }

  private buildGraph(): void {
    for (const seg of this.builtMap.segments) {
      // Weight favors motorways slightly over slow urban/mountain roads
      const speedFactor = 90 / Math.max(40, seg.def.speedLimitKmh);
      const cost = seg.lengthMeters * speedFactor;

      const listA = this.adj.get(seg.def.fromNodeId) ?? [];
      listA.push({ toNodeId: seg.def.toNodeId, segment: seg, reverse: false, cost });
      this.adj.set(seg.def.fromNodeId, listA);

      if (!seg.def.oneWay) {
        const listB = this.adj.get(seg.def.toNodeId) ?? [];
        listB.push({ toNodeId: seg.def.fromNodeId, segment: seg, reverse: true, cost });
        this.adj.set(seg.def.toNodeId, listB);
      }
    }
  }

  public findNearestNodeId(x: number, z: number): string | null {
    let bestId: string | null = null;
    let bestDistSq = Infinity;
    for (const node of this.builtMap.manifest.nodes) {
      const dx = node.position[0] - x;
      const dz = node.position[2] - z;
      const dSq = dx * dx + dz * dz;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestId = node.id;
      }
    }
    return bestId;
  }

  public computeRoute(fromX: number, fromZ: number, toX: number, toZ: number): ActiveRoute {
    const startNodeId = this.findNearestNodeId(fromX, fromZ);
    const endNodeId = this.findNearestNodeId(toX, toZ);
    if (!startNodeId || !endNodeId) {
      return {
        points: [
          { x: fromX, z: fromZ },
          { x: toX, z: toZ },
        ],
        totalDistanceMeters: Math.hypot(toX - fromX, toZ - fromZ),
      };
    }

    const dist = new Map<string, number>();
    const prev = new Map<string, { nodeId: string; edge: GraphEdge }>();
    const unvisited = new Set<string>();

    for (const n of this.builtMap.manifest.nodes) {
      dist.set(n.id, Infinity);
      unvisited.add(n.id);
    }
    dist.set(startNodeId, 0);

    while (unvisited.size > 0) {
      let u: string | null = null;
      let uDist = Infinity;
      for (const id of unvisited) {
        const d = dist.get(id) ?? Infinity;
        if (d < uDist) {
          uDist = d;
          u = id;
        }
      }
      if (!u || u === endNodeId || uDist === Infinity) break;
      unvisited.delete(u);

      const edges = this.adj.get(u) ?? [];
      for (const edge of edges) {
        if (!unvisited.has(edge.toNodeId)) continue;
        const alt = uDist + edge.cost;
        if (alt < (dist.get(edge.toNodeId) ?? Infinity)) {
          dist.set(edge.toNodeId, alt);
          prev.set(edge.toNodeId, { nodeId: u, edge });
        }
      }
    }

    // Reconstruct segment sequence
    const edgeChain: GraphEdge[] = [];
    let curr: string | undefined = endNodeId;
    while (curr && curr !== startNodeId) {
      const step = prev.get(curr);
      if (!step) break;
      edgeChain.unshift(step.edge);
      curr = step.nodeId;
    }

    const points: RoutePoint[] = [{ x: fromX, z: fromZ }];
    for (const edge of edgeChain) {
      const samples = edge.segment.samples;
      if (!edge.reverse) {
        for (let i = 0; i < samples.length; i += 3) {
          points.push({ x: samples[i]!.x, z: samples[i]!.z });
        }
      } else {
        for (let i = samples.length - 1; i >= 0; i -= 3) {
          points.push({ x: samples[i]!.x, z: samples[i]!.z });
        }
      }
    }
    points.push({ x: toX, z: toZ });

    let totalDistanceMeters = 0;
    for (let i = 1; i < points.length; i++) {
      totalDistanceMeters += Math.hypot(
        points[i]!.x - points[i - 1]!.x,
        points[i]!.z - points[i - 1]!.z
      );
    }

    return { points, totalDistanceMeters };
  }

  public getGuidance(
    truckX: number,
    truckZ: number,
    truckYaw: number,
    destX: number,
    destZ: number,
    route: ActiveRoute | null
  ): NavigationGuidance {
    if (!route || route.points.length < 2) {
      const d = Math.hypot(destX - truckX, destZ - truckZ);
      return {
        distanceMeters: d,
        etaSeconds: d / 17,
        instruction: '自由驾驶模式 · 前往货场按 Enter 接单',
        routePoints: [],
      };
    }

    // Find closest vertex on polyline
    let bestIdx = 0;
    let bestDistSq = Infinity;
    for (let i = 0; i < route.points.length; i++) {
      const pt = route.points[i]!;
      const dSq = (pt.x - truckX) ** 2 + (pt.z - truckZ) ** 2;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestIdx = i;
      }
    }

    // Remaining path length from bestIdx -> destination
    let remaining = Math.hypot(
      route.points[bestIdx]!.x - truckX,
      route.points[bestIdx]!.z - truckZ
    );
    for (let i = bestIdx + 1; i < route.points.length; i++) {
      remaining += Math.hypot(
        route.points[i]!.x - route.points[i - 1]!.x,
        route.points[i]!.z - route.points[i - 1]!.z
      );
    }

    // Look ahead ~70m along route to compute turn hint
    const lookIdx = Math.min(route.points.length - 1, bestIdx + 4);
    const targetPt = route.points[lookIdx]!;
    const dx = targetPt.x - truckX;
    const dz = targetPt.z - truckZ;
    const targetBearing = Math.atan2(dx, dz);
    let relAngle = targetBearing - truckYaw;
    while (relAngle > Math.PI) relAngle -= Math.PI * 2;
    while (relAngle < -Math.PI) relAngle += Math.PI * 2;

    let instruction = '沿主路直行';
    if (remaining < 130) {
      instruction = '即将抵达目的地货场，注意减速入库';
    } else if (relAngle > 0.42) {
      instruction = '前方路口向左转向';
    } else if (relAngle < -0.42) {
      instruction = '前方路口向右转向';
    }

    return {
      distanceMeters: remaining,
      etaSeconds: remaining / 18.5,
      instruction,
      routePoints: route.points.slice(bestIdx),
    };
  }
}
