import * as THREE from 'three';
import {
  CityDefinition,
  CityDepot,
  MapManifest,
  RoadNode,
  RoadSegment,
  ServiceStation,
  SpeedCameraDef,
} from './types';
import { ProceduralTextures } from '../graphics/ProceduralTextures';
import { EnvironmentSystem } from '../graphics/EnvironmentSystem';
import { GeometryBatcher } from '../graphics/GeometryBatcher';
import { SignalState } from '../store/useGameStore';

export interface RoadSamplePoint {
  x: number;
  y: number;
  z: number;
  tx: number;
  tz: number;
  t: number;
}

export interface CompiledRoadSegment {
  def: RoadSegment;
  curve: THREE.CatmullRomCurve3;
  lengthMeters: number;
  samples: RoadSamplePoint[];
}

export interface BoxCollider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  y: number;
  label: string;
}

export interface SpeedCameraInstance {
  def: SpeedCameraDef;
  x: number;
  y: number;
  z: number;
  lastTriggeredMs: number;
}

export interface SurfaceQueryResult {
  groundY: number;
  onRoad: boolean;
  speedLimitKmh: number;
  nearestSegmentId: string | null;
  roadDist: number;
  guardrailPushX: number;
  guardrailPushZ: number;
  guardrailHit: boolean;
}

export interface BuiltMap {
  manifest: MapManifest;
  root: THREE.Group;
  nodeMap: Map<string, RoadNode>;
  segments: CompiledRoadSegment[];
  segmentMap: Map<string, CompiledRoadSegment>;
  speedCameras: SpeedCameraInstance[];
  colliders: BoxCollider[];
  getHeightAt: (x: number, z: number) => number;
  querySurface: (x: number, z: number, out: SurfaceQueryResult) => void;
  getTrafficLightState: (nodeId: string, approachDirX: number, approachDirZ: number) => SignalState;
  highlightDestinationDepot: (depotId: string | null) => void;
  setFoliageDensity: (ratio: number, isLowSpec?: boolean) => void;
  setPbrDetailEnabled: (enabled: boolean) => void;
  setRainWetness: (wet01: number) => void;
  update: (dtSec: number, elapsedSec: number) => void;
  dispose: () => void;
}

interface SpatialCellEntry {
  segIdx: number;
  sampleIdx: number;
}

