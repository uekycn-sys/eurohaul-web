import * as THREE from 'three';
import { BuiltMap, CompiledRoadSegment } from '../map/MapBuilder';
import { CollisionEvent } from './TruckPhysics';

type TrafficArchetype = 'sedan' | 'van' | 'semi';

interface TrafficAgent {
  segment: CompiledRoadSegment;
  dir: 1 | -1;
  sMeters: number;
  speedMs: number;
  targetSpeedMs: number;
  archetype: TrafficArchetype;
  isTruck: boolean;
  colorHex: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

const SEDAN_COLORS = ['#dc2626', '#2563eb', '#e2e8f0', '#475569', '#059669', '#0f172a'] as const;
const VAN_COLORS = ['#f8fafc', '#e2e8f0', '#f1f5f9', '#cbd5e1'] as const;
const SEMI_COLORS = ['#b91c1c', '#1d4ed8', '#d97706', '#047857'] as const;

const BUBBLE_MIN_M = 80;
const BUBBLE_MAX_M = 480;
const RECYCLE_DIST_M = 520;
const MIN_SAFE_GAP_M = 35;

/**
 * Instanced AI traffic simulation maintaining a dense player-centered dynamic
 * traffic bubble (80m..480m) with balanced oncoming/same-direction lanes,
 * 3 vehicle archetypes (Euro sedans, cargo vans, rival semis), and rain/night lights.
 */
export class TrafficSystem {
  private readonly builtMap: BuiltMap;
  private readonly agents: TrafficAgent[] = [];
  private readonly nodeConnections = new Map<string, CompiledRoadSegment[]>();
  private readonly roadPool: CompiledRoadSegment[];

  private readonly bodyInst: THREE.InstancedMesh;
  private readonly cabinInst: THREE.InstancedMesh;
  private readonly wheelInst: THREE.InstancedMesh;
  private readonly headlightInst: THREE.InstancedMesh;
  private readonly taillightInst: THREE.InstancedMesh;
  private readonly shadowInst: THREE.InstancedMesh | null = null;
  private readonly headlightMat: THREE.MeshBasicMaterial;
  private readonly taillightMat: THREE.MeshBasicMaterial;
  private readonly maxCapacity: number;
  private activeCount: number;
  private readonly dummy = new THREE.Object3D();
  private readonly disposables: { dispose: () => void }[] = [];

  private collisionCooldownSec = 0;

