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
  highlightDestinationDepot: (depotId: string | null) => void;
  setFoliageDensity: (ratio: number) => void;
  setPbrDetailEnabled: (enabled: boolean) => void;
  update: (dtSec: number, elapsedSec: number) => void;
  dispose: () => void;
}

interface SpatialCellEntry {
  segIdx: number;
  sampleIdx: number;
}

/**
 * Compiles any MapManifest into an optimized Three.js 3D world with continuous
 * elevation-matched roads, InstancedMesh foliage/props, and O(1) spatial queries.
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

    // Build spatial hash grid for fast road/surface lookups (cell size = 40m)
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

    // Helper: nearest road/city elevation at (x, z)
    const findNearestRoadDistanceAndY = (x: number, z: number): { dist: number; y: number; seg: CompiledRoadSegment | null } => {
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
        // Fallback scan over nodes/cities for far terrain vertices
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

    // 2. Build continuous terrain heightfield synchronized with roads & cities
    const bounds = manifest.worldBounds;
    const spanX = bounds.maxX - bounds.minX;
    const spanZ = bounds.maxZ - bounds.minZ;
    const gridN = 128;
    const heightGrid = new Float32Array((gridN + 1) * (gridN + 1));

    const terrainGeo = new THREE.PlaneGeometry(spanX, spanZ, gridN, gridN);
    terrainGeo.rotateX(-Math.PI / 2);
    const posAttr = terrainGeo.attributes.position as THREE.BufferAttribute;

    for (let i = 0; i < posAttr.count; i++) {
      const vx = posAttr.getX(i) + (bounds.minX + bounds.maxX) * 0.5;
      const vz = posAttr.getZ(i) + (bounds.minZ + bounds.maxZ) * 0.5;
      posAttr.setX(i, vx);
      posAttr.setZ(i, vz);

      // Base elevation from nearest road/city node
      const nearest = findNearestRoadDistanceAndY(vx, vz);
      let baseH = nearest.y;

      // Check city aprons so city yards stay completely flat
      for (const city of manifest.cities) {
        const cd = Math.hypot(vx - city.position[0], vz - city.position[2]);
        if (cd < city.radius) {
          const blend = Math.max(0, 1 - cd / city.radius);
          baseH = THREE.MathUtils.lerp(baseH, city.position[1], blend);
        }
      }

      // Gentle rolling hills away from roads (zero amplitude within 24m of roads!)
      const rollFactor = THREE.MathUtils.clamp((nearest.dist - 24) / 95, 0, 1);
      const alpineBoost = vx > 250 && vz > 200 ? 14 * rollFactor : 0;
      const rolling =
        (Math.sin(vx * 0.0045) * Math.cos(vz * 0.0045) * 8 +
          Math.sin(vx * 0.011 + vz * 0.008) * 3.5) *
        rollFactor;

      const finalY = baseH - 0.14 + rolling + alpineBoost;
      posAttr.setY(i, finalY);
      heightGrid[i] = finalY;
    }

    const pbrMaterialBindings: {
      mat: THREE.MeshStandardMaterial;
      roughnessMap: THREE.CanvasTexture;
      bumpMap: THREE.CanvasTexture;
      bumpScale: number;
    }[] = [];

    terrainGeo.computeVertexNormals();
    const terrainPbr = this.textures.getTerrainTextures();
    const terrainMat = new THREE.MeshStandardMaterial({
      map: terrainPbr.map,
      roughnessMap: terrainPbr.roughnessMap,
      bumpMap: terrainPbr.bumpMap,
      bumpScale: 0.14,
      roughness: 0.94,
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

    // 3. Build continuous road ribbons + embankment skirts + junction discs
    const roadGroup = new THREE.Group();
    root.add(roadGroup);

    const skirtMat = new THREE.MeshStandardMaterial({
      color: '#4b5563',
      roughness: 0.9,
      metalness: 0.05,
    });
    disposables.push(skirtMat);

    for (const seg of segments) {
      const roadPbr = this.textures.getRoadTextures(seg.def.lanes, seg.def.roadClass);
      const segMat = new THREE.MeshStandardMaterial({
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
      pbrMaterialBindings.push({
        mat: segMat,
        roughnessMap: roadPbr.roughnessMap,
        bumpMap: roadPbr.bumpMap,
        bumpScale: 0.035,
      });
      disposables.push(segMat);

      const n = seg.samples.length;
      const halfW = seg.def.width * 0.5;
      const positions = new Float32Array(n * 2 * 3);
      const normals = new Float32Array(n * 2 * 3);
      const uvs = new Float32Array(n * 2 * 2);
      const indices: number[] = [];

      // Side embankment skirts to seal terrain gaps on elevated hills
      const skirtPos = new Float32Array(n * 4 * 3);
      const skirtIndices: number[] = [];

      let accumLen = 0;
      for (let i = 0; i < n; i++) {
        const s = seg.samples[i]!;
        if (i > 0) {
          const prev = seg.samples[i - 1]!;
          accumLen += Math.hypot(s.x - prev.x, s.y - prev.y, s.z - prev.z);
        }
        // Right normal in XZ plane
        const rx = -s.tz;
        const rz = s.tx;

        const lx = s.x - rx * halfW;
        const lz = s.z - rz * halfW;
        const rpx = s.x + rx * halfW;
        const rpz = s.z + rz * halfW;

        const vBase = i * 6;
        positions[vBase] = lx;
        positions[vBase + 1] = s.y + 0.03;
        positions[vBase + 2] = lz;
        positions[vBase + 3] = rpx;
        positions[vBase + 4] = s.y + 0.03;
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

        // Skirt vertices (top edge + bottom edge buried below terrain)
        const sb = i * 12;
        skirtPos[sb] = lx;
        skirtPos[sb + 1] = s.y + 0.02;
        skirtPos[sb + 2] = lz;
        skirtPos[sb + 3] = lx - rx * 1.8;
        skirtPos[sb + 4] = s.y - 3.5;
        skirtPos[sb + 5] = lz - rz * 1.8;
        skirtPos[sb + 6] = rpx;
        skirtPos[sb + 7] = s.y + 0.02;
        skirtPos[sb + 8] = rpz;
        skirtPos[sb + 9] = rpx + rx * 1.8;
        skirtPos[sb + 10] = s.y - 3.5;
        skirtPos[sb + 11] = rpz + rz * 1.8;

        if (i < n - 1) {
          const a = i * 2;
          const b = a + 1;
          const c = a + 2;
          const d = a + 3;
          indices.push(a, c, b, b, c, d);

          const sa = i * 4;
          // Left skirt
          skirtIndices.push(sa, sa + 1, sa + 4, sa + 1, sa + 5, sa + 4);
          // Right skirt
          skirtIndices.push(sa + 2, sa + 6, sa + 3, sa + 3, sa + 6, sa + 7);
        }
      }

      const roadGeo = new THREE.BufferGeometry();
      roadGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      roadGeo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      roadGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      roadGeo.setIndex(indices);

      const roadMesh = new THREE.Mesh(roadGeo, segMat);
      roadMesh.receiveShadow = true;
      roadGroup.add(roadMesh);
      disposables.push(roadGeo);

      const skirtGeo = new THREE.BufferGeometry();
      skirtGeo.setAttribute('position', new THREE.BufferAttribute(skirtPos, 3));
      skirtGeo.setIndex(skirtIndices);
      skirtGeo.computeVertexNormals();
      const skirtMesh = new THREE.Mesh(skirtGeo, skirtMat);
      roadGroup.add(skirtMesh);
      disposables.push(skirtGeo);
    }

    // Junction asphalt discs at every RoadNode so multi-way intersections have zero seams
    const junctionMat = new THREE.MeshStandardMaterial({
      color: '#3c4048',
      roughness: 0.88,
      metalness: 0.04,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
    disposables.push(junctionMat);

    for (const node of manifest.nodes) {
      const radius = node.kind === 'roundabout' ? 18 : node.kind === 'intersection' ? 12.5 : 10.5;
      const discGeo = new THREE.CylinderGeometry(radius, radius + 1.5, 0.35, 20);
      const discMesh = new THREE.Mesh(discGeo, junctionMat);
      discMesh.position.set(node.position[0], node.position[1] - 0.14, node.position[2]);
      discMesh.receiveShadow = true;
      roadGroup.add(discMesh);
      disposables.push(discGeo);

      if (node.kind === 'roundabout') {
        const islandGeo = new THREE.CylinderGeometry(5.5, 6.2, 0.7, 18);
        const islandMat = new THREE.MeshStandardMaterial({ color: '#4c6642', roughness: 0.9 });
        const island = new THREE.Mesh(islandGeo, islandMat);
        island.position.set(node.position[0], node.position[1] + 0.2, node.position[2]);
        roadGroup.add(island);
        disposables.push(islandGeo, islandMat);
      }
    }

    // 4. InstancedMesh Guardrails & Street Lights
    const dummy = new THREE.Object3D();
    const guardrailPostGeo = new THREE.BoxGeometry(0.14, 0.78, 0.14);
    const guardrailPostMat = new THREE.MeshStandardMaterial({ color: '#94a3b8', metalness: 0.65, roughness: 0.4 });
    const guardrailRailGeo = new THREE.BoxGeometry(0.12, 0.22, 6.2);
    const guardrailRailMat = new THREE.MeshStandardMaterial({ color: '#cbd5e1', metalness: 0.7, roughness: 0.35 });
    disposables.push(guardrailPostGeo, guardrailPostMat, guardrailRailGeo, guardrailRailMat);

    const railTransforms: { x: number; y: number; z: number; rotY: number }[] = [];
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

    if (railTransforms.length > 0) {
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

    if (lightTransforms.length > 0) {
      const poleGeo = new THREE.CylinderGeometry(0.11, 0.16, 7.6, 6);
      const poleMat = new THREE.MeshStandardMaterial({ color: '#475569', metalness: 0.6, roughness: 0.45 });
      const headGeo = new THREE.BoxGeometry(1.1, 0.18, 0.42);
      const headMat = new THREE.MeshStandardMaterial({
        color: '#fef3c7',
        emissive: '#fbbf24',
        emissiveIntensity: 0.25,
        roughness: 0.3,
      });
      this.env.setStreetLampMaterial(headMat);
      disposables.push(poleGeo, poleMat, headGeo, headMat);

      const poleInst = new THREE.InstancedMesh(poleGeo, poleMat, lightTransforms.length);
      const headInst = new THREE.InstancedMesh(headGeo, headMat, lightTransforms.length);

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
      root.add(poleInst, headInst);
    }

    // 5. Speed Cameras
    const speedCameras: SpeedCameraInstance[] = [];
    const camPoleGeo = new THREE.CylinderGeometry(0.12, 0.15, 5.2, 8);
    const camBoxGeo = new THREE.BoxGeometry(0.8, 0.9, 0.6);
    const camMat = new THREE.MeshStandardMaterial({ color: '#334155', metalness: 0.5, roughness: 0.4 });
    const camLensMat = new THREE.MeshStandardMaterial({
      color: '#ef4444',
      emissive: '#ef4444',
      emissiveIntensity: 0.8,
    });
    disposables.push(camPoleGeo, camBoxGeo, camMat, camLensMat);

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

      const pole = new THREE.Mesh(camPoleGeo, camMat);
      pole.position.set(cx, p.y + 2.6, cz);
      const box = new THREE.Mesh(camBoxGeo, camMat);
      box.position.set(cx, p.y + 5.1, cz);
      box.rotation.y = Math.atan2(tan.x, tan.z);

      const signTex = this.textures.getSpeedSignTexture(sc.speedLimitKmh);
      const signGeo = new THREE.CircleGeometry(0.62, 20);
      const signMat = new THREE.MeshBasicMaterial({ map: signTex, side: THREE.DoubleSide });
      const signMesh = new THREE.Mesh(signGeo, signMat);
      signMesh.position.set(cx, p.y + 3.7, cz);
      signMesh.rotation.y = Math.atan2(tan.x, tan.z);

      root.add(pole, box, signMesh);
      disposables.push(signGeo, signMat);

      speedCameras.push({
        def: sc,
        x: p.x,
        y: p.y,
        z: p.z,
        lastTriggeredMs: 0,
      });
    }

    // 6. Cities, Freight Depots, Parking Bays & Service Stations
    const colliders: BoxCollider[] = [];
    const parkingBayMeshes = new Map<string, THREE.Mesh>();

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
    disposables.push(yardApronMat);

    for (const city of manifest.cities) {
      this.buildCityArea(city, root, yardApronMat, bayTexture, parkingBayMeshes, colliders, disposables);
    }

    // 7. Landmarks (Wind turbines, Mountain peaks, Lakes, Port cranes, Warehouses, Toll booths)
    const rotatingRotors: THREE.Object3D[] = [];
    for (const lm of manifest.landmarks) {
      this.buildLandmark(lm, root, rotatingRotors, colliders, disposables);
    }

    // 8. Instanced Biome Vegetation (scattered safely outside roads & cities)
    const setFoliageDensity = this.buildInstancedFoliage(
      manifest,
      root,
      findNearestRoadDistanceAndY,
      getHeightAt,
      disposables
    );

    // Pre-allocated lookup helpers
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
        // Interpolate elevation continuously along adjacent spline sample to avoid slope stair-stepping
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

        out.groundY = onRoad ? smoothY : Math.max(terrainY, smoothY - Math.max(0, dist - halfW) * 0.25);
        out.onRoad = onRoad;
        out.speedLimitKmh = bestSeg.def.speedLimitKmh;
        out.nearestSegmentId = bestSeg.def.id;
        out.roadDist = dist;

        // Guardrail soft boundary push only outside paved road shoulder
        if (bestSeg.def.hasGuardrails && dist > halfW + 0.65 && dist < halfW + 3.2) {
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

      // Recognize full logistics aprons, freight depots, parking bays, and service stations as paved surfaces
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
      for (const [id, mesh] of parkingBayMeshes.entries()) {
        const mat = mesh.material as THREE.MeshBasicMaterial;
        if (id === depotId) {
          mat.opacity = 0.95;
          mat.color.set('#34d399');
        } else {
          mat.opacity = 0.24;
          mat.color.set('#64748b');
        }
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

    const update = (dtSec: number, elapsedSec: number): void => {
      for (let i = 0; i < rotatingRotors.length; i++) {
        rotatingRotors[i]!.rotation.z += dtSec * 1.15;
      }
      // Subtle breathing pulse on active destination bay
      for (const mesh of parkingBayMeshes.values()) {
        const mat = mesh.material as THREE.MeshBasicMaterial;
        if (mat.opacity > 0.5) {
          mat.opacity = 0.72 + Math.sin(elapsedSec * 4.2) * 0.22;
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
      highlightDestinationDepot,
      setFoliageDensity,
      setPbrDetailEnabled,
      update,
      dispose,
    };
  }

  private buildCityArea(
    city: CityDefinition,
    root: THREE.Group,
    apronMat: THREE.MeshStandardMaterial,
    bayTexture: THREE.CanvasTexture,
    parkingBayMeshes: Map<string, THREE.Mesh>,
    colliders: BoxCollider[],
    disposables: { dispose: () => void }[]
  ): void {
    // Large continuous paved logistics apron connecting entry node to depots & stations
    const apronGeo = new THREE.BoxGeometry(270, 0.36, 290);
    const apronMesh = new THREE.Mesh(apronGeo, apronMat);
    apronMesh.position.set(city.position[0], city.position[1] - 0.16, city.position[2]);
    apronMesh.receiveShadow = true;
    root.add(apronMesh);
    disposables.push(apronGeo);

    for (const depot of city.depots) {
      this.buildDepot(depot, root, bayTexture, parkingBayMeshes, colliders, disposables);
    }
    for (const st of city.stations) {
      this.buildServiceStation(st, root, colliders, disposables);
    }
  }

  private buildDepot(
    depot: CityDepot,
    root: THREE.Group,
    bayTexture: THREE.CanvasTexture,
    parkingBayMeshes: Map<string, THREE.Mesh>,
    colliders: BoxCollider[],
    disposables: { dispose: () => void }[]
  ): void {
    const [bx, by, bz] = depot.parkingBayPosition;
    const bayGeo = new THREE.PlaneGeometry(5.4, 18.5);
    const bayMat = new THREE.MeshBasicMaterial({
      map: bayTexture,
      transparent: true,
      opacity: 0.26,
      depthWrite: false,
      color: '#64748b',
    });
    const bayMesh = new THREE.Mesh(bayGeo, bayMat);
    bayMesh.rotation.x = -Math.PI / 2;
    bayMesh.rotation.z = depot.parkingBayHeadingRad;
    bayMesh.position.set(bx, by + 0.08, bz);
    root.add(bayMesh);
    parkingBayMeshes.set(depot.id, bayMesh);
    disposables.push(bayGeo, bayMat);

    // Depot office booth + glowing freight marker ring
    const [ox, oy, oz] = depot.officePosition;
    const officeGeo = new THREE.BoxGeometry(6.5, 4.2, 5.0);
    const officeMat = new THREE.MeshStandardMaterial({
      color: depot.type === 'port' ? '#1e3a8a' : depot.type === 'factory' ? '#334155' : '#3f6212',
      roughness: 0.65,
    });
    const office = new THREE.Mesh(officeGeo, officeMat);
    office.position.set(ox + 5.5, oy + 2.1, oz);
    office.castShadow = true;
    office.receiveShadow = true;
    root.add(office);
    disposables.push(officeGeo, officeMat);

    colliders.push({
      minX: ox + 5.5 - 3.3,
      maxX: ox + 5.5 + 3.3,
      minZ: oz - 2.6,
      maxZ: oz + 2.6,
      y: oy,
      label: depot.name,
    });

    // Holographic interaction ring at office position
    const ringGeo = new THREE.RingGeometry(2.8, 3.6, 24);
    const ringMat = new THREE.MeshBasicMaterial({
      color: '#f59e0b',
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.78,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(ox, oy + 0.1, oz);
    root.add(ring);
    disposables.push(ringGeo, ringMat);
  }

  private buildServiceStation(
    st: ServiceStation,
    root: THREE.Group,
    colliders: BoxCollider[],
    disposables: { dispose: () => void }[]
  ): void {
    const [sx, sy, sz] = st.position;
    const isFuelOnly = st.kind === 'fuel';
    const accentColor = isFuelOnly ? '#10b981' : '#38bdf8';

    // Canopy roof
    const roofGeo = new THREE.BoxGeometry(16, 0.9, 12);
    const roofMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.5, metalness: 0.35 });
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.set(sx, sy + 6.4, sz);
    roof.castShadow = true;
    root.add(roof);

    // Accent trim band
    const trimGeo = new THREE.BoxGeometry(16.2, 0.35, 12.2);
    const trimMat = new THREE.MeshStandardMaterial({
      color: accentColor,
      emissive: accentColor,
      emissiveIntensity: 0.65,
    });
    const trim = new THREE.Mesh(trimGeo, trimMat);
    trim.position.set(sx, sy + 6.4, sz);
    root.add(trim);

    // Canopy pillars
    const pillarGeo = new THREE.BoxGeometry(0.65, 6.2, 0.65);
    const pillarMat = new THREE.MeshStandardMaterial({ color: '#cbd5e1', metalness: 0.5 });
    for (const [px, pz] of [
      [-6.5, -4.5],
      [6.5, -4.5],
      [-6.5, 4.5],
      [6.5, 4.5],
    ] as const) {
      const p = new THREE.Mesh(pillarGeo, pillarMat);
      p.position.set(sx + px, sy + 3.1, sz + pz);
      p.castShadow = true;
      root.add(p);
      colliders.push({
        minX: sx + px - 0.5,
        maxX: sx + px + 0.5,
        minZ: sz + pz - 0.5,
        maxZ: sz + pz + 0.5,
        y: sy,
        label: st.name,
      });
    }

    // Glowing service pad
    const padGeo = new THREE.RingGeometry(3.2, 4.1, 24);
    const padMat = new THREE.MeshBasicMaterial({
      color: accentColor,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.72,
    });
    const pad = new THREE.Mesh(padGeo, padMat);
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(sx, sy + 0.09, sz);
    root.add(pad);

    disposables.push(roofGeo, roofMat, trimGeo, trimMat, pillarGeo, pillarMat, padGeo, padMat);
  }

  private buildLandmark(
    lm: MapManifest['landmarks'][number],
    root: THREE.Group,
    rotatingRotors: THREE.Object3D[],
    colliders: BoxCollider[],
    disposables: { dispose: () => void }[]
  ): void {
    const [x, y, z] = lm.position;
    if (lm.kind === 'lake') {
      const [sx, , sz] = lm.scale ?? [200, 1, 200];
      const geo = new THREE.PlaneGeometry(sx, sz);
      const mat = new THREE.MeshStandardMaterial({
        color: '#1e5f7a',
        roughness: 0.16,
        metalness: 0.62,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, y, z);
      root.add(mesh);
      disposables.push(geo, mat);
      return;
    }

    if (lm.kind === 'mountain_peak') {
      const [sx, sy, sz] = lm.scale ?? [220, 180, 220];
      const geo = new THREE.ConeGeometry(0.5, 1, 7);
      const mat = new THREE.MeshStandardMaterial({
        color: '#5a6875',
        roughness: 0.92,
        flatShading: true,
      });
      const peak = new THREE.Mesh(geo, mat);
      peak.position.set(x, y + sy * 0.45, z);
      peak.scale.set(sx, sy, sz);
      root.add(peak);

      // Snow cap
      const capGeo = new THREE.ConeGeometry(0.22, 0.42, 7);
      const capMat = new THREE.MeshStandardMaterial({ color: '#e2e8f0', roughness: 0.75, flatShading: true });
      const cap = new THREE.Mesh(capGeo, capMat);
      cap.position.set(x, y + sy * 0.75, z);
      cap.scale.set(sx, sy, sz);
      root.add(cap);

      disposables.push(geo, mat, capGeo, capMat);
      return;
    }

    if (lm.kind === 'wind_turbine') {
      const group = new THREE.Group();
      group.position.set(x, y, z);
      group.rotation.y = lm.rotationY ?? 0;

      const mastGeo = new THREE.CylinderGeometry(0.8, 1.8, 52, 8);
      const whiteMat = new THREE.MeshStandardMaterial({ color: '#e2e8f0', roughness: 0.45 });
      const mast = new THREE.Mesh(mastGeo, whiteMat);
      mast.position.y = 26;
      group.add(mast);

      const nacelleGeo = new THREE.BoxGeometry(2.6, 2.4, 5.2);
      const nacelle = new THREE.Mesh(nacelleGeo, whiteMat);
      nacelle.position.set(0, 52, 0);
      group.add(nacelle);

      const rotor = new THREE.Group();
      rotor.position.set(0, 52, 2.8);
      const bladeGeo = new THREE.BoxGeometry(1.1, 22, 0.25);
      for (let i = 0; i < 3; i++) {
        const bladeHolder = new THREE.Group();
        bladeHolder.rotation.z = (i * Math.PI * 2) / 3;
        const blade = new THREE.Mesh(bladeGeo, whiteMat);
        blade.position.y = 11;
        bladeHolder.add(blade);
        rotor.add(bladeHolder);
      }
      group.add(rotor);
      rotatingRotors.push(rotor);
      root.add(group);
      disposables.push(mastGeo, whiteMat, nacelleGeo, bladeGeo);
      return;
    }

    if (lm.kind === 'warehouse_block') {
      const [sx, sy, sz] = lm.scale ?? [44, 12, 24];
      const geo = new THREE.BoxGeometry(sx, sy, sz);
      const mat = new THREE.MeshStandardMaterial({
        color: lm.color ?? '#475569',
        roughness: 0.78,
        metalness: 0.15,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y + sy * 0.5, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      root.add(mesh);
      disposables.push(geo, mat);

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
      const group = new THREE.Group();
      group.position.set(x, y, z);
      group.rotation.y = lm.rotationY ?? 0;

      const steelMat = new THREE.MeshStandardMaterial({
        color: lm.color ?? '#dc2626',
        roughness: 0.5,
        metalness: 0.45,
      });
      const legGeo = new THREE.BoxGeometry(1.6, 26, 1.6);
      const beamGeo = new THREE.BoxGeometry(4.5, 2.2, 34);
      for (const [lx, lz] of [
        [-4, -4],
        [4, -4],
        [-4, 4],
        [4, 4],
      ] as const) {
        const leg = new THREE.Mesh(legGeo, steelMat);
        leg.position.set(lx, 13, lz);
        group.add(leg);
      }
      const beam = new THREE.Mesh(beamGeo, steelMat);
      beam.position.set(0, 26.5, 8);
      group.add(beam);
      root.add(group);
      disposables.push(steelMat, legGeo, beamGeo);
      return;
    }

    if (lm.kind === 'toll_booth') {
      const group = new THREE.Group();
      group.position.set(x, y, z);
      group.rotation.y = lm.rotationY ?? 0;

      const canopyGeo = new THREE.BoxGeometry(22, 1.4, 6.5);
      const canopyMat = new THREE.MeshStandardMaterial({ color: '#1e3a8a', roughness: 0.45 });
      const canopy = new THREE.Mesh(canopyGeo, canopyMat);
      canopy.position.set(0, 6.6, 0);
      group.add(canopy);

      const postGeo = new THREE.BoxGeometry(0.9, 6.4, 2.6);
      const postMat = new THREE.MeshStandardMaterial({ color: '#e2e8f0', roughness: 0.5 });
      for (const px of [-9.5, 9.5]) {
        const post = new THREE.Mesh(postGeo, postMat);
        post.position.set(px, 3.2, 0);
        group.add(post);
      }
      root.add(group);
      disposables.push(canopyGeo, canopyMat, postGeo, postMat);
      return;
    }

    if (lm.kind === 'bridge_pylon') {
      const group = new THREE.Group();
      group.position.set(x, y, z);
      group.rotation.y = lm.rotationY ?? 0;

      const mat = new THREE.MeshStandardMaterial({ color: '#cbd5e1', roughness: 0.55 });
      const towerGeo = new THREE.BoxGeometry(1.5, 22, 1.5);
      const crossGeo = new THREE.BoxGeometry(21, 1.2, 1.4);
      for (const px of [-9.8, 9.8]) {
        const t = new THREE.Mesh(towerGeo, mat);
        t.position.set(px, 9, 0);
        group.add(t);
      }
      const c = new THREE.Mesh(crossGeo, mat);
      c.position.set(0, 16, 0);
      group.add(c);
      root.add(group);
      disposables.push(mat, towerGeo, crossGeo);
    }
  }

  private buildInstancedFoliage(
    manifest: MapManifest,
    root: THREE.Group,
    findNearestRoadDistanceAndY: (x: number, z: number) => { dist: number; y: number; seg: CompiledRoadSegment | null },
    getHeightAt: (x: number, z: number) => number,
    disposables: { dispose: () => void }[]
  ): (ratio: number) => void {
    const { minX, maxX, minZ, maxZ } = manifest.worldBounds;
    let seed = 424242;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const treeSpots: { x: number; y: number; z: number; scale: number; isPine: boolean }[] = [];
    const maxAttempts = 1900;

    for (let i = 0; i < maxAttempts && treeSpots.length < 720; i++) {
      const x = minX + 60 + rand() * (maxX - minX - 120);
      const z = minZ + 60 + rand() * (maxZ - minZ - 120);

      // Keep clear of city yard aprons
      let insideCity = false;
      for (const city of manifest.cities) {
        if (Math.hypot(x - city.position[0], z - city.position[2]) < 210) {
          insideCity = true;
          break;
        }
      }
      if (insideCity) continue;

      const roadInfo = findNearestRoadDistanceAndY(x, z);
      const minClearance = (roadInfo.seg?.def.width ?? 14) * 0.65 + 11;
      if (roadInfo.dist < minClearance || roadInfo.dist > 260) continue;

      const y = getHeightAt(x, z);
      const isPine = roadInfo.seg?.def.biome === 'alpine' || y > 14 || rand() < 0.45;
      treeSpots.push({ x, y, z, scale: 0.75 + rand() * 0.75, isPine });
    }

    if (treeSpots.length === 0) return () => {};

    const trunkGeo = new THREE.CylinderGeometry(0.28, 0.42, 3.2, 6);
    const trunkMat = new THREE.MeshStandardMaterial({ color: '#5c4033', roughness: 0.92 });
    const pineGeo = new THREE.ConeGeometry(2.4, 7.6, 7);
    const pineMat = new THREE.MeshStandardMaterial({ color: '#274e36', roughness: 0.88, flatShading: true });
    const oakGeo = new THREE.DodecahedronGeometry(2.5, 0);
    const oakMat = new THREE.MeshStandardMaterial({ color: '#3f6a34', roughness: 0.88, flatShading: true });

    disposables.push(trunkGeo, trunkMat, pineGeo, pineMat, oakGeo, oakMat);

    // Shuffle deterministically once so slicing count preserves uniform spatial coverage
    const pines: typeof treeSpots = [];
    const oaks: typeof treeSpots = [];
    const orderedSpots: typeof treeSpots = [];
    for (let i = 0; i < treeSpots.length; i++) {
      const spot = treeSpots[i]!;
      orderedSpots.push(spot);
    }

    // Build unified indexed order so trunkInst[i] matches pine/oak ordering proportionally
    for (const spot of orderedSpots) {
      if (spot.isPine) pines.push(spot);
      else oaks.push(spot);
    }

    // Interleave trunk matrices in proportion [pines, oaks] or set separate count cleanly:
    // Actually easiest & 100% consistent: keep two trunk InstancedMeshes or sort orderedSpots = [...pines, ...oaks]?
    // Wait: if we keep separate pineTrunks and oakTrunks or simply scale pineInst.count and oakInst.count + put trunks in same [pines..., oaks...]? No, if trunkInst has all pines first then oaks, trunkInst.count wouldn't match both!
    // Even cleaner: 2 small trunk InstancedMeshes (pineTrunks + oakTrunks) = still just 4 draw calls total and 100% exact tree/trunk matching at any density!
    const pineTrunkInst = pines.length > 0 ? new THREE.InstancedMesh(trunkGeo, trunkMat, pines.length) : null;
    const oakTrunkInst = oaks.length > 0 ? new THREE.InstancedMesh(trunkGeo, trunkMat, oaks.length) : null;
    const dummy = new THREE.Object3D();

    let pineInst: THREE.InstancedMesh | null = null;
    if (pines.length > 0 && pineTrunkInst) {
      pineInst = new THREE.InstancedMesh(pineGeo, pineMat, pines.length);
      for (let i = 0; i < pines.length; i++) {
        const t = pines[i]!;
        dummy.position.set(t.x, t.y + 1.5 * t.scale, t.z);
        dummy.rotation.set(0, (i * 1.37) % Math.PI, 0);
        dummy.scale.set(t.scale, t.scale, t.scale);
        dummy.updateMatrix();
        pineTrunkInst.setMatrixAt(i, dummy.matrix);

        dummy.position.set(t.x, t.y + 5.6 * t.scale, t.z);
        dummy.rotation.set(0, (i * 0.9) % Math.PI, 0);
        dummy.updateMatrix();
        pineInst.setMatrixAt(i, dummy.matrix);
      }
      pineTrunkInst.instanceMatrix.needsUpdate = true;
      pineInst.instanceMatrix.needsUpdate = true;
      root.add(pineTrunkInst, pineInst);
    }

    let oakInst: THREE.InstancedMesh | null = null;
    if (oaks.length > 0 && oakTrunkInst) {
      oakInst = new THREE.InstancedMesh(oakGeo, oakMat, oaks.length);
      for (let i = 0; i < oaks.length; i++) {
        const t = oaks[i]!;
        dummy.position.set(t.x, t.y + 1.5 * t.scale, t.z);
        dummy.rotation.set(0, (i * 1.37) % Math.PI, 0);
        dummy.scale.set(t.scale, t.scale, t.scale);
        dummy.updateMatrix();
        oakTrunkInst.setMatrixAt(i, dummy.matrix);

        dummy.position.set(t.x, t.y + 4.4 * t.scale, t.z);
        dummy.rotation.set(0, (i * 1.1) % Math.PI, 0);
        dummy.scale.set(t.scale, t.scale * 0.92, t.scale);
        dummy.updateMatrix();
        oakInst.setMatrixAt(i, dummy.matrix);
      }
      oakTrunkInst.instanceMatrix.needsUpdate = true;
      oakInst.instanceMatrix.needsUpdate = true;
      root.add(oakTrunkInst, oakInst);
    }

    return (ratio: number) => {
      const r = THREE.MathUtils.clamp(ratio, 0.1, 1);
      if (pineInst && pineTrunkInst) {
        const c = Math.floor(pines.length * r);
        pineInst.count = c;
        pineTrunkInst.count = c;
      }
      if (oakInst && oakTrunkInst) {
        const c = Math.floor(oaks.length * r);
        oakInst.count = c;
        oakTrunkInst.count = c;
      }
    };
  }
}