// Deterministic 2D Value Noise + FBM for realistic Alpine ridges & countryside hills
function hash2(ix: number, iz: number): number {
  const n = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function valueNoise2D(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

function fbmNoise2D(x: number, z: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise2D(x * freq, z * freq);
    freq *= 2.05;
    amp *= 0.5;
  }
  return sum;
}

/**
 * Compiles any MapManifest into an optimized Three.js 3D world featuring
 * multi-frequency vertex-colored Alpine ridges, InstancedMesh European highway
 * infrastructure, 3-species ecology, numbered dock hubs, and O(1) surface queries.
 */
export class MapBuilder {
  private readonly textures: ProceduralTextures;
  private readonly env: EnvironmentSystem;

  constructor(textures: ProceduralTextures, env: EnvironmentSystem) {
    this.textures = textures;
    this.env = env;
  }

  public build(manifest: MapManifest): BuiltMap {
    const root = new THREE.Group();
    root.name = `Map_${manifest.id}`;

    const disposables: { dispose: () => void }[] = [];
    const batcher = new GeometryBatcher();
    const nodeMap = new Map<string, RoadNode>();
    for (const n of manifest.nodes) {
      nodeMap.set(n.id, n);
    }

    // 1. Compile all road splines & samples
    const segments: CompiledRoadSegment[] = [];
    const segmentMap = new Map<string, CompiledRoadSegment>();

    for (const seg of manifest.segments) {
      const fromNode = nodeMap.get(seg.fromNodeId);
      const toNode = nodeMap.get(seg.toNodeId);
      if (!fromNode || !toNode) continue;

      const pts: THREE.Vector3[] = [new THREE.Vector3(...fromNode.position)];
      if (seg.controlPoints) {
        for (const cp of seg.controlPoints) {
          pts.push(new THREE.Vector3(...cp));
        }
      }
      pts.push(new THREE.Vector3(...toNode.position));

      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
      const lengthMeters = Math.max(10, curve.getLength());
      const sampleCount = Math.max(16, Math.ceil(lengthMeters / 6));
      const spaced = curve.getSpacedPoints(sampleCount);

      const samples: RoadSamplePoint[] = [];
      for (let i = 0; i < spaced.length; i++) {
        const p = spaced[i]!;
        const t = i / (spaced.length - 1);
        const tangent = curve.getTangentAt(t);
        const horizLen = Math.hypot(tangent.x, tangent.z) || 1;
        samples.push({
          x: p.x,
          y: p.y,
          z: p.z,
          tx: tangent.x / horizLen,
          tz: tangent.z / horizLen,
          t,
        });
      }

      const compiled: CompiledRoadSegment = { def: seg, curve, lengthMeters, samples };
      segments.push(compiled);
      segmentMap.set(seg.id, compiled);
    }

    // Spatial hash grid for O(1) road lookup (cell size = 40m)
    const cellSize = 40;
    const spatialGrid = new Map<string, SpatialCellEntry[]>();
    const addCell = (gx: number, gz: number, entry: SpatialCellEntry) => {
      const key = `${gx},${gz}`;
      let arr = spatialGrid.get(key);
      if (!arr) {
        arr = [];
        spatialGrid.set(key, arr);
      }
      arr.push(entry);
    };

    for (let sIdx = 0; sIdx < segments.length; sIdx++) {
      const seg = segments[sIdx]!;
      for (let pIdx = 0; pIdx < seg.samples.length; pIdx++) {
        const pt = seg.samples[pIdx]!;
        const gx = Math.floor(pt.x / cellSize);
        const gz = Math.floor(pt.z / cellSize);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) {
            addCell(gx + dx, gz + dz, { segIdx: sIdx, sampleIdx: pIdx });
          }
        }
      }
    }

    const findNearestRoadDistanceAndY = (
      x: number,
      z: number
    ): { dist: number; y: number; seg: CompiledRoadSegment | null } => {
      const gx = Math.floor(x / cellSize);
      const gz = Math.floor(z / cellSize);
      const entries = spatialGrid.get(`${gx},${gz}`);
      let bestDistSq = Infinity;
      let bestY = 0;
      let bestSeg: CompiledRoadSegment | null = null;

      if (entries) {
        for (let i = 0; i < entries.length; i++) {
          const e = entries[i]!;
          const seg = segments[e.segIdx]!;
          const pt = seg.samples[e.sampleIdx]!;
          const dx = x - pt.x;
          const dz = z - pt.z;
          const dSq = dx * dx + dz * dz;
          if (dSq < bestDistSq) {
            bestDistSq = dSq;
            bestY = pt.y;
            bestSeg = seg;
          }
        }
      }

      if (!bestSeg) {
        for (const n of manifest.nodes) {
          const dx = x - n.position[0];
          const dz = z - n.position[2];
          const dSq = dx * dx + dz * dz;
          if (dSq < bestDistSq) {
            bestDistSq = dSq;
            bestY = n.position[1];
          }
        }
      }

      return { dist: Math.sqrt(bestDistSq), y: bestY, seg: bestSeg };
    };

    // 2. Multi-frequency FBM Alpine Ridges + Vertex-Colored Terrain
    const bounds = manifest.worldBounds;
    const spanX = bounds.maxX - bounds.minX;
    const spanZ = bounds.maxZ - bounds.minZ;
    const gridN = 200;
    const heightGrid = new Float32Array((gridN + 1) * (gridN + 1));

    // Extract mountain_peak attractors to sculpt natural connected mountain massifs instead of cone primitives
    const ridgePeaks = manifest.landmarks.filter((l) => l.kind === 'mountain_peak');

    const terrainGeo = new THREE.PlaneGeometry(spanX, spanZ, gridN, gridN);
    terrainGeo.rotateX(-Math.PI / 2);
    const posAttr = terrainGeo.attributes.position as THREE.BufferAttribute;

    for (let i = 0; i < posAttr.count; i++) {
      const vx = posAttr.getX(i) + (bounds.minX + bounds.maxX) * 0.5;
      const vz = posAttr.getZ(i) + (bounds.minZ + bounds.maxZ) * 0.5;
      posAttr.setX(i, vx);
      posAttr.setZ(i, vz);

      const nearest = findNearestRoadDistanceAndY(vx, vz);
      let baseH = nearest.y;

      // Flatten inside city aprons and highway rest stops
      let apronClearance = 1.0;
      for (const city of manifest.cities) {
        const cd = Math.hypot(vx - city.position[0], vz - city.position[2]);
        if (cd < city.radius) {
          const blend = Math.max(0, 1 - cd / city.radius);
          baseH = THREE.MathUtils.lerp(baseH, city.position[1], blend);
          if (cd < 185) apronClearance = 0;
        }
        for (const st of city.stations) {
          const sd = Math.hypot(vx - st.position[0], vz - st.position[2]);
          if (sd < 48) {
            baseH = THREE.MathUtils.lerp(baseH, st.position[1], 1 - sd / 48);
            apronClearance = Math.min(apronClearance, Math.max(0, (sd - 30) / 18));
          }
        }
      }

      // Smoothly isolate road corridors (0 elevation offset within 32m of centerline)
      const rollFactor =
        THREE.MathUtils.clamp((nearest.dist - 32) / 105, 0, 1) * apronClearance;

      const broadNoise = fbmNoise2D(vx * 0.0022 + 12.3, vz * 0.0022 + 7.1, 4);
      const ridgeNoise = 1 - Math.abs(valueNoise2D(vx * 0.0048 + 3.1, vz * 0.0048 - 5.4) * 2 - 1);
      const rollingHills = (broadNoise - 0.38) * 34;

      // Sculpt craggy Alpine ridges around mountain_peak coordinates
      let mountainMassif = 0;
      for (let p = 0; p < ridgePeaks.length; p++) {
        const pk = ridgePeaks[p]!;
        const sx = (pk.scale?.[0] ?? 240) * 1.15;
        const sy = pk.scale?.[1] ?? 180;
        const sz = (pk.scale?.[2] ?? 240) * 1.15;
        const dx = (vx - pk.position[0]) / sx;
        const dz = (vz - pk.position[2]) / sz;
        const distSq = dx * dx + dz * dz;
        if (distSq < 2.2) {
          const envelope = Math.exp(-distSq * 1.55);
          const crag = 0.58 + ridgeNoise * 0.62 + (broadNoise - 0.45) * 0.4;
          mountainMassif = Math.max(mountainMassif, sy * envelope * crag);
        }
      }

      // Background Alpine border framing the southeast
      const alpineZone =
        vx > 200 && vz > 180
          ? THREE.MathUtils.clamp(((vx - 200) * (vz - 180)) / 520000, 0, 1) *
            (22 + ridgeNoise * 55)
          : 0;

      const finalY = baseH - 0.34 + (rollingHills + mountainMassif + alpineZone) * rollFactor;
      posAttr.setY(i, finalY);
      heightGrid[i] = finalY;
    }

    terrainGeo.computeVertexNormals();

    // Compute per-vertex biome colors: lowland meadow + farmland patchwork -> mid-rock -> alpine snow
    const normAttr = terrainGeo.attributes.normal as THREE.BufferAttribute;
    const vertColors = new Float32Array(posAttr.count * 3);
    const colMeadow = new THREE.Color('#8fae7a');
    const colWheat = new THREE.Color('#c8b674');
    const colSoil = new THREE.Color('#8f795a');
    const colRock = new THREE.Color('#7a736a');
    const colSnow = new THREE.Color('#f1f5f9');
    const tmpVertCol = new THREE.Color();

    for (let i = 0; i < posAttr.count; i++) {
      const vx = posAttr.getX(i);
      const vy = posAttr.getY(i);
      const vz = posAttr.getZ(i);
      const slopeUp = normAttr.getY(i); // 1 = flat, < 0.78 = steep cliff

      // Farmland patchwork stripes in flat countryside lowlands
      const farmPattern = valueNoise2D(Math.floor(vx / 140) * 1.37, Math.floor(vz / 110) * 2.13);
      if (vy < 24 && slopeUp > 0.9 && !(vx > 300 && vz > 300)) {
        if (farmPattern > 0.74) {
          tmpVertCol.copy(colWheat);
        } else if (farmPattern < 0.22) {
          tmpVertCol.copy(colSoil);
        } else {
          tmpVertCol.copy(colMeadow);
        }
      } else {
        tmpVertCol.copy(colMeadow);
      }

      // Transition to grey-brown rock on cliffs or mid-elevation slopes
      const rockByHeight = THREE.MathUtils.clamp((vy - 28) / 36, 0, 1);
      const rockBySlope = THREE.MathUtils.clamp((0.86 - slopeUp) / 0.2, 0, 1);
      const rockFactor = Math.max(rockByHeight, rockBySlope);
      tmpVertCol.lerp(colRock, rockFactor);

      // Transition to natural snow cap above 72m on non-vertical faces
      const snowNoise = (valueNoise2D(vx * 0.015, vz * 0.015) - 0.5) * 18;
      const snowByHeight = THREE.MathUtils.clamp((vy + snowNoise - 68) / 34, 0, 1);
      const snowSlopeMask = THREE.MathUtils.clamp((slopeUp - 0.52) / 0.26, 0, 1);
      tmpVertCol.lerp(colSnow, snowByHeight * snowSlopeMask);

      vertColors[i * 3] = tmpVertCol.r;
      vertColors[i * 3 + 1] = tmpVertCol.g;
      vertColors[i * 3 + 2] = tmpVertCol.b;
    }
    terrainGeo.setAttribute('color', new THREE.BufferAttribute(vertColors, 3));

    const pbrMaterialBindings: {
      mat: THREE.MeshStandardMaterial;
      roughnessMap: THREE.CanvasTexture;
      bumpMap: THREE.CanvasTexture;
      bumpScale: number;
    }[] = [];

    const terrainPbr = this.textures.getTerrainTextures();
    const terrainMat = new THREE.MeshStandardMaterial({
      map: terrainPbr.map,
      roughnessMap: terrainPbr.roughnessMap,
      bumpMap: terrainPbr.bumpMap,
      bumpScale: 0.14,
      vertexColors: true,
      roughness: 0.93,
      metalness: 0.02,
    });
    pbrMaterialBindings.push({
      mat: terrainMat,
      roughnessMap: terrainPbr.roughnessMap,
      bumpMap: terrainPbr.bumpMap,
      bumpScale: 0.14,
    });
    const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
    terrainMesh.receiveShadow = true;
    root.add(terrainMesh);
    disposables.push(terrainGeo, terrainMat);

    const getHeightAt = (x: number, z: number): number => {
      const u = THREE.MathUtils.clamp((x - bounds.minX) / spanX, 0, 1);
      const v = THREE.MathUtils.clamp((z - bounds.minZ) / spanZ, 0, 1);
      const fx = u * gridN;
      const fz = v * gridN;
      const ix = Math.min(gridN - 1, Math.floor(fx));
      const iz = Math.min(gridN - 1, Math.floor(fz));
      const tx = fx - ix;
      const tz = fz - iz;
      const stride = gridN + 1;
      const h00 = heightGrid[iz * stride + ix] ?? 0;
      const h10 = heightGrid[iz * stride + ix + 1] ?? 0;
      const h01 = heightGrid[(iz + 1) * stride + ix] ?? 0;
      const h11 = heightGrid[(iz + 1) * stride + ix + 1] ?? 0;
      const h0 = h00 + (h10 - h00) * tx;
      const h1 = h01 + (h11 - h01) * tx;
      return h0 + (h1 - h0) * tz;
    };

    // 3. Build continuous road ribbons + graded gravel shoulder embankment + junction discs
    const roadGroup = new THREE.Group();
    root.add(roadGroup);

    const skirtMat = new THREE.MeshStandardMaterial({
      color: '#5a6065',
      roughness: 0.92,
      metalness: 0.03,
    });
    disposables.push(skirtMat);

    const roadMaterials: THREE.MeshStandardMaterial[] = [];
    const roadMatByClass = new Map<string, THREE.MeshStandardMaterial>();

    for (const seg of segments) {
      const roadClassKey = `${seg.def.lanes}_${seg.def.roadClass}`;
      let segMat = roadMatByClass.get(roadClassKey);
      if (!segMat) {
        const roadPbr = this.textures.getRoadTextures(seg.def.lanes, seg.def.roadClass);
        segMat = new THREE.MeshStandardMaterial({
          map: roadPbr.map,
          roughnessMap: roadPbr.roughnessMap,
          bumpMap: roadPbr.bumpMap,
          bumpScale: 0.035,
          roughness: 0.85,
          metalness: 0.04,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        });
        roadMatByClass.set(roadClassKey, segMat);
        roadMaterials.push(segMat);
        pbrMaterialBindings.push({
          mat: segMat,
          roughnessMap: roadPbr.roughnessMap,
          bumpMap: roadPbr.bumpMap,
          bumpScale: 0.035,
        });
        disposables.push(segMat);
      }

      const n = seg.samples.length;
      const halfW = seg.def.width * 0.5;
      const positions = new Float32Array(n * 2 * 3);
      const normals = new Float32Array(n * 2 * 3);
      const uvs = new Float32Array(n * 2 * 2);
      const indices: number[] = [];

      // 6-vertex cross-section embankment skirt: graded gravel shoulder -> slope down into terrain
      const skirtPos = new Float32Array(n * 6 * 3);
      const skirtIndices: number[] = [];

      let accumLen = 0;
      for (let i = 0; i < n; i++) {
        const s = seg.samples[i]!;
        if (i > 0) {
          const prev = seg.samples[i - 1]!;
          accumLen += Math.hypot(s.x - prev.x, s.y - prev.y, s.z - prev.z);
        }
        const rx = -s.tz;
        const rz = s.tx;

        const lx = s.x - rx * halfW;
        const lz = s.z - rz * halfW;
        const rpx = s.x + rx * halfW;
        const rpz = s.z + rz * halfW;

        const vBase = i * 6;
        positions[vBase] = lx;
        positions[vBase + 1] = s.y + 0.06;
        positions[vBase + 2] = lz;
        positions[vBase + 3] = rpx;
        positions[vBase + 4] = s.y + 0.06;
        positions[vBase + 5] = rpz;

        normals[vBase] = 0;
        normals[vBase + 1] = 1;
        normals[vBase + 2] = 0;
        normals[vBase + 3] = 0;
        normals[vBase + 4] = 1;
        normals[vBase + 5] = 0;

        const uvBase = i * 4;
        const vCoord = accumLen / 16;
        uvs[uvBase] = 0;
        uvs[uvBase + 1] = vCoord;
        uvs[uvBase + 2] = 1;
        uvs[uvBase + 3] = vCoord;

        // Graded gravel shoulder (+1.6m, -0.10m) then embankment slope (+4.2m, -4.0m)
        const sb = i * 18;
        // Left: edge (0), gravel shoulder (1), toe (2)
        skirtPos[sb] = lx;
        skirtPos[sb + 1] = s.y + 0.05;
        skirtPos[sb + 2] = lz;
        skirtPos[sb + 3] = lx - rx * 1.6;
        skirtPos[sb + 4] = s.y - 0.12;
        skirtPos[sb + 5] = lz - rz * 1.6;
        skirtPos[sb + 6] = lx - rx * 4.2;
        skirtPos[sb + 7] = s.y - 4.0;
        skirtPos[sb + 8] = lz - rz * 4.2;

        // Right: edge (3), gravel shoulder (4), toe (5)
        skirtPos[sb + 9] = rpx;
        skirtPos[sb + 10] = s.y + 0.05;
        skirtPos[sb + 11] = rpz;
        skirtPos[sb + 12] = rpx + rx * 1.6;
        skirtPos[sb + 13] = s.y - 0.12;
        skirtPos[sb + 14] = rpz + rz * 1.6;
        skirtPos[sb + 15] = rpx + rx * 4.2;
        skirtPos[sb + 16] = s.y - 4.0;
        skirtPos[sb + 17] = rpz + rz * 4.2;

        if (i < n - 1) {
          const a = i * 2;
          const b = a + 1;
          const c = a + 2;
          const d = a + 3;
          // Counter-clockwise +Y upward-facing triangle winding
          indices.push(a, b, c, b, d, c);

          const sa = i * 6;
          // Left shoulder + embankment (+Y outward winding)
          skirtIndices.push(sa, sa + 6, sa + 1, sa + 1, sa + 6, sa + 7);
          skirtIndices.push(sa + 1, sa + 7, sa + 2, sa + 2, sa + 7, sa + 8);
          // Right shoulder + embankment (+Y outward winding)
          skirtIndices.push(sa + 3, sa + 4, sa + 9, sa + 4, sa + 10, sa + 9);
          skirtIndices.push(sa + 4, sa + 5, sa + 10, sa + 5, sa + 11, sa + 10);
        }
      }

      const roadGeo = new THREE.BufferGeometry();
      roadGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      roadGeo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      roadGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      roadGeo.setIndex(indices);
      batcher.add(segMat, roadGeo, { receiveShadow: true });
      disposables.push(roadGeo);

      const skirtGeo = new THREE.BufferGeometry();
      skirtGeo.setAttribute('position', new THREE.BufferAttribute(skirtPos, 3));
      skirtGeo.setIndex(skirtIndices);
      skirtGeo.computeVertexNormals();
      batcher.add(skirtMat, skirtGeo, { receiveShadow: true });
      disposables.push(skirtGeo);
    }

    const junctionMat = new THREE.MeshStandardMaterial({
      color: '#3c4048',
      roughness: 0.88,
      metalness: 0.04,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    disposables.push(junctionMat);

    const islandMat = new THREE.MeshStandardMaterial({ color: '#4c6642', roughness: 0.9 });
    disposables.push(islandMat);

    for (const node of manifest.nodes) {
      const radius = node.kind === 'roundabout' ? 18 : node.kind === 'intersection' ? 12.5 : 10.5;
      const discGeo = new THREE.CylinderGeometry(radius, radius + 1.5, 0.35, 20);
      batcher.add(junctionMat, discGeo, {
        x: node.position[0],
        y: node.position[1] - 0.14,
        z: node.position[2],
        receiveShadow: true,
      });
      disposables.push(discGeo);

      if (node.kind === 'roundabout') {
        const islandGeo = new THREE.CylinderGeometry(5.5, 6.2, 0.7, 18);
        batcher.add(islandMat, islandGeo, {
          x: node.position[0],
          y: node.position[1] + 0.2,
          z: node.position[2],
        });
        disposables.push(islandGeo);
      }
    }

    // 3b. Batched European Cantilever Traffic Lights at signalized junctions
    interface TrafficSignalStateGroup {
      nodeId: string;
      phaseOffset: number;
    }
    const signalNodesList: TrafficSignalStateGroup[] = [];
    const signalNodes = manifest.nodes.filter((n) => n.trafficLight);

    const makeLensMat = (color: string) => {
      const m = new THREE.MeshStandardMaterial({
        color: '#1e293b',
        emissive: color,
        emissiveIntensity: 0,
        roughness: 0.25,
      });
      disposables.push(m);
      return m;
    };
    const nsRedMat = makeLensMat('#ef4444');
    const nsAmberMat = makeLensMat('#f59e0b');
    const nsGreenMat = makeLensMat('#22c55e');
    const ewRedMat = makeLensMat('#ef4444');
    const ewAmberMat = makeLensMat('#f59e0b');
    const ewGreenMat = makeLensMat('#22c55e');

    if (signalNodes.length > 0) {
      const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 5.8, 8);
      const armGeo = new THREE.BoxGeometry(5.2, 0.16, 0.16);
      const headGeo = new THREE.BoxGeometry(0.44, 1.35, 0.36);
      const lensGeo = new THREE.CircleGeometry(0.14, 12);
      const steelMat = new THREE.MeshStandardMaterial({ color: '#334155', metalness: 0.65, roughness: 0.4 });
      const housingMat = new THREE.MeshStandardMaterial({ color: '#0f172a', roughness: 0.6 });
      disposables.push(poleGeo, armGeo, headGeo, lensGeo, steelMat, housingMat);

      const perAxisLensCount = signalNodes.length * 2;
      const nsRedInst = new THREE.InstancedMesh(lensGeo, nsRedMat, perAxisLensCount);
      const nsAmberInst = new THREE.InstancedMesh(lensGeo, nsAmberMat, perAxisLensCount);
      const nsGreenInst = new THREE.InstancedMesh(lensGeo, nsGreenMat, perAxisLensCount);
      const ewRedInst = new THREE.InstancedMesh(lensGeo, ewRedMat, perAxisLensCount);
      const ewAmberInst = new THREE.InstancedMesh(lensGeo, ewAmberMat, perAxisLensCount);
      const ewGreenInst = new THREE.InstancedMesh(lensGeo, ewGreenMat, perAxisLensCount);

      const tmpObj = new THREE.Object3D();
      const tmpChild = new THREE.Object3D();
      tmpObj.add(tmpChild);

      for (let i = 0; i < signalNodes.length; i++) {
        const node = signalNodes[i]!;
        signalNodesList.push({ nodeId: node.id, phaseOffset: 0 });
        const [nx, ny, nz] = node.position;

        const addSignalCorner = (cx: number, cz: number, rotY: number, isNs: boolean) => {
          tmpObj.position.set(cx, ny, cz);
          tmpObj.rotation.set(0, rotY, 0);
          tmpObj.updateMatrixWorld(true);

          tmpChild.position.set(0, 2.9, 0);
          tmpChild.rotation.set(0, 0, 0);
          tmpChild.updateMatrixWorld();
          batcher.add(steelMat, poleGeo, { matrix: tmpChild.matrixWorld });

          tmpChild.position.set(2.4, 5.65, 0);
          tmpChild.updateMatrixWorld();
          batcher.add(steelMat, armGeo, { matrix: tmpChild.matrixWorld });

          tmpChild.position.set(4.1, 5.2, 0);
          tmpChild.updateMatrixWorld();
          batcher.add(housingMat, headGeo, { matrix: tmpChild.matrixWorld });

          const lensSides = [0.19, -0.19] as const;
          for (let sIdx = 0; sIdx < lensSides.length; sIdx++) {
            const sideZ = lensSides[sIdx]!;
            const instIdx = i * 2 + sIdx;
            tmpChild.rotation.set(0, sideZ > 0 ? 0 : Math.PI, 0);

            tmpChild.position.set(4.1, 5.62, sideZ);
            tmpChild.updateMatrixWorld();
            (isNs ? nsRedInst : ewRedInst).setMatrixAt(instIdx, tmpChild.matrixWorld);

            tmpChild.position.set(4.1, 5.2, sideZ);
            tmpChild.updateMatrixWorld();
            (isNs ? nsAmberInst : ewAmberInst).setMatrixAt(instIdx, tmpChild.matrixWorld);

            tmpChild.position.set(4.1, 4.78, sideZ);
            tmpChild.updateMatrixWorld();
            (isNs ? nsGreenInst : ewGreenInst).setMatrixAt(instIdx, tmpChild.matrixWorld);
          }
        };

        addSignalCorner(nx - 10.5, nz - 10.5, 0, true);
        addSignalCorner(nx + 10.5, nz + 10.5, Math.PI / 2, false);
      }

      for (const inst of [nsRedInst, nsAmberInst, nsGreenInst, ewRedInst, ewAmberInst, ewGreenInst]) {
        inst.instanceMatrix.needsUpdate = true;
        inst.layers.set(1);
        root.add(inst);
      }
    }

    // 4. InstancedMesh Highway Infrastructure: Guardrails, Delineators, Noise Barriers, Street Lights, Gantries
    const dummy = new THREE.Object3D();
    const railTransforms: { x: number; y: number; z: number; rotY: number }[] = [];
    const delineatorTransforms: { x: number; y: number; z: number; rotY: number; isRight: boolean }[] = [];
    const noiseBarrierTransforms: { x: number; y: number; z: number; rotY: number }[] = [];
    const lightTransforms: { x: number; y: number; z: number; rotY: number }[] = [];

    for (const seg of segments) {
      const halfW = seg.def.width * 0.5;
      if (seg.def.hasGuardrails) {
        for (let i = 2; i < seg.samples.length - 2; i += 2) {
          const s = seg.samples[i]!;
          const rx = -s.tz;
          const rz = s.tx;
          const rotY = Math.atan2(s.tx, s.tz);
          railTransforms.push({ x: s.x - rx * (halfW + 0.75), y: s.y, z: s.z - rz * (halfW + 0.75), rotY });
          railTransforms.push({ x: s.x + rx * (halfW + 0.75), y: s.y, z: s.z + rz * (halfW + 0.75), rotY });

          if (i % 4 === 2) {
            delineatorTransforms.push({ x: s.x - rx * (halfW + 1.15), y: s.y, z: s.z - rz * (halfW + 1.15), rotY, isRight: false });
            delineatorTransforms.push({ x: s.x + rx * (halfW + 1.15), y: s.y, z: s.z + rz * (halfW + 1.15), rotY, isRight: true });
          }
        }
      }
      if (seg.def.hasNoiseBarrier) {
        for (let i = 4; i < seg.samples.length - 4; i += 2) {
          const s = seg.samples[i]!;
          const rx = -s.tz;
          const rz = s.tx;
          const rotY = Math.atan2(s.tx, s.tz);
          noiseBarrierTransforms.push({
            x: s.x + rx * (halfW + 2.4),
            y: s.y,
            z: s.z + rz * (halfW + 2.4),
            rotY,
          });
        }
      }
      if (seg.def.hasStreetLights) {
        for (let i = 4; i < seg.samples.length - 4; i += 8) {
          const s = seg.samples[i]!;
          const rx = -s.tz;
          const rz = s.tx;
          const rotY = Math.atan2(s.tx, s.tz);
          const side = (i / 8) % 2 === 0 ? 1 : -1;
          lightTransforms.push({
            x: s.x + rx * side * (halfW + 1.4),
            y: s.y,
            z: s.z + rz * side * (halfW + 1.4),
            rotY: side > 0 ? rotY : rotY + Math.PI,
          });
        }
      }
    }

    // Continuous Guardrails (12m step -> 12.6m rail beams so zero floating gaps)
    if (railTransforms.length > 0) {
      const guardrailPostGeo = new THREE.BoxGeometry(0.14, 0.78, 0.14);
      const guardrailPostMat = new THREE.MeshStandardMaterial({ color: '#94a3b8', metalness: 0.65, roughness: 0.4 });
      const guardrailRailGeo = new THREE.BoxGeometry(0.12, 0.26, 12.6);
      const guardrailRailMat = new THREE.MeshStandardMaterial({ color: '#cbd5e1', metalness: 0.72, roughness: 0.34 });
      disposables.push(guardrailPostGeo, guardrailPostMat, guardrailRailGeo, guardrailRailMat);

      const postInst = new THREE.InstancedMesh(guardrailPostGeo, guardrailPostMat, railTransforms.length);
      const railInst = new THREE.InstancedMesh(guardrailRailGeo, guardrailRailMat, railTransforms.length);
      for (let i = 0; i < railTransforms.length; i++) {
        const tf = railTransforms[i]!;
        dummy.position.set(tf.x, tf.y + 0.36, tf.z);
        dummy.rotation.set(0, tf.rotY, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        postInst.setMatrixAt(i, dummy.matrix);

        dummy.position.set(tf.x, tf.y + 0.62, tf.z);
        dummy.updateMatrix();
        railInst.setMatrixAt(i, dummy.matrix);
      }
      postInst.instanceMatrix.needsUpdate = true;
      railInst.instanceMatrix.needsUpdate = true;
      root.add(postInst, railInst);
    }

    // Delineator Posts (Euro red/white reflectors)
    let delinPostInst: THREE.InstancedMesh | null = null;
    let delinReflectInst: THREE.InstancedMesh | null = null;
    if (delineatorTransforms.length > 0) {
      const delinGeo = new THREE.BoxGeometry(0.12, 0.95, 0.08);
      const delinMat = new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.5 });
      const capGeo = new THREE.BoxGeometry(0.13, 0.22, 0.1);
      const capMat = new THREE.MeshStandardMaterial({
        color: '#ef4444',
        emissive: '#dc2626',
        emissiveIntensity: 0.45,
      });
      disposables.push(delinGeo, delinMat, capGeo, capMat);

      delinPostInst = new THREE.InstancedMesh(delinGeo, delinMat, delineatorTransforms.length);
      delinReflectInst = new THREE.InstancedMesh(capGeo, capMat, delineatorTransforms.length);
      const tmpC = new THREE.Color();
      for (let i = 0; i < delineatorTransforms.length; i++) {
        const tf = delineatorTransforms[i]!;
        dummy.position.set(tf.x, tf.y + 0.46, tf.z);
        dummy.rotation.set(0, tf.rotY, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        delinPostInst.setMatrixAt(i, dummy.matrix);

        dummy.position.set(tf.x, tf.y + 0.78, tf.z);
        dummy.updateMatrix();
        delinReflectInst.setMatrixAt(i, dummy.matrix);
        tmpC.set(tf.isRight ? '#ef4444' : '#f8fafc');
        delinReflectInst.setColorAt(i, tmpC);
      }
      delinPostInst.instanceMatrix.needsUpdate = true;
      delinReflectInst.instanceMatrix.needsUpdate = true;
      if (delinReflectInst.instanceColor) delinReflectInst.instanceColor.needsUpdate = true;
      delinPostInst.layers.set(1);
      delinReflectInst.layers.set(1);
      root.add(delinPostInst, delinReflectInst);
    }

    // Continuous Acoustic Noise Barriers (12m step -> 12.4m panels)
    let noiseBarrierInst: THREE.InstancedMesh | null = null;
    if (noiseBarrierTransforms.length > 0) {
      const nbGeo = new THREE.BoxGeometry(0.24, 3.2, 12.4);
      const nbMat = new THREE.MeshStandardMaterial({ color: '#475a52', roughness: 0.8 });
      disposables.push(nbGeo, nbMat);
      noiseBarrierInst = new THREE.InstancedMesh(nbGeo, nbMat, noiseBarrierTransforms.length);
      for (let i = 0; i < noiseBarrierTransforms.length; i++) {
        const tf = noiseBarrierTransforms[i]!;
        dummy.position.set(tf.x, tf.y + 1.55, tf.z);
        dummy.rotation.set(0, tf.rotY, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        noiseBarrierInst.setMatrixAt(i, dummy.matrix);
      }
      noiseBarrierInst.instanceMatrix.needsUpdate = true;
      noiseBarrierInst.layers.set(1);
      root.add(noiseBarrierInst);
    }

    // Street Lights & Floodlight Mast Material (linked to EnvironmentSystem night factor)
    const lampHeadMat = new THREE.MeshStandardMaterial({
      color: '#fef3c7',
      emissive: '#fbbf24',
      emissiveIntensity: 0.25,
      roughness: 0.3,
    });
    this.env.setStreetLampMaterial(lampHeadMat);
    disposables.push(lampHeadMat);

    if (lightTransforms.length > 0) {
      const poleGeo = new THREE.CylinderGeometry(0.11, 0.16, 7.6, 6);
      const poleMat = new THREE.MeshStandardMaterial({ color: '#475569', metalness: 0.6, roughness: 0.45 });
      const headGeo = new THREE.BoxGeometry(1.1, 0.18, 0.42);
      disposables.push(poleGeo, poleMat, headGeo);

      const poleInst = new THREE.InstancedMesh(poleGeo, poleMat, lightTransforms.length);
      const headInst = new THREE.InstancedMesh(headGeo, lampHeadMat, lightTransforms.length);

      for (let i = 0; i < lightTransforms.length; i++) {
        const tf = lightTransforms[i]!;
        dummy.position.set(tf.x, tf.y + 3.8, tf.z);
        dummy.rotation.set(0, tf.rotY, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        poleInst.setMatrixAt(i, dummy.matrix);

        const armOffsetX = -Math.cos(tf.rotY) * 0.55;
        const armOffsetZ = Math.sin(tf.rotY) * 0.55;
        dummy.position.set(tf.x + armOffsetX, tf.y + 7.55, tf.z + armOffsetZ);
        dummy.updateMatrix();
        headInst.setMatrixAt(i, dummy.matrix);
      }
      poleInst.instanceMatrix.needsUpdate = true;
      headInst.instanceMatrix.needsUpdate = true;
      poleInst.layers.set(1);
      headInst.layers.set(1);
      root.add(poleInst, headInst);
    }

    // Overhead Motorway Gantries (batched steel truss + procedural Euro sign faces)
    if (manifest.gantries && manifest.gantries.length > 0) {
      const gantryList = manifest.gantries;
      const gPostGeo = new THREE.CylinderGeometry(0.2, 0.24, 7.4, 8);
      const gBeamGeo = new THREE.BoxGeometry(20, 0.48, 0.52);
      const gSteelMat = new THREE.MeshStandardMaterial({ color: '#94a3b8', metalness: 0.65, roughness: 0.38 });
      const signGeo = new THREE.PlaneGeometry(8.6, 3.2);
      disposables.push(gPostGeo, gBeamGeo, gSteelMat, signGeo);

      const gantryPostInst = new THREE.InstancedMesh(gPostGeo, gSteelMat, gantryList.length * 2);
      const gantryBeamInst = new THREE.InstancedMesh(gBeamGeo, gSteelMat, gantryList.length);

      for (let i = 0; i < gantryList.length; i++) {
        const g = gantryList[i]!;
        const seg = segmentMap.get(g.segmentId);
        if (!seg) continue;
        const t = THREE.MathUtils.clamp(g.t, 0.08, 0.92);
        const p = seg.curve.getPointAt(t);
        const tan = seg.curve.getTangentAt(t);
        const len = Math.hypot(tan.x, tan.z) || 1;
        const rx = -tan.z / len;
        const rz = tan.x / len;
        const rotY = Math.atan2(tan.x, tan.z);
        const halfSpan = seg.def.width * 0.5 + 1.4;

        dummy.position.set(p.x - rx * halfSpan, p.y + 3.7, p.z - rz * halfSpan);
        dummy.rotation.set(0, rotY, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        gantryPostInst.setMatrixAt(i * 2, dummy.matrix);

        dummy.position.set(p.x + rx * halfSpan, p.y + 3.7, p.z + rz * halfSpan);
        dummy.updateMatrix();
        gantryPostInst.setMatrixAt(i * 2 + 1, dummy.matrix);

        dummy.position.set(p.x, p.y + 7.2, p.z);
        dummy.scale.set((halfSpan * 2 + 0.8) / 20, 1, 1);
        dummy.updateMatrix();
        gantryBeamInst.setMatrixAt(i, dummy.matrix);

        const signTex = this.textures.getHighwayGantryTexture(
          g.routeCode,
          g.destinationLabel,
          g.distanceLabel,
          g.style
        );
        const signMat = new THREE.MeshStandardMaterial({
          map: signTex,
          roughness: 0.45,
          metalness: 0.1,
          side: THREE.DoubleSide,
        });
        const signMesh = new THREE.Mesh(signGeo, signMat);
        signMesh.position.set(p.x, p.y + 7.1, p.z);
        signMesh.rotation.y = rotY;
        signMesh.layers.set(1);
        root.add(signMesh);
        disposables.push(signMat);
      }

      gantryPostInst.instanceMatrix.needsUpdate = true;
      gantryBeamInst.instanceMatrix.needsUpdate = true;
      gantryPostInst.layers.set(1);
      gantryBeamInst.layers.set(1);
      root.add(gantryPostInst, gantryBeamInst);
    }

    // 5. Speed Cameras (poles & boxes batched, signs on Layer 1)
    const speedCameras: SpeedCameraInstance[] = [];
    const camPoleGeo = new THREE.CylinderGeometry(0.12, 0.15, 5.2, 8);
    const camBoxGeo = new THREE.BoxGeometry(0.8, 0.9, 0.6);
    const camMat = new THREE.MeshStandardMaterial({ color: '#334155', metalness: 0.5, roughness: 0.4 });
    disposables.push(camPoleGeo, camBoxGeo, camMat);

    for (const sc of manifest.speedCameras) {
      const seg = segmentMap.get(sc.segmentId);
      if (!seg) continue;
      const p = seg.curve.getPointAt(THREE.MathUtils.clamp(sc.t, 0.05, 0.95));
      const tan = seg.curve.getTangentAt(THREE.MathUtils.clamp(sc.t, 0.05, 0.95));
      const len = Math.hypot(tan.x, tan.z) || 1;
      const rx = -tan.z / len;
      const rz = tan.x / len;
      const sideOffset = seg.def.width * 0.5 + 2.4;
      const cx = p.x + rx * sideOffset;
      const cz = p.z + rz * sideOffset;
      const rotY = Math.atan2(tan.x, tan.z);

      batcher.add(camMat, camPoleGeo, { x: cx, y: p.y + 2.6, z: cz, layer: 1 });
      batcher.add(camMat, camBoxGeo, { x: cx, y: p.y + 5.1, z: cz, rotY, layer: 1 });

      const signTex = this.textures.getSpeedSignTexture(sc.speedLimitKmh);
      const signGeo = new THREE.CircleGeometry(0.62, 20);
      const signMat = new THREE.MeshBasicMaterial({ map: signTex, side: THREE.DoubleSide });
      const signMesh = new THREE.Mesh(signGeo, signMat);
      signMesh.position.set(cx, p.y + 3.7, cz);
      signMesh.rotation.y = rotY;
      signMesh.layers.set(1);

      root.add(signMesh);
      disposables.push(signGeo, signMat);

      speedCameras.push({
        def: sc,
        x: p.x,
        y: p.y,
        z: p.z,
        lastTriggeredMs: 0,
      });
    }

    // 6. Cities, Numbered Dock Warehouses, Yard Containers/Pallets (Instanced), & Service Stations
    const colliders: BoxCollider[] = [];
    const depotBayTransforms = new Map<
      string,
      { x: number; y: number; z: number; headingRad: number }
    >();
    const parkingBeaconMeshes = new Map<string, THREE.Mesh>();

    const yardPbr = this.textures.getYardConcreteTextures();
    const yardApronMat = new THREE.MeshStandardMaterial({
      map: yardPbr.map,
      roughnessMap: yardPbr.roughnessMap,
      bumpMap: yardPbr.bumpMap,
      bumpScale: 0.045,
      roughness: 0.86,
      metalness: 0.05,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    pbrMaterialBindings.push({
      mat: yardApronMat,
      roughnessMap: yardPbr.roughnessMap,
      bumpMap: yardPbr.bumpMap,
      bumpScale: 0.045,
    });
    const bayTexture = this.textures.getParkingBayTexture();
    const inactiveBayMat = new THREE.MeshBasicMaterial({
      map: bayTexture,
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
      color: '#64748b',
    });
    const activeBayGeo = new THREE.PlaneGeometry(5.4, 18.5);
    const activeBayMat = new THREE.MeshBasicMaterial({
      map: bayTexture,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      color: '#34d399',
    });
    const activeBayMesh = new THREE.Mesh(activeBayGeo, activeBayMat);
    activeBayMesh.visible = false;
    root.add(activeBayMesh);
    disposables.push(yardApronMat, inactiveBayMat, activeBayGeo, activeBayMat);

    const yardContainerSpots: { x: number; y: number; z: number; rotY: number; color: string }[] = [];
    const yardPalletSpots: { x: number; y: number; z: number; rotY: number }[] = [];
    const yardFloodLightSpots: { x: number; y: number; z: number }[] = [];

    const sharedMats = this.createBatchMaterials(disposables);

    for (const city of manifest.cities) {
      this.buildCityArea(
        city,
        root,
        batcher,
        yardApronMat,
        inactiveBayMat,
        sharedMats,
        depotBayTransforms,
        parkingBeaconMeshes,
        colliders,
        yardContainerSpots,
        yardPalletSpots,
        yardFloodLightSpots,
        disposables
      );
    }

    // Batch all yard stacked containers & pallets into 2 InstancedMeshes
    let yardContInst: THREE.InstancedMesh | null = null;
    if (yardContainerSpots.length > 0) {
      const cGeo = new THREE.BoxGeometry(2.5, 2.6, 6.2);
      const cMat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.25 });
      disposables.push(cGeo, cMat);
      yardContInst = new THREE.InstancedMesh(cGeo, cMat, yardContainerSpots.length);
      yardContInst.layers.set(1);
      const tmpC = new THREE.Color();
      for (let i = 0; i < yardContainerSpots.length; i++) {
        const s = yardContainerSpots[i]!;
        dummy.position.set(s.x, s.y, s.z);
        dummy.rotation.set(0, s.rotY, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        yardContInst.setMatrixAt(i, dummy.matrix);
        tmpC.set(s.color);
        yardContInst.setColorAt(i, tmpC);
      }
      yardContInst.instanceMatrix.needsUpdate = true;
      if (yardContInst.instanceColor) yardContInst.instanceColor.needsUpdate = true;
      root.add(yardContInst);
    }

    let yardPalletInst: THREE.InstancedMesh | null = null;
    if (yardPalletSpots.length > 0) {
      const pGeo = new THREE.BoxGeometry(1.4, 1.1, 1.4);
      const pMat = new THREE.MeshStandardMaterial({ color: '#b48a5a', roughness: 0.88 });
      disposables.push(pGeo, pMat);
      yardPalletInst = new THREE.InstancedMesh(pGeo, pMat, yardPalletSpots.length);
      for (let i = 0; i < yardPalletSpots.length; i++) {
        const s = yardPalletSpots[i]!;
        dummy.position.set(s.x, s.y + 0.55, s.z);
        dummy.rotation.set(0, s.rotY, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        yardPalletInst.setMatrixAt(i, dummy.matrix);
      }
      yardPalletInst.instanceMatrix.needsUpdate = true;
      yardPalletInst.layers.set(1);
      root.add(yardPalletInst);
    }

    if (yardFloodLightSpots.length > 0) {
      const mastGeo = new THREE.CylinderGeometry(0.14, 0.22, 11.5, 6);
      const mastMat = new THREE.MeshStandardMaterial({ color: '#334155', metalness: 0.6 });
      const headGeo = new THREE.BoxGeometry(1.5, 0.3, 0.7);
      disposables.push(mastGeo, mastMat, headGeo);
      const mastInst = new THREE.InstancedMesh(mastGeo, mastMat, yardFloodLightSpots.length);
      const floodHeadInst = new THREE.InstancedMesh(headGeo, lampHeadMat, yardFloodLightSpots.length);
      for (let i = 0; i < yardFloodLightSpots.length; i++) {
        const fl = yardFloodLightSpots[i]!;
        dummy.position.set(fl.x, fl.y + 5.75, fl.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        mastInst.setMatrixAt(i, dummy.matrix);

        dummy.position.set(fl.x, fl.y + 11.5, fl.z);
        dummy.updateMatrix();
        floodHeadInst.setMatrixAt(i, dummy.matrix);
      }
      mastInst.instanceMatrix.needsUpdate = true;
      floodHeadInst.instanceMatrix.needsUpdate = true;
      mastInst.layers.set(1);
      floodHeadInst.layers.set(1);
      root.add(mastInst, floodHeadInst);
    }

    // 7. Landmarks (batched per material; rotors on Layer 1)
    const rotatingRotors: THREE.Object3D[] = [];
    for (const lm of manifest.landmarks) {
      this.buildLandmark(lm, root, batcher, sharedMats, rotatingRotors, colliders, disposables);
    }

    batcher.flush(root, disposables);

    // 8. Multi-Tier Natural Ecology (3 Tree Species + Bushes) & Distant Rural Props (Power Pylons + Cottages)
    const updateSceneryDensity = this.buildEcologyAndRuralProps(
      manifest,
      root,
      findNearestRoadDistanceAndY,
      getHeightAt,
      delinPostInst,
      delinReflectInst,
      delineatorTransforms.length,
      noiseBarrierInst,
      noiseBarrierTransforms.length,
      yardContInst,
      yardContainerSpots.length,
      yardPalletInst,
      yardPalletSpots.length,
      disposables
    );

    // 9. Surface Query (O(1) spatial hash + linear slope interpolation + full paved yards/rest stops)
    const querySurface = (x: number, z: number, out: SurfaceQueryResult): void => {
      const gx = Math.floor(x / cellSize);
      const gz = Math.floor(z / cellSize);
      const entries = spatialGrid.get(`${gx},${gz}`);

      let bestDistSq = Infinity;
      let bestSeg: CompiledRoadSegment | null = null;
      let bestSampleIdx = 0;

      if (entries) {
        for (let i = 0; i < entries.length; i++) {
          const e = entries[i]!;
          const seg = segments[e.segIdx]!;
          const pt = seg.samples[e.sampleIdx]!;
          const dx = x - pt.x;
          const dz = z - pt.z;
          const dSq = dx * dx + dz * dz;
          if (dSq < bestDistSq) {
            bestDistSq = dSq;
            bestSeg = seg;
            bestSampleIdx = e.sampleIdx;
          }
        }
      }

      const terrainY = getHeightAt(x, z);

      if (bestSeg) {
        const samples = bestSeg.samples;
        const p0 = samples[bestSampleIdx]!;
        let smoothY = p0.y;
        const nextPt = samples[Math.min(samples.length - 1, bestSampleIdx + 1)]!;
        const prevPt = samples[Math.max(0, bestSampleIdx - 1)]!;
        const spanDx = nextPt.x - prevPt.x;
        const spanDz = nextPt.z - prevPt.z;
        const spanLenSq = spanDx * spanDx + spanDz * spanDz;
        if (spanLenSq > 0.01) {
          const projT = THREE.MathUtils.clamp(
            ((x - prevPt.x) * spanDx + (z - prevPt.z) * spanDz) / spanLenSq,
            0,
            1
          );
          smoothY = prevPt.y + (nextPt.y - prevPt.y) * projT;
        }

        const dist = Math.sqrt(bestDistSq);
        const halfW = bestSeg.def.width * 0.5;
        const onRoad = dist <= halfW + 2.2;

        out.groundY = onRoad
          ? smoothY
          : Math.max(terrainY, smoothY - Math.max(0, dist - halfW) * 0.25);
        out.onRoad = onRoad;
        out.speedLimitKmh = bestSeg.def.speedLimitKmh;
        out.nearestSegmentId = bestSeg.def.id;
        out.roadDist = dist;

        if (bestSeg.def.hasGuardrails && dist > halfW + 0.35 && dist < halfW + 4.8) {
          const dx = p0.x - x;
          const dz = p0.z - z;
          const len = Math.hypot(dx, dz) || 1;
          out.guardrailHit = true;
          out.guardrailPushX = dx / len;
          out.guardrailPushZ = dz / len;
        } else {
          out.guardrailHit = false;
          out.guardrailPushX = 0;
          out.guardrailPushZ = 0;
        }
      } else {
        out.groundY = terrainY;
        out.onRoad = false;
        out.speedLimitKmh = 60;
        out.nearestSegmentId = null;
        out.roadDist = 999;
        out.guardrailHit = false;
        out.guardrailPushX = 0;
        out.guardrailPushZ = 0;
      }

      for (const city of manifest.cities) {
        const dxCity = Math.abs(x - city.position[0]);
        const dzCity = Math.abs(z - city.position[2]);
        if (dxCity <= 145 && dzCity <= 155) {
          out.groundY = city.position[1];
          out.onRoad = true;
          out.speedLimitKmh = 50;
          out.guardrailHit = false;
          return;
        }

        for (const depot of city.depots) {
          if (
            Math.hypot(x - depot.parkingBayPosition[0], z - depot.parkingBayPosition[2]) <= 42 ||
            Math.hypot(x - depot.officePosition[0], z - depot.officePosition[2]) <= 42 ||
            Math.hypot(x - depot.position[0], z - depot.position[2]) <= 48
          ) {
            out.groundY = depot.position[1];
            out.onRoad = true;
            out.speedLimitKmh = 50;
            out.guardrailHit = false;
            return;
          }
        }

        for (const st of city.stations) {
          if (Math.hypot(x - st.position[0], z - st.position[2]) <= st.radius + 18) {
            out.groundY = st.position[1];
            out.onRoad = true;
            out.speedLimitKmh = 50;
            out.guardrailHit = false;
            return;
          }
        }
      }
    };

    const highlightDestinationDepot = (depotId: string | null): void => {
      const bayInfo = depotId ? depotBayTransforms.get(depotId) : undefined;
      if (bayInfo) {
        activeBayMesh.position.set(bayInfo.x, bayInfo.y + 0.095, bayInfo.z);
        activeBayMesh.rotation.set(-Math.PI / 2, 0, bayInfo.headingRad);
        activeBayMesh.visible = true;
      } else {
        activeBayMesh.visible = false;
      }
      for (const [id, beacon] of parkingBeaconMeshes.entries()) {
        beacon.visible = id === depotId;
      }
    };

    const setPbrDetailEnabled = (enabled: boolean): void => {
      for (const b of pbrMaterialBindings) {
        b.mat.roughnessMap = enabled ? b.roughnessMap : null;
        b.mat.bumpMap = enabled ? b.bumpMap : null;
        b.mat.bumpScale = enabled ? b.bumpScale : 0;
        b.mat.needsUpdate = true;
      }
    };

    let currentElapsedSec = 0;

    const signalLookup = new Map<string, number>();
    for (const sn of signalNodesList) {
      signalLookup.set(sn.nodeId, sn.phaseOffset);
    }

    const getTrafficLightState = (
      nodeId: string,
      approachDirX: number,
      approachDirZ: number
    ): SignalState => {
      const offset = signalLookup.get(nodeId);
      if (offset === undefined) return 'green';
      const cycle = (currentElapsedSec + offset) % 26;
      const isNsAxis = Math.abs(approachDirZ) >= Math.abs(approachDirX);
      if (isNsAxis) {
        if (cycle < 11) return 'green';
        if (cycle < 13) return 'amber';
        return 'red';
      }
      if (cycle >= 13 && cycle < 24) return 'green';
      if (cycle >= 24) return 'amber';
      return 'red';
    };

    const setRainWetness = (wet01: number): void => {
      const w = THREE.MathUtils.clamp(wet01, 0, 1);
      const rough = THREE.MathUtils.lerp(0.85, 0.34, w);
      for (let i = 0; i < roadMaterials.length; i++) {
        roadMaterials[i]!.roughness = rough;
      }
    };

    const update = (dtSec: number, elapsedSec: number): void => {
      currentElapsedSec = elapsedSec;
      for (let i = 0; i < signalNodesList.length; i++) {
        // Compute aggregate visibility from earliest/first signal phase cleanly per axis
        const cycle = (elapsedSec + signalNodesList[i]!.phaseOffset) % 26;
        if (i === 0) {
          nsGreenMat.emissiveIntensity = cycle < 11 ? 2.4 : 0.05;
          nsAmberMat.emissiveIntensity = cycle >= 11 && cycle < 13 ? 2.4 : 0.05;
          nsRedMat.emissiveIntensity = cycle >= 13 ? 2.4 : 0.05;
          ewGreenMat.emissiveIntensity = cycle >= 13 && cycle < 24 ? 2.4 : 0.05;
          ewAmberMat.emissiveIntensity = cycle >= 24 ? 2.4 : 0.05;
          ewRedMat.emissiveIntensity = cycle < 13 ? 2.4 : 0.05;
        }
      }

      for (let i = 0; i < rotatingRotors.length; i++) {
        rotatingRotors[i]!.rotation.z += dtSec * 1.15;
      }
      if (activeBayMesh.visible) {
        activeBayMat.opacity = 0.72 + Math.sin(elapsedSec * 4.2) * 0.22;
      }
      for (const beacon of parkingBeaconMeshes.values()) {
        if (beacon.visible) {
          beacon.rotation.y += dtSec * 1.4;
          const pulse = 1 + Math.sin(elapsedSec * 3.5) * 0.08;
          beacon.scale.set(pulse, 1, pulse);
        }
      }
    };

    const dispose = (): void => {
      for (const d of disposables) {
        d.dispose();
      }
    };

    return {
      manifest,
      root,
      nodeMap,
      segments,
      segmentMap,
      speedCameras,
      colliders,
      getHeightAt,
      querySurface,
      getTrafficLightState,
      highlightDestinationDepot,
      setFoliageDensity: updateSceneryDensity,
      setPbrDetailEnabled,
      setRainWetness,
      update,
      dispose,
    };
  }

  private createBatchMaterials(disposables: { dispose: () => void }[]) {
    const whSideMat = new THREE.MeshStandardMaterial({
      color: '#475569',
      roughness: 0.72,
      metalness: 0.2,
    });
    const officeVertexMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.65,
    });
    const ringPadVertexMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.78,
    });
    const stationSlateMat = new THREE.MeshStandardMaterial({
      color: '#253142',
      roughness: 0.58,
      metalness: 0.22,
    });
    const stationAlumMat = new THREE.MeshStandardMaterial({
      color: '#d8e0ea',
      roughness: 0.44,
      metalness: 0.42,
    });
    const stationFuelTrimMat = new THREE.MeshStandardMaterial({
      color: '#10b981',
      emissive: '#10b981',
      emissiveIntensity: 0.72,
    });
    const stationHubTrimMat = new THREE.MeshStandardMaterial({
      color: '#38bdf8',
      emissive: '#38bdf8',
      emissiveIntensity: 0.72,
    });
    const lakeMat = new THREE.MeshStandardMaterial({
      color: '#1b5f7d',
      roughness: 0.14,
      metalness: 0.7,
      envMapIntensity: 1.25,
    });
    const turbineWhiteMat = new THREE.MeshStandardMaterial({
      color: '#e2e8f0',
      roughness: 0.45,
    });
    const warehouseVertexMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.78,
      metalness: 0.15,
    });
    const craneVertexMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.5,
      metalness: 0.45,
    });
    const tollCanopyMat = new THREE.MeshStandardMaterial({ color: '#1e3a8a', roughness: 0.42 });
    const tollPostMat = new THREE.MeshStandardMaterial({ color: '#e2e8f0', roughness: 0.5 });
    const tollLightMat = new THREE.MeshBasicMaterial({ color: '#22c55e' });
    const tollArmMat = new THREE.MeshStandardMaterial({ color: '#ef4444' });
    const pylonConcreteMat = new THREE.MeshStandardMaterial({ color: '#cbd5e1', roughness: 0.55 });
    const whFrontMats = new Map<string, THREE.MeshStandardMaterial>();

    disposables.push(
      whSideMat,
      officeVertexMat,
      ringPadVertexMat,
      stationSlateMat,
      stationAlumMat,
      stationFuelTrimMat,
      stationHubTrimMat,
      lakeMat,
      turbineWhiteMat,
      warehouseVertexMat,
      craneVertexMat,
      tollCanopyMat,
      tollPostMat,
      tollLightMat,
      tollArmMat,
      pylonConcreteMat
    );

    return {
      whSideMat,
      officeVertexMat,
      ringPadVertexMat,
      stationSlateMat,
      stationAlumMat,
      stationFuelTrimMat,
      stationHubTrimMat,
      lakeMat,
      turbineWhiteMat,
      warehouseVertexMat,
      craneVertexMat,
      tollCanopyMat,
      tollPostMat,
      tollLightMat,
      tollArmMat,
      pylonConcreteMat,
      whFrontMats,
    };
  }

  private buildCityArea(
    city: CityDefinition,
    root: THREE.Group,
    batcher: GeometryBatcher,
    apronMat: THREE.MeshStandardMaterial,
    inactiveBayMat: THREE.MeshBasicMaterial,
    sharedMats: ReturnType<MapBuilder['createBatchMaterials']>,
    depotBayTransforms: Map<string, { x: number; y: number; z: number; headingRad: number }>,
    parkingBeaconMeshes: Map<string, THREE.Mesh>,
    colliders: BoxCollider[],
    yardContainerSpots: { x: number; y: number; z: number; rotY: number; color: string }[],
    yardPalletSpots: { x: number; y: number; z: number; rotY: number }[],
    yardFloodLightSpots: { x: number; y: number; z: number }[],
    disposables: { dispose: () => void }[]
  ): void {
    const apronGeo = new THREE.BoxGeometry(270, 0.36, 290);
    batcher.add(apronMat, apronGeo, {
      x: city.position[0],
      y: city.position[1] - 0.16,
      z: city.position[2],
      receiveShadow: true,
    });
    disposables.push(apronGeo);

    const accentHex =
      city.regionStyle === 'coastal_port'
        ? '#1d4ed8'
        : city.regionStyle === 'alpine_wood'
        ? '#92400e'
        : city.regionStyle === 'countryside_farm'
        ? '#15803d'
        : '#d97706';

    for (const depot of city.depots) {
      this.buildDepot(
        depot,
        accentHex,
        root,
        batcher,
        inactiveBayMat,
        sharedMats,
        depotBayTransforms,
        parkingBeaconMeshes,
        colliders,
        yardContainerSpots,
        yardPalletSpots,
        yardFloodLightSpots,
        disposables
      );
    }

    for (const st of city.stations) {
      const distFromCity = Math.hypot(
        st.position[0] - city.position[0],
        st.position[2] - city.position[2]
      );
      const isHighwayRestStop = distFromCity > 140;
      this.buildServiceStation(
        st,
        isHighwayRestStop,
        apronMat,
        batcher,
        sharedMats,
        colliders,
        disposables
      );
    }
  }

  private buildDepot(
    depot: CityDepot,
    accentHex: string,
    root: THREE.Group,
    batcher: GeometryBatcher,
    inactiveBayMat: THREE.MeshBasicMaterial,
    sharedMats: ReturnType<MapBuilder['createBatchMaterials']>,
    depotBayTransforms: Map<string, { x: number; y: number; z: number; headingRad: number }>,
    parkingBeaconMeshes: Map<string, THREE.Mesh>,
    colliders: BoxCollider[],
    yardContainerSpots: { x: number; y: number; z: number; rotY: number; color: string }[],
    yardPalletSpots: { x: number; y: number; z: number; rotY: number }[],
    yardFloodLightSpots: { x: number; y: number; z: number }[],
    disposables: { dispose: () => void }[]
  ): void {
    const [bx, by, bz] = depot.parkingBayPosition;
    const bayGeo = new THREE.PlaneGeometry(5.4, 18.5);
    batcher.add(inactiveBayMat, bayGeo, {
      x: bx,
      y: by + 0.08,
      z: bz,
      rotX: -Math.PI / 2,
      rotZ: depot.parkingBayHeadingRad,
    });
    depotBayTransforms.set(depot.id, {
      x: bx,
      y: by,
      z: bz,
      headingRad: depot.parkingBayHeadingRad,
    });
    disposables.push(bayGeo);

    // Animated vertical emerald guide beacon (Layer 1: skipped by mirrors)
    const beaconGeo = new THREE.CylinderGeometry(2.4, 2.8, 22, 16, 1, true);
    const beaconMat = new THREE.MeshBasicMaterial({
      color: '#10b981',
      transparent: true,
      opacity: 0.24,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const beaconMesh = new THREE.Mesh(beaconGeo, beaconMat);
    beaconMesh.position.set(bx, by + 11.1, bz);
    beaconMesh.layers.set(1);
    beaconMesh.visible = false;
    root.add(beaconMesh);
    parkingBeaconMeshes.set(depot.id, beaconMesh);
    disposables.push(beaconGeo, beaconMat);

    const cosH = Math.cos(depot.parkingBayHeadingRad);
    const sinH = Math.sin(depot.parkingBayHeadingRad);
    const whX = bx - sinH * 19;
    const whZ = bz - cosH * 19;

    const whBodyGeo = new THREE.BoxGeometry(26, 7.6, 12);
    batcher.add(sharedMats.whSideMat, whBodyGeo, {
      x: whX,
      y: by + 3.8,
      z: whZ,
      rotY: depot.parkingBayHeadingRad,
      castShadow: true,
      receiveShadow: true,
    });
    disposables.push(whBodyGeo);

    let whFrontMat = sharedMats.whFrontMats.get(accentHex);
    if (!whFrontMat) {
      const dockTex = this.textures.getWarehouseDockTexture(accentHex);
      whFrontMat = new THREE.MeshStandardMaterial({ map: dockTex, roughness: 0.6 });
      sharedMats.whFrontMats.set(accentHex, whFrontMat);
      disposables.push(whFrontMat);
    }
    const whFrontGeo = new THREE.PlaneGeometry(25.8, 7.5);
    batcher.add(whFrontMat, whFrontGeo, {
      x: whX + sinH * 6.02,
      y: by + 3.8,
      z: whZ + cosH * 6.02,
      rotY: depot.parkingBayHeadingRad,
    });
    disposables.push(whFrontGeo);

    colliders.push({
      minX: whX - 11,
      maxX: whX + 11,
      minZ: whZ - 11,
      maxZ: whZ + 11,
      y: by,
      label: `${depot.name} 装卸月台`,
    });

    const [ox, oy, oz] = depot.officePosition;
    const officeGeo = new THREE.BoxGeometry(6.5, 4.2, 5.0);
    const officeColor =
      depot.type === 'port' ? '#1e3a8a' : depot.type === 'factory' ? '#334155' : '#3f6212';
    batcher.add(sharedMats.officeVertexMat, officeGeo, {
      x: ox + 5.8,
      y: oy + 2.1,
      z: oz,
      colorHex: officeColor,
      receiveShadow: true,
    });
    disposables.push(officeGeo);

    colliders.push({
      minX: ox + 5.8 - 3.3,
      maxX: ox + 5.8 + 3.3,
      minZ: oz - 2.6,
      maxZ: oz + 2.6,
      y: oy,
      label: depot.name,
    });

    const ringGeo = new THREE.RingGeometry(2.8, 3.6, 24);
    batcher.add(sharedMats.ringPadVertexMat, ringGeo, {
      x: ox,
      y: oy + 0.1,
      z: oz,
      rotX: -Math.PI / 2,
      colorHex: '#f59e0b',
    });
    disposables.push(ringGeo);

    const cColors = ['#b91c1c', '#1d4ed8', '#d97706', '#047857'];
    yardContainerSpots.push(
      { x: bx + cosH * 12, y: by + 1.3, z: bz - sinH * 12, rotY: depot.parkingBayHeadingRad, color: cColors[0]! },
      { x: bx + cosH * 12, y: by + 3.9, z: bz - sinH * 12, rotY: depot.parkingBayHeadingRad, color: cColors[1]! },
      { x: bx + cosH * 15.2, y: by + 1.3, z: bz - sinH * 15.2, rotY: depot.parkingBayHeadingRad, color: cColors[2]! }
    );
    yardPalletSpots.push(
      { x: ox + 5.8, y: oy, z: oz + 4.8, rotY: 0.2 },
      { x: ox + 7.6, y: oy, z: oz + 4.6, rotY: -0.15 }
    );
    yardFloodLightSpots.push({ x: bx - cosH * 9, y: by, z: bz + sinH * 9 });
  }

  private buildServiceStation(
    st: ServiceStation,
    withOwnApron: boolean,
    apronMat: THREE.MeshStandardMaterial,
    batcher: GeometryBatcher,
    sharedMats: ReturnType<MapBuilder['createBatchMaterials']>,
    colliders: BoxCollider[],
    disposables: { dispose: () => void }[]
  ): void {
    const [sx, sy, sz] = st.position;
    const isFuelOnly = st.kind === 'fuel';
    const accentColor = isFuelOnly ? '#10b981' : '#38bdf8';

    if (withOwnApron) {
      const restApronGeo = new THREE.BoxGeometry(58, 0.34, 46);
      batcher.add(apronMat, restApronGeo, {
        x: sx,
        y: sy - 0.14,
        z: sz,
        rotY: st.headingRad,
        receiveShadow: true,
      });
      disposables.push(restApronGeo);
    }

    const roofGeo = new THREE.BoxGeometry(16, 0.9, 12);
    batcher.add(sharedMats.stationSlateMat, roofGeo, {
      x: sx,
      y: sy + 6.4,
      z: sz,
      castShadow: true,
    });

    const trimGeo = new THREE.BoxGeometry(16.2, 0.35, 12.2);
    batcher.add(
      isFuelOnly ? sharedMats.stationFuelTrimMat : sharedMats.stationHubTrimMat,
      trimGeo,
      { x: sx, y: sy + 6.4, z: sz }
    );

    const pumpGeo = new THREE.BoxGeometry(0.9, 1.7, 0.65);
    for (const px of [-3.6, 3.6]) {
      batcher.add(sharedMats.stationAlumMat, pumpGeo, {
        x: sx + px,
        y: sy + 0.85,
        z: sz,
      });
    }

    const shopGeo = new THREE.BoxGeometry(10, 4.0, 6.5);
    batcher.add(sharedMats.stationSlateMat, shopGeo, {
      x: sx,
      y: sy + 2.0,
      z: sz - 12.5,
    });
    colliders.push({
      minX: sx - 5.2,
      maxX: sx + 5.2,
      minZ: sz - 15.9,
      maxZ: sz - 9.1,
      y: sy,
      label: st.name,
    });

    const pillarGeo = new THREE.BoxGeometry(0.65, 6.2, 0.65);
    for (const [px, pz] of [
      [-6.5, -4.5],
      [6.5, -4.5],
      [-6.5, 4.5],
      [6.5, 4.5],
    ] as const) {
      batcher.add(sharedMats.stationAlumMat, pillarGeo, {
        x: sx + px,
        y: sy + 3.1,
        z: sz + pz,
      });
      colliders.push({
        minX: sx + px - 0.5,
        maxX: sx + px + 0.5,
        minZ: sz + pz - 0.5,
        maxZ: sz + pz + 0.5,
        y: sy,
        label: st.name,
      });
    }

    const padGeo = new THREE.RingGeometry(3.2, 4.1, 24);
    batcher.add(sharedMats.ringPadVertexMat, padGeo, {
      x: sx,
      y: sy + 0.09,
      z: sz,
      rotX: -Math.PI / 2,
      colorHex: accentColor,
    });

    disposables.push(roofGeo, trimGeo, pumpGeo, shopGeo, pillarGeo, padGeo);
  }

  private buildLandmark(
    lm: MapManifest['landmarks'][number],
    root: THREE.Group,
    batcher: GeometryBatcher,
    sharedMats: ReturnType<MapBuilder['createBatchMaterials']>,
    rotatingRotors: THREE.Object3D[],
    colliders: BoxCollider[],
    disposables: { dispose: () => void }[]
  ): void {
    const [x, y, z] = lm.position;
    if (lm.kind === 'mountain_peak') return;

    if (lm.kind === 'lake') {
      const [sx, , sz] = lm.scale ?? [200, 1, 200];
      const geo = new THREE.PlaneGeometry(sx, sz);
      batcher.add(sharedMats.lakeMat, geo, { x, y, z, rotX: -Math.PI / 2 });
      disposables.push(geo);
      return;
    }

    if (lm.kind === 'wind_turbine') {
      const rotY = lm.rotationY ?? 0;
      const mastGeo = new THREE.CylinderGeometry(0.8, 1.8, 52, 8);
      const nacelleGeo = new THREE.BoxGeometry(2.6, 2.4, 5.2);
      batcher.add(sharedMats.turbineWhiteMat, mastGeo, { x, y: y + 26, z, rotY, layer: 1 });
      batcher.add(sharedMats.turbineWhiteMat, nacelleGeo, { x, y: y + 52, z, rotY, layer: 1 });

      const group = new THREE.Group();
      group.position.set(x, y, z);
      group.rotation.y = rotY;
      const rotor = new THREE.Group();
      rotor.position.set(0, 52, 2.8);
      const bladeGeo = new THREE.BoxGeometry(1.1, 22, 0.25);
      const rotorBatch = new GeometryBatcher();
      const tmpRot = new THREE.Object3D();
      const tmpBlade = new THREE.Object3D();
      tmpRot.add(tmpBlade);
      for (let i = 0; i < 3; i++) {
        tmpRot.rotation.z = (i * Math.PI * 2) / 3;
        tmpBlade.position.y = 11;
        tmpRot.updateMatrixWorld(true);
        rotorBatch.add(sharedMats.turbineWhiteMat, bladeGeo, {
          matrix: tmpBlade.matrixWorld,
          layer: 1,
        });
      }
      rotorBatch.flush(rotor, disposables);
      group.add(rotor);
      rotatingRotors.push(rotor);
      root.add(group);
      disposables.push(mastGeo, nacelleGeo, bladeGeo);
      return;
    }

    if (lm.kind === 'warehouse_block') {
      const [sx, sy, sz] = lm.scale ?? [44, 12, 24];
      const geo = new THREE.BoxGeometry(sx, sy, sz);
      batcher.add(sharedMats.warehouseVertexMat, geo, {
        x,
        y: y + sy * 0.5,
        z,
        colorHex: lm.color ?? '#475569',
        receiveShadow: true,
      });
      disposables.push(geo);

      colliders.push({
        minX: x - sx * 0.5,
        maxX: x + sx * 0.5,
        minZ: z - sz * 0.5,
        maxZ: z + sz * 0.5,
        y,
        label: '仓库建筑',
      });
      return;
    }

    if (lm.kind === 'port_crane') {
      const rotY = lm.rotationY ?? 0;
      const colorHex = lm.color ?? '#dc2626';
      const holder = new THREE.Object3D();
      const child = new THREE.Object3D();
      holder.add(child);
      holder.position.set(x, y, z);
      holder.rotation.y = rotY;
      holder.updateMatrixWorld(true);

      const legGeo = new THREE.BoxGeometry(1.6, 26, 1.6);
      const beamGeo = new THREE.BoxGeometry(4.5, 2.2, 34);
      for (const [lx, lz] of [
        [-4, -4],
        [4, -4],
        [-4, 4],
        [4, 4],
      ] as const) {
        child.position.set(lx, 13, lz);
        child.rotation.set(0, 0, 0);
        child.updateMatrixWorld();
        batcher.add(sharedMats.craneVertexMat, legGeo, {
          matrix: child.matrixWorld,
          colorHex,
          layer: 1,
        });
      }
      child.position.set(0, 26.5, 8);
      child.updateMatrixWorld();
      batcher.add(sharedMats.craneVertexMat, beamGeo, {
        matrix: child.matrixWorld,
        colorHex,
        layer: 1,
      });
      disposables.push(legGeo, beamGeo);
      return;
    }

    if (lm.kind === 'toll_booth') {
      const holder = new THREE.Object3D();
      const child = new THREE.Object3D();
      holder.add(child);
      holder.position.set(x, y, z);
      holder.rotation.y = lm.rotationY ?? 0;
      holder.updateMatrixWorld(true);

      const canopyGeo = new THREE.BoxGeometry(24, 1.4, 7.2);
      const postGeo = new THREE.BoxGeometry(1.0, 6.6, 2.8);
      const lightGeo = new THREE.BoxGeometry(0.7, 0.5, 0.3);
      const armGeo = new THREE.BoxGeometry(3.8, 0.14, 0.14);

      child.position.set(0, 6.8, 0);
      child.rotation.set(0, 0, 0);
      child.updateMatrixWorld();
      batcher.add(sharedMats.tollCanopyMat, canopyGeo, { matrix: child.matrixWorld });

      for (const px of [-9.8, -3.2, 3.2, 9.8]) {
        child.position.set(px, 3.3, 0);
        child.updateMatrixWorld();
        batcher.add(sharedMats.tollPostMat, postGeo, { matrix: child.matrixWorld });
      }
      for (const lx of [-6.5, 0, 6.5]) {
        child.rotation.set(0, 0, 0);
        child.position.set(lx, 6.6, 3.65);
        child.updateMatrixWorld();
        batcher.add(sharedMats.tollLightMat, lightGeo, { matrix: child.matrixWorld });

        child.position.set(lx, 6.6, -3.65);
        child.updateMatrixWorld();
        batcher.add(sharedMats.tollLightMat, lightGeo, { matrix: child.matrixWorld });

        child.position.set(lx - 1.5, 3.0, 0);
        child.rotation.set(0, 0, 1.15);
        child.updateMatrixWorld();
        batcher.add(sharedMats.tollArmMat, armGeo, { matrix: child.matrixWorld });
      }
      disposables.push(canopyGeo, postGeo, lightGeo, armGeo);
      return;
    }

    if (lm.kind === 'bridge_pylon') {
      const holder = new THREE.Object3D();
      const child = new THREE.Object3D();
      holder.add(child);
      holder.position.set(x, y, z);
      holder.rotation.y = lm.rotationY ?? 0;
      holder.updateMatrixWorld(true);

      const towerGeo = new THREE.BoxGeometry(1.5, 22, 1.5);
      const crossGeo = new THREE.BoxGeometry(21, 1.2, 1.4);
      const parapetGeo = new THREE.BoxGeometry(0.4, 1.4, 28);
      for (const px of [-9.8, 9.8]) {
        child.position.set(px, 9, 0);
        child.updateMatrixWorld();
        batcher.add(sharedMats.pylonConcreteMat, towerGeo, { matrix: child.matrixWorld });

        child.position.set(px * 0.88, 0.7, 0);
        child.updateMatrixWorld();
        batcher.add(sharedMats.pylonConcreteMat, parapetGeo, { matrix: child.matrixWorld });
      }
      child.position.set(0, 16, 0);
      child.updateMatrixWorld();
      batcher.add(sharedMats.pylonConcreteMat, crossGeo, { matrix: child.matrixWorld });
      disposables.push(towerGeo, crossGeo, parapetGeo);
    }
  }

  private buildEcologyAndRuralProps(
    manifest: MapManifest,
    root: THREE.Group,
    findNearestRoadDistanceAndY: (x: number, z: number) => { dist: number; y: number; seg: CompiledRoadSegment | null },
    getHeightAt: (x: number, z: number) => number,
    delinPostInst: THREE.InstancedMesh | null,
    delinReflectInst: THREE.InstancedMesh | null,
    delinMaxCount: number,
    noiseBarrierInst: THREE.InstancedMesh | null,
    noiseBarrierMaxCount: number,
    yardContInst: THREE.InstancedMesh | null,
    yardContMaxCount: number,
    yardPalletInst: THREE.InstancedMesh | null,
    yardPalletMaxCount: number,
    disposables: { dispose: () => void }[]
  ): (ratio: number, isLowSpec?: boolean) => void {
    const { minX, maxX, minZ, maxZ } = manifest.worldBounds;
    let seed = 424242;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const spruceSpots: { x: number; y: number; z: number; scale: number }[] = [];
    const oakSpots: { x: number; y: number; z: number; scale: number }[] = [];
    const bushSpots: { x: number; y: number; z: number; scale: number }[] = [];
    const cottageSpots: { x: number; y: number; z: number; rotY: number }[] = [];
    const pylonSpots: { x: number; y: number; z: number; rotY: number }[] = [];

    const maxAttempts = 2400;
    for (let i = 0; i < maxAttempts && spruceSpots.length + oakSpots.length < 760; i++) {
      const x = minX + 70 + rand() * (maxX - minX - 140);
      const z = minZ + 70 + rand() * (maxZ - minZ - 140);

      let insideCity = false;
      for (const city of manifest.cities) {
        if (Math.hypot(x - city.position[0], z - city.position[2]) < 215) {
          insideCity = true;
          break;
        }
      }
      if (insideCity) continue;

      const roadInfo = findNearestRoadDistanceAndY(x, z);
      const minClearance = (roadInfo.seg?.def.width ?? 14) * 0.65 + 11;
      if (roadInfo.dist < minClearance || roadInfo.dist > 280) continue;

      const y = getHeightAt(x, z);
      if (y > 68) continue; // Keep above snowline bare rock/snow

      const biome = roadInfo.seg?.def.biome;
      const isSpruce = biome === 'alpine' || y > 16 || rand() < 0.45;
      const scale = 0.78 + rand() * 0.78;

      if (isSpruce) {
        spruceSpots.push({ x, y, z, scale });
      } else {
        oakSpots.push({ x, y, z, scale });
      }

      if (bushSpots.length < 340 && rand() < 0.35 && roadInfo.dist < 55) {
        bushSpots.push({ x: x + (rand() - 0.5) * 8, y, z: z + (rand() - 0.5) * 8, scale: 0.7 + rand() * 0.6 });
      }

      if (
        cottageSpots.length < 36 &&
        biome !== 'industrial' &&
        roadInfo.dist > 34 &&
        roadInfo.dist < 140 &&
        y < 42 &&
        rand() < 0.04
      ) {
        cottageSpots.push({ x, y, z, rotY: rand() * Math.PI * 2 });
      }
    }

    // High-voltage power pylons marching in lines across northern & central plains
    for (let k = -3; k <= 3; k++) {
      const px = k * 210 - 60;
      const pz = -560 + k * 45;
      const roadInfo = findNearestRoadDistanceAndY(px, pz);
      if (roadInfo.dist > 28) {
        pylonSpots.push({ x: px, y: getHeightAt(px, pz), z: pz, rotY: 0.25 });
      }
    }

    const dummy = new THREE.Object3D();
    const tmpColor = new THREE.Color();

    // 1. Nordic Spruce (Trunk + Lower Tier + Upper Tier)
    const trunkGeo = new THREE.CylinderGeometry(0.24, 0.4, 3.4, 6);
    const trunkMat = new THREE.MeshStandardMaterial({ color: '#5c4033', roughness: 0.92 });
    const spruceLowGeo = new THREE.ConeGeometry(2.35, 5.2, 7);
    const spruceHighGeo = new THREE.ConeGeometry(1.65, 4.6, 7);
    const spruceMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.88, flatShading: true });
    disposables.push(trunkGeo, trunkMat, spruceLowGeo, spruceHighGeo, spruceMat);

    let spruceTrunkInst: THREE.InstancedMesh | null = null;
    let spruceLowInst: THREE.InstancedMesh | null = null;
    let spruceHighInst: THREE.InstancedMesh | null = null;

    if (spruceSpots.length > 0) {
      spruceTrunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, spruceSpots.length);
      spruceLowInst = new THREE.InstancedMesh(spruceLowGeo, spruceMat, spruceSpots.length);
      spruceHighInst = new THREE.InstancedMesh(spruceHighGeo, spruceMat, spruceSpots.length);

      for (let i = 0; i < spruceSpots.length; i++) {
        const t = spruceSpots[i]!;
        dummy.position.set(t.x, t.y + 1.6 * t.scale, t.z);
        dummy.rotation.set(0, (i * 1.37) % Math.PI, 0);
        dummy.scale.set(t.scale, t.scale, t.scale);
        dummy.updateMatrix();
        spruceTrunkInst.setMatrixAt(i, dummy.matrix);

        dummy.position.set(t.x, t.y + 4.8 * t.scale, t.z);
        dummy.updateMatrix();
        spruceLowInst.setMatrixAt(i, dummy.matrix);

        dummy.position.set(t.x, t.y + 7.6 * t.scale, t.z);
        dummy.updateMatrix();
        spruceHighInst.setMatrixAt(i, dummy.matrix);

        tmpColor.setHSL(0.37 + ((i % 7) - 3) * 0.012, 0.36, 0.22 + (i % 5) * 0.02);
        spruceLowInst.setColorAt(i, tmpColor);
        spruceHighInst.setColorAt(i, tmpColor);
      }
      spruceTrunkInst.instanceMatrix.needsUpdate = true;
      spruceLowInst.instanceMatrix.needsUpdate = true;
      spruceHighInst.instanceMatrix.needsUpdate = true;
      if (spruceLowInst.instanceColor) spruceLowInst.instanceColor.needsUpdate = true;
      if (spruceHighInst.instanceColor) spruceHighInst.instanceColor.needsUpdate = true;
      spruceTrunkInst.layers.set(1);
      root.add(spruceTrunkInst, spruceLowInst, spruceHighInst);
    }

    // 2. Broadleaf Oak (Trunk + Rounded Crown)
    const oakGeo = new THREE.IcosahedronGeometry(2.6, 1);
    const oakMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.88, flatShading: true });
    disposables.push(oakGeo, oakMat);

    let oakTrunkInst: THREE.InstancedMesh | null = null;
    let oakInst: THREE.InstancedMesh | null = null;
    if (oakSpots.length > 0) {
      oakTrunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, oakSpots.length);
      oakInst = new THREE.InstancedMesh(oakGeo, oakMat, oakSpots.length);
      for (let i = 0; i < oakSpots.length; i++) {
        const t = oakSpots[i]!;
        dummy.position.set(t.x, t.y + 1.6 * t.scale, t.z);
        dummy.rotation.set(0, (i * 1.1) % Math.PI, 0);
        dummy.scale.set(t.scale, t.scale, t.scale);
        dummy.updateMatrix();
        oakTrunkInst.setMatrixAt(i, dummy.matrix);

        dummy.position.set(t.x, t.y + 4.7 * t.scale, t.z);
        dummy.scale.set(t.scale * 1.05, t.scale * 0.9, t.scale);
        dummy.updateMatrix();
        oakInst.setMatrixAt(i, dummy.matrix);

        tmpColor.setHSL(0.28 + ((i % 6) - 2) * 0.015, 0.38, 0.3 + (i % 4) * 0.025);
        oakInst.setColorAt(i, tmpColor);
      }
      oakTrunkInst.instanceMatrix.needsUpdate = true;
      oakInst.instanceMatrix.needsUpdate = true;
      if (oakInst.instanceColor) oakInst.instanceColor.needsUpdate = true;
      oakTrunkInst.layers.set(1);
      root.add(oakTrunkInst, oakInst);
    }

    // 3. Roadside Bushes / Shrubs
    const bushGeo = new THREE.DodecahedronGeometry(1.15, 0);
    const bushMat = new THREE.MeshStandardMaterial({ color: '#436932', roughness: 0.9, flatShading: true });
    disposables.push(bushGeo, bushMat);
    let bushInst: THREE.InstancedMesh | null = null;
    if (bushSpots.length > 0) {
      bushInst = new THREE.InstancedMesh(bushGeo, bushMat, bushSpots.length);
      for (let i = 0; i < bushSpots.length; i++) {
        const b = bushSpots[i]!;
        dummy.position.set(b.x, b.y + 0.55 * b.scale, b.z);
        dummy.rotation.set(0, i * 0.7, 0);
        dummy.scale.set(b.scale * 1.25, b.scale * 0.75, b.scale);
        dummy.updateMatrix();
        bushInst.setMatrixAt(i, dummy.matrix);
      }
      bushInst.instanceMatrix.needsUpdate = true;
      bushInst.layers.set(1);
      root.add(bushInst);
    }

    // 4. Rural European Cottages & Red-Roof Barns
    let cottageWallInst: THREE.InstancedMesh | null = null;
    let cottageRoofInst: THREE.InstancedMesh | null = null;
    if (cottageSpots.length > 0) {
      const wallGeo = new THREE.BoxGeometry(9.5, 5.2, 7.0);
      const wallMat = new THREE.MeshStandardMaterial({ color: '#ede9df', roughness: 0.8 });
      const roofGeo = new THREE.ConeGeometry(7.2, 3.8, 4);
      roofGeo.rotateY(Math.PI / 4);
      const roofMat = new THREE.MeshStandardMaterial({ color: '#b44835', roughness: 0.72, flatShading: true });
      disposables.push(wallGeo, wallMat, roofGeo, roofMat);

      cottageWallInst = new THREE.InstancedMesh(wallGeo, wallMat, cottageSpots.length);
      cottageRoofInst = new THREE.InstancedMesh(roofGeo, roofMat, cottageSpots.length);
      for (let i = 0; i < cottageSpots.length; i++) {
        const c = cottageSpots[i]!;
        dummy.position.set(c.x, c.y + 2.5, c.z);
        dummy.rotation.set(0, c.rotY, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        cottageWallInst.setMatrixAt(i, dummy.matrix);

        dummy.position.set(c.x, c.y + 6.9, c.z);
        dummy.updateMatrix();
        cottageRoofInst.setMatrixAt(i, dummy.matrix);
      }
      cottageWallInst.instanceMatrix.needsUpdate = true;
      cottageRoofInst.instanceMatrix.needsUpdate = true;
      cottageWallInst.layers.set(1);
      cottageRoofInst.layers.set(1);
      root.add(cottageWallInst, cottageRoofInst);
    }

    // 5. High-Voltage Power Pylons
    let pylonInst: THREE.InstancedMesh | null = null;
    if (pylonSpots.length > 0) {
      const pylonGeo = new THREE.CylinderGeometry(0.45, 2.6, 28, 4);
      const pylonMat = new THREE.MeshStandardMaterial({
        color: '#64748b',
        metalness: 0.6,
        roughness: 0.45,
        wireframe: true,
      });
      disposables.push(pylonGeo, pylonMat);
      pylonInst = new THREE.InstancedMesh(pylonGeo, pylonMat, pylonSpots.length);
      for (let i = 0; i < pylonSpots.length; i++) {
        const p = pylonSpots[i]!;
        dummy.position.set(p.x, p.y + 13.5, p.z);
        dummy.rotation.set(0, p.rotY, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        pylonInst.setMatrixAt(i, dummy.matrix);
      }
      pylonInst.instanceMatrix.needsUpdate = true;
      pylonInst.layers.set(1);
      root.add(pylonInst);
    }

    return (ratio: number, isLowSpec = false) => {
      const r = THREE.MathUtils.clamp(ratio, 0.1, 1);
      if (spruceTrunkInst && spruceLowInst && spruceHighInst) {
        const c = Math.floor(spruceSpots.length * r);
        spruceTrunkInst.count = c;
        spruceLowInst.count = c;
        spruceHighInst.count = c;
      }
      if (oakTrunkInst && oakInst) {
        const c = Math.floor(oakSpots.length * r);
        oakTrunkInst.count = c;
        oakInst.count = c;
      }
      if (bushInst) {
        bushInst.count = isLowSpec ? 0 : Math.floor(bushSpots.length * r);
      }
      if (cottageWallInst && cottageRoofInst) {
        const c = isLowSpec ? 0 : Math.floor(cottageSpots.length * r);
        cottageWallInst.count = c;
        cottageRoofInst.count = c;
      }
      if (pylonInst) {
        pylonInst.count = isLowSpec ? 0 : pylonSpots.length;
      }
      if (delinPostInst && delinReflectInst) {
        const c = isLowSpec ? 0 : Math.floor(delinMaxCount * Math.max(0.5, r));
        delinPostInst.count = c;
        delinReflectInst.count = c;
      }
      if (noiseBarrierInst) {
        noiseBarrierInst.count = isLowSpec ? 0 : noiseBarrierMaxCount;
      }
      if (yardContInst) {
        yardContInst.count = isLowSpec ? Math.ceil(yardContMaxCount * 0.5) : yardContMaxCount;
      }
      if (yardPalletInst) {
        yardPalletInst.count = isLowSpec ? 0 : yardPalletMaxCount;
      }
    };
  }
}
