import * as THREE from 'three';
import { SurfaceQueryResult } from '../map/MapBuilder';
import { ProceduralTextures } from '../graphics/ProceduralTextures';
import { A2ExamLevelId } from './types';
import {
  A2_LAYOUT,
  getA2ExamLevel,
  getSCurveCenterline,
  hillStartHeight,
  mountainCenterX,
  mountainHeight,
} from './A2ExamCatalog';

export interface BuiltExamArena {
  levelId: A2ExamLevelId;
  root: THREE.Group;
  querySurface: (x: number, z: number, out: SurfaceQueryResult) => boolean;
  getGripMultiplier: (x: number, z: number) => number;
  setHazardBarricadeVisible: (visible: boolean) => void;
  setTrafficSignal: (state: 'green' | 'amber' | 'red') => void;
  setTargetZoneState: (state: 'idle' | 'aligned' | 'violation') => void;
  update: (dtSec: number) => void;
  dispose: () => void;
}

export class A2ExamArenaBuilder {
  private readonly textures: ProceduralTextures;

  constructor(textures: ProceduralTextures) {
    this.textures = textures;
  }

  public build(levelId: A2ExamLevelId): BuiltExamArena {
    const root = new THREE.Group();
    root.name = `A2ExamArena_${levelId}`;
    const disposables: { dispose: () => void }[] = [];
    const def = getA2ExamLevel(levelId);

    // Common exam materials (all placed on Layer 0 so VirtualMirrors see everything!)
    const roadTex = this.textures.getRoadTextures(2, 'urban');
    roadTex.map.repeat.set(14, 14);
    roadTex.roughnessMap.repeat.set(14, 14);
    roadTex.bumpMap.repeat.set(14, 14);

    const yardMat = new THREE.MeshStandardMaterial({
      color: '#475569',
      map: roadTex.map,
      roughness: 0.86,
    });
    const laneMat = new THREE.MeshStandardMaterial({
      color: '#334155',
      roughness: 0.82,
    });
    const grassMat = new THREE.MeshStandardMaterial({
      color: '#4b6842',
      roughness: 0.95,
    });
    const yellowLineMat = new THREE.MeshBasicMaterial({ color: '#facc15' });
    const whiteLineMat = new THREE.MeshBasicMaterial({ color: '#f8fafc' });
    const redZoneMat = new THREE.MeshBasicMaterial({ color: '#ef4444' });
    const poleRedMat = new THREE.MeshStandardMaterial({ color: '#dc2626', roughness: 0.5 });
    const poleWhiteMat = new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.5 });
    const poleBaseMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.7 });
    const concreteMat = new THREE.MeshStandardMaterial({ color: '#94a3b8', roughness: 0.82 });
    const steelBridgeMat = new THREE.MeshStandardMaterial({
      color: '#d97706',
      metalness: 0.45,
      roughness: 0.48,
    });

    const targetMat = new THREE.MeshBasicMaterial({
      color: '#f59e0b',
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    });

    disposables.push(
      yardMat,
      laneMat,
      grassMat,
      yellowLineMat,
      whiteLineMat,
      redZoneMat,
      poleRedMat,
      poleWhiteMat,
      poleBaseMat,
      concreteMat,
      steelBridgeMat,
      targetMat
    );

    // Wide surrounding ground slab so horizon looks grounded and realistic
    const groundGeo = new THREE.PlaneGeometry(1400, 1400);
    groundGeo.rotateX(-Math.PI / 2);
    const groundMesh = new THREE.Mesh(groundGeo, grassMat);
    groundMesh.position.set(0, -0.08, 160);
    groundMesh.receiveShadow = true;
    root.add(groundMesh);
    disposables.push(groundGeo);

    // Asphalt testing yard apron
    const yardGeo = new THREE.PlaneGeometry(360, 720);
    yardGeo.rotateX(-Math.PI / 2);
    const yardMesh = new THREE.Mesh(yardGeo, yardMat);
    yardMesh.position.set(0, -0.03, 210);
    yardMesh.receiveShadow = true;
    root.add(yardMesh);
    disposables.push(yardGeo);

    const addRect = (
      mat: THREE.Material,
      x: number,
      y: number,
      z: number,
      w: number,
      d: number,
      rotY = 0
    ): THREE.Mesh => {
      const geo = new THREE.PlaneGeometry(w, d);
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.y = rotY;
      m.receiveShadow = true;
      root.add(m);
      disposables.push(geo);
      return m;
    };

    const addBox = (
      mat: THREE.Material,
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
      castShadow = false
    ): THREE.Mesh => {
      const geo = new THREE.BoxGeometry(w, h, d);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = castShadow;
      m.receiveShadow = true;
      root.add(m);
      disposables.push(geo);
      return m;
    };

    const addPole = (x: number, y: number, z: number, height = 2.4): void => {
      const baseGeo = new THREE.CylinderGeometry(0.24, 0.28, 0.16, 12);
      const base = new THREE.Mesh(baseGeo, poleBaseMat);
      base.position.set(x, y + 0.08, z);
      root.add(base);
      disposables.push(baseGeo);

      const segH = height / 4;
      const segGeo = new THREE.CylinderGeometry(0.065, 0.065, segH, 10);
      disposables.push(segGeo);
      for (let i = 0; i < 4; i++) {
        const seg = new THREE.Mesh(segGeo, i % 2 === 0 ? poleRedMat : poleWhiteMat);
        seg.position.set(x, y + 0.16 + segH * (i + 0.5), z);
        seg.castShadow = true;
        root.add(seg);
      }
    };

    const addGantrySign = (x: number, y: number, z: number, text: string, rotY = 0): void => {
      const group = new THREE.Group();
      group.position.set(x, y, z);
      group.rotation.y = rotY;

      const postGeo = new THREE.CylinderGeometry(0.14, 0.16, 6.2, 10);
      const postL = new THREE.Mesh(postGeo, concreteMat);
      postL.position.set(6.4, 3.1, 0);
      const postR = new THREE.Mesh(postGeo, concreteMat);
      postR.position.set(-6.4, 3.1, 0);
      const beamGeo = new THREE.BoxGeometry(13.2, 0.24, 0.24);
      const beam = new THREE.Mesh(beamGeo, concreteMat);
      beam.position.set(0, 6.0, 0);
      group.add(postL, postR, beam);

      const canvas = document.createElement('canvas');
      canvas.width = 1024;
      canvas.height = 192;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#1e3a8a';
      ctx.fillRect(0, 0, 1024, 192);
      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = 8;
      ctx.strokeRect(8, 8, 1008, 176);
      ctx.fillStyle = '#facc15';
      ctx.font = 'bold 42px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`中国 A2 重型牵引挂车考场 · ${def.subjectLabel}`, 512, 62);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 52px sans-serif';
      ctx.fillText(text, 512, 128);

      const signTex = new THREE.CanvasTexture(canvas);
      signTex.colorSpace = THREE.SRGBColorSpace;
      const signMat = new THREE.MeshBasicMaterial({ map: signTex, side: THREE.DoubleSide });
      const signGeo = new THREE.PlaneGeometry(10.8, 2.0);
      const signMesh = new THREE.Mesh(signGeo, signMat);
      signMesh.position.set(0, 6.1, 0.16);
      // Mirror back face correctly
      const signBack = new THREE.Mesh(signGeo, signMat);
      signBack.position.set(0, 6.1, -0.16);
      signBack.rotation.y = Math.PI;
      group.add(signMesh, signBack);

      root.add(group);
      disposables.push(postGeo, beamGeo, signTex, signMat, signGeo);
    };

    let hazardBarricade: THREE.Group | null = null;
    let signalRedMat: THREE.MeshBasicMaterial | null = null;
    let signalAmberMat: THREE.MeshBasicMaterial | null = null;
    let signalGreenMat: THREE.MeshBasicMaterial | null = null;

    // Level-specific 3D construction & surface query
    let customSurfaceFn: (x: number, z: number, out: SurfaceQueryResult) => boolean;
    let customGripFn: (x: number, z: number) => number = () => 1.0;

    if (levelId === 'reverse_bay') {
      const L = A2_LAYOUT.reverseBay;
      addRect(laneMat, 0, 0.005, (L.apronMinZ + L.apronMaxZ) * 0.5, L.apronMaxX - L.apronMinX, L.apronMaxZ - L.apronMinZ);
      // Outer apron lines
      addRect(yellowLineMat, L.apronMinX, 0.015, 7, 0.2, 66);
      addRect(yellowLineMat, L.apronMaxX, 0.015, 7, 0.2, 66);
      addRect(yellowLineMat, 0, 0.015, L.apronMinZ, 48, 0.2);
      addRect(yellowLineMat, 0, 0.015, L.apronMaxZ, 48, 0.2);

      // Bay boundaries & target illuminated pad
      const bayCenterZ = (L.bayMinZ + L.bayMaxZ) * 0.5;
      const bayLen = L.bayMaxZ - L.bayMinZ;
      const bayWidth = L.bayMaxX - L.bayMinX;
      addRect(targetMat, 0, 0.012, bayCenterZ, bayWidth, bayLen);
      addRect(yellowLineMat, L.bayMinX, 0.018, bayCenterZ, 0.18, bayLen);
      addRect(yellowLineMat, L.bayMaxX, 0.018, bayCenterZ, 0.18, bayLen);
      addRect(yellowLineMat, 0, 0.018, L.bayMinZ, bayWidth, 0.18);

      // Start bay box on left-front
      const startCenterX = (L.startZoneMinX + L.startZoneMaxX) * 0.5;
      const startCenterZ = (L.startZoneMinZ + L.startZoneMaxZ) * 0.5;
      addRect(whiteLineMat, L.startZoneMinX, 0.014, startCenterZ, 0.14, L.startZoneMaxZ - L.startZoneMinZ);
      addRect(whiteLineMat, L.startZoneMaxX, 0.014, startCenterZ, 0.14, L.startZoneMaxZ - L.startZoneMinZ);
      addRect(whiteLineMat, startCenterX, 0.014, L.startZoneMaxZ, L.startZoneMaxX - L.startZoneMinX, 0.14);

      // 6 Exam poles around bay
      for (const px of [L.bayMinX - 0.12, L.bayMaxX + 0.12]) {
        for (const pz of [L.bayMaxZ, (L.bayMaxZ + L.bayMinZ) * 0.5, L.bayMinZ]) {
          addPole(px, 0, pz, 2.6);
        }
      }
      addGantrySign(0, 0, 32, '半挂倒车入库考区');

      customSurfaceFn = (_x, _z, out) => {
        out.groundY = 0;
        out.onRoad = true;
        out.speedLimitKmh = 20;
        out.nearestSegmentId = null;
        out.roadDist = 0;
        out.guardrailHit = false;
        out.guardrailPushX = 0;
        out.guardrailPushZ = 0;
        return true;
      };
    } else if (levelId === 'hill_start') {
      const L = A2_LAYOUT.hillStart;
      const centerX = (L.minX + L.maxX) * 0.5;
      const width = L.maxX - L.minX;

      // Build continuous 3D sloped ramp mesh matching hillStartHeight(z)
      const zSteps = 120;
      const zStart = L.minZ;
      const zEnd = L.maxZ;
      const rampGeo = new THREE.PlaneGeometry(width, zEnd - zStart, 2, zSteps);
      rampGeo.rotateX(-Math.PI / 2);
      const pos = rampGeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const vx = pos.getX(i) + centerX;
        const vz = pos.getZ(i) + (zStart + zEnd) * 0.5;
        pos.setX(i, vx);
        pos.setZ(i, vz);
        pos.setY(i, hillStartHeight(vz) + 0.01);
      }
      rampGeo.computeVertexNormals();
      const rampMesh = new THREE.Mesh(rampGeo, laneMat);
      rampMesh.receiveShadow = true;
      root.add(rampMesh);
      disposables.push(rampGeo);

      // Side concrete support walls under ramp
      const sideWallGeo = new THREE.PlaneGeometry(zEnd - zStart, 5.5, zSteps, 1);
      const wPos = sideWallGeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < wPos.count; i++) {
        const wz = wPos.getX(i) + (zStart + zEnd) * 0.5;
        const wy = wPos.getY(i);
        const topH = hillStartHeight(wz);
        wPos.setX(i, wz);
        wPos.setY(i, wy > 0 ? topH : -0.1);
      }
      sideWallGeo.computeVertexNormals();
      const sideMat = new THREE.MeshStandardMaterial({ color: '#64748b', roughness: 0.88, side: THREE.DoubleSide });
      const wallL = new THREE.Mesh(sideWallGeo, sideMat);
      wallL.rotation.y = -Math.PI / 2;
      wallL.position.set(L.maxX, 0, 0);
      const wallR = new THREE.Mesh(sideWallGeo, sideMat);
      wallR.rotation.y = -Math.PI / 2;
      wallR.position.set(L.minX, 0, 0);
      root.add(wallL, wallR);
      disposables.push(sideWallGeo, sideMat);

      // Edge yellow lines along ramp
      for (let z = zStart; z < zEnd; z += 2) {
        const y0 = hillStartHeight(z);
        const y1 = hillStartHeight(z + 2);
        const midY = (y0 + y1) * 0.5 + 0.025;
        const slope = Math.atan2(y1 - y0, 2);
        const segGeo = new THREE.BoxGeometry(0.18, 0.02, 2.04);
        for (const lx of [L.minX + 0.1, L.maxX - 0.1]) {
          const lineSeg = new THREE.Mesh(segGeo, yellowLineMat);
          lineSeg.position.set(lx, midY, z + 1);
          lineSeg.rotation.x = -slope;
          root.add(lineSeg);
        }
        disposables.push(segGeo);
      }

      // Target stop line & ±50cm tolerance band at z = 28.0
      const stopY = hillStartHeight(L.stopLineZ) + 0.035;
      const stopSlope = Math.atan2(
        hillStartHeight(L.stopLineZ + 1) - hillStartHeight(L.stopLineZ - 1),
        2
      );
      const stopBandGeo = new THREE.BoxGeometry(width - 0.4, 0.02, 1.0);
      const stopBand = new THREE.Mesh(stopBandGeo, targetMat);
      stopBand.position.set(centerX, stopY, L.stopLineZ);
      stopBand.rotation.x = -stopSlope;
      const stopCenterGeo = new THREE.BoxGeometry(width - 0.4, 0.025, 0.22);
      const stopCenter = new THREE.Mesh(stopCenterGeo, redZoneMat);
      stopCenter.position.set(centerX, stopY + 0.005, L.stopLineZ);
      stopCenter.rotation.x = -stopSlope;
      root.add(stopBand, stopCenter);
      disposables.push(stopBandGeo, stopCenterGeo);

      addPole(L.minX - 0.15, hillStartHeight(L.stopLineZ), L.stopLineZ, 2.8);
      addPole(L.maxX + 0.15, hillStartHeight(L.stopLineZ), L.stopLineZ, 2.8);
      addGantrySign(centerX, hillStartHeight(L.finishZ), L.finishZ, '坡道定点停车终点线');

      customSurfaceFn = (_x, z, out) => {
        out.groundY = hillStartHeight(z);
        out.onRoad = true;
        out.speedLimitKmh = 30;
        out.nearestSegmentId = null;
        out.roadDist = 0;
        out.guardrailHit = false;
        out.guardrailPushX = 0;
        out.guardrailPushZ = 0;
        return true;
      };
    } else if (levelId === 'parallel_park') {
      const L = A2_LAYOUT.parallelPark;
      const laneW = L.laneMaxX - L.laneMinX;
      const laneCenterX = (L.laneMinX + L.laneMaxX) * 0.5;
      const len = L.maxZ - L.minZ;
      const centerZ = (L.minZ + L.maxZ) * 0.5;

      addRect(laneMat, laneCenterX, 0.005, centerZ, laneW, len);
      const bayW = L.bayMaxX - L.bayMinX;
      const bayLen = L.bayMaxZ - L.bayMinZ;
      const bayCX = (L.bayMinX + L.bayMaxX) * 0.5;
      const bayCZ = (L.bayMinZ + L.bayMaxZ) * 0.5;
      addRect(laneMat, bayCX, 0.005, bayCZ, bayW, bayLen);
      addRect(targetMat, bayCX, 0.012, bayCZ, bayW, bayLen);

      // Left edge line (solid yellow)
      addRect(yellowLineMat, L.laneMaxX, 0.018, centerZ, 0.18, len);
      // Right edge before bay, bay recess lines, right edge after bay
      addRect(yellowLineMat, L.laneMinX, 0.018, (L.minZ + L.bayMinZ) * 0.5, 0.18, L.bayMinZ - L.minZ);
      addRect(yellowLineMat, L.laneMinX, 0.018, (L.bayMaxZ + L.maxZ) * 0.5, 0.18, L.maxZ - L.bayMaxZ);
      addRect(yellowLineMat, L.bayMinX, 0.018, bayCZ, 0.18, bayLen);
      addRect(yellowLineMat, bayCX, 0.018, L.bayMinZ, bayW, 0.18);
      addRect(yellowLineMat, bayCX, 0.018, L.bayMaxZ, bayW, 0.18);
      // Dashed bay entrance line
      for (let z = L.bayMinZ + 1; z < L.bayMaxZ - 1; z += 3.0) {
        addRect(whiteLineMat, L.bayMaxX, 0.016, z + 0.75, 0.12, 1.5);
      }
      // Finish line
      addRect(whiteLineMat, laneCenterX, 0.016, L.finishZ, laneW, 0.3);

      for (const pz of [L.bayMinZ, L.bayMaxZ]) {
        addPole(L.bayMinX - 0.12, 0, pz, 2.4);
      }
      addGantrySign(laneCenterX, 0, L.finishZ + 6, '侧方停车出库线');

      customSurfaceFn = (_x, _z, out) => {
        out.groundY = 0;
        out.onRoad = true;
        out.speedLimitKmh = 20;
        out.nearestSegmentId = null;
        out.roadDist = 0;
        out.guardrailHit = false;
        out.guardrailPushX = 0;
        out.guardrailPushZ = 0;
        return true;
      };
    } else if (levelId === 'single_bridge') {
      const L = A2_LAYOUT.singleBridge;
      const len = L.maxZ - L.minZ;
      const centerZ = (L.minZ + L.maxZ) * 0.5;
      addRect(laneMat, 0, 0.005, centerZ, L.maxX - L.minX, len);
      addRect(yellowLineMat, L.minX, 0.016, centerZ, 0.18, len);
      addRect(yellowLineMat, L.maxX, 0.016, centerZ, 0.18, len);

      const buildBridge = (cx: number, z0: number, z1: number) => {
        const bLen = z1 - z0;
        addBox(steelBridgeMat, cx, L.bridgeHeight * 0.5, (z0 + z1) * 0.5, L.bridgeWidth, L.bridgeHeight, bLen, true);
        // Entry/exit ramps
        const rampGeo = new THREE.BoxGeometry(L.bridgeWidth, L.bridgeHeight, L.rampLen);
        const slope = Math.atan2(L.bridgeHeight, L.rampLen);
        const rIn = new THREE.Mesh(rampGeo, steelBridgeMat);
        rIn.position.set(cx, L.bridgeHeight * 0.25, z0 - L.rampLen * 0.5);
        rIn.rotation.x = -slope;
        const rOut = new THREE.Mesh(rampGeo, steelBridgeMat);
        rOut.position.set(cx, L.bridgeHeight * 0.25, z1 + L.rampLen * 0.5);
        rOut.rotation.x = slope;
        root.add(rIn, rOut);
        disposables.push(rampGeo);

        // Guide stripes before bridge
        addRect(whiteLineMat, cx, 0.015, z0 - 4, 0.16, 4.5);
      };

      buildBridge(L.leftCenterX, L.leftStartZ, L.leftEndZ);
      buildBridge(L.rightCenterX, L.rightStartZ, L.rightEndZ);
      addRect(targetMat, 0, 0.014, L.finishZ, L.maxX - L.minX, 3.0);
      addGantrySign(0, 0, L.finishZ + 2, '单边桥通过终点');

      const bridgeSurfaceY = (x: number, z: number): number => {
        const checkBridge = (cx: number, z0: number, z1: number): number => {
          if (Math.abs(x - cx) > L.bridgeWidth * 0.52) return 0;
          if (z >= z0 && z <= z1) return L.bridgeHeight;
          if (z >= z0 - L.rampLen && z < z0) {
            return L.bridgeHeight * ((z - (z0 - L.rampLen)) / L.rampLen);
          }
          if (z > z1 && z <= z1 + L.rampLen) {
            return L.bridgeHeight * (1 - (z - z1) / L.rampLen);
          }
          return 0;
        };
        return Math.max(
          checkBridge(L.leftCenterX, L.leftStartZ, L.leftEndZ),
          checkBridge(L.rightCenterX, L.rightStartZ, L.rightEndZ)
        );
      };

      customSurfaceFn = (x, z, out) => {
        out.groundY = bridgeSurfaceY(x, z);
        out.onRoad = true;
        out.speedLimitKmh = 20;
        out.nearestSegmentId = null;
        out.roadDist = 0;
        out.guardrailHit = false;
        out.guardrailPushX = 0;
        out.guardrailPushZ = 0;
        return true;
      };
    } else if (levelId === 's_curve') {
      const poly = getSCurveCenterline();
      const hw = A2_LAYOUT.sCurve.halfWidth;
      const stripCount = poly.length - 1;
      const quadGeo = new THREE.BufferGeometry();
      const positions = new Float32Array(stripCount * 6 * 3);
      const leftLinePos = new Float32Array(stripCount * 6 * 3);
      const rightLinePos = new Float32Array(stripCount * 6 * 3);

      const writeQuad = (
        arr: Float32Array,
        idx: number,
        ax: number,
        az: number,
        bx: number,
        bz: number,
        cx: number,
        cz: number,
        dx: number,
        dz: number,
        y: number
      ) => {
        const o = idx * 18;
        arr[o] = ax; arr[o + 1] = y; arr[o + 2] = az;
        arr[o + 3] = bx; arr[o + 4] = y; arr[o + 5] = bz;
        arr[o + 6] = cx; arr[o + 7] = y; arr[o + 8] = cz;
        arr[o + 9] = ax; arr[o + 10] = y; arr[o + 11] = az;
        arr[o + 12] = cx; arr[o + 13] = y; arr[o + 14] = cz;
        arr[o + 15] = dx; arr[o + 16] = y; arr[o + 17] = dz;
      };

      for (let i = 0; i < stripCount; i++) {
        const p0 = poly[i]!;
        const p1 = poly[i + 1]!;
        const l0x = p0.tz;
        const l0z = -p0.tx;
        const l1x = p1.tz;
        const l1z = -p1.tx;

        writeQuad(
          positions,
          i,
          p0.x + l0x * hw, p0.z + l0z * hw,
          p0.x - l0x * hw, p0.z - l0z * hw,
          p1.x - l1x * hw, p1.z - l1z * hw,
          p1.x + l1x * hw, p1.z + l1z * hw,
          0.008
        );
        writeQuad(
          leftLinePos,
          i,
          p0.x + l0x * (hw + 0.1), p0.z + l0z * (hw + 0.1),
          p0.x + l0x * (hw - 0.12), p0.z + l0z * (hw - 0.12),
          p1.x + l1x * (hw - 0.12), p1.z + l1z * (hw - 0.12),
          p1.x + l1x * (hw + 0.1), p1.z + l1z * (hw + 0.1),
          0.018
        );
        writeQuad(
          rightLinePos,
          i,
          p0.x - l0x * (hw - 0.12), p0.z - l0z * (hw - 0.12),
          p0.x - l0x * (hw + 0.1), p0.z - l0z * (hw + 0.1),
          p1.x - l1x * (hw + 0.1), p1.z - l1z * (hw + 0.1),
          p1.x - l1x * (hw - 0.12), p1.z - l1z * (hw - 0.12),
          0.018
        );
      }

      quadGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      quadGeo.computeVertexNormals();
      const sMesh = new THREE.Mesh(quadGeo, laneMat);
      sMesh.receiveShadow = true;

      const lGeo = new THREE.BufferGeometry();
      lGeo.setAttribute('position', new THREE.BufferAttribute(leftLinePos, 3));
      const rGeo = new THREE.BufferGeometry();
      rGeo.setAttribute('position', new THREE.BufferAttribute(rightLinePos, 3));
      const doubleYellow = new THREE.MeshBasicMaterial({ color: '#facc15', side: THREE.DoubleSide });
      const lMesh = new THREE.Mesh(lGeo, doubleYellow);
      const rMesh = new THREE.Mesh(rGeo, doubleYellow);
      root.add(sMesh, lMesh, rMesh);
      disposables.push(quadGeo, lGeo, rGeo, doubleYellow);

      const endPt = poly[poly.length - 1]!;
      addRect(targetMat, endPt.x, 0.015, endPt.z - 6, hw * 2, 4.0);
      addGantrySign(endPt.x, 0, endPt.z - 4, 'S 弯曲线行驶终点');

      customSurfaceFn = (_x, _z, out) => {
        out.groundY = 0;
        out.onRoad = true;
        out.speedLimitKmh = 25;
        out.nearestSegmentId = null;
        out.roadDist = 0;
        out.guardrailHit = false;
        out.guardrailPushX = 0;
        out.guardrailPushZ = 0;
        return true;
      };
    } else if (levelId === 'right_angle_gates') {
      const L = A2_LAYOUT.rightAngleGates;
      const hw = L.legHalfW;
      // Entry leg along +Z
      const entryLen = L.cornerOuterZ - L.entryMinZ;
      addRect(laneMat, 0, 0.005, (L.entryMinZ + L.cornerOuterZ) * 0.5, hw * 2, entryLen);
      // Exit leg along +X
      const exitLen = L.exitMaxX - (-hw);
      addRect(laneMat, (-hw + L.exitMaxX) * 0.5, 0.006, (L.cornerInnerZ + L.cornerOuterZ) * 0.5, exitLen, hw * 2);

      // Entry outer yellow lines
      addRect(yellowLineMat, -hw, 0.018, (L.entryMinZ + L.cornerOuterZ) * 0.5, 0.18, entryLen);
      addRect(yellowLineMat, hw, 0.018, (L.entryMinZ + L.cornerInnerZ) * 0.5, 0.18, L.cornerInnerZ - L.entryMinZ);
      // Exit outer yellow lines
      addRect(yellowLineMat, (-hw + L.exitMaxX) * 0.5, 0.018, L.cornerOuterZ, exitLen, 0.18);
      addRect(yellowLineMat, (hw + L.exitMaxX) * 0.5, 0.018, L.cornerInnerZ, L.exitMaxX - hw, 0.18);

      // 3 Width-limited gates along +X
      for (const g of L.gates) {
        const halfGap = L.gateGapWidth * 0.5;
        addPole(g.x, 0, g.centerZ - halfGap, 2.7);
        addPole(g.x, 0, g.centerZ + halfGap, 2.7);
        // Overhead gate bar
        addBox(poleRedMat, g.x, 2.8, g.centerZ, 0.14, 0.14, L.gateGapWidth + 0.4);
      }
      addRect(targetMat, L.finishX, 0.015, (L.cornerInnerZ + L.cornerOuterZ) * 0.5, 3.0, hw * 2);
      addGantrySign(L.finishX + 3, 0, (L.cornerInnerZ + L.cornerOuterZ) * 0.5, '限宽门考区终点', Math.PI / 2);

      customSurfaceFn = (_x, _z, out) => {
        out.groundY = 0;
        out.onRoad = true;
        out.speedLimitKmh = 25;
        out.nearestSegmentId = null;
        out.roadDist = 0;
        out.guardrailHit = false;
        out.guardrailPushX = 0;
        out.guardrailPushZ = 0;
        return true;
      };
    } else if (levelId === 'mountain_hazard') {
      const L = A2_LAYOUT.mountainHazard;
      const zLen = L.maxZ - L.minZ;
      const zSteps = 180;
      const trackGeo = new THREE.PlaneGeometry(L.halfW * 2, zLen, 2, zSteps);
      trackGeo.rotateX(-Math.PI / 2);
      const pos = trackGeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const localX = pos.getX(i);
        const vz = pos.getZ(i) + (L.minZ + L.maxZ) * 0.5;
        const cx = mountainCenterX(vz);
        pos.setX(i, cx + localX);
        pos.setZ(i, vz);
        pos.setY(i, mountainHeight(vz) + 0.01);
      }
      trackGeo.computeVertexNormals();
      const trackMesh = new THREE.Mesh(trackGeo, laneMat);
      trackMesh.receiveShadow = true;
      root.add(trackMesh);
      disposables.push(trackGeo);

      // Side yellow edge lines along mountain road
      for (let z = L.minZ; z < L.maxZ - 2; z += 2.5) {
        const cx0 = mountainCenterX(z);
        const cx1 = mountainCenterX(z + 2.5);
        const y0 = mountainHeight(z);
        const y1 = mountainHeight(z + 2.5);
        const midY = (y0 + y1) * 0.5 + 0.03;
        const pitch = Math.atan2(y1 - y0, 2.5);
        const yaw = Math.atan2(cx1 - cx0, 2.5);
        const segGeo = new THREE.BoxGeometry(0.16, 0.02, 2.55);
        for (const side of [-1, 1]) {
          const m = new THREE.Mesh(segGeo, yellowLineMat);
          m.position.set((cx0 + cx1) * 0.5 + side * (L.halfW - 0.1), midY, z + 1.25);
          m.rotation.set(-pitch, yaw, 0, 'YXZ');
          root.add(m);
        }
        disposables.push(segGeo);
      }

      // 3D Tunnel Vault at z ∈ [15..75], y = 11.2
      const tunnelLen = L.tunnelEndZ - L.tunnelStartZ;
      const tunnelCenterZ = (L.tunnelStartZ + L.tunnelEndZ) * 0.5;
      const tunnelMat = new THREE.MeshStandardMaterial({ color: '#475569', roughness: 0.9 });
      const tunnelLampMat = new THREE.MeshBasicMaterial({ color: '#fde68a' });
      disposables.push(tunnelMat, tunnelLampMat);
      addBox(tunnelMat, -L.halfW - 0.5, L.topY + 2.8, tunnelCenterZ, 0.9, 5.6, tunnelLen);
      addBox(tunnelMat, L.halfW + 0.5, L.topY + 2.8, tunnelCenterZ, 0.9, 5.6, tunnelLen);
      addBox(tunnelMat, 0, L.topY + 5.7, tunnelCenterZ, L.halfW * 2 + 1.9, 0.7, tunnelLen);
      for (let tz = L.tunnelStartZ + 8; tz < L.tunnelEndZ; tz += 12) {
        addBox(tunnelLampMat, 0, L.topY + 5.3, tz, 1.4, 0.1, 0.4);
      }
      addGantrySign(0, L.topY, L.tunnelStartZ - 2, '前方隧道 · 请开灯鸣笛');
      addGantrySign(0, 0, L.rainStartZ + 5, '湿滑雨雾路段 · 注意应急避险');

      // Emergency Hazard Barricade (revealed dynamically during exam)
      hazardBarricade = new THREE.Group();
      hazardBarricade.position.set(0, 0, L.barricadeZ);
      hazardBarricade.visible = false;
      const barGeo = new THREE.BoxGeometry(6.8, 1.1, 0.55);
      const barMat = new THREE.MeshStandardMaterial({ color: '#ea580c', emissive: '#9a3412', emissiveIntensity: 0.55 });
      const bar = new THREE.Mesh(barGeo, barMat);
      bar.position.y = 0.75;
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(6.85, 0.25, 0.58), whiteLineMat);
      stripe.position.y = 0.85;
      hazardBarricade.add(bar, stripe);
      root.add(hazardBarricade);
      disposables.push(barGeo, barMat, stripe.geometry);

      // Safe emergency stop pad before barricade
      addRect(targetMat, 0, 0.02, (L.stopMinZ + L.stopMaxZ) * 0.5, L.halfW * 2, L.stopMaxZ - L.stopMinZ);

      customSurfaceFn = (_x, z, out) => {
        out.groundY = mountainHeight(z);
        out.onRoad = true;
        out.speedLimitKmh = z < L.tunnelEndZ ? 40 : z < L.downgradeEndZ ? 50 : 40;
        out.nearestSegmentId = null;
        out.roadDist = 0;
        out.guardrailHit = false;
        out.guardrailPushX = 0;
        out.guardrailPushZ = 0;
        return true;
      };
      customGripFn = (_x, z) => (z >= L.rainStartZ ? 0.62 : 1.0);
    } else {
      // Subject 3 Road Boulevard
      const L = A2_LAYOUT.subject3;
      const len = L.maxZ - L.minZ;
      const centerZ = (L.minZ + L.maxZ) * 0.5;
      addRect(laneMat, 0, 0.005, centerZ, L.maxX - L.minX, len);
      // Right concrete curb at x = -7.5
      addBox(concreteMat, L.curbX - 0.35, 0.14, centerZ, 0.7, 0.28, len);
      addRect(yellowLineMat, 0, 0.016, centerZ, 0.22, len);
      addRect(yellowLineMat, L.maxX, 0.016, centerZ, 0.18, len);
      addRect(yellowLineMat, L.curbX + 0.08, 0.016, centerZ, 0.16, len);
      // Dashed lane dividers
      for (let z = L.minZ + 2; z < L.maxZ - 4; z += 7) {
        addRect(whiteLineMat, L.laneDividerX, 0.016, z + 1.5, 0.14, 3.0);
        addRect(whiteLineMat, -L.laneDividerX, 0.016, z + 1.5, 0.14, 3.0);
      }

      // Stop line + Working Traffic Light Gantry at z = 225
      addRect(whiteLineMat, -3.75, 0.02, L.signalStopZ, 7.2, 0.42);
      addGantrySign(0, 0, L.signalLineZ, '前方信号灯路口 · 注意观察通行');
      signalRedMat = new THREE.MeshBasicMaterial({ color: '#450a0a' });
      signalAmberMat = new THREE.MeshBasicMaterial({ color: '#451a03' });
      signalGreenMat = new THREE.MeshBasicMaterial({ color: '#10b981' });
      disposables.push(signalRedMat, signalAmberMat, signalGreenMat);

      const housing = addBox(poleBaseMat, -3.75, 5.2, L.signalLineZ, 1.5, 0.55, 0.4);
      const lensGeo = new THREE.CircleGeometry(0.18, 12);
      const redLens = new THREE.Mesh(lensGeo, signalRedMat);
      redLens.position.set(-4.2, 5.2, L.signalLineZ - 0.21);
      redLens.rotation.y = Math.PI;
      const amberLens = new THREE.Mesh(lensGeo, signalAmberMat);
      amberLens.position.set(-3.75, 5.2, L.signalLineZ - 0.21);
      amberLens.rotation.y = Math.PI;
      const greenLens = new THREE.Mesh(lensGeo, signalGreenMat);
      greenLens.position.set(-3.3, 5.2, L.signalLineZ - 0.21);
      greenLens.rotation.y = Math.PI;
      housing.visible = true;
      root.add(redLens, amberLens, greenLens);
      disposables.push(lensGeo);

      // Zebra Crosswalk & School Zone (z = 240..295)
      for (let x = -6.8; x <= 6.8; x += 1.1) {
        addRect(whiteLineMat, x, 0.02, 246, 0.55, 4.2);
      }
      addGantrySign(0, 0, 240, '学校区域 · 限速 30 km/h');
      addGantrySign(0, 0, 305, '加减挡操作路段 (先升后降)');
      addGantrySign(0, 0, L.pulloverStartZ, '靠边停车考区 (边距 ≤ 35cm)');
      addRect(targetMat, -6.1, 0.015, (L.pulloverStartZ + L.pulloverFinishZ) * 0.5, 2.7, L.pulloverFinishZ - L.pulloverStartZ);

      customSurfaceFn = (_x, _z, out) => {
        out.groundY = 0;
        out.onRoad = true;
        out.speedLimitKmh = 60;
        out.nearestSegmentId = null;
        out.roadDist = 0;
        out.guardrailHit = false;
        out.guardrailPushX = 0;
        out.guardrailPushZ = 0;
        return true;
      };
    }

    return {
      levelId,
      root,
      querySurface: customSurfaceFn,
      getGripMultiplier: customGripFn,
      setHazardBarricadeVisible: (visible: boolean) => {
        if (hazardBarricade) hazardBarricade.visible = visible;
      },
      setTrafficSignal: (state: 'green' | 'amber' | 'red') => {
        if (!signalRedMat || !signalAmberMat || !signalGreenMat) return;
        signalRedMat.color.set(state === 'red' ? '#ef4444' : '#450a0a');
        signalAmberMat.color.set(state === 'amber' ? '#f59e0b' : '#451a03');
        signalGreenMat.color.set(state === 'green' ? '#10b981' : '#064e3b');
      },
      setTargetZoneState: (state: 'idle' | 'aligned' | 'violation') => {
        if (state === 'aligned') {
          targetMat.color.set('#10b981');
          targetMat.opacity = 0.36;
        } else if (state === 'violation') {
          targetMat.color.set('#ef4444');
          targetMat.opacity = 0.38;
        } else {
          targetMat.color.set('#f59e0b');
          targetMat.opacity = 0.25;
        }
      },
      update: (_dtSec: number) => {},
      dispose: () => {
        for (const d of disposables) {
          d.dispose();
        }
      },
    };
  }
}