  constructor(
    builtMap: BuiltMap,
    vehicleCount = 20,
    maxCapacity = 28,
    shadowTexture?: THREE.CanvasTexture
  ) {
    this.builtMap = builtMap;
    this.maxCapacity = Math.max(maxCapacity, vehicleCount);
    this.activeCount = Math.min(this.maxCapacity, vehicleCount);

    for (const seg of builtMap.segments) {
      const a = this.nodeConnections.get(seg.def.fromNodeId) ?? [];
      a.push(seg);
      this.nodeConnections.set(seg.def.fromNodeId, a);

      if (!seg.def.oneWay) {
        const b = this.nodeConnections.get(seg.def.toNodeId) ?? [];
        b.push(seg);
        this.nodeConnections.set(seg.def.toNodeId, b);
      }
    }

    const arterial = builtMap.segments.filter((s) => s.def.roadClass !== 'urban');
    this.roadPool = arterial.length > 0 ? arterial : builtMap.segments;

    // Create batched InstancedMeshes for all AI vehicles + night/rain headlights/taillights
    const bodyGeo = new THREE.BoxGeometry(2.1, 1.05, 4.6);
    const bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0.38 });
    const cabinGeo = new THREE.BoxGeometry(1.85, 0.72, 2.3);
    const cabinMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.3, metalness: 0.25 });
    const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 2.18, 10);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelMat = new THREE.MeshStandardMaterial({ color: '#18181b', roughness: 0.9 });
    const lampGeo = new THREE.BoxGeometry(0.34, 0.16, 0.08);
    this.headlightMat = new THREE.MeshBasicMaterial({ color: '#fef9c3' });
    this.taillightMat = new THREE.MeshBasicMaterial({ color: '#ef4444' });

    this.disposables.push(
      bodyGeo,
      bodyMat,
      cabinGeo,
      cabinMat,
      wheelGeo,
      wheelMat,
      lampGeo,
      this.headlightMat,
      this.taillightMat
    );

    this.bodyInst = new THREE.InstancedMesh(bodyGeo, bodyMat, this.maxCapacity);
    this.bodyInst.castShadow = true;
    this.cabinInst = new THREE.InstancedMesh(cabinGeo, cabinMat, this.maxCapacity);
    this.wheelInst = new THREE.InstancedMesh(wheelGeo, wheelMat, this.maxCapacity * 2);
    this.headlightInst = new THREE.InstancedMesh(lampGeo, this.headlightMat, this.maxCapacity * 2);
    this.taillightInst = new THREE.InstancedMesh(lampGeo, this.taillightMat, this.maxCapacity * 2);

    if (shadowTexture) {
      const shadowGeo = new THREE.PlaneGeometry(2.9, 5.8);
      shadowGeo.rotateX(-Math.PI / 2);
      const shadowMat = new THREE.MeshBasicMaterial({
        map: shadowTexture,
        transparent: true,
        opacity: 0.58,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      this.shadowInst = new THREE.InstancedMesh(shadowGeo, shadowMat, this.maxCapacity);
      this.disposables.push(shadowGeo, shadowMat);
      builtMap.root.add(this.shadowInst);
    }

    const [sx, , sz] = builtMap.manifest.defaultSpawnPosition;
    this.spawnAgents(this.maxCapacity, sx, sz, builtMap.manifest.defaultSpawnHeadingRad);
    this.setActiveCount(this.activeCount);
    builtMap.root.add(this.bodyInst, this.cabinInst, this.wheelInst, this.headlightInst, this.taillightInst);
  }

  public setActiveCount(count: number): void {
    this.activeCount = Math.max(0, Math.min(this.maxCapacity, Math.round(count)));
    this.bodyInst.count = this.activeCount;
    this.cabinInst.count = this.activeCount;
    this.wheelInst.count = this.activeCount * 2;
    this.headlightInst.count = this.activeCount * 2;
    this.taillightInst.count = this.activeCount * 2;
    if (this.shadowInst) {
      this.shadowInst.count = this.activeCount;
    }
  }

  private speedForAgent(seg: CompiledRoadSegment, archetype: TrafficArchetype): number {
    const mult = archetype === 'semi' ? 0.78 : archetype === 'van' ? 0.86 : 0.94;
    return (seg.def.speedLimitKmh * mult) / 3.6;
  }

  private spawnAgents(count: number, focusX: number, focusZ: number, focusYaw: number): void {
    const tmpColor = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const archetype: TrafficArchetype =
        i % 5 === 0 ? 'semi' : i % 3 === 0 ? 'van' : 'sedan';
      const colorHex =
        archetype === 'semi'
          ? SEMI_COLORS[i % SEMI_COLORS.length]!
          : archetype === 'van'
          ? VAN_COLORS[i % VAN_COLORS.length]!
          : SEDAN_COLORS[i % SEDAN_COLORS.length]!;
      const fallbackSeg = this.roadPool[i % this.roadPool.length]!;

      const agent: TrafficAgent = {
        segment: fallbackSeg,
        dir: i % 2 === 0 ? 1 : -1,
        sMeters: Math.min(fallbackSeg.lengthMeters - 10, 15 + i * 24),
        speedMs: 14,
        targetSpeedMs: 14,
        archetype,
        isTruck: archetype !== 'sedan',
        colorHex,
        x: 0,
        y: 0,
        z: 0,
        yaw: 0,
      };
      this.placeAgentInBubble(agent, i, focusX, focusZ, focusYaw, true);
      this.agents.push(agent);

      tmpColor.set(colorHex);
      this.bodyInst.setColorAt(i, tmpColor);
    }
    if (this.bodyInst.instanceColor) {
      this.bodyInst.instanceColor.needsUpdate = true;
    }
  }

  private placeAgentInBubble(
    agent: TrafficAgent,
    slotIndex: number,
    playerX: number,
    playerZ: number,
    playerYaw: number,
    isInitialSpawn: boolean
  ): void {
    const pFwdX = Math.sin(playerYaw);
    const pFwdZ = Math.cos(playerYaw);
    const wantOncoming = slotIndex % 2 === 0;
    const wantBehind = !wantOncoming && slotIndex % 4 === 3;

    const minDist = isInitialSpawn ? BUBBLE_MIN_M : wantBehind ? 160 : 280;
    const maxDist = isInitialSpawn ? BUBBLE_MAX_M : wantBehind ? 260 : BUBBLE_MAX_M;

    const candidates: {
      seg: CompiledRoadSegment;
      dir: 1 | -1;
      sMeters: number;
      x: number;
      z: number;
      score: number;
    }[] = [];

    for (let sIdx = 0; sIdx < this.roadPool.length; sIdx++) {
      const seg = this.roadPool[sIdx]!;
      if (seg.samples.length < 3 || seg.lengthMeters < 40) continue;

      const step = Math.max(1, Math.floor(seg.samples.length / 18));
      for (let pIdx = 1; pIdx < seg.samples.length - 1; pIdx += step) {
        const pt = seg.samples[pIdx]!;
        const dx = pt.x - playerX;
        const dz = pt.z - playerZ;
        const dist = Math.hypot(dx, dz);
        if (dist < minDist || dist > maxDist) continue;

        const dirX = dx / dist;
        const dirZ = dz / dist;
        const alongPlayer = dirX * pFwdX + dirZ * pFwdZ;

        if (!isInitialSpawn) {
          if (wantBehind && alongPlayer > -0.2) continue;
          if (!wantBehind && alongPlayer < 0.1) continue;
        }

        const dirDot = pt.tx * pFwdX + pt.tz * pFwdZ;
        let travelDir: 1 | -1;
        if (seg.def.oneWay) {
          travelDir = 1;
        } else if (wantOncoming) {
          travelDir = dirDot >= 0 ? -1 : 1;
        } else {
          travelDir = dirDot >= 0 ? 1 : -1;
        }

        const sMeters = THREE.MathUtils.clamp(pt.t * seg.lengthMeters, 12, seg.lengthMeters - 12);
        const rx = -pt.tz * travelDir;
        const rz = pt.tx * travelDir;
        const laneOff = seg.def.width * 0.25;
        const candX = pt.x + rx * laneOff;
        const candZ = pt.z + rz * laneOff;

        if (Math.hypot(candX - playerX, candZ - playerZ) < BUBBLE_MIN_M) continue;

        let tooClose = false;
        for (let j = 0; j < this.agents.length; j++) {
          const other = this.agents[j]!;
          if (other === agent) continue;
          if (Math.hypot(candX - other.x, candZ - other.z) < MIN_SAFE_GAP_M) {
            tooClose = true;
            break;
          }
        }
        if (tooClose) continue;

        const alignBonus = wantOncoming
          ? (pt.tx * travelDir * pFwdX + pt.tz * travelDir * pFwdZ < -0.25 ? 2 : 0)
          : (pt.tx * travelDir * pFwdX + pt.tz * travelDir * pFwdZ > 0.25 ? 2 : 0);
        const score = alignBonus + Math.abs(alongPlayer) + Math.random() * 0.6;
        candidates.push({ seg, dir: travelDir, sMeters, x: candX, z: candZ, score });
      }
    }

    if (candidates.length > 0) {
      candidates.sort((a, b) => b.score - a.score);
      const topSpan = Math.min(candidates.length, 6);
      const pick = candidates[(slotIndex + Math.floor(Math.random() * topSpan)) % topSpan]!;
      agent.segment = pick.seg;
      agent.dir = pick.dir;
      agent.sMeters = pick.sMeters;
      agent.targetSpeedMs = this.speedForAgent(pick.seg, agent.archetype);
      agent.speedMs = agent.targetSpeedMs;
      this.syncAgentPose(agent);
      return;
    }

    // Relaxed fallback within 100..480m on any segment
    for (let sIdx = 0; sIdx < this.builtMap.segments.length; sIdx++) {
      const seg = this.builtMap.segments[(sIdx + slotIndex) % this.builtMap.segments.length]!;
      if (seg.samples.length < 3) continue;
      const mid = seg.samples[Math.floor(seg.samples.length * 0.5)]!;
      const dist = Math.hypot(mid.x - playerX, mid.z - playerZ);
      if (dist >= 90 && dist <= BUBBLE_MAX_M) {
        agent.segment = seg;
        agent.dir = seg.def.oneWay || slotIndex % 2 === 0 ? 1 : -1;
        agent.sMeters = seg.lengthMeters * 0.5;
        agent.targetSpeedMs = this.speedForAgent(seg, agent.archetype);
        agent.speedMs = agent.targetSpeedMs;
        this.syncAgentPose(agent);
        return;
      }
    }

    this.syncAgentPose(agent);
  }

  private syncAgentPose(agent: TrafficAgent): void {
    const t = THREE.MathUtils.clamp(agent.sMeters / agent.segment.lengthMeters, 0, 1);
    const p = agent.segment.curve.getPointAt(t);
    const tan = agent.segment.curve.getTangentAt(t);
    const hLen = Math.hypot(tan.x, tan.z) || 1;
    const tx = tan.x / hLen;
    const tz = tan.z / hLen;

    // Right-hand side of travel
    const rx = -tz * agent.dir;
    const rz = tx * agent.dir;
    const laneOffset = agent.segment.def.width * 0.25;

    agent.x = p.x + rx * laneOffset;
    agent.y = p.y;
    agent.z = p.z + rz * laneOffset;
    agent.yaw = Math.atan2(tx * agent.dir, tz * agent.dir);
  }

  private transitionNextSegment(agent: TrafficAgent): void {
    const arrivedNodeId = agent.dir === 1 ? agent.segment.def.toNodeId : agent.segment.def.fromNodeId;
    const connected = this.nodeConnections.get(arrivedNodeId) ?? [];
    const options = connected.filter((s) => s.def.id !== agent.segment.def.id && s.def.roadClass !== 'urban');
    const nextSeg = options.length > 0
      ? options[Math.floor(Math.random() * options.length)]!
      : agent.segment;

    if (nextSeg.def.fromNodeId === arrivedNodeId) {
      agent.segment = nextSeg;
      agent.dir = 1;
      agent.sMeters = 2;
    } else if (!nextSeg.def.oneWay) {
      agent.segment = nextSeg;
      agent.dir = -1;
      agent.sMeters = nextSeg.lengthMeters - 2;
    } else {
      agent.dir = 1;
      agent.sMeters = 2;
    }
    agent.targetSpeedMs = this.speedForAgent(agent.segment, agent.archetype);
  }

  public update(
    dtSec: number,
    playerX: number,
    playerY: number,
    playerZ: number,
    playerYaw: number,
    trailerX: number,
    trailerZ: number,
    nightFactor = 0,
    rainIntensity = 0
  ): CollisionEvent | null {
    const lightsOn = nightFactor > 0.25 || rainIntensity > 0.25;
    this.headlightMat.color.setHex(lightsOn ? 0xfffbeb : 0xe2e8f0);
    this.taillightMat.color.setHex(lightsOn ? 0xff2d2d : 0xb91c1c);
    let collision: CollisionEvent | null = null;
    if (this.collisionCooldownSec > 0) {
      this.collisionCooldownSec = Math.max(0, this.collisionCooldownSec - dtSec);
    }

    for (let i = 0; i < this.activeCount; i++) {
      const a = this.agents[i]!;

      // Dynamic Traffic Bubble: seamlessly recycle agents outside 520m radius back into 80m..480m around player
      const distSqToPlayer = (a.x - playerX) * (a.x - playerX) + (a.z - playerZ) * (a.z - playerZ);
      if (distSqToPlayer > RECYCLE_DIST_M * RECYCLE_DIST_M) {
        this.placeAgentInBubble(a, i, playerX, playerZ, playerYaw, false);
      }

      let desiredSpeed = a.targetSpeedMs;

      const fwdX = Math.sin(a.yaw);
      const fwdZ = Math.cos(a.yaw);

      // Stop smoothly for RED / AMBER traffic signals at approaching signalized nodes
      const remainingToNode = a.dir === 1 ? a.segment.lengthMeters - a.sMeters : a.sMeters;
      if (remainingToNode < 28 && remainingToNode > 7) {
        const destNodeId = a.dir === 1 ? a.segment.def.toNodeId : a.segment.def.fromNodeId;
        const signal = this.builtMap.getTrafficLightState(destNodeId, fwdX, fwdZ);
        if (signal !== 'green') {
          desiredSpeed = remainingToNode < 14 ? 0 : Math.min(desiredSpeed, ((remainingToNode - 14) / 14) * 6);
        }
      }

      // Check distance to player tractor & trailer ahead in same lane
      for (const [px, pz] of [
        [playerX, playerZ],
        [trailerX, trailerZ],
      ] as const) {
        const dx = px - a.x;
        const dz = pz - a.z;
        const forwardDot = dx * fwdX + dz * fwdZ;
        const lateralDist = Math.abs(dx * -fwdZ + dz * fwdX);
        if (forwardDot > 0 && forwardDot < 34 && lateralDist < 3.4) {
          if (forwardDot < 14) desiredSpeed = 0;
          else desiredSpeed = Math.min(desiredSpeed, ((forwardDot - 14) / 20) * a.targetSpeedMs);
        }
      }

      // Check distance to other AI vehicles ahead
      for (let j = 0; j < this.activeCount; j++) {
        if (i === j) continue;
        const b = this.agents[j]!;
        if (Math.abs(a.y - b.y) > 5) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const forwardDot = dx * fwdX + dz * fwdZ;
        const lateralDist = Math.abs(dx * -fwdZ + dz * fwdX);
        if (forwardDot > 0 && forwardDot < 28 && lateralDist < 2.8) {
          if (forwardDot < 11) desiredSpeed = 0;
          else desiredSpeed = Math.min(desiredSpeed, b.speedMs * 0.9);
        }
      }

      // Smooth accel / braking
      const rate = desiredSpeed < a.speedMs ? 11 : 4.5;
      a.speedMs += (desiredSpeed - a.speedMs) * Math.min(1, dtSec * rate);
      a.sMeters += a.dir * a.speedMs * dtSec;

      if (a.sMeters >= a.segment.lengthMeters - 1 || a.sMeters <= 1) {
        this.transitionNextSegment(a);
      }
      this.syncAgentPose(a);

      // Player collision check
      if (this.collisionCooldownSec <= 0 && Math.abs(a.y - playerY) < 4) {
        const dPlayer = Math.hypot(a.x - playerX, a.z - playerZ);
        if (dPlayer < 3.5) {
          a.speedMs = 0;
          this.collisionCooldownSec = 1.6;
          collision = {
            impactSpeedKmh: 26,
            label:
              a.archetype === 'semi'
                ? '竞争对手半挂车'
                : a.archetype === 'van'
                ? '欧系厢式货车'
                : '社会乘用车',
          };
        }
      }

      // Update instanced matrices for 3 distinct archetypes
      const scaleZ = a.archetype === 'semi' ? 1.85 : a.archetype === 'van' ? 1.16 : 0.96;
      const scaleY = a.archetype === 'semi' ? 1.95 : a.archetype === 'van' ? 1.52 : 0.95;

      this.dummy.position.set(a.x, a.y + 0.62 * scaleY, a.z);
      this.dummy.rotation.set(0, a.yaw, 0);
      this.dummy.scale.set(1, scaleY, scaleZ);
      this.dummy.updateMatrix();
      this.bodyInst.setMatrixAt(i, this.dummy.matrix);

      const cabOff = a.archetype === 'semi' ? 2.45 : a.archetype === 'van' ? 1.55 : -0.2;
      const cabY = a.archetype === 'semi' ? 1.68 : a.archetype === 'van' ? 1.58 : 1.35;
      const cabScaleZ = a.archetype === 'semi' ? 0.56 : a.archetype === 'van' ? 0.58 : 1.0;
      this.dummy.position.set(a.x + fwdX * cabOff, a.y + cabY, a.z + fwdZ * cabOff);
      this.dummy.scale.set(1, 1, cabScaleZ);
      this.dummy.updateMatrix();
      this.cabinInst.setMatrixAt(i, this.dummy.matrix);

      const axleOffset = a.archetype === 'semi' ? 2.55 : a.archetype === 'van' ? 1.65 : 1.35;
      this.dummy.position.set(a.x + fwdX * axleOffset, a.y + 0.36, a.z + fwdZ * axleOffset);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      this.wheelInst.setMatrixAt(i * 2, this.dummy.matrix);

      this.dummy.position.set(a.x - fwdX * axleOffset, a.y + 0.36, a.z - fwdZ * axleOffset);
      this.dummy.updateMatrix();
      this.wheelInst.setMatrixAt(i * 2 + 1, this.dummy.matrix);

      // Front headlights & rear taillights
      const rightX = -fwdZ;
      const rightZ = fwdX;
      const halfLen = 2.3 * scaleZ;
      for (const [idxOffset, side] of [
        [0, -0.74],
        [1, 0.74],
      ] as const) {
        this.dummy.position.set(
          a.x + fwdX * halfLen + rightX * side,
          a.y + 0.65,
          a.z + fwdZ * halfLen + rightZ * side
        );
        this.dummy.rotation.set(0, a.yaw, 0);
        this.dummy.scale.set(1, 1, 1);
        this.dummy.updateMatrix();
        this.headlightInst.setMatrixAt(i * 2 + idxOffset, this.dummy.matrix);

        this.dummy.position.set(
          a.x - fwdX * halfLen + rightX * side,
          a.y + 0.68,
          a.z - fwdZ * halfLen + rightZ * side
        );
        this.dummy.updateMatrix();
        this.taillightInst.setMatrixAt(i * 2 + idxOffset, this.dummy.matrix);
      }

      if (this.shadowInst) {
        this.dummy.position.set(a.x, a.y + 0.032, a.z);
        this.dummy.rotation.set(0, a.yaw, 0);
        this.dummy.scale.set(1, 1, scaleZ * 0.96);
        this.dummy.updateMatrix();
        this.shadowInst.setMatrixAt(i, this.dummy.matrix);
      }
    }

    this.bodyInst.instanceMatrix.needsUpdate = true;
    this.cabinInst.instanceMatrix.needsUpdate = true;
    this.wheelInst.instanceMatrix.needsUpdate = true;
    this.headlightInst.instanceMatrix.needsUpdate = true;
    this.taillightInst.instanceMatrix.needsUpdate = true;
    if (this.shadowInst) {
      this.shadowInst.instanceMatrix.needsUpdate = true;
    }
    return collision;
  }

  public dispose(): void {
    this.bodyInst.dispose();
    this.cabinInst.dispose();
    this.wheelInst.dispose();
    this.headlightInst.dispose();
    this.taillightInst.dispose();
    this.shadowInst?.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
