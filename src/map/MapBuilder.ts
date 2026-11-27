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
import {
  createSedanGeometries,
  createVanGeometries,
  mergeNormalizedParts,
} from '../graphics/VehicleModelFactory';
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
  roadHalfWidth?: number;
  medianBarrierHit?: boolean;
  medianPushX?: number;
  medianPushZ?: number;
  medianPenetration?: number;
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
  getUpcomingTollBooth: (x: number, z: number, yaw: number) => { label: string; distMeters: number } | null;
  highlightDestinationDepot: (depotId: string | null) => void;
  setDestinationBayAligned: (aligned: boolean) => void;
  evaluateTollBooths: (
    x: number,
    z: number,
    speedKmh: number,
    dtSec: number
  ) => { kind: 'paid' | 'violation'; label: string } | null;
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

    // Spatial hash grid for O(1) road lookup (cell size = 40m, integer-packed keys for zero string GC)
    const cellSize = 40;
    const cellKey = (gx: number, gz: number): number => (gx + 32768) * 65536 + (gz + 32768);
    const spatialGrid = new Map<number, SpatialCellEntry[]>();
    const addCell = (gx: number, gz: number, entry: SpatialCellEntry) => {
      const key = cellKey(gx, gz);
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
      const entries = spatialGrid.get(cellKey(gx, gz));
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

      // Smoothly isolate road corridors using cubic smoothstep (28m..150m) to eliminate steep dirt ledges
      const uRoll = THREE.MathUtils.clamp((nearest.dist - 28) / 122, 0, 1);
      const rollFactor = uRoll * uRoll * (3 - 2 * uRoll) * apronClearance;

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

      // Transition to stratified grey-brown rock & alpine scree on slopes/mid-altitude
      const strataBand = Math.sin(vy * 0.35 + vx * 0.02) * 0.08;
      const rockByHeight = THREE.MathUtils.clamp((vy - 24) / 34 + strataBand, 0, 1);
      const rockBySlope = THREE.MathUtils.clamp((0.88 - slopeUp) / 0.18, 0, 1);
      const rockFactor = Math.max(rockByHeight, rockBySlope);
      tmpVertCol.lerp(colRock, rockFactor);

      // Transition to natural snow cap above 65m with wind-blown snowline variation
      const snowNoise = (valueNoise2D(vx * 0.015, vz * 0.015) - 0.5) * 18;
      const snowByHeight = THREE.MathUtils.clamp((vy + snowNoise - 64) / 30, 0, 1);
      const snowSlopeMask = THREE.MathUtils.clamp((slopeUp - 0.48) / 0.28, 0, 1);
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
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.02,
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

      // Gentle sloped embankment (8-12.5m wide runout blending gravel shoulder into meadow grass)
      const skirtPos = new Float32Array(n * 6 * 3);
      const skirtCol = new Float32Array(n * 6 * 3);
      const skirtIndices: number[] = [];
      const slopeSpan = seg.def.roadClass === 'motorway' ? 12.0 : 9.0;
      const colEdge = new THREE.Color('#666b6e');
      const colGravel = new THREE.Color('#6f7468');
      const colGrass = new THREE.Color('#5a7747');

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

        const lToeX = lx - rx * slopeSpan;
        const lToeZ = lz - rz * slopeSpan;
        const rToeX = rpx + rx * slopeSpan;
        const rToeZ = rpz + rz * slopeSpan;
        const lToeY = Math.min(s.y - 0.65, getHeightAt(lToeX, lToeZ) - 0.35);
        const rToeY = Math.min(s.y - 0.65, getHeightAt(rToeX, rToeZ) - 0.35);

        const sb = i * 18;
        // Left: edge (0), gravel shoulder (1), gentle grass toe (2)
        skirtPos[sb] = lx;
        skirtPos[sb + 1] = s.y + 0.05;
        skirtPos[sb + 2] = lz;
        skirtPos[sb + 3] = lx - rx * 2.1;
        skirtPos[sb + 4] = s.y - 0.1;
        skirtPos[sb + 5] = lz - rz * 2.1;
        skirtPos[sb + 6] = lToeX;
        skirtPos[sb + 7] = lToeY;
        skirtPos[sb + 8] = lToeZ;

        // Right: edge (3), gravel shoulder (4), gentle grass toe (5)
        skirtPos[sb + 9] = rpx;
        skirtPos[sb + 10] = s.y + 0.05;
        skirtPos[sb + 11] = rpz;
        skirtPos[sb + 12] = rpx + rx * 2.1;
        skirtPos[sb + 13] = s.y - 0.1;
        skirtPos[sb + 14] = rpz + rz * 2.1;
        skirtPos[sb + 15] = rToeX;
        skirtPos[sb + 16] = rToeY;
        skirtPos[sb + 17] = rToeZ;

        // Vertex color gradient: gravel shoulder -> meadow grass
        for (const [offset, col] of [
          [0, colEdge],
          [3, colGravel],
          [6, colGrass],
          [9, colEdge],
          [12, colGravel],
          [15, colGrass],
        ] as [number, THREE.Color][]) {
          skirtCol[sb + offset] = col.r;
          skirtCol[sb + offset + 1] = col.g;
          skirtCol[sb + offset + 2] = col.b;
        }

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
      roadGeo.computeVertexNormals();
      batcher.add(segMat, roadGeo, { receiveShadow: true });
      disposables.push(roadGeo);

      const skirtGeo = new THREE.BufferGeometry();
      skirtGeo.setAttribute('position', new THREE.BufferAttribute(skirtPos, 3));
      skirtGeo.setAttribute('color', new THREE.BufferAttribute(skirtCol, 3));
      skirtGeo.setIndex(skirtIndices);
      skirtGeo.computeVertexNormals();
      batcher.add(skirtMat, skirtGeo, { receiveShadow: true });
      disposables.push(skirtGeo);
    }

    const worldVertexMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.62,
      metalness: 0.22,
    });
    const junctionMat = new THREE.MeshStandardMaterial({
      color: '#3c4048',
      roughness: 0.88,
      metalness: 0.04,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    disposables.push(worldVertexMat, junctionMat);

    const portalSignGeo = new THREE.PlaneGeometry(11.4, 1.35);
    const portalBeamGeo = new THREE.BoxGeometry(15.6, 1.45, 0.72);
    const portalPillarGeo = new THREE.BoxGeometry(0.65, 6.2, 0.65);
    disposables.push(portalSignGeo, portalBeamGeo, portalPillarGeo);

    for (const node of manifest.nodes) {
      if (node.kind === 'city_entry') {
        // Industrial Logistics Entrance Portal Arch bridging spur road into freight yard (no oversized grey road disc!)
        const spurSeg = segments.find(
          (s) => s.def.fromNodeId === node.id || s.def.toNodeId === node.id
        );
        const spurTan = spurSeg
          ? spurSeg.curve.getTangentAt(spurSeg.def.fromNodeId === node.id ? 0.05 : 0.95)
          : new THREE.Vector3(1, 0, 0);
        const sDir = spurSeg && spurSeg.def.toNodeId === node.id ? -1 : 1;
        const hLen = Math.hypot(spurTan.x, spurTan.z) || 1;
        const tx = (spurTan.x / hLen) * sDir;
        const tz = (spurTan.z / hLen) * sDir;
        const rx = -tz;
        const rz = tx;
        const rotY = Math.atan2(tx, tz);
        const halfSpan = ((spurSeg?.def.width ?? 13) * 0.5) + 1.1;

        for (const side of [-1, 1]) {
          batcher.add(worldVertexMat, portalPillarGeo, {
            x: node.position[0] + rx * side * halfSpan,
            y: node.position[1] + 3.0,
            z: node.position[2] + rz * side * halfSpan,
            rotY,
            colorHex: '#334155',
            layer: 1,
          });
        }
        batcher.add(worldVertexMat, portalBeamGeo, {
          x: node.position[0],
          y: node.position[1] + 6.1,
          z: node.position[2],
          rotY,
          colorHex: '#1e3a8a',
          layer: 1,
        });
        const archTex = this.textures.getHighwayGantryTexture(
          'YARD',
          'EUROHAUL LOGISTICS',
          'ENTRY · 30 km/h',
          'motorway'
        );
        const archMat = new THREE.MeshStandardMaterial({
          map: archTex,
          roughness: 0.45,
          metalness: 0.1,
          side: THREE.FrontSide,
        });
        const archSign = new THREE.Mesh(portalSignGeo, archMat);
        archSign.position.set(
          node.position[0] + tx * 0.38,
          node.position[1] + 6.1,
          node.position[2] + tz * 0.38
        );
        archSign.rotation.y = rotY;
        archSign.layers.set(1);
        root.add(archSign);
        disposables.push(archMat);
        continue;
      }

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
        batcher.add(worldVertexMat, islandGeo, {
          x: node.position[0],
          y: node.position[1] + 0.2,
          z: node.position[2],
          colorHex: '#4c6642',
        });
        disposables.push(islandGeo);
      }
    }

    // 3b. Curbside Cantilever Traffic Lights aligned strictly to incoming road shoulders
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

      const nsPlacements: { cx: number; cy: number; cz: number; rotY: number }[] = [];
      const ewPlacements: { cx: number; cy: number; cz: number; rotY: number }[] = [];

      for (let i = 0; i < signalNodes.length; i++) {
        const node = signalNodes[i]!;
        signalNodesList.push({ nodeId: node.id, phaseOffset: 0 });
        for (const seg of segments) {
          const isTo = seg.def.toNodeId === node.id;
          const isFrom = seg.def.fromNodeId === node.id && !seg.def.oneWay;
          if (!isTo && !isFrom) continue;
          const sTarget = isTo ? Math.max(0, seg.lengthMeters - 14.0) : Math.min(seg.lengthMeters, 14.0);
          const tVal = THREE.MathUtils.clamp(sTarget / seg.lengthMeters, 0.02, 0.98);
          const pt = seg.curve.getPointAt(tVal);
          const tan = seg.curve.getTangentAt(tVal);
          const hLen = Math.hypot(tan.x, tan.z) || 1;
          const dirSign = isTo ? 1 : -1;
          const inTx = (tan.x / hLen) * dirSign;
          const inTz = (tan.z / hLen) * dirSign;
          const rx = -inTz;
          const rz = inTx;
          const shoulderOffset = seg.def.width * 0.5 + 1.8;
          const cx = pt.x + rx * shoulderOffset;
          const cz = pt.z + rz * shoulderOffset;
          const rotY = Math.atan2(inTx, inTz);
          const isNs = Math.abs(inTz) >= Math.abs(inTx);
          (isNs ? nsPlacements : ewPlacements).push({ cx, cy: pt.y, cz, rotY });
        }
      }

      const nsRedInst = new THREE.InstancedMesh(lensGeo, nsRedMat, Math.max(1, nsPlacements.length));
      const nsAmberInst = new THREE.InstancedMesh(lensGeo, nsAmberMat, Math.max(1, nsPlacements.length));
      const nsGreenInst = new THREE.InstancedMesh(lensGeo, nsGreenMat, Math.max(1, nsPlacements.length));
      const ewRedInst = new THREE.InstancedMesh(lensGeo, ewRedMat, Math.max(1, ewPlacements.length));
      const ewAmberInst = new THREE.InstancedMesh(lensGeo, ewAmberMat, Math.max(1, ewPlacements.length));
      const ewGreenInst = new THREE.InstancedMesh(lensGeo, ewGreenMat, Math.max(1, ewPlacements.length));
      nsRedInst.count = nsPlacements.length;
      nsAmberInst.count = nsPlacements.length;
      nsGreenInst.count = nsPlacements.length;
      ewRedInst.count = ewPlacements.length;
      ewAmberInst.count = ewPlacements.length;
      ewGreenInst.count = ewPlacements.length;

      const tmpObj = new THREE.Object3D();
      const tmpChild = new THREE.Object3D();
      tmpObj.add(tmpChild);

      const populateSignals = (
        list: { cx: number; cy: number; cz: number; rotY: number }[],
        redInst: THREE.InstancedMesh,
        amberInst: THREE.InstancedMesh,
        greenInst: THREE.InstancedMesh
      ) => {
        for (let idx = 0; idx < list.length; idx++) {
          const p = list[idx]!;
          tmpObj.position.set(p.cx, p.cy, p.cz);
          tmpObj.rotation.set(0, p.rotY, 0);
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

          // Lens faces -Z (toward approaching traffic along +Z)
          tmpChild.rotation.set(0, Math.PI, 0);
          tmpChild.position.set(4.1, 5.62, -0.19);
          tmpChild.updateMatrixWorld();
          redInst.setMatrixAt(idx, tmpChild.matrixWorld);

          tmpChild.position.set(4.1, 5.2, -0.19);
          tmpChild.updateMatrixWorld();
          amberInst.setMatrixAt(idx, tmpChild.matrixWorld);

          tmpChild.position.set(4.1, 4.78, -0.19);
          tmpChild.updateMatrixWorld();
          greenInst.setMatrixAt(idx, tmpChild.matrixWorld);
        }
      };

      populateSignals(nsPlacements, nsRedInst, nsAmberInst, nsGreenInst);
      populateSignals(ewPlacements, ewRedInst, ewAmberInst, ewGreenInst);

      // Add crisp white stop-lines on all incoming approaches to signalized junctions
      const stopLineMat = new THREE.MeshStandardMaterial({
        color: '#f8fafc',
        roughness: 0.7,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      });
      disposables.push(stopLineMat);
      for (const node of signalNodes) {
        for (const seg of segments) {
          const isTo = seg.def.toNodeId === node.id;
          const isFrom = seg.def.fromNodeId === node.id && !seg.def.oneWay;
          if (!isTo && !isFrom) continue;
          const sTarget = isTo ? Math.max(0, seg.lengthMeters - 13.5) : Math.min(seg.lengthMeters, 13.5);
          const tVal = THREE.MathUtils.clamp(sTarget / seg.lengthMeters, 0.02, 0.98);
          const pt = seg.curve.getPointAt(tVal);
          const tan = seg.curve.getTangentAt(tVal);
          const hLen = Math.hypot(tan.x, tan.z) || 1;
          const dirSign = isTo ? 1 : -1;
          const inTx = (tan.x / hLen) * dirSign;
          const inTz = (tan.z / hLen) * dirSign;
          const rx = -inTz;
          const rz = inTx;
          const laneCenter = seg.def.width * 0.24;
          const stopGeo = new THREE.BoxGeometry(seg.def.width * 0.42, 0.025, 0.55);
          batcher.add(stopLineMat, stopGeo, {
            x: pt.x + rx * laneCenter,
            y: pt.y + 0.075,
            z: pt.z + rz * laneCenter,
            rotY: Math.atan2(inTx, inTz),
          });
          disposables.push(stopGeo);
        }
      }

      for (const inst of [nsRedInst, nsAmberInst, nsGreenInst, ewRedInst, ewAmberInst, ewGreenInst]) {
        inst.instanceMatrix.needsUpdate = true;
        inst.layers.set(1);
        root.add(inst);
      }
    }

    // 4. InstancedMesh Highway Infrastructure: Slope-Matched Guardrails, Delineators, Noise Barriers, Street Lights, Gantries
    const dummy = new THREE.Object3D();
    const railTransforms: { x: number; y: number; z: number; rotY: number; pitch: number; scaleZ: number }[] = [];
    const delineatorTransforms: { x: number; y: number; z: number; rotY: number; isRight: boolean }[] = [];
    const noiseBarrierTransforms: { x: number; y: number; z: number; rotY: number; pitch: number; scaleZ: number }[] = [];
    const lightTransforms: { x: number; y: number; z: number; rotY: number }[] = [];

    for (const seg of segments) {
      const halfW = seg.def.width * 0.5;
      const computeSlopePitch = (idx: number): { pitch: number; scaleZ: number } => {
        const pPrev = seg.samples[Math.max(0, idx - 1)]!;
        const pNext = seg.samples[Math.min(seg.samples.length - 1, idx + 1)]!;
        const dH = Math.hypot(pNext.x - pPrev.x, pNext.z - pPrev.z) || 1;
        const dy = pNext.y - pPrev.y;
        return {
          pitch: -Math.atan2(dy, dH),
          scaleZ: Math.hypot(dH, dy) / dH,
        };
      };

      if (seg.def.hasGuardrails) {
        const isDividedMotorway = seg.def.roadClass === 'motorway' && seg.def.lanes >= 4;
        for (let i = 2; i < seg.samples.length - 2; i += 2) {
          const s = seg.samples[i]!;
          const rx = -s.tz;
          const rz = s.tx;
          const rotY = Math.atan2(s.tx, s.tz);
          const { pitch, scaleZ } = computeSlopePitch(i);
          railTransforms.push({ x: s.x - rx * (halfW + 0.75), y: s.y, z: s.z - rz * (halfW + 0.75), rotY, pitch, scaleZ });
          railTransforms.push({ x: s.x + rx * (halfW + 0.75), y: s.y, z: s.z + rz * (halfW + 0.75), rotY, pitch, scaleZ });

          // Slim low central double-wave barrier along 4-lane European motorways (reuses railInst, 0 extra DC)
          if (isDividedMotorway && i >= 4 && i < seg.samples.length - 4) {
            railTransforms.push({ x: s.x, y: s.y - 0.14, z: s.z, rotY, pitch, scaleZ });
          }

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
          const { pitch, scaleZ } = computeSlopePitch(i);
          noiseBarrierTransforms.push({
            x: s.x + rx * (halfW + 2.4),
            y: s.y,
            z: s.z + rz * (halfW + 2.4),
            rotY,
            pitch,
            scaleZ,
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
            x: s.x + rx * side * (halfW + 1.5),
            y: s.y,
            z: s.z + rz * side * (halfW + 1.5),
            rotY: side > 0 ? rotY : rotY + Math.PI,
          });
        }
      }
    }

    // Continuous Slope-Aligned Corrugated W-Beam Guardrails (12m step -> 12.6m rail beams so zero floating gaps)
    if (railTransforms.length > 0) {
      const postShaftGeo = new THREE.BoxGeometry(0.13, 0.78, 0.13);
      const postSpacerGeo = new THREE.BoxGeometry(0.16, 0.22, 0.16);
      const spacerMat = new THREE.Matrix4().makeTranslation(0, 0.22, 0);
      const guardrailPostGeo = mergeNormalizedParts(
        [{ geo: postShaftGeo }, { geo: postSpacerGeo, matrix: spacerMat }],
        false
      );
      postShaftGeo.dispose();
      postSpacerGeo.dispose();

      const wShape = new THREE.Shape();
      wShape.moveTo(-0.04, -0.14);
      wShape.lineTo(0.035, -0.09);
      wShape.lineTo(-0.015, 0);
      wShape.lineTo(0.035, 0.09);
      wShape.lineTo(-0.04, 0.14);
      wShape.lineTo(-0.065, 0.14);
      wShape.lineTo(0.01, 0.09);
      wShape.lineTo(-0.04, 0);
      wShape.lineTo(0.01, -0.09);
      wShape.lineTo(-0.065, -0.14);
      wShape.closePath();
      const guardrailRailGeo = new THREE.ExtrudeGeometry(wShape, {
        depth: 12.6,
        bevelEnabled: false,
        steps: 1,
      });
      guardrailRailGeo.translate(0, 0, -6.3);
      guardrailRailGeo.computeVertexNormals();

      const guardrailPostMat = new THREE.MeshStandardMaterial({ color: '#94a3b8', metalness: 0.65, roughness: 0.4 });
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
        dummy.rotation.set(tf.pitch, tf.rotY, 0, 'YXZ');
        dummy.scale.set(1, 1, tf.scaleZ);
        dummy.updateMatrix();
        railInst.setMatrixAt(i, dummy.matrix);
      }
      postInst.instanceMatrix.needsUpdate = true;
      railInst.instanceMatrix.needsUpdate = true;
      postInst.layers.set(1);
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

    // Continuous Slope-Aligned Acoustic Noise Barriers (12m step -> 12.4m panels)
    let noiseBarrierInst: THREE.InstancedMesh | null = null;
    if (noiseBarrierTransforms.length > 0) {
      const nbGeo = new THREE.BoxGeometry(0.24, 3.2, 12.4);
      const nbMat = new THREE.MeshStandardMaterial({ color: '#475a52', roughness: 0.8 });
      disposables.push(nbGeo, nbMat);
      noiseBarrierInst = new THREE.InstancedMesh(nbGeo, nbMat, noiseBarrierTransforms.length);
      for (let i = 0; i < noiseBarrierTransforms.length; i++) {
        const tf = noiseBarrierTransforms[i]!;
        dummy.position.set(tf.x, tf.y + 1.55, tf.z);
        dummy.rotation.set(tf.pitch, tf.rotY, 0, 'YXZ');
        dummy.scale.set(1, 1, tf.scaleZ);
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
      // European swan-neck cantilevered street lamp (local +X points toward the road centerline)
      const plinthGeo = new THREE.CylinderGeometry(0.19, 0.24, 0.55, 8);
      const mastGeo = new THREE.CylinderGeometry(0.085, 0.145, 7.35, 8);
      const armGeo = new THREE.CylinderGeometry(0.06, 0.08, 1.35, 6);
      armGeo.rotateZ(-Math.PI / 2 + 0.28);
      const hoodGeo = new THREE.BoxGeometry(0.76, 0.12, 0.34);

      const poleGeo = mergeNormalizedParts(
        [
          { geo: plinthGeo, matrix: new THREE.Matrix4().makeTranslation(0, 0.275, 0) },
          { geo: mastGeo, matrix: new THREE.Matrix4().makeTranslation(0, 3.675, 0) },
          { geo: armGeo, matrix: new THREE.Matrix4().makeTranslation(0.62, 7.42, 0) },
          { geo: hoodGeo, matrix: new THREE.Matrix4().makeTranslation(1.26, 7.64, 0) },
        ],
        false
      );
      plinthGeo.dispose();
      mastGeo.dispose();
      armGeo.dispose();
      hoodGeo.dispose();

      const poleMat = new THREE.MeshStandardMaterial({ color: '#475569', metalness: 0.62, roughness: 0.42 });
      const headGeo = new THREE.BoxGeometry(0.68, 0.05, 0.28);
      disposables.push(poleGeo, poleMat, headGeo);

      const poleInst = new THREE.InstancedMesh(poleGeo, poleMat, lightTransforms.length);
      const headInst = new THREE.InstancedMesh(headGeo, lampHeadMat, lightTransforms.length);

      for (let i = 0; i < lightTransforms.length; i++) {
        const tf = lightTransforms[i]!;
        dummy.position.set(tf.x, tf.y, tf.z);
        dummy.rotation.set(0, tf.rotY, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        poleInst.setMatrixAt(i, dummy.matrix);

        // Local +X tip (1.26m) rotated by tf.rotY points directly over the road
        const armOffsetX = Math.cos(tf.rotY) * 1.26;
        const armOffsetZ = -Math.sin(tf.rotY) * 1.26;
        dummy.position.set(tf.x + armOffsetX, tf.y + 7.56, tf.z + armOffsetZ);
        dummy.updateMatrix();
        headInst.setMatrixAt(i, dummy.matrix);
      }
      poleInst.instanceMatrix.needsUpdate = true;
      headInst.instanceMatrix.needsUpdate = true;
      poleInst.layers.set(1);
      headInst.layers.set(1);
      root.add(poleInst, headInst);
    }

    // Overhead Motorway Gantries (twin-chord steel truss + single-sided Euro sign faces with aluminum backing)
    if (manifest.gantries && manifest.gantries.length > 0) {
      const gantryList = manifest.gantries;
      const gPostShaftGeo = new THREE.CylinderGeometry(0.18, 0.22, 7.4, 8);
      const gPostFlangeGeo = new THREE.BoxGeometry(0.72, 0.28, 0.72);
      const gPostGeo = mergeNormalizedParts(
        [
          { geo: gPostShaftGeo },
          { geo: gPostFlangeGeo, matrix: new THREE.Matrix4().makeTranslation(0, -3.56, 0) },
        ],
        false
      );
      gPostShaftGeo.dispose();
      gPostFlangeGeo.dispose();

      const gChordGeo = new THREE.BoxGeometry(20, 0.14, 0.48);
      const gStrutGeo = new THREE.BoxGeometry(0.10, 0.44, 0.10);
      const beamParts: { geo: THREE.BufferGeometry; matrix: THREE.Matrix4 }[] = [
        { geo: gChordGeo, matrix: new THREE.Matrix4().makeTranslation(0, 0.24, 0) },
        { geo: gChordGeo, matrix: new THREE.Matrix4().makeTranslation(0, -0.24, 0) },
      ];
      for (let gx = -9; gx <= 9; gx += 2) {
        for (const gz of [-0.18, 0.18]) {
          beamParts.push({
            geo: gStrutGeo,
            matrix: new THREE.Matrix4().makeTranslation(gx, 0, gz),
          });
        }
      }
      const gBeamGeo = mergeNormalizedParts(beamParts, false);
      gChordGeo.dispose();
      gStrutGeo.dispose();

      const gSteelMat = new THREE.MeshStandardMaterial({ color: '#94a3b8', metalness: 0.65, roughness: 0.38 });
      const signGeo = new THREE.PlaneGeometry(8.6, 3.2);
      const signBackGeo = new THREE.BoxGeometry(8.66, 3.26, 0.14);
      const signBackMat = new THREE.MeshStandardMaterial({ color: '#64748b', metalness: 0.5, roughness: 0.55 });
      disposables.push(gPostGeo, gBeamGeo, gSteelMat, signGeo, signBackGeo, signBackMat);

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
        const tx = tan.x / len;
        const tz = tan.z / len;
        const rx = -tz;
        const rz = tx;
        const rotY = Math.atan2(tx, tz);
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

        // Aluminum structural backing box (batched, no reverse mirrored lettering!)
        batcher.add(signBackMat, signBackGeo, {
          x: p.x + tx * 0.08,
          y: p.y + 7.1,
          z: p.z + tz * 0.08,
          rotY,
          layer: 1,
        });

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
          side: THREE.FrontSide,
        });
        const signMesh = new THREE.Mesh(signGeo, signMat);
        signMesh.position.set(p.x - tx * 0.01, p.y + 7.1, p.z - tz * 0.01);
        signMesh.rotation.y = rotY + Math.PI;
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
    const parkedCarSpots: { x: number; y: number; z: number; rotY: number; color: string; isVan: boolean }[] = [];

    const sharedMats = this.createBatchMaterials(disposables, worldVertexMat);

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
        parkedCarSpots,
        disposables
      );
    }

    // Instanced parked sedans & vans at highway rest stops / service stations (Layer 1)
    const parkedSedans = parkedCarSpots.filter((p) => !p.isVan);
    const parkedVans = parkedCarSpots.filter((p) => p.isVan);
    const parkedVehicleInsts: THREE.InstancedMesh[] = [];
    if (parkedSedans.length > 0 || parkedVans.length > 0) {
      const parkedPaintMat = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.42 });
      const parkedDetailMat = new THREE.MeshStandardMaterial({
        color: '#ffffff',
        roughness: 0.54,
        metalness: 0.25,
        vertexColors: true,
      });
      disposables.push(parkedPaintMat, parkedDetailMat);

      const populateParked = (
        spots: typeof parkedCarSpots,
        pair: { paintGeo: THREE.BufferGeometry; detailGeo: THREE.BufferGeometry }
      ) => {
        if (spots.length === 0) {
          pair.paintGeo.dispose();
          pair.detailGeo.dispose();
          return;
        }
        disposables.push(pair.paintGeo, pair.detailGeo);
        const pInst = new THREE.InstancedMesh(pair.paintGeo, parkedPaintMat, spots.length);
        const dInst = new THREE.InstancedMesh(pair.detailGeo, parkedDetailMat, spots.length);
        const tmpC = new THREE.Color();
        for (let i = 0; i < spots.length; i++) {
          const sp = spots[i]!;
          dummy.position.set(sp.x, sp.y, sp.z);
          dummy.rotation.set(0, sp.rotY, 0);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          pInst.setMatrixAt(i, dummy.matrix);
          dInst.setMatrixAt(i, dummy.matrix);
          tmpC.set(sp.color);
          pInst.setColorAt(i, tmpC);
        }
        pInst.instanceMatrix.needsUpdate = true;
        dInst.instanceMatrix.needsUpdate = true;
        if (pInst.instanceColor) pInst.instanceColor.needsUpdate = true;
        pInst.layers.set(1);
        dInst.layers.set(1);
        root.add(pInst, dInst);
        parkedVehicleInsts.push(pInst, dInst);
      };

      if (parkedSedans.length > 0) populateParked(parkedSedans, createSedanGeometries());
      if (parkedVans.length > 0) populateParked(parkedVans, createVanGeometries());
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

    // 7. Landmarks & Interactive Toll Booths (batched per material; rotors & barriers animated)
    const rotatingRotors: THREE.Object3D[] = [];
    interface TollBoothRuntime {
      x: number;
      z: number;
      label: string;
      armPivots: THREE.Group[];
      lightMat: THREE.MeshBasicMaterial;
      openTarget: number;
      openRatio: number;
      cooldownSec: number;
    }
    const tollBooths: TollBoothRuntime[] = [];

    for (const lm of manifest.landmarks) {
      if (lm.kind === 'toll_booth') {
        const [tx, ty, tz] = lm.position;
        const rotY = lm.rotationY ?? 0;
        const boothGroup = new THREE.Group();
        boothGroup.position.set(tx, ty, tz);
        boothGroup.rotation.y = rotY;
        boothGroup.updateMatrixWorld(true);

        const canopyGeo = new THREE.BoxGeometry(24, 1.4, 7.2);
        const postGeo = new THREE.BoxGeometry(1.0, 6.6, 2.8);
        const boothCabinGeo = new THREE.BoxGeometry(1.06, 1.35, 2.15);
        const lightGeo = new THREE.BoxGeometry(0.7, 0.5, 0.3);
        const armGeo = new THREE.BoxGeometry(3.4, 0.14, 0.14);
        const armStripeGeo = new THREE.BoxGeometry(0.65, 0.15, 0.15);
        const boothLightMat = new THREE.MeshBasicMaterial({ color: '#f59e0b' });
        const armMat = new THREE.MeshStandardMaterial({ color: '#ef4444', roughness: 0.45 });
        const armWhiteMat = new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.45 });
        disposables.push(canopyGeo, postGeo, boothCabinGeo, lightGeo, armGeo, armStripeGeo, boothLightMat, armMat, armWhiteMat);

        const child = new THREE.Object3D();
        boothGroup.add(child);
        child.position.set(0, 6.8, 0);
        child.updateMatrixWorld();
        batcher.add(sharedMats.worldVertexMat, canopyGeo, {
          matrix: child.matrixWorld,
          colorHex: '#1e3a8a',
        });
        for (const px of [-9.8, -3.2, 3.2, 9.8]) {
          child.position.set(px, 3.3, 0);
          child.updateMatrixWorld();
          batcher.add(sharedMats.worldVertexMat, postGeo, {
            matrix: child.matrixWorld,
            colorHex: '#e2e8f0',
          });
          child.position.set(px, 2.45, 0);
          child.updateMatrixWorld();
          batcher.add(sharedMats.worldVertexMat, boothCabinGeo, {
            matrix: child.matrixWorld,
            colorHex: '#1e293b',
          });
        }
        boothGroup.remove(child);

        const armPivots: THREE.Group[] = [];
        for (const lx of [-6.5, 0, 6.5]) {
          const lFront = new THREE.Mesh(lightGeo, boothLightMat);
          lFront.position.set(lx, 6.6, 3.65);
          const lBack = new THREE.Mesh(lightGeo, boothLightMat);
          lBack.position.set(lx, 6.6, -3.65);
          boothGroup.add(lFront, lBack);

          const pivot = new THREE.Group();
          pivot.position.set(lx - 1.6, 1.35, 0);
          const arm = new THREE.Mesh(armGeo, armMat);
          arm.position.set(1.7, 0, 0);
          pivot.add(arm);
          for (const sx of [0.85, 2.15]) {
            const stripe = new THREE.Mesh(armStripeGeo, armWhiteMat);
            stripe.position.set(sx, 0, 0);
            pivot.add(stripe);
          }
          boothGroup.add(pivot);
          armPivots.push(pivot);
        }
        root.add(boothGroup);
        tollBooths.push({
          x: tx,
          z: tz,
          label: lm.id === 'lm_toll_west' ? 'A9 西部 E-Toll 收费站' : 'A2 北部 E-Toll 收费站',
          armPivots,
          lightMat: boothLightMat,
          openTarget: 0,
          openRatio: 0,
          cooldownSec: 0,
        });
      } else {
        this.buildLandmark(lm, root, batcher, sharedMats, rotatingRotors, colliders, disposables);
      }
    }

    // 7b. European Motorway Exit Countdown Signs, Alpine Chevrons & City Welcome Signs (Layer 1)
    const signPostSpots: { x: number; y: number; z: number; h: number }[] = [];
    const exit300Spots: { x: number; y: number; z: number; rotY: number }[] = [];
    const exit200Spots: { x: number; y: number; z: number; rotY: number }[] = [];
    const exit100Spots: { x: number; y: number; z: number; rotY: number }[] = [];
    const chevronSpots: { x: number; y: number; z: number; rotY: number }[] = [];
    const decorativeSignMeshes: THREE.Object3D[] = [];

    for (const segId of ['seg_a9_south', 'seg_a7_north', 'seg_a2_east', 'seg_bavaria_express']) {
      const seg = segmentMap.get(segId);
      if (!seg) continue;
      for (const [tVal, targetArr] of [
        [0.72, exit300Spots],
        [0.80, exit200Spots],
        [0.88, exit100Spots],
      ] as const) {
        const pt = seg.curve.getPointAt(tVal);
        const tan = seg.curve.getTangentAt(tVal);
        const len = Math.hypot(tan.x, tan.z) || 1;
        const rx = -tan.z / len;
        const rz = tan.x / len;
        const sx = pt.x + rx * (seg.def.width * 0.5 + 2.3);
        const sz = pt.z + rz * (seg.def.width * 0.5 + 2.3);
        const rotY = Math.atan2(tan.x, tan.z) + Math.PI;
        targetArr.push({ x: sx, y: pt.y, z: sz, rotY });
        signPostSpots.push({ x: sx, y: pt.y, z: sz, h: 2.5 });
      }
    }

    for (const segId of ['seg_alpine_climb', 'seg_alpine_ridge']) {
      const seg = segmentMap.get(segId);
      if (!seg || seg.samples.length < 8) continue;
      for (let i = 4; i < seg.samples.length - 4; i += 3) {
        const pPrev = seg.samples[i - 2]!;
        const pCurr = seg.samples[i]!;
        const pNext = seg.samples[i + 2]!;
        const cross = pPrev.tx * pNext.tz - pPrev.tz * pNext.tx;
        if (Math.abs(cross) > 0.14) {
          // Outer curve shoulder
          const outSign = cross > 0 ? 1 : -1;
          const rx = -pCurr.tz;
          const rz = pCurr.tx;
          const sx = pCurr.x + rx * outSign * (seg.def.width * 0.5 + 2.1);
          const sz = pCurr.z + rz * outSign * (seg.def.width * 0.5 + 2.1);
          const rotY = Math.atan2(pCurr.tx, pCurr.tz) + Math.PI;
          chevronSpots.push({ x: sx, y: pCurr.y, z: sz, rotY });
          signPostSpots.push({ x: sx, y: pCurr.y, z: sz, h: 1.9 });
        }
      }
    }

    const buildInstancedSign = (
      spots: { x: number; y: number; z: number; rotY: number }[],
      w: number,
      h: number,
      yOff: number,
      tex: THREE.CanvasTexture
    ) => {
      if (spots.length === 0) return;
      const geo = new THREE.PlaneGeometry(w, h);
      const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
      const inst = new THREE.InstancedMesh(geo, mat, spots.length);
      for (let i = 0; i < spots.length; i++) {
        const sp = spots[i]!;
        dummy.position.set(sp.x, sp.y + yOff, sp.z);
        dummy.rotation.set(0, sp.rotY, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
      }
      inst.instanceMatrix.needsUpdate = true;
      inst.layers.set(1);
      root.add(inst);
      decorativeSignMeshes.push(inst);
      disposables.push(geo, mat);
    };

    buildInstancedSign(exit300Spots, 1.05, 2.0, 2.2, this.textures.getExitCountdownTexture(300));
    buildInstancedSign(exit200Spots, 1.05, 2.0, 2.2, this.textures.getExitCountdownTexture(200));
    buildInstancedSign(exit100Spots, 1.05, 2.0, 2.2, this.textures.getExitCountdownTexture(100));
    buildInstancedSign(chevronSpots, 2.1, 1.05, 1.75, this.textures.getCurveChevronTexture());

    // 4 European City Welcome Signs
    const cityWelcomePairs: [string, string, string][] = [
      ['seg_munich_spur', 'München', '德国'],
      ['seg_hamburg_spur', 'Hamburg', '德国'],
      ['seg_frankfurt_spur', 'Frankfurt', '德国'],
      ['seg_innsbruck_spur', 'Innsbruck', '奥地利'],
    ];
    const welcomeGeo = new THREE.PlaneGeometry(2.8, 1.4);
    disposables.push(welcomeGeo);
    for (const [segId, label, country] of cityWelcomePairs) {
      const seg = segmentMap.get(segId);
      if (!seg) continue;
      const pt = seg.curve.getPointAt(0.5);
      const tan = seg.curve.getTangentAt(0.5);
      const len = Math.hypot(tan.x, tan.z) || 1;
      const rx = -tan.z / len;
      const rz = tan.x / len;
      const sx = pt.x - rx * (seg.def.width * 0.5 + 2.2);
      const sz = pt.z - rz * (seg.def.width * 0.5 + 2.2);
      const tex = this.textures.getCityWelcomeSignTexture(label, country);
      const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(welcomeGeo, mat);
      mesh.position.set(sx, pt.y + 2.35, sz);
      mesh.rotation.y = Math.atan2(tan.x, tan.z);
      mesh.layers.set(1);
      root.add(mesh);
      decorativeSignMeshes.push(mesh);
      disposables.push(mat);
      signPostSpots.push({ x: sx, y: pt.y, z: sz, h: 2.3 });
    }

    if (signPostSpots.length > 0) {
      const sPostGeo = new THREE.CylinderGeometry(0.06, 0.07, 1, 6);
      const sPostMat = new THREE.MeshStandardMaterial({ color: '#94a3b8', metalness: 0.6 });
      const sPostInst = new THREE.InstancedMesh(sPostGeo, sPostMat, signPostSpots.length);
      for (let i = 0; i < signPostSpots.length; i++) {
        const sp = signPostSpots[i]!;
        dummy.position.set(sp.x, sp.y + sp.h * 0.5, sp.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, sp.h, 1);
        dummy.updateMatrix();
        sPostInst.setMatrixAt(i, dummy.matrix);
      }
      sPostInst.instanceMatrix.needsUpdate = true;
      sPostInst.layers.set(1);
      root.add(sPostInst);
      decorativeSignMeshes.push(sPostInst);
      disposables.push(sPostGeo, sPostMat);
    }

    batcher.flush(root, disposables);

    // 8. Multi-Tier Natural Ecology (3 Tree Species + Bushes) & Distant Rural Props (Power Pylons + Cottages)
    const updateSceneryDensityBase = this.buildEcologyAndRuralProps(
      manifest,
      root,
      findNearestRoadDistanceAndY,
      getHeightAt,
      lightTransforms,
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
    const updateSceneryDensity = (ratio: number, isLowSpec = false) => {
      updateSceneryDensityBase(ratio, isLowSpec);
      for (let i = 0; i < decorativeSignMeshes.length; i++) {
        decorativeSignMeshes[i]!.visible = !isLowSpec;
      }
      for (let i = 0; i < parkedVehicleInsts.length; i++) {
        parkedVehicleInsts[i]!.visible = !isLowSpec;
      }
    };

    // Precomputed flat paved zones for fast zero-hypot surface queries
    const pavedCityBoxes: { minX: number; maxX: number; minZ: number; maxZ: number; y: number }[] = [];
    const pavedCircles: { x: number; z: number; rSq: number; y: number }[] = [];
    for (const city of manifest.cities) {
      pavedCityBoxes.push({
        minX: city.position[0] - 145,
        maxX: city.position[0] + 145,
        minZ: city.position[2] - 155,
        maxZ: city.position[2] + 155,
        y: city.position[1],
      });
      for (const depot of city.depots) {
        pavedCircles.push(
          { x: depot.parkingBayPosition[0], z: depot.parkingBayPosition[2], rSq: 42 * 42, y: depot.position[1] },
          { x: depot.officePosition[0], z: depot.officePosition[2], rSq: 42 * 42, y: depot.position[1] },
          { x: depot.position[0], z: depot.position[2], rSq: 48 * 48, y: depot.position[1] }
        );
      }
      for (const st of city.stations) {
        const r = st.radius + 18;
        pavedCircles.push({ x: st.position[0], z: st.position[2], rSq: r * r, y: st.position[1] });
      }
    }

    // 9. Surface Query (O(1) spatial hash + linear slope interpolation + full paved yards/rest stops)
    const querySurface = (x: number, z: number, out: SurfaceQueryResult): void => {
      const gx = Math.floor(x / cellSize);
      const gz = Math.floor(z / cellSize);
      const entries = spatialGrid.get(cellKey(gx, gz));

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
        out.roadHalfWidth = halfW;
        out.medianBarrierHit = false;
        out.medianPushX = 0;
        out.medianPushZ = 0;
        out.medianPenetration = 0;

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

        // 4-lane divided motorway central median steel barrier check (outside junction nodes)
        if (
          bestSeg.def.roadClass === 'motorway' &&
          bestSeg.def.lanes >= 4 &&
          bestSeg.def.hasGuardrails
        ) {
          const fn = nodeMap.get(bestSeg.def.fromNodeId);
          const tn = nodeMap.get(bestSeg.def.toNodeId);
          const distFromNode = fn ? Math.hypot(x - fn.position[0], z - fn.position[2]) : 999;
          const distToNode = tn ? Math.hypot(x - tn.position[0], z - tn.position[2]) : 999;
          if (distFromNode > 26 && distToNode > 26) {
            const rx = -p0.tz;
            const rz = p0.tx;
            const signedLat = (x - p0.x) * rx + (z - p0.z) * rz;
            const medianHalf = 1.45;
            if (Math.abs(signedLat) < medianHalf) {
              const pushSide = signedLat >= 0 ? 1 : -1;
              out.medianBarrierHit = true;
              out.medianPushX = rx * pushSide;
              out.medianPushZ = rz * pushSide;
              out.medianPenetration = medianHalf - Math.abs(signedLat);
            }
          }
        }
      } else {
        out.groundY = terrainY;
        out.onRoad = false;
        out.speedLimitKmh = 60;
        out.nearestSegmentId = null;
        out.roadDist = 999;
        out.roadHalfWidth = 0;
        out.guardrailHit = false;
        out.guardrailPushX = 0;
        out.guardrailPushZ = 0;
        out.medianBarrierHit = false;
        out.medianPushX = 0;
        out.medianPushZ = 0;
        out.medianPenetration = 0;
      }

      for (let i = 0; i < pavedCityBoxes.length; i++) {
        const b = pavedCityBoxes[i]!;
        if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) {
          out.groundY = b.y;
          out.onRoad = true;
          out.speedLimitKmh = 50;
          out.guardrailHit = false;
          return;
        }
      }

      for (let i = 0; i < pavedCircles.length; i++) {
        const c = pavedCircles[i]!;
        const dx = x - c.x;
        const dz = z - c.z;
        if (dx * dx + dz * dz <= c.rSq) {
          out.groundY = c.y;
          out.onRoad = true;
          out.speedLimitKmh = 50;
          out.guardrailHit = false;
          return;
        }
      }
    };

    let bayAligned = false;
    const highlightDestinationDepot = (depotId: string | null): void => {
      const bayInfo = depotId ? depotBayTransforms.get(depotId) : undefined;
      if (bayInfo) {
        activeBayMesh.position.set(bayInfo.x, bayInfo.y + 0.095, bayInfo.z);
        activeBayMesh.rotation.set(-Math.PI / 2, 0, bayInfo.headingRad);
        activeBayMesh.visible = true;
      } else {
        activeBayMesh.visible = false;
        bayAligned = false;
      }
      for (const [id, beacon] of parkingBeaconMeshes.entries()) {
        beacon.visible = id === depotId;
      }
    };

    const setDestinationBayAligned = (aligned: boolean): void => {
      bayAligned = aligned;
      activeBayMat.color.setHex(aligned ? 0x10b981 : 0xf59e0b);
    };

    const evaluateTollBooths = (
      tx: number,
      tz: number,
      speedKmh: number,
      dtSec: number
    ): { kind: 'paid' | 'violation'; label: string } | null => {
      let event: { kind: 'paid' | 'violation'; label: string } | null = null;
      for (let i = 0; i < tollBooths.length; i++) {
        const tb = tollBooths[i]!;
        if (tb.cooldownSec > 0) {
          tb.cooldownSec = Math.max(0, tb.cooldownSec - dtSec);
        }
        const dist = Math.hypot(tx - tb.x, tz - tb.z);
        if (dist < 26) {
          if (speedKmh <= 42) {
            tb.openTarget = 1;
            tb.lightMat.color.setHex(0x22c55e);
            if (dist < 13 && tb.cooldownSec <= 0) {
              tb.cooldownSec = 10;
              event = { kind: 'paid', label: tb.label };
            }
          } else {
            tb.openTarget = 0;
            tb.lightMat.color.setHex(0xef4444);
            if (dist < 9.5 && tb.openRatio < 0.45 && tb.cooldownSec <= 0) {
              tb.cooldownSec = 10;
              event = { kind: 'violation', label: tb.label };
            }
          }
        } else {
          tb.openTarget = 0;
          tb.lightMat.color.setHex(0xf59e0b);
        }

        tb.openRatio += (tb.openTarget - tb.openRatio) * Math.min(1, dtSec * 4.5);
        const angle = tb.openRatio * 1.28;
        for (let a = 0; a < tb.armPivots.length; a++) {
          tb.armPivots[a]!.rotation.z = angle;
        }
      }
      return event;
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

    let lastWetness = -1;
    const setRainWetness = (wet01: number): void => {
      const w = THREE.MathUtils.clamp(wet01, 0, 1);
      if (Math.abs(w - lastWetness) < 0.005) return;
      lastWetness = w;
      const rough = THREE.MathUtils.lerp(0.85, 0.26, w);
      const metal = THREE.MathUtils.lerp(0.04, 0.24, w);
      const envInt = THREE.MathUtils.lerp(0.55, 1.38, w);
      for (let i = 0; i < roadMaterials.length; i++) {
        const m = roadMaterials[i]!;
        m.roughness = rough;
        m.metalness = metal;
        m.envMapIntensity = envInt;
      }
      yardApronMat.roughness = THREE.MathUtils.lerp(0.86, 0.34, w);
      yardApronMat.envMapIntensity = THREE.MathUtils.lerp(0.55, 1.2, w);
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
        const pulseSpeed = bayAligned ? 9.0 : 4.2;
        activeBayMat.opacity = (bayAligned ? 0.8 : 0.68) + Math.sin(elapsedSec * pulseSpeed) * 0.22;
      }
      for (const beacon of parkingBeaconMeshes.values()) {
        if (beacon.visible) {
          beacon.rotation.y += dtSec * 1.4;
          const pulse = 1 + Math.sin(elapsedSec * 3.5) * 0.08;
          beacon.scale.set(pulse, 1, pulse);
        }
      }
    };

    const getUpcomingTollBooth = (
      x: number,
      z: number,
      yaw: number
    ): { label: string; distMeters: number } | null => {
      const fwdX = Math.sin(yaw);
      const fwdZ = Math.cos(yaw);
      let best: { label: string; distMeters: number } | null = null;
      let bestDist = 120;
      for (let i = 0; i < tollBooths.length; i++) {
        const tb = tollBooths[i]!;
        const dx = tb.x - x;
        const dz = tb.z - z;
        const d = Math.hypot(dx, dz);
        if (d < 6 || d >= bestDist) continue;
        const dot = (dx * fwdX + dz * fwdZ) / d;
        if (dot > 0.45) {
          bestDist = d;
          best = { label: tb.label, distMeters: Math.round(d) };
        }
      }
      return best;
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
      getUpcomingTollBooth,
      highlightDestinationDepot,
      setDestinationBayAligned,
      evaluateTollBooths,
      setFoliageDensity: updateSceneryDensity,
      setPbrDetailEnabled,
      setRainWetness,
      update,
      dispose,
    };
  }

  private createBatchMaterials(
    disposables: { dispose: () => void }[],
    worldVertexMat: THREE.MeshStandardMaterial
  ) {
    const ringPadVertexMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.78,
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
    const tollLightMat = new THREE.MeshBasicMaterial({ color: '#22c55e' });
    const whFrontMats = new Map<string, THREE.MeshStandardMaterial>();
    const officeFacadeMat = new THREE.MeshStandardMaterial({
      map: this.textures.getBuildingFacadeTexture('office'),
      roughness: 0.72,
    });
    const warehouseBlockMat = new THREE.MeshStandardMaterial({
      map: this.textures.getBuildingFacadeTexture('warehouse'),
      roughness: 0.7,
    });

    disposables.push(
      ringPadVertexMat,
      stationFuelTrimMat,
      stationHubTrimMat,
      lakeMat,
      tollLightMat,
      officeFacadeMat,
      warehouseBlockMat
    );

    return {
      worldVertexMat,
      ringPadVertexMat,
      stationFuelTrimMat,
      stationHubTrimMat,
      lakeMat,
      tollLightMat,
      whFrontMats,
      officeFacadeMat,
      warehouseBlockMat,
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
    parkedCarSpots: { x: number; y: number; z: number; rotY: number; color: string; isVan: boolean }[],
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
        parkedCarSpots,
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
    batcher.add(sharedMats.worldVertexMat, whBodyGeo, {
      x: whX,
      y: by + 3.8,
      z: whZ,
      rotY: depot.parkingBayHeadingRad,
      colorHex: '#475569',
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
    batcher.add(sharedMats.officeFacadeMat, officeGeo, {
      x: ox + 5.8,
      y: oy + 2.1,
      z: oz,
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
    parkedCarSpots: { x: number; y: number; z: number; rotY: number; color: string; isVan: boolean }[],
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
    batcher.add(sharedMats.worldVertexMat, roofGeo, {
      x: sx,
      y: sy + 6.4,
      z: sz,
      colorHex: '#253142',
      castShadow: true,
    });

    const trimGeo = new THREE.BoxGeometry(16.2, 0.35, 12.2);
    batcher.add(
      isFuelOnly ? sharedMats.stationFuelTrimMat : sharedMats.stationHubTrimMat,
      trimGeo,
      { x: sx, y: sy + 6.4, z: sz }
    );

    // Fuel islands: concrete curb, pump housing, dark digital display, brand top cap & yellow bollards
    const curbGeo = new THREE.BoxGeometry(1.5, 0.16, 3.4);
    const pumpGeo = new THREE.BoxGeometry(0.9, 1.7, 0.65);
    const pumpDisplayGeo = new THREE.BoxGeometry(0.64, 0.48, 0.68);
    const pumpCapGeo = new THREE.BoxGeometry(1.02, 0.26, 0.76);
    const bollardGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.95, 8);
    for (const px of [-3.6, 3.6]) {
      batcher.add(sharedMats.worldVertexMat, curbGeo, {
        x: sx + px,
        y: sy + 0.08,
        z: sz,
        colorHex: '#94a3b8',
      });
      batcher.add(sharedMats.worldVertexMat, pumpGeo, {
        x: sx + px,
        y: sy + 0.92,
        z: sz,
        colorHex: '#d8e0ea',
      });
      batcher.add(sharedMats.worldVertexMat, pumpDisplayGeo, {
        x: sx + px,
        y: sy + 1.28,
        z: sz,
        colorHex: '#0f172a',
      });
      batcher.add(sharedMats.worldVertexMat, pumpCapGeo, {
        x: sx + px,
        y: sy + 1.85,
        z: sz,
        colorHex: accentColor,
      });
      for (const bz of [-1.45, 1.45]) {
        batcher.add(sharedMats.worldVertexMat, bollardGeo, {
          x: sx + px,
          y: sy + 0.48,
          z: sz + bz,
          colorHex: '#eab308',
        });
      }
    }

    const shopGeo = new THREE.BoxGeometry(10, 4.0, 6.5);
    batcher.add(sharedMats.worldVertexMat, shopGeo, {
      x: sx,
      y: sy + 2.0,
      z: sz - 12.5,
      colorHex: '#253142',
    });
    const shopGlassGeo = new THREE.BoxGeometry(9.2, 1.5, 6.62);
    batcher.add(sharedMats.worldVertexMat, shopGlassGeo, {
      x: sx,
      y: sy + 2.15,
      z: sz - 12.5,
      colorHex: '#1e293b',
    });
    const awningGeo = new THREE.BoxGeometry(7.2, 0.22, 1.4);
    batcher.add(sharedMats.worldVertexMat, awningGeo, {
      x: sx,
      y: sy + 3.15,
      z: sz - 8.8,
      colorHex: '#334155',
    });

    // Roadside station price totem pylon (clear of fueling lanes)
    const totemGeo = new THREE.BoxGeometry(1.4, 7.5, 0.45);
    const totemTrimGeo = new THREE.BoxGeometry(1.5, 0.65, 0.52);
    batcher.add(sharedMats.worldVertexMat, totemGeo, {
      x: sx + 10.5,
      y: sy + 3.75,
      z: sz + 6.5,
      colorHex: '#1e293b',
    });
    batcher.add(
      isFuelOnly ? sharedMats.stationFuelTrimMat : sharedMats.stationHubTrimMat,
      totemTrimGeo,
      { x: sx + 10.5, y: sy + 7.1, z: sz + 6.5 }
    );

    // Parked vehicles beside the station shop
    const parkedPalette = ['#dc2626', '#2563eb', '#e2e8f0', '#475569', '#059669'];
    const pIdx = Math.abs(Math.round(sx + sz)) % parkedPalette.length;
    parkedCarSpots.push(
      {
        x: sx + 8.6,
        y: sy,
        z: sz - 12.2,
        rotY: 0.06,
        color: parkedPalette[pIdx]!,
        isVan: false,
      },
      {
        x: sx - 8.6,
        y: sy,
        z: sz - 12.2,
        rotY: Math.PI - 0.05,
        color: '#f1f5f9',
        isVan: true,
      }
    );

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
      batcher.add(sharedMats.worldVertexMat, pillarGeo, {
        x: sx + px,
        y: sy + 3.1,
        z: sz + pz,
        colorHex: '#d8e0ea',
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

    disposables.push(
      roofGeo,
      trimGeo,
      curbGeo,
      pumpGeo,
      pumpDisplayGeo,
      pumpCapGeo,
      bollardGeo,
      shopGeo,
      shopGlassGeo,
      awningGeo,
      totemGeo,
      totemTrimGeo,
      pillarGeo,
      padGeo
    );
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
      batcher.add(sharedMats.worldVertexMat, mastGeo, {
        x,
        y: y + 26,
        z,
        rotY,
        colorHex: '#e2e8f0',
        layer: 1,
      });
      batcher.add(sharedMats.worldVertexMat, nacelleGeo, {
        x,
        y: y + 52,
        z,
        rotY,
        colorHex: '#e2e8f0',
        layer: 1,
      });

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
        rotorBatch.add(sharedMats.worldVertexMat, bladeGeo, {
          matrix: tmpBlade.matrixWorld,
          colorHex: '#e2e8f0',
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
      batcher.add(sharedMats.warehouseBlockMat, geo, {
        x,
        y: y + sy * 0.5,
        z,
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
        batcher.add(sharedMats.worldVertexMat, legGeo, {
          matrix: child.matrixWorld,
          colorHex,
          layer: 1,
        });
      }
      child.position.set(0, 26.5, 8);
      child.updateMatrixWorld();
      batcher.add(sharedMats.worldVertexMat, beamGeo, {
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
      batcher.add(sharedMats.worldVertexMat, canopyGeo, {
        matrix: child.matrixWorld,
        colorHex: '#1e3a8a',
      });

      for (const px of [-9.8, -3.2, 3.2, 9.8]) {
        child.position.set(px, 3.3, 0);
        child.updateMatrixWorld();
        batcher.add(sharedMats.worldVertexMat, postGeo, {
          matrix: child.matrixWorld,
          colorHex: '#e2e8f0',
        });
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
        batcher.add(sharedMats.worldVertexMat, armGeo, {
          matrix: child.matrixWorld,
          colorHex: '#ef4444',
        });
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
        batcher.add(sharedMats.worldVertexMat, towerGeo, {
          matrix: child.matrixWorld,
          colorHex: '#cbd5e1',
        });

        child.position.set(px * 0.88, 0.7, 0);
        child.updateMatrixWorld();
        batcher.add(sharedMats.worldVertexMat, parapetGeo, {
          matrix: child.matrixWorld,
          colorHex: '#cbd5e1',
        });
      }
      child.position.set(0, 16, 0);
      child.updateMatrixWorld();
      batcher.add(sharedMats.worldVertexMat, crossGeo, {
        matrix: child.matrixWorld,
        colorHex: '#cbd5e1',
      });
      disposables.push(towerGeo, crossGeo, parapetGeo);
    }
  }

  private buildEcologyAndRuralProps(
    manifest: MapManifest,
    root: THREE.Group,
    findNearestRoadDistanceAndY: (x: number, z: number) => { dist: number; y: number; seg: CompiledRoadSegment | null },
    getHeightAt: (x: number, z: number) => number,
    lightTransforms: { x: number; y: number; z: number; rotY: number }[],
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

    const maxAttempts = 2800;
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
      const halfW = (roadInfo.seg?.def.width ?? 14) * 0.5;
      const minClearance = halfW + 7.2; // Keep trees strictly outside roadHalfWidth + 6.5m & clear of shoulders
      if (roadInfo.dist < minClearance || roadInfo.dist > 280) continue;

      // Reject trees near intersections/nodes (> 22m) or streetlights (> 7.5m) to eliminate canopy clipping
      let nearObstacle = false;
      for (let nIdx = 0; nIdx < manifest.nodes.length; nIdx++) {
        const nd = manifest.nodes[nIdx]!;
        if (Math.hypot(x - nd.position[0], z - nd.position[2]) < 22) {
          nearObstacle = true;
          break;
        }
      }
      if (nearObstacle) continue;

      for (let lIdx = 0; lIdx < lightTransforms.length; lIdx++) {
        const lt = lightTransforms[lIdx]!;
        if (Math.hypot(x - lt.x, z - lt.z) < 7.5) {
          nearObstacle = true;
          break;
        }
      }
      if (nearObstacle) continue;

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

    // 1. Nordic Spruce (Flared-root Trunk with Branches + 3 Layered Foliage Cones)
    const rootFlareGeo = new THREE.CylinderGeometry(0.36, 0.54, 0.9, 6);
    const trunkMainGeo = new THREE.CylinderGeometry(0.22, 0.38, 3.4, 6);
    const branchStubGeo = new THREE.CylinderGeometry(0.10, 0.17, 1.5, 5);
    const trunkGeo = mergeNormalizedParts(
      [
        { geo: rootFlareGeo, matrix: new THREE.Matrix4().makeTranslation(0, -1.25, 0) },
        { geo: trunkMainGeo },
        {
          geo: branchStubGeo,
          matrix: new THREE.Matrix4().compose(
            new THREE.Vector3(0.45, 1.45, 0),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -0.52)),
            new THREE.Vector3(1, 1, 1)
          ),
        },
        {
          geo: branchStubGeo,
          matrix: new THREE.Matrix4().compose(
            new THREE.Vector3(-0.38, 1.25, 0.25),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(0.32, 0, 0.48)),
            new THREE.Vector3(1, 1, 1)
          ),
        },
      ],
      false
    );
    rootFlareGeo.dispose();
    trunkMainGeo.dispose();
    branchStubGeo.dispose();

    const jitterFoliage = (geo: THREE.BufferGeometry, amp = 0.14): THREE.BufferGeometry => {
      const pos = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const vx = pos.getX(i);
        const vy = pos.getY(i);
        const vz = pos.getZ(i);
        const h = Math.sin(vx * 12.9898 + vy * 78.233 + vz * 37.719) * 43758.5453;
        const frac = h - Math.floor(h);
        const scale = 1 + (frac * 2 - 1) * amp;
        pos.setXYZ(i, vx * scale, vy * scale, vz * scale);
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
      return geo;
    };

    const trunkMat = new THREE.MeshStandardMaterial({ color: '#5c4033', roughness: 0.92 });
    const spruceLowGeo = new THREE.ConeGeometry(2.45, 4.8, 7);
    const spruceMidGeo = new THREE.ConeGeometry(1.95, 4.4, 7);
    const spruceHighGeo = new THREE.ConeGeometry(1.35, 3.8, 7);
    const spruceMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.88, flatShading: true });
    disposables.push(trunkGeo, trunkMat, spruceLowGeo, spruceMidGeo, spruceHighGeo, spruceMat);

    let spruceTrunkInst: THREE.InstancedMesh | null = null;
    let spruceLowInst: THREE.InstancedMesh | null = null;
    let spruceMidInst: THREE.InstancedMesh | null = null;
    let spruceHighInst: THREE.InstancedMesh | null = null;

    if (spruceSpots.length > 0) {
      spruceTrunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, spruceSpots.length);
      spruceLowInst = new THREE.InstancedMesh(spruceLowGeo, spruceMat, spruceSpots.length);
      spruceMidInst = new THREE.InstancedMesh(spruceMidGeo, spruceMat, spruceSpots.length);
      spruceHighInst = new THREE.InstancedMesh(spruceHighGeo, spruceMat, spruceSpots.length);

      for (let i = 0; i < spruceSpots.length; i++) {
        const t = spruceSpots[i]!;
        dummy.position.set(t.x, t.y + 1.6 * t.scale, t.z);
        dummy.rotation.set(0, (i * 1.37) % Math.PI, 0);
        dummy.scale.set(t.scale, t.scale, t.scale);
        dummy.updateMatrix();
        spruceTrunkInst.setMatrixAt(i, dummy.matrix);

        dummy.position.set(t.x, t.y + 4.4 * t.scale, t.z);
        dummy.updateMatrix();
        spruceLowInst.setMatrixAt(i, dummy.matrix);

        dummy.position.set(t.x, t.y + 6.7 * t.scale, t.z);
        dummy.updateMatrix();
        spruceMidInst.setMatrixAt(i, dummy.matrix);

        dummy.position.set(t.x, t.y + 8.8 * t.scale, t.z);
        dummy.updateMatrix();
        spruceHighInst.setMatrixAt(i, dummy.matrix);

        tmpColor.setHSL(0.37 + ((i % 7) - 3) * 0.012, 0.36, 0.21 + (i % 5) * 0.02);
        spruceLowInst.setColorAt(i, tmpColor);
        spruceMidInst.setColorAt(i, tmpColor);
        spruceHighInst.setColorAt(i, tmpColor);
      }
      spruceTrunkInst.instanceMatrix.needsUpdate = true;
      spruceLowInst.instanceMatrix.needsUpdate = true;
      spruceMidInst.instanceMatrix.needsUpdate = true;
      spruceHighInst.instanceMatrix.needsUpdate = true;
      if (spruceLowInst.instanceColor) spruceLowInst.instanceColor.needsUpdate = true;
      if (spruceMidInst.instanceColor) spruceMidInst.instanceColor.needsUpdate = true;
      if (spruceHighInst.instanceColor) spruceHighInst.instanceColor.needsUpdate = true;
      spruceTrunkInst.layers.set(1);
      spruceMidInst.layers.set(1);
      root.add(spruceTrunkInst, spruceLowInst, spruceMidInst, spruceHighInst);
    }

    // 2. Broadleaf Oak (Trunk + Organic Jittered Dual-Cluster Asymmetric Crown)
    const oakGeo = jitterFoliage(new THREE.IcosahedronGeometry(2.5, 1), 0.14);
    const oakSubGeo = jitterFoliage(new THREE.IcosahedronGeometry(1.75, 1), 0.14);
    const oakMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.88, flatShading: true });
    disposables.push(oakGeo, oakSubGeo, oakMat);

    let oakTrunkInst: THREE.InstancedMesh | null = null;
    let oakInst: THREE.InstancedMesh | null = null;
    let oakSubInst: THREE.InstancedMesh | null = null;
    if (oakSpots.length > 0) {
      oakTrunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, oakSpots.length);
      oakInst = new THREE.InstancedMesh(oakGeo, oakMat, oakSpots.length);
      oakSubInst = new THREE.InstancedMesh(oakSubGeo, oakMat, oakSpots.length);
      for (let i = 0; i < oakSpots.length; i++) {
        const t = oakSpots[i]!;
        const yaw = (i * 1.1) % Math.PI;
        dummy.position.set(t.x, t.y + 1.6 * t.scale, t.z);
        dummy.rotation.set(0, yaw, 0);
        dummy.scale.set(t.scale, t.scale, t.scale);
        dummy.updateMatrix();
        oakTrunkInst.setMatrixAt(i, dummy.matrix);

        dummy.position.set(t.x, t.y + 4.7 * t.scale, t.z);
        dummy.scale.set(t.scale * 1.05, t.scale * 0.9, t.scale);
        dummy.updateMatrix();
        oakInst.setMatrixAt(i, dummy.matrix);

        dummy.position.set(
          t.x + Math.cos(yaw) * 1.25 * t.scale,
          t.y + 4.2 * t.scale,
          t.z + Math.sin(yaw) * 1.25 * t.scale
        );
        dummy.scale.set(t.scale * 0.95, t.scale * 0.85, t.scale * 0.95);
        dummy.updateMatrix();
        oakSubInst.setMatrixAt(i, dummy.matrix);

        tmpColor.setHSL(0.28 + ((i % 6) - 2) * 0.015, 0.38, 0.3 + (i % 4) * 0.025);
        oakInst.setColorAt(i, tmpColor);
        oakSubInst.setColorAt(i, tmpColor);
      }
      oakTrunkInst.instanceMatrix.needsUpdate = true;
      oakInst.instanceMatrix.needsUpdate = true;
      oakSubInst.instanceMatrix.needsUpdate = true;
      if (oakInst.instanceColor) oakInst.instanceColor.needsUpdate = true;
      if (oakSubInst.instanceColor) oakSubInst.instanceColor.needsUpdate = true;
      oakTrunkInst.layers.set(1);
      oakSubInst.layers.set(1);
      root.add(oakTrunkInst, oakInst, oakSubInst);
    }

    // 3. Roadside Bushes / Shrubs
    const bushGeo = jitterFoliage(new THREE.DodecahedronGeometry(1.15, 0), 0.15);
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
      const wallMat = new THREE.MeshStandardMaterial({
        map: this.textures.getBuildingFacadeTexture('cottage'),
        roughness: 0.8,
      });
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
      if (spruceTrunkInst && spruceLowInst && spruceMidInst && spruceHighInst) {
        const c = Math.floor(spruceSpots.length * r);
        spruceTrunkInst.count = c;
        spruceLowInst.count = c;
        spruceMidInst.count = isLowSpec ? 0 : c;
        spruceHighInst.count = c;
      }
      if (oakTrunkInst && oakInst && oakSubInst) {
        const c = Math.floor(oakSpots.length * r);
        oakTrunkInst.count = c;
        oakInst.count = c;
        oakSubInst.count = isLowSpec ? 0 : c;
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
