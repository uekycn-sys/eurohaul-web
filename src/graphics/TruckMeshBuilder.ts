import * as THREE from 'three';
import { PbrTextureSet, ProceduralTextures } from '../graphics/ProceduralTextures';
import { GeometryBatcher } from './GeometryBatcher';
import { HeadlightMode, TrailerCargoType, WipersMode } from '../store/useGameStore';

export interface TruckVisualRefs {
  tractorRoot: THREE.Group;
  cabSuspensionGroup: THREE.Group;
  steeringWheel: THREE.Group;
  frontWheelSteerPivots: THREE.Group[];
  tractorWheelSpinMeshes: THREE.Object3D[];
  trailerRoot: THREE.Group;
  trailerWheelSpinMeshes: THREE.Object3D[];
  trailerLandingGear: THREE.Group;
  trailerContainerMesh: THREE.Mesh;
  setPaintColor: (hex: string) => void;
  setTrailerCargoVisual: (colorHex: string, label: string, cargoType?: TrailerCargoType) => void;
  setBlobShadowVisible: (visible: boolean) => void;
  setPbrDetailEnabled: (enabled: boolean) => void;
  setDoorMirrorTextures: (leftTex: THREE.Texture, rightTex: THREE.Texture) => void;
  updateInteriorDetails: (opts: {
    dtSec: number;
    leftBlinker: boolean;
    rightBlinker: boolean;
    retarderLevel: number;
    cabRoll: number;
    cabPitch: number;
    nightFactor: number;
    cabLightOn: boolean;
    trailerAttached: boolean;
    showRainGlass: boolean;
    rainIntensity?: number;
    showCabPendant?: boolean;
  }) => void;
  getWiperAngle: () => number;
  updateWipers: (elapsedSec: number, mode: WipersMode) => void;
  syncWheelInstances: () => void;
  updateLights: (opts: {
    headlightMode: HeadlightMode;
    nightFactor: number;
    rainIntensity?: number;
    braking: boolean;
    reversing: boolean;
    leftBlinkerLit: boolean;
    rightBlinkerLit: boolean;
  }) => void;
  dispose: () => void;
}

/**
 * Builds a high-craft European 6x2 cab-over tractor and 13.6m Reefer semi-trailer
 * featuring a sunlit charcoal interior, live instrument cluster, rotating multi-function
 * steering wheel, wipers, vertical chrome exhausts, side fuel/air tanks, and LED lighting.
 */
export class TruckMeshBuilder {
  private readonly textures: ProceduralTextures;

  constructor(textures: ProceduralTextures) {
    this.textures = textures;
  }

  public build(initialPaintHex: string): TruckVisualRefs {
    const disposables: { dispose: () => void }[] = [];
    const tractorBatcher = new GeometryBatcher();
    const cabBatcher = new GeometryBatcher();
    const trailerBatcher = new GeometryBatcher();

    const tractorRoot = new THREE.Group();
    tractorRoot.name = 'TractorUnit';

    const cabSuspensionGroup = new THREE.Group();
    tractorRoot.add(cabSuspensionGroup);

    // Exterior & Interior PBR Materials
    const paintMat = new THREE.MeshStandardMaterial({
      color: initialPaintHex,
      roughness: 0.24,
      metalness: 0.62,
      envMapIntensity: 1.15,
    });
    const darkChassisMat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.64,
      metalness: 0.36,
      vertexColors: true,
    });
    const metalMat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.2,
      metalness: 0.88,
      envMapIntensity: 1.2,
      vertexColors: true,
    });
    const wiperMat = new THREE.MeshStandardMaterial({
      color: '#1e2736',
      roughness: 0.62,
      metalness: 0.22,
    });
    // Interior soft-touch charcoal/slate material (Layer 1: skipped by mirrors, vertex-colored)
    const cabInteriorMat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.72,
      metalness: 0.08,
      emissive: '#222e42',
      emissiveIntensity: 0.34,
      vertexColors: true,
    });
    // Dedicated Layer-1 interior brushed-aluminum / chrome trim material (kept separate from exterior metalMat)
    const cabTrimMetalMat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.28,
      metalness: 0.78,
      envMapIntensity: 1.1,
      vertexColors: true,
    });
    const glassMat = new THREE.MeshStandardMaterial({
      color: '#26466d',
      roughness: 0.06,
      metalness: 0.35,
      envMapIntensity: 1.4,
      transparent: true,
      opacity: 0.24,
    });
    const tirePbr = this.textures.getTireTextures();
    const tireMat = new THREE.MeshStandardMaterial({
      map: tirePbr.map,
      bumpMap: tirePbr.bumpMap,
      bumpScale: 0.03,
      color: '#ffffff',
      roughness: 0.86,
    });
    const rimMat = new THREE.MeshStandardMaterial({
      map: this.textures.getWheelRimTexture(),
      color: '#ffffff',
      metalness: 0.82,
      roughness: 0.24,
    });

    // Dynamic lighting materials
    const drlMat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      emissive: '#e0f2fe',
      emissiveIntensity: 1.35,
    });
    const headlightEmissiveMat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      emissive: '#fef9c3',
      emissiveIntensity: 0.5,
    });
    const fogLampMat = new THREE.MeshStandardMaterial({
      color: '#fef3c7',
      emissive: '#fde68a',
      emissiveIntensity: 0.4,
    });
    const brakeMat = new THREE.MeshStandardMaterial({
      color: '#7f1d1d',
      emissive: '#ef4444',
      emissiveIntensity: 0.25,
    });
    const reverseMat = new THREE.MeshStandardMaterial({
      color: '#cbd5e1',
      emissive: '#ffffff',
      emissiveIntensity: 0.0,
    });
    const leftSignalMat = new THREE.MeshStandardMaterial({
      color: '#78350f',
      emissive: '#f59e0b',
      emissiveIntensity: 0.0,
    });
    const rightSignalMat = new THREE.MeshStandardMaterial({
      color: '#78350f',
      emissive: '#f59e0b',
      emissiveIntensity: 0.0,
    });
    const sideMarkerMat = new THREE.MeshStandardMaterial({
      color: '#d97706',
      emissive: '#f59e0b',
      emissiveIntensity: 0.35,
    });

    disposables.push(
      paintMat,
      darkChassisMat,
      metalMat,
      wiperMat,
      cabInteriorMat,
      cabTrimMetalMat,
      glassMat,
      tireMat,
      rimMat,
      drlMat,
      headlightEmissiveMat,
      fogLampMat,
      brakeMat,
      reverseMat,
      leftSignalMat,
      rightSignalMat,
      sideMarkerMat
    );

    // 1. Chassis Frame, Fifth Wheel, Aluminum Fuel Tanks, Air Tanks & Catwalk (batched per material)
    const railGeo = new THREE.BoxGeometry(0.16, 0.28, 6.25);
    for (const rx of [-0.46, 0.46]) {
      tractorBatcher.add(darkChassisMat, railGeo, {
        x: rx,
        y: 0.68,
        z: -0.15,
        colorHex: '#222b38',
        castShadow: true,
      });
    }

    const deckGeo = new THREE.BoxGeometry(1.18, 0.12, 2.8);
    tractorBatcher.add(metalMat, deckGeo, { x: 0, y: 0.85, z: -1.75, colorHex: '#cbd5e1' });

    const fifthWheelGeo = new THREE.CylinderGeometry(0.5, 0.54, 0.14, 16);
    tractorBatcher.add(darkChassisMat, fifthWheelGeo, {
      x: 0,
      y: 0.96,
      z: -1.65,
      colorHex: '#222b38',
    });

    const fuelTankGeo = new THREE.CylinderGeometry(0.32, 0.32, 1.88, 12);
    fuelTankGeo.rotateX(Math.PI / 2);
    const strapGeo = new THREE.TorusGeometry(0.33, 0.025, 6, 14);
    for (const tx of [-0.88, 0.88]) {
      tractorBatcher.add(metalMat, fuelTankGeo, {
        x: tx,
        y: 0.64,
        z: -0.35,
        colorHex: '#cbd5e1',
        castShadow: true,
      });
      for (const sz of [-0.9, 0.2]) {
        tractorBatcher.add(darkChassisMat, strapGeo, {
          x: tx,
          y: 0.64,
          z: sz,
          colorHex: '#1e2736',
        });
      }
    }

    const airTankGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.72, 10);
    airTankGeo.rotateZ(Math.PI / 2);
    for (const az of [0.15, 0.42]) {
      tractorBatcher.add(darkChassisMat, airTankGeo, {
        x: 0,
        y: 0.56,
        z: az,
        colorHex: '#222b38',
      });
    }

    const bumperGeo = new THREE.BoxGeometry(2.48, 0.44, 0.48);
    tractorBatcher.add(darkChassisMat, bumperGeo, {
      x: 0,
      y: 0.56,
      z: 2.88,
      colorHex: '#1e2736',
      castShadow: true,
    });

    const bumperLipGeo = new THREE.BoxGeometry(2.38, 0.1, 0.52);
    tractorBatcher.add(paintMat, bumperLipGeo, { x: 0, y: 0.36, z: 2.9 });

    // EU Front License Plate (M · EH 2026)
    const plateTex = this.textures.getLicensePlateTexture('M · EH 2026');
    const plateMat = new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.4, metalness: 0.1 });
    const plateGeo = new THREE.PlaneGeometry(0.54, 0.13);
    tractorBatcher.add(plateMat, plateGeo, { x: 0, y: 0.52, z: 3.13 });
    disposables.push(plateMat, plateGeo);

    // Front wheel-arch fenders & aerodynamic chassis side skirts (batched)
    const frontFenderGeo = new THREE.BoxGeometry(0.38, 0.16, 1.38);
    const sideSkirtGeo = new THREE.BoxGeometry(0.08, 0.44, 2.55);
    const sideSkirtTrimGeo = new THREE.BoxGeometry(0.09, 0.08, 2.58);
    for (const side of [-1, 1]) {
      tractorBatcher.add(darkChassisMat, frontFenderGeo, {
        x: side * 1.06,
        y: 1.08,
        z: 1.85,
        colorHex: '#1e2736',
      });
      tractorBatcher.add(paintMat, sideSkirtGeo, {
        x: side * 1.18,
        y: 0.66,
        z: -0.25,
        castShadow: true,
      });
      tractorBatcher.add(darkChassisMat, sideSkirtTrimGeo, {
        x: side * 1.185,
        y: 0.42,
        z: -0.25,
        colorHex: '#1e2736',
      });
    }
    disposables.push(frontFenderGeo, sideSkirtGeo, sideSkirtTrimGeo);

    const fogGeo = new THREE.BoxGeometry(0.24, 0.11, 0.08);
    for (const fx of [-0.88, 0.88]) {
      tractorBatcher.add(fogLampMat, fogGeo, { x: fx, y: 0.48, z: 3.12 });
    }

    const mudguardGeo = new THREE.BoxGeometry(0.65, 0.2, 2.75);
    const flapGeo = new THREE.BoxGeometry(0.62, 0.42, 0.04);
    const sideMarkGeo = new THREE.BoxGeometry(0.05, 0.06, 0.16);
    for (const mx of [-0.94, 0.94]) {
      tractorBatcher.add(darkChassisMat, mudguardGeo, {
        x: mx,
        y: 1.07,
        z: -1.72,
        colorHex: '#1e2736',
      });
      tractorBatcher.add(darkChassisMat, flapGeo, {
        x: mx,
        y: 0.52,
        z: -3.02,
        colorHex: '#18202c',
      });
    }
    for (const sx of [-1.18, 1.18]) {
      for (const sz of [-0.95, 0.45]) {
        tractorBatcher.add(sideMarkerMat, sideMarkGeo, { x: sx, y: 0.72, z: sz });
      }
    }

    // AdBlue tank, battery box & rear tractor EU plate (batched on chassis)
    const adblueTankGeo = new THREE.BoxGeometry(0.44, 0.50, 0.72);
    tractorBatcher.add(darkChassisMat, adblueTankGeo, {
      x: 0.88,
      y: 0.68,
      z: 0.92,
      colorHex: '#1e2736',
    });
    const adblueCapGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.06, 8);
    tractorBatcher.add(metalMat, adblueCapGeo, {
      x: 0.98,
      y: 0.94,
      z: 0.96,
      colorHex: '#2563eb',
    });
    const batteryBoxGeo = new THREE.BoxGeometry(0.46, 0.44, 0.78);
    tractorBatcher.add(darkChassisMat, batteryBoxGeo, {
      x: -0.88,
      y: 0.66,
      z: 0.90,
      colorHex: '#18202c',
    });
    // Rear catwalk safety handrail behind cab
    const catwalkPostGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.78, 6);
    const catwalkRailGeo = new THREE.CylinderGeometry(0.02, 0.02, 1.38, 6);
    catwalkRailGeo.rotateZ(Math.PI / 2);
    for (const px of [-0.66, 0.66]) {
      tractorBatcher.add(metalMat, catwalkPostGeo, {
        x: px,
        y: 1.28,
        z: -0.42,
        colorHex: '#cbd5e1',
      });
    }
    tractorBatcher.add(metalMat, catwalkRailGeo, {
      x: 0,
      y: 1.66,
      z: -0.42,
      colorHex: '#cbd5e1',
    });
    tractorBatcher.add(plateMat, plateGeo, {
      x: 0,
      y: 0.66,
      z: -3.28,
      rotY: Math.PI,
    });
    disposables.push(adblueTankGeo, adblueCapGeo, batteryBoxGeo, catwalkPostGeo, catwalkRailGeo);

    const rearBarGeo = new THREE.BoxGeometry(2.38, 0.24, 0.18);
    tractorBatcher.add(darkChassisMat, rearBarGeo, {
      x: 0,
      y: 0.66,
      z: -3.18,
      colorHex: '#1e2736',
    });

    const lampSmallGeo = new THREE.BoxGeometry(0.22, 0.14, 0.08);
    tractorBatcher.add(brakeMat, lampSmallGeo, { x: 0.88, y: 0.66, z: -3.26 });
    tractorBatcher.add(brakeMat, lampSmallGeo, { x: -0.88, y: 0.66, z: -3.26 });
    tractorBatcher.add(leftSignalMat, lampSmallGeo, { x: 1.08, y: 0.66, z: -3.26 });
    tractorBatcher.add(rightSignalMat, lampSmallGeo, { x: -1.08, y: 0.66, z: -3.26 });
    tractorBatcher.add(reverseMat, lampSmallGeo, { x: 0.64, y: 0.66, z: -3.26 });

    const headLampGeo = new THREE.BoxGeometry(0.38, 0.18, 0.1);
    const drlGeo = new THREE.BoxGeometry(0.42, 0.05, 0.11);
    tractorBatcher.add(headlightEmissiveMat, headLampGeo, { x: 0.9, y: 0.72, z: 3.09 });
    tractorBatcher.add(headlightEmissiveMat, headLampGeo, { x: -0.9, y: 0.72, z: 3.09 });
    tractorBatcher.add(drlMat, drlGeo, { x: 0.9, y: 0.83, z: 3.09 });
    tractorBatcher.add(drlMat, drlGeo, { x: -0.9, y: 0.83, z: 3.09 });
    tractorBatcher.add(leftSignalMat, lampSmallGeo, { x: 1.15, y: 0.72, z: 3.07 });
    tractorBatcher.add(rightSignalMat, lampSmallGeo, { x: -1.15, y: 0.72, z: 3.07 });

    // Lightweight additive headlight glow flares + ground light pool (replaces heavy Bloom!)
    const glowTex = this.textures.getHeadlightGlowTexture();
    const glowMat = new THREE.MeshBasicMaterial({
      map: glowTex,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const glowGeo = new THREE.PlaneGeometry(0.95, 0.95);
    const glowL = new THREE.Mesh(glowGeo, glowMat);
    glowL.position.set(0.9, 0.72, 3.16);
    glowL.layers.set(1);
    const glowR = new THREE.Mesh(glowGeo, glowMat);
    glowR.position.set(-0.9, 0.72, 3.16);
    glowR.layers.set(1);
    tractorRoot.add(glowL, glowR);

    const beamGeo = new THREE.ConeGeometry(2.4, 18, 14, 1, true);
    beamGeo.translate(0, -9, 0);
    // Negative X rotation maps -Y cone axis forward onto +Z truck nose!
    beamGeo.rotateX(-Math.PI / 2);
    const beamMat = new THREE.MeshBasicMaterial({
      color: '#fef3c7',
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const beamL = new THREE.Mesh(beamGeo, beamMat);
    beamL.position.set(0.9, 0.74, 3.16);
    beamL.rotation.x = 0.06;
    beamL.layers.set(1);
    const beamR = new THREE.Mesh(beamGeo, beamMat);
    beamR.position.set(-0.9, 0.74, 3.16);
    beamR.rotation.x = 0.06;
    beamR.layers.set(1);
    tractorRoot.add(beamL, beamR);

    const groundPoolGeo = new THREE.PlaneGeometry(7.2, 22);
    groundPoolGeo.rotateX(-Math.PI / 2);
    const groundPoolMat = new THREE.MeshBasicMaterial({
      map: glowTex,
      color: '#fff4d4',
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -3,
    });
    const groundPool = new THREE.Mesh(groundPoolGeo, groundPoolMat);
    groundPool.position.set(0, 0.045, 13.8);
    groundPool.layers.set(1);
    tractorRoot.add(groundPool);

    const spotLight = new THREE.SpotLight('#fffbeb', 0, 80, Math.PI / 4.2, 0.48, 1.35);
    spotLight.position.set(0, 1.05, 3.12);
    const spotTarget = new THREE.Object3D();
    spotTarget.position.set(0, 0.1, 26);
    tractorRoot.add(spotLight, spotTarget);
    spotLight.target = spotTarget;

    // 2. Cab Suspension Group (Exterior Body + Stacks + Aero + Lit Interior batched per material)
    const cabLowerGeo = new THREE.BoxGeometry(2.44, 1.05, 2.38);
    cabBatcher.add(paintMat, cabLowerGeo, { x: 0, y: 1.38, z: 1.78, castShadow: true });

    const grilleUpperGeo = new THREE.BoxGeometry(1.78, 0.56, 0.12);
    cabBatcher.add(darkChassisMat, grilleUpperGeo, {
      x: 0,
      y: 1.62,
      z: 2.98,
      colorHex: '#1e2736',
    });
    const grilleLowerGeo = new THREE.BoxGeometry(1.56, 0.34, 0.12);
    cabBatcher.add(darkChassisMat, grilleLowerGeo, {
      x: 0,
      y: 1.12,
      z: 2.98,
      colorHex: '#1e2736',
    });

    const slatGeo = new THREE.BoxGeometry(1.62, 0.055, 0.15);
    for (let i = 0; i < 4; i++) {
      cabBatcher.add(metalMat, slatGeo, {
        x: 0,
        y: 1.14 + i * 0.21,
        z: 3.0,
        colorHex: '#e2e8f0',
      });
    }
    const emblemGeo = new THREE.BoxGeometry(0.44, 0.12, 0.16);
    cabBatcher.add(metalMat, emblemGeo, {
      x: 0,
      y: 1.62,
      z: 3.01,
      colorHex: '#e2e8f0',
    });

    const handleGeo = new THREE.BoxGeometry(0.06, 0.08, 0.24);
    const stepGeo = new THREE.BoxGeometry(0.24, 0.06, 0.56);
    for (const side of [-1, 1]) {
      cabBatcher.add(darkChassisMat, handleGeo, {
        x: side * 1.24,
        y: 1.72,
        z: 1.86,
        colorHex: '#1e2736',
      });
      for (const sy of [0.58, 0.86]) {
        tractorBatcher.add(metalMat, stepGeo, {
          x: side * 1.14,
          y: sy,
          z: 2.22,
          colorHex: '#cbd5e1',
        });
      }
    }

    const cabBackGeo = new THREE.BoxGeometry(2.44, 1.45, 0.82);
    cabBatcher.add(paintMat, cabBackGeo, { x: 0, y: 2.58, z: 1.0, castShadow: true });

    const sideDeflectorGeo = new THREE.BoxGeometry(0.11, 1.38, 0.42);
    for (const side of [-1, 1]) {
      cabBatcher.add(paintMat, sideDeflectorGeo, {
        x: side * 1.24,
        y: 2.58,
        z: 0.56,
        rotY: side * 0.14,
      });
    }

    const cabBackInnerGeo = new THREE.PlaneGeometry(2.18, 1.32);
    cabBatcher.add(cabInteriorMat, cabBackInnerGeo, {
      x: 0,
      y: 2.58,
      z: 1.42,
      colorHex: '#3b4656',
      layer: 1,
    });

    const stackGeo = new THREE.CylinderGeometry(0.085, 0.095, 2.35, 10);
    const stackTipGeo = new THREE.CylinderGeometry(0.105, 0.085, 0.28, 10);
    const heatShieldGeo = new THREE.CylinderGeometry(0.118, 0.118, 0.85, 10);
    for (const sx of [-1.06, 1.06]) {
      cabBatcher.add(metalMat, stackGeo, {
        x: sx,
        y: 2.35,
        z: 0.52,
        colorHex: '#e2e8f0',
        castShadow: true,
      });
      cabBatcher.add(metalMat, stackTipGeo, {
        x: sx,
        y: 3.58,
        z: 0.48,
        rotX: -0.25,
        colorHex: '#e2e8f0',
      });
      cabBatcher.add(darkChassisMat, heatShieldGeo, {
        x: sx,
        y: 2.05,
        z: 0.52,
        colorHex: '#334155',
      });
    }

    const cabRoofGeo = new THREE.BoxGeometry(2.42, 0.22, 2.34);
    cabBatcher.add(paintMat, cabRoofGeo, { x: 0, y: 3.34, z: 1.76, castShadow: true });

    // Full sealed interior cab shell (headliner, windshield header beam, floor, B-pillars, roof rails, door panels)
    const headlinerGeo = new THREE.PlaneGeometry(2.36, 1.7);
    cabBatcher.add(cabInteriorMat, headlinerGeo, {
      x: 0,
      y: 3.225,
      z: 2.08,
      rotX: Math.PI / 2,
      colorHex: '#4f5a6b',
      layer: 1,
    });
    const headerBeamGeo = new THREE.BoxGeometry(2.36, 0.14, 0.28);
    cabBatcher.add(cabInteriorMat, headerBeamGeo, {
      x: 0,
      y: 3.245,
      z: 2.86,
      colorHex: '#27303f',
      layer: 1,
    });
    const cabFloorGeo = new THREE.BoxGeometry(2.26, 0.08, 1.56);
    cabBatcher.add(cabInteriorMat, cabFloorGeo, {
      x: 0,
      y: 1.76,
      z: 2.05,
      colorHex: '#242c38',
      layer: 1,
    });
    const bPillarGeo = new THREE.BoxGeometry(0.1, 1.24, 0.22);
    const roofRailGeo = new THREE.BoxGeometry(0.12, 0.14, 1.56);
    const doorTrimGeo = new THREE.BoxGeometry(0.11, 0.62, 1.50);
    const doorSillSealGeo = new THREE.BoxGeometry(0.17, 0.05, 1.48);
    const doorBolsterGeo = new THREE.BoxGeometry(0.06, 0.24, 1.18);
    const doorHandleTrimGeo = new THREE.BoxGeometry(0.03, 0.04, 0.16);
    const doorPocketGeo = new THREE.BoxGeometry(0.06, 0.14, 0.72);
    const speakerGrilleGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.025, 12);
    speakerGrilleGeo.rotateZ(Math.PI / 2);
    const armrestGeo = new THREE.BoxGeometry(0.09, 0.08, 0.62);
    const switchPodGeo = new THREE.BoxGeometry(0.08, 0.05, 0.22);
    const doorHeaderTrimGeo = new THREE.BoxGeometry(0.09, 0.12, 1.48);
    const aPillarInnerGeo = new THREE.BoxGeometry(0.09, 1.32, 0.12);
    const aPillarGrabGeo = new THREE.CylinderGeometry(0.017, 0.017, 0.68, 8);
    const grabBracketGeo = new THREE.BoxGeometry(0.045, 0.04, 0.05);
    const cornerGussetGeo = new THREE.BoxGeometry(0.10, 0.12, 0.16);
    const sideGlassGeo = new THREE.PlaneGeometry(1.36, 0.96);
    for (const side of [-1, 1]) {
      cabBatcher.add(cabInteriorMat, bPillarGeo, {
        x: side * 1.16,
        y: 2.64,
        z: 1.44,
        colorHex: '#334155',
        layer: 1,
      });
      cabBatcher.add(cabInteriorMat, roofRailGeo, {
        x: side * 1.16,
        y: 3.18,
        z: 2.12,
        colorHex: '#3b4656',
        layer: 1,
      });
      // Full-height charcoal door card + dark rubber window sill seal covering exterior orange door edge
      cabBatcher.add(cabInteriorMat, doorTrimGeo, {
        x: side * 1.105,
        y: 2.04,
        z: 2.12,
        colorHex: '#262f3d',
        layer: 1,
      });
      cabBatcher.add(cabInteriorMat, doorSillSealGeo, {
        x: side * 1.165,
        y: 2.33,
        z: 2.12,
        colorHex: '#18202c',
        layer: 1,
      });
      cabBatcher.add(cabInteriorMat, doorBolsterGeo, {
        x: side * 1.07,
        y: 2.18,
        z: 2.10,
        colorHex: '#334155',
        layer: 1,
      });
      cabBatcher.add(cabTrimMetalMat, doorHandleTrimGeo, {
        x: side * 1.045,
        y: 2.20,
        z: 2.18,
        colorHex: '#cbd5e1',
        layer: 1,
      });
      cabBatcher.add(cabInteriorMat, doorPocketGeo, {
        x: side * 1.06,
        y: 1.88,
        z: 2.14,
        colorHex: '#1b2230',
        layer: 1,
      });
      cabBatcher.add(cabInteriorMat, speakerGrilleGeo, {
        x: side * 1.055,
        y: 1.88,
        z: 2.52,
        colorHex: '#141a24',
        layer: 1,
      });
      cabBatcher.add(cabInteriorMat, armrestGeo, {
        x: side * 1.035,
        y: 2.04,
        z: 2.02,
        colorHex: '#1e2736',
        layer: 1,
      });
      cabBatcher.add(cabInteriorMat, switchPodGeo, {
        x: side * 1.03,
        y: 2.09,
        z: 2.28,
        colorHex: '#475569',
        layer: 1,
      });
      cabBatcher.add(cabInteriorMat, doorHeaderTrimGeo, {
        x: side * 1.13,
        y: 3.16,
        z: 2.12,
        colorHex: '#27303f',
        layer: 1,
      });
      cabBatcher.add(cabInteriorMat, aPillarInnerGeo, {
        x: side * 1.14,
        y: 2.63,
        z: 2.83,
        rotX: -0.08,
        rotY: side * 0.22,
        colorHex: '#252e3d',
        layer: 1,
      });
      // A-pillar interior boarding grab handle + metallic mounting brackets
      cabBatcher.add(cabInteriorMat, aPillarGrabGeo, {
        x: side * 1.08,
        y: 2.58,
        z: 2.75,
        rotX: -0.08,
        colorHex: '#1b2230',
        layer: 1,
      });
      for (const gy of [2.28, 2.88]) {
        cabBatcher.add(cabTrimMetalMat, grabBracketGeo, {
          x: side * 1.105,
          y: gy,
          z: 2.78,
          colorHex: '#94a3b8',
          layer: 1,
        });
      }
      cabBatcher.add(cabInteriorMat, cornerGussetGeo, {
        x: side * 1.15,
        y: 3.21,
        z: 2.84,
        colorHex: '#27303f',
        layer: 1,
      });
      const sideGlass = new THREE.Mesh(sideGlassGeo, glassMat);
      sideGlass.position.set(side * 1.19, 2.68, 2.14);
      sideGlass.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
      sideGlass.layers.set(1);
      cabSuspensionGroup.add(sideGlass);
    }
    disposables.push(
      doorSillSealGeo,
      doorBolsterGeo,
      doorHandleTrimGeo,
      doorPocketGeo,
      speakerGrilleGeo,
      armrestGeo,
      switchPodGeo,
      doorHeaderTrimGeo,
      aPillarInnerGeo,
      aPillarGrabGeo,
      grabBracketGeo,
      cornerGussetGeo
    );

    // Overhead Euro-Truck Storage Console, Tachograph/CB Faceplate & Stowed Sun Visors (strictly above y = 3.12)
    const overheadShelfGeo = new THREE.BoxGeometry(2.26, 0.14, 0.34);
    cabBatcher.add(cabInteriorMat, overheadShelfGeo, {
      x: 0,
      y: 3.22,
      z: 2.68,
      colorHex: '#242d3b',
      layer: 1,
    });
    const lockerDoorGeo = new THREE.BoxGeometry(0.62, 0.11, 0.03);
    const lockerLatchGeo = new THREE.BoxGeometry(0.08, 0.022, 0.04);
    for (const lx of [-0.72, 0.72]) {
      cabBatcher.add(cabInteriorMat, lockerDoorGeo, {
        x: lx,
        y: 3.21,
        z: 2.505,
        colorHex: '#2d3748',
        layer: 1,
      });
      cabBatcher.add(cabTrimMetalMat, lockerLatchGeo, {
        x: lx,
        y: 3.19,
        z: 2.49,
        colorHex: '#cbd5e1',
        layer: 1,
      });
    }
    const tachoFaceGeo = new THREE.BoxGeometry(0.54, 0.09, 0.03);
    cabBatcher.add(cabInteriorMat, tachoFaceGeo, {
      x: 0,
      y: 3.21,
      z: 2.505,
      colorHex: '#141a24',
      layer: 1,
    });
    const sunVisorInteriorGeo = new THREE.BoxGeometry(0.72, 0.018, 0.16);
    for (const vx of [-0.56, 0.56]) {
      cabBatcher.add(cabInteriorMat, sunVisorInteriorGeo, {
        x: vx,
        y: 3.16,
        z: 2.75,
        rotX: 0.22,
        colorHex: '#334155',
        layer: 1,
      });
    }
    // Windshield rubber gasket strips (top & bottom)
    const gasketStripGeo = new THREE.BoxGeometry(2.24, 0.032, 0.04);
    cabBatcher.add(cabInteriorMat, gasketStripGeo, {
      x: 0,
      y: 2.04,
      z: 2.86,
      colorHex: '#141a24',
      layer: 1,
    });
    cabBatcher.add(cabInteriorMat, gasketStripGeo, {
      x: 0,
      y: 3.19,
      z: 2.86,
      colorHex: '#141a24',
      layer: 1,
    });
    disposables.push(overheadShelfGeo, lockerDoorGeo, lockerLatchGeo, tachoFaceGeo, sunVisorInteriorGeo, gasketStripGeo);

    const spoilerGeo = new THREE.BoxGeometry(2.36, 0.44, 0.96);
    cabBatcher.add(paintMat, spoilerGeo, { x: 0, y: 3.56, z: 1.08, rotX: 0.22 });

    // Aerodynamic roof fairing wedge + twin chrome roof air horns + roof lightbar + corner aero flutes
    const roofFairingGeo = new THREE.BoxGeometry(2.34, 0.20, 0.72);
    cabBatcher.add(paintMat, roofFairingGeo, { x: 0, y: 3.45, z: 2.24, rotX: 0.24 });
    const cornerFluteGeo = new THREE.BoxGeometry(0.10, 0.92, 0.16);
    for (const side of [-1, 1]) {
      cabBatcher.add(darkChassisMat, cornerFluteGeo, {
        x: side * 1.19,
        y: 1.50,
        z: 2.94,
        rotY: side * 0.16,
        colorHex: '#18202c',
      });
    }
    const roofBarTubeGeo = new THREE.CylinderGeometry(0.028, 0.028, 1.88, 8);
    roofBarTubeGeo.rotateZ(Math.PI / 2);
    cabBatcher.add(metalMat, roofBarTubeGeo, {
      x: 0,
      y: 3.55,
      z: 2.68,
      colorHex: '#e2e8f0',
    });
    const roofSpotGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.08, 10);
    roofSpotGeo.rotateX(Math.PI / 2);
    for (const rx of [-0.62, -0.22, 0.22, 0.62]) {
      cabBatcher.add(headlightEmissiveMat, roofSpotGeo, {
        x: rx,
        y: 3.56,
        z: 2.74,
      });
    }
    const whipAntennaGeo = new THREE.CylinderGeometry(0.006, 0.012, 0.75, 6);
    for (const ax of [-1.12, 1.12]) {
      cabBatcher.add(darkChassisMat, whipAntennaGeo, {
        x: ax,
        y: 3.74,
        z: 1.95,
        rotX: -0.18,
        colorHex: '#111827',
      });
    }
    const airHornBodyGeo = new THREE.CylinderGeometry(0.055, 0.025, 0.56, 10);
    airHornBodyGeo.rotateX(Math.PI / 2);
    const airHornBellGeo = new THREE.CylinderGeometry(0.072, 0.055, 0.14, 10);
    airHornBellGeo.rotateX(Math.PI / 2);
    for (const hx of [-0.78, 0.78]) {
      cabBatcher.add(metalMat, airHornBodyGeo, { x: hx, y: 3.49, z: 2.38, colorHex: '#e2e8f0' });
      cabBatcher.add(metalMat, airHornBellGeo, { x: hx, y: 3.49, z: 2.71, colorHex: '#f8fafc' });
    }
    disposables.push(
      roofFairingGeo,
      cornerFluteGeo,
      roofBarTubeGeo,
      roofSpotGeo,
      whipAntennaGeo,
      airHornBodyGeo,
      airHornBellGeo
    );

    const lightboxGeo = new THREE.BoxGeometry(1.42, 0.22, 0.14);
    const lightboxMat = new THREE.MeshStandardMaterial({
      color: '#f8fafc',
      emissive: '#fef3c7',
      emissiveIntensity: 0.72,
    });
    cabBatcher.add(lightboxMat, lightboxGeo, { x: 0, y: 3.47, z: 2.74 });

    // Slim flush sunvisor seated tightly against windshield header (zero roof gap)
    const visorGeo = new THREE.BoxGeometry(2.42, 0.065, 0.22);
    cabBatcher.add(darkChassisMat, visorGeo, {
      x: 0,
      y: 3.27,
      z: 2.94,
      rotX: 0.14,
      colorHex: '#1e2736',
    });

    const markerGeo = new THREE.BoxGeometry(0.16, 0.065, 0.08);
    for (const mx of [-0.82, -0.41, 0, 0.41, 0.82]) {
      cabBatcher.add(sideMarkerMat, markerGeo, { x: mx, y: 3.29, z: 3.05 });
    }

    // Symmetrical angled matte-charcoal A-pillars with seamless header transition
    const pillarGeo = new THREE.BoxGeometry(0.085, 1.32, 0.115);
    for (const side of [-1, 1]) {
      cabBatcher.add(darkChassisMat, pillarGeo, {
        x: side * 1.16,
        y: 2.64,
        z: 2.85,
        rotX: -0.08,
        rotY: side * 0.22,
        colorHex: '#252e3d',
      });
    }

    const sideLowerDoorGeo = new THREE.BoxGeometry(0.08, 0.48, 1.45);
    for (const sx of [-1.20, 1.20]) {
      cabBatcher.add(paintMat, sideLowerDoorGeo, { x: sx, y: 2.08, z: 2.12 });
    }

    const windshieldGeo = new THREE.PlaneGeometry(2.28, 1.22);
    const windshield = new THREE.Mesh(windshieldGeo, glassMat);
    windshield.position.set(0, 2.62, 2.89);
    windshield.rotation.x = -0.08;
    windshield.layers.set(1);
    cabSuspensionGroup.add(windshield);

    // Interior upper windshield dark sunband strip
    const sunbandGeo = new THREE.PlaneGeometry(2.26, 0.16);
    const sunbandMat = new THREE.MeshBasicMaterial({
      color: '#0f172a',
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const sunbandMesh = new THREE.Mesh(sunbandGeo, sunbandMat);
    sunbandMesh.position.set(0, 3.12, 2.885);
    sunbandMesh.rotation.x = -0.08;
    sunbandMesh.layers.set(1);
    cabSuspensionGroup.add(sunbandMesh);
    disposables.push(sunbandGeo, sunbandMat);

    // Dynamic interior raindrop layer inside windshield (Layer 1, active when raining in 1st-person)
    const rainGlassGeo = new THREE.PlaneGeometry(2.24, 1.18);
    const rainGlassMat = new THREE.MeshBasicMaterial({
      map: this.textures.getWindshieldRainTexture(),
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
    });
    const rainGlassMesh = new THREE.Mesh(rainGlassGeo, rainGlassMat);
    rainGlassMesh.position.set(0, 2.62, 2.882);
    rainGlassMesh.rotation.set(0.08, Math.PI, 0, 'YXZ');
    rainGlassMesh.layers.set(1);
    rainGlassMesh.visible = false;
    cabSuspensionGroup.add(rainGlassMesh);

    // Slim two-piece windshield wipers tucked cleanly at the lower glass cowl, sweeping across the glass
    const wiperArmGeo = new THREE.BoxGeometry(0.36, 0.016, 0.018);
    const wiperGeo = new THREE.BoxGeometry(0.58, 0.018, 0.022);
    const wiperPivots: THREE.Group[] = [];
    for (const wx of [-0.18, 0.52]) {
      const pivot = new THREE.Group();
      pivot.position.set(wx, 2.06, 2.925);
      pivot.rotation.x = -0.08;
      const arm = new THREE.Mesh(wiperArmGeo, wiperMat);
      arm.position.set(-0.18, 0.012, 0.004);
      arm.layers.set(1);
      const blade = new THREE.Mesh(wiperGeo, wiperMat);
      blade.position.set(-0.44, 0.024, 0.008);
      blade.layers.set(1);
      pivot.add(arm, blade);
      pivot.rotation.z = -0.02;
      cabSuspensionGroup.add(pivot);
      wiperPivots.push(pivot);
    }

    // European aerodynamic twin-arm vertical side mirrors with 1:1 main mirror + wide-angle blindspot mirror (0 extra RT)
    const mirrorArmGeo = new THREE.CylinderGeometry(0.015, 0.018, 0.28, 8);
    mirrorArmGeo.rotateZ(Math.PI / 2);
    const mirrorBaseGeo = new THREE.BoxGeometry(0.04, 0.10, 0.08);
    const mirrorHousingGeo = new THREE.BoxGeometry(0.23, 0.40, 0.11);
    const mirrorCapGeo = new THREE.BoxGeometry(0.22, 0.38, 0.035);
    const blindMirrorGeo = new THREE.BoxGeometry(0.22, 0.16, 0.09);
    disposables.push(mirrorBaseGeo);

    const makeDoorMirrorGeo = (w: number, h: number, uMin: number, uMax: number) => {
      const geo = new THREE.PlaneGeometry(w, h);
      const uvAttr = geo.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uvAttr.count; i++) {
        uvAttr.setX(i, uvAttr.getX(i) > 0.5 ? uMax : uMin);
      }
      uvAttr.needsUpdate = true;
      return geo;
    };
    const leftMirrorGlassGeo = makeDoorMirrorGeo(0.21, 0.36, 0.46, 0.81);
    const rightMirrorGlassGeo = makeDoorMirrorGeo(0.21, 0.36, 0.19, 0.54);
    const leftBlindGlassGeo = makeDoorMirrorGeo(0.20, 0.14, 0.12, 0.96);
    const rightBlindGlassGeo = makeDoorMirrorGeo(0.20, 0.14, 0.04, 0.88);
    const leftDoorMirrorMat = new THREE.MeshBasicMaterial({ color: '#e0f2fe' });
    const rightDoorMirrorMat = new THREE.MeshBasicMaterial({ color: '#e0f2fe' });
    disposables.push(leftBlindGlassGeo, rightBlindGlassGeo);

    for (const side of [-1, 1]) {
      cabBatcher.add(darkChassisMat, mirrorBaseGeo, {
        x: side * 1.21,
        y: 2.94,
        z: 2.84,
        colorHex: '#18202c',
      });
      cabBatcher.add(darkChassisMat, mirrorBaseGeo, {
        x: side * 1.21,
        y: 2.52,
        z: 2.82,
        colorHex: '#18202c',
      });
      cabBatcher.add(metalMat, mirrorArmGeo, {
        x: side * 1.32,
        y: 2.93,
        z: 2.84,
        rotZ: side * -0.12,
        colorHex: '#94a3b8',
      });
      cabBatcher.add(metalMat, mirrorArmGeo, {
        x: side * 1.32,
        y: 2.53,
        z: 2.82,
        rotZ: side * 0.14,
        colorHex: '#94a3b8',
      });
      cabBatcher.add(darkChassisMat, mirrorHousingGeo, {
        x: side * 1.44,
        y: 2.76,
        z: 2.84,
        rotY: side * -0.1,
        colorHex: '#1e2634',
      });
      cabBatcher.add(paintMat, mirrorCapGeo, {
        x: side * 1.44,
        y: 2.76,
        z: 2.89,
        rotY: side * -0.1,
      });
      cabBatcher.add(darkChassisMat, blindMirrorGeo, {
        x: side * 1.44,
        y: 2.46,
        z: 2.83,
        rotY: side * -0.12,
        colorHex: '#1e2634',
      });

      const mirrorMesh = new THREE.Mesh(
        side > 0 ? leftMirrorGlassGeo : rightMirrorGlassGeo,
        side > 0 ? leftDoorMirrorMat : rightDoorMirrorMat
      );
      mirrorMesh.position.set(side * 1.44, 2.76, 2.782);
      mirrorMesh.rotation.y = Math.PI + side * -0.1;
      mirrorMesh.layers.set(1);
      cabSuspensionGroup.add(mirrorMesh);

      const blindMesh = new THREE.Mesh(
        side > 0 ? leftBlindGlassGeo : rightBlindGlassGeo,
        side > 0 ? leftDoorMirrorMat : rightDoorMirrorMat
      );
      blindMesh.position.set(side * 1.44, 2.46, 2.782);
      blindMesh.rotation.y = Math.PI + side * -0.12;
      blindMesh.layers.set(1);
      cabSuspensionGroup.add(blindMesh);
    }

    const dashTex = this.textures.getDynamicDashboardTexture();
    // Wrap-around soft-touch lower dashboard, leatherette upper pad, defroster strip & metallic trim molding
    const dashBodyGeo = new THREE.BoxGeometry(2.20, 0.42, 0.52);
    cabBatcher.add(cabInteriorMat, dashBodyGeo, {
      x: 0,
      y: 1.94,
      z: 2.60,
      colorHex: '#262f3d',
      layer: 1,
    });
    const dashPadGeo = new THREE.BoxGeometry(2.22, 0.08, 0.48);
    cabBatcher.add(cabInteriorMat, dashPadGeo, {
      x: 0,
      y: 2.19,
      z: 2.68,
      colorHex: '#1e2633',
      layer: 1,
    });
    const defrosterStripGeo = new THREE.BoxGeometry(1.75, 0.02, 0.08);
    cabBatcher.add(cabInteriorMat, defrosterStripGeo, {
      x: 0,
      y: 2.235,
      z: 2.79,
      colorHex: '#121822',
      layer: 1,
    });
    const dashAccentBarGeo = new THREE.BoxGeometry(1.96, 0.018, 0.022);
    cabBatcher.add(cabTrimMetalMat, dashAccentBarGeo, {
      x: 0,
      y: 2.12,
      z: 2.43,
      colorHex: '#cbd5e1',
      layer: 1,
    });
    const centerConsoleGeo = new THREE.BoxGeometry(0.64, 0.40, 0.48);
    cabBatcher.add(cabInteriorMat, centerConsoleGeo, {
      x: -0.02,
      y: 1.96,
      z: 2.50,
      rotY: 0.34,
      colorHex: '#222b38',
      layer: 1,
    });
    const floorTrayGeo = new THREE.BoxGeometry(0.46, 0.08, 0.54);
    cabBatcher.add(cabInteriorMat, floorTrayGeo, {
      x: 0.02,
      y: 1.82,
      z: 2.22,
      colorHex: '#1b2230',
      layer: 1,
    });
    const cupHolderGeo = new THREE.CylinderGeometry(0.044, 0.038, 0.05, 10);
    for (const cx of [-0.06, 0.07]) {
      cabBatcher.add(cabTrimMetalMat, cupHolderGeo, {
        x: cx,
        y: 1.86,
        z: 2.14,
        colorHex: '#475569',
        layer: 1,
      });
    }

    const cowlGeo = new THREE.BoxGeometry(2.18, 0.06, 0.38);
    cabBatcher.add(cabInteriorMat, cowlGeo, {
      x: 0,
      y: 2.18,
      z: 2.74,
      colorHex: '#2c3647',
      layer: 1,
    });

    // Sleek Low-Profile Sculpted Instrument Cluster Binnacle (100% clear of GPS sightline)
    const hoodTopGeo = new THREE.BoxGeometry(0.68, 0.032, 0.14);
    const hoodSideGeo = new THREE.BoxGeometry(0.024, 0.19, 0.11);
    const hoodBackGeo = new THREE.BoxGeometry(0.68, 0.22, 0.03);
    const hoodTrimGeo = new THREE.BoxGeometry(0.65, 0.012, 0.018);
    cabBatcher.add(cabInteriorMat, hoodTopGeo, {
      x: 0.58,
      y: 2.45,
      z: 2.58,
      rotX: -0.10,
      colorHex: '#19212e',
      layer: 1,
    });
    for (const side of [-1, 1]) {
      cabBatcher.add(cabInteriorMat, hoodSideGeo, {
        x: 0.58 + side * 0.345,
        y: 2.34,
        z: 2.585,
        rotZ: side * 0.14,
        colorHex: '#19212e',
        layer: 1,
      });
    }
    cabBatcher.add(cabInteriorMat, hoodBackGeo, {
      x: 0.58,
      y: 2.34,
      z: 2.625,
      colorHex: '#111824',
      layer: 1,
    });
    cabBatcher.add(cabTrimMetalMat, hoodTrimGeo, {
      x: 0.58,
      y: 2.225,
      z: 2.535,
      colorHex: '#94a3b8',
      layer: 1,
    });
    disposables.push(
      dashPadGeo,
      defrosterStripGeo,
      dashAccentBarGeo,
      floorTrayGeo,
      cupHolderGeo,
      hoodTopGeo,
      hoodSideGeo,
      hoodBackGeo,
      hoodTrimGeo
    );

    // Slatted AC vent grilles, rotary HVAC dials, rocker switches, dual pneumatic parking brake valves & glovebox
    const ventBezelGeo = new THREE.BoxGeometry(0.14, 0.085, 0.036);
    const ventRingGeo = new THREE.BoxGeometry(0.148, 0.092, 0.018);
    const ventLouverGeo = new THREE.BoxGeometry(0.11, 0.008, 0.042);
    for (const [vx, vy, vz, vRotY] of [
      [1.00, 2.16, 2.50, 0.06],
      [0.20, 2.14, 2.45, 0.20],
      [-0.32, 2.15, 2.47, 0.28],
      [-0.92, 2.16, 2.50, -0.06],
    ] as const) {
      cabBatcher.add(cabInteriorMat, ventBezelGeo, {
        x: vx,
        y: vy,
        z: vz,
        rotY: vRotY,
        colorHex: '#141a24',
        layer: 1,
      });
      cabBatcher.add(cabTrimMetalMat, ventRingGeo, {
        x: vx,
        y: vy,
        z: vz - 0.012,
        rotY: vRotY,
        colorHex: '#64748b',
        layer: 1,
      });
      for (const ly of [-0.018, 0, 0.018]) {
        cabBatcher.add(cabInteriorMat, ventLouverGeo, {
          x: vx,
          y: vy + ly,
          z: vz - 0.006,
          rotY: vRotY,
          colorHex: '#334155',
          layer: 1,
        });
      }
    }

    const switchBankGeo = new THREE.BoxGeometry(0.30, 0.075, 0.045);
    cabBatcher.add(cabInteriorMat, switchBankGeo, {
      x: -0.02,
      y: 2.13,
      z: 2.35,
      rotY: -0.34,
      colorHex: '#141a24',
      layer: 1,
    });
    const rockerKeyGeo = new THREE.BoxGeometry(0.028, 0.028, 0.024);
    for (let sIdx = 0; sIdx < 5; sIdx++) {
      const offset = (sIdx - 2) * 0.046;
      const cosA = Math.cos(0.34);
      const sinA = Math.sin(0.34);
      cabBatcher.add(cabInteriorMat, rockerKeyGeo, {
        x: -0.02 + offset * cosA,
        y: 2.135,
        z: 2.33 - offset * sinA,
        rotY: -0.34,
        colorHex: sIdx === 3 ? '#dc2626' : sIdx === 1 ? '#d97706' : '#334155',
        layer: 1,
      });
    }
    const hvacDialGeo = new THREE.CylinderGeometry(0.022, 0.024, 0.026, 12);
    hvacDialGeo.rotateX(Math.PI / 2);
    for (const dOff of [-0.08, 0, 0.08]) {
      cabBatcher.add(cabTrimMetalMat, hvacDialGeo, {
        x: -0.02 + dOff * Math.cos(0.34),
        y: 2.04,
        z: 2.31 - dOff * Math.sin(0.34),
        rotY: -0.34,
        colorHex: '#94a3b8',
        layer: 1,
      });
    }

    // Dual pneumatic parking brake valves (yellow tractor valve + red trailer valve)
    const parkValveGeo = new THREE.CylinderGeometry(0.018, 0.013, 0.068, 8);
    cabBatcher.add(cabInteriorMat, parkValveGeo, {
      x: -0.14,
      y: 2.14,
      z: 2.28,
      rotX: -0.42,
      colorHex: '#eab308',
      layer: 1,
    });
    cabBatcher.add(cabInteriorMat, parkValveGeo, {
      x: -0.20,
      y: 2.14,
      z: 2.30,
      rotX: -0.42,
      colorHex: '#dc2626',
      layer: 1,
    });

    // Passenger glovebox seam + brushed latch + grab handle with metallic brackets
    const gloveboxGeo = new THREE.BoxGeometry(0.56, 0.24, 0.03);
    cabBatcher.add(cabInteriorMat, gloveboxGeo, {
      x: -0.62,
      y: 2.01,
      z: 2.34,
      colorHex: '#1f2735',
      layer: 1,
    });
    const gloveLatchGeo = new THREE.BoxGeometry(0.07, 0.022, 0.02);
    cabBatcher.add(cabTrimMetalMat, gloveLatchGeo, {
      x: -0.62,
      y: 2.10,
      z: 2.32,
      colorHex: '#cbd5e1',
      layer: 1,
    });
    const grabHandleGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.42, 8);
    grabHandleGeo.rotateZ(Math.PI / 2);
    cabBatcher.add(cabInteriorMat, grabHandleGeo, {
      x: -0.62,
      y: 2.21,
      z: 2.40,
      colorHex: '#1b2230',
      layer: 1,
    });
    for (const gx of [-0.81, -0.43]) {
      cabBatcher.add(cabTrimMetalMat, grabBracketGeo, {
        x: gx,
        y: 2.20,
        z: 2.43,
        colorHex: '#94a3b8',
        layer: 1,
      });
    }
    disposables.push(
      ventBezelGeo,
      ventRingGeo,
      ventLouverGeo,
      switchBankGeo,
      rockerKeyGeo,
      hvacDialGeo,
      parkValveGeo,
      gloveboxGeo,
      gloveLatchGeo,
      grabHandleGeo
    );

    // Dynamic glowing instrument cluster recessed inside low-profile binnacle (Layer 1: skipped by mirrors)
    const clusterGeo = new THREE.PlaneGeometry(0.64, 0.20);
    const clusterMat = new THREE.MeshBasicMaterial({ map: dashTex });
    const cluster = new THREE.Mesh(clusterGeo, clusterMat);
    cluster.position.set(0.58, 2.33, 2.55);
    cluster.rotation.y = Math.PI;
    cluster.rotation.x = 0.22;
    cluster.layers.set(1);
    cabSuspensionGroup.add(cluster);

    // Unobstructed Embedded Euro-Truck SatNav angled cleanly toward driver (Layer 1)
    const gpsTex = this.textures.getDynamicCabGpsTexture();
    const gpsGroup = new THREE.Group();
    gpsGroup.position.set(0.03, 2.30, 2.50);
    gpsGroup.rotation.set(-0.14, Math.PI - 0.30, 0, 'YXZ');
    const gpsBezelGeo = new THREE.BoxGeometry(0.33, 0.205, 0.024);
    const gpsBezel = new THREE.Mesh(gpsBezelGeo, wiperMat);
    gpsBezel.layers.set(1);
    const gpsGeo = new THREE.PlaneGeometry(0.30, 0.18);
    const gpsMat = new THREE.MeshBasicMaterial({ map: gpsTex });
    const gpsMesh = new THREE.Mesh(gpsGeo, gpsMat);
    gpsMesh.position.z = 0.014;
    gpsMesh.layers.set(1);
    gpsGroup.add(gpsBezel, gpsMesh);
    cabSuspensionGroup.add(gpsGroup);

    // Contoured mounting pedestal connecting SatNav cleanly to angled center console
    const gpsMountGeo = new THREE.BoxGeometry(0.14, 0.12, 0.09);
    cabBatcher.add(cabInteriorMat, gpsMountGeo, {
      x: 0.03,
      y: 2.19,
      z: 2.52,
      rotY: -0.30,
      colorHex: '#18202c',
      layer: 1,
    });
    const gpsRimGeo = new THREE.BoxGeometry(0.342, 0.216, 0.014);
    cabBatcher.add(cabTrimMetalMat, gpsRimGeo, {
      x: 0.03,
      y: 2.30,
      z: 2.505,
      rotX: -0.14,
      rotY: Math.PI - 0.30,
      colorHex: '#64748b',
      layer: 1,
    });
    disposables.push(gpsMountGeo, gpsRimGeo);

    // Driver & Passenger seats (batched, Layer 1 — driver backrest omitted so cab eye never clips seat)
    const seatCushionGeo = new THREE.BoxGeometry(0.54, 0.16, 0.46);
    const seatBackGeo = new THREE.BoxGeometry(0.52, 0.72, 0.12);
    for (const sx of [-0.58, 0.58]) {
      cabBatcher.add(cabInteriorMat, seatCushionGeo, {
        x: sx,
        y: 1.90,
        z: 1.74,
        colorHex: '#4c586b',
        layer: 1,
      });
    }
    cabBatcher.add(cabInteriorMat, seatBackGeo, {
      x: -0.58,
      y: 2.34,
      z: 1.50,
      colorHex: '#4c586b',
      layer: 1,
    });

    // 4-Spoke European Multi-Function Steering Wheel (LHD on +X = 0.58, Layer 1)
    // Positive rotation.x tilts top rim forward toward windshield so dashboard is 100% unobstructed!
    const steeringColumnGeo = new THREE.CylinderGeometry(0.056, 0.072, 0.36, 10);
    steeringColumnGeo.rotateX(Math.PI / 2 + 0.50);
    cabBatcher.add(cabInteriorMat, steeringColumnGeo, {
      x: 0.58,
      y: 2.07,
      z: 2.29,
      colorHex: '#252e3d',
      layer: 1,
    });
    const ignitionCylGeo = new THREE.CylinderGeometry(0.016, 0.016, 0.036, 8);
    ignitionCylGeo.rotateZ(Math.PI / 2);
    cabBatcher.add(cabTrimMetalMat, ignitionCylGeo, {
      x: 0.495,
      y: 2.11,
      z: 2.24,
      colorHex: '#94a3b8',
      layer: 1,
    });
    disposables.push(ignitionCylGeo);

    const wheelGroup = new THREE.Group();
    const steeringWheel = new THREE.Group();
    steeringWheel.position.set(0.58, 2.15, 2.14);
    steeringWheel.rotation.x = 0.50;
    const rimTorusGeo = new THREE.TorusGeometry(0.205, 0.022, 10, 28);
    const thumbBolsterGeo = new THREE.BoxGeometry(0.036, 0.044, 0.050);
    const spokeGeo = new THREE.BoxGeometry(0.375, 0.044, 0.022);
    const buttonPodGeo = new THREE.BoxGeometry(0.068, 0.048, 0.028);
    const spokeLowerGeo = new THREE.BoxGeometry(0.056, 0.18, 0.022);
    const hubGeo = new THREE.CylinderGeometry(0.068, 0.062, 0.044, 16);
    hubGeo.rotateX(Math.PI / 2);
    const wheelBadgeGeo = new THREE.CylinderGeometry(0.026, 0.026, 0.050, 14);
    wheelBadgeGeo.rotateX(Math.PI / 2);
    const wheelMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.48, metalness: 0.28 });
    const swBatcher = new GeometryBatcher();
    swBatcher.add(wheelMat, rimTorusGeo, { colorHex: '#232b38', layer: 1 });
    for (const side of [-1, 1]) {
      swBatcher.add(wheelMat, thumbBolsterGeo, {
        x: side * 0.175,
        y: 0.088,
        rotZ: side * 0.45,
        colorHex: '#1b2230',
        layer: 1,
      });
      swBatcher.add(wheelMat, buttonPodGeo, {
        x: side * 0.125,
        y: 0,
        z: 0.004,
        colorHex: '#111827',
        layer: 1,
      });
    }
    swBatcher.add(wheelMat, spokeGeo, { colorHex: '#2d3748', layer: 1 });
    swBatcher.add(wheelMat, spokeLowerGeo, { y: -0.095, colorHex: '#cbd5e1', layer: 1 });
    swBatcher.add(wheelMat, hubGeo, { colorHex: '#27303f', layer: 1 });
    swBatcher.add(wheelMat, wheelBadgeGeo, { colorHex: '#e2e8f0', layer: 1 });
    swBatcher.flush(steeringWheel, disposables);
    disposables.push(wheelMat, thumbBolsterGeo, buttonPodGeo);
    cabSuspensionGroup.add(steeringWheel);

    // Animated Steering Column Stalks (left = blinker, right = retarder)
    const stalkRodGeo = new THREE.BoxGeometry(0.14, 0.016, 0.018);
    const stalkTipGeo = new THREE.BoxGeometry(0.03, 0.022, 0.024);
    const stalkMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.55 });
    const leftStalkPivot = new THREE.Group();
    leftStalkPivot.position.set(0.64, 2.13, 2.22);
    const lRod = new THREE.Mesh(stalkRodGeo, stalkMat);
    lRod.position.set(0.07, 0, 0);
    lRod.layers.set(1);
    const lTip = new THREE.Mesh(stalkTipGeo, stalkMat);
    lTip.position.set(0.14, 0, 0);
    lTip.layers.set(1);
    leftStalkPivot.add(lRod, lTip);
    leftStalkPivot.layers.set(1);

    const rightStalkPivot = new THREE.Group();
    rightStalkPivot.position.set(0.52, 2.13, 2.22);
    const rRod = new THREE.Mesh(stalkRodGeo, stalkMat);
    rRod.position.set(-0.07, 0, 0);
    rRod.layers.set(1);
    const rTip = new THREE.Mesh(stalkTipGeo, stalkMat);
    rTip.position.set(-0.14, 0, 0);
    rTip.layers.set(1);
    rightStalkPivot.add(rRod, rTip);
    rightStalkPivot.layers.set(1);
    cabSuspensionGroup.add(leftStalkPivot, rightStalkPivot);

    // Compact Deep-Crimson Gold-Trimmed ETS2 Cab Pennant (pendulum driven by cabRoll / cabPitch)
    const cabPendantPivot = new THREE.Group();
    cabPendantPivot.position.set(0.18, 3.12, 2.74);
    const cordGeo = new THREE.BoxGeometry(0.005, 0.038, 0.005);
    const cordMat = new THREE.MeshBasicMaterial({ color: '#facc15' });
    const pennantGeo = new THREE.ConeGeometry(0.026, 0.048, 3);
    pennantGeo.rotateX(Math.PI);
    const pennantMat = new THREE.MeshStandardMaterial({
      color: '#991b1b',
      emissive: '#450a0a',
      emissiveIntensity: 0.25,
      roughness: 0.5,
    });
    const cordMesh = new THREE.Mesh(cordGeo, cordMat);
    cordMesh.position.y = -0.019;
    cordMesh.layers.set(1);
    const pennantMesh = new THREE.Mesh(pennantGeo, pennantMat);
    pennantMesh.position.y = -0.056;
    pennantMesh.layers.set(1);
    const goldTrimGeo = new THREE.BoxGeometry(0.048, 0.005, 0.006);
    const goldTrimMesh = new THREE.Mesh(goldTrimGeo, cordMat);
    goldTrimMesh.position.y = -0.034;
    goldTrimMesh.layers.set(1);
    cabPendantPivot.add(cordMesh, pennantMesh, goldTrimMesh);
    cabSuspensionGroup.add(cabPendantPivot);
    disposables.push(goldTrimGeo);

    // Night Cab Ambient Accent Strips + Toggleable Overhead Dome Lamp (zero dynamic lights!)
    const ambientStripMat = new THREE.MeshStandardMaterial({
      color: '#2a3444',
      emissive: '#f59e0b',
      emissiveIntensity: 0.0,
      roughness: 0.4,
    });
    const ambientStripGeo = new THREE.BoxGeometry(1.78, 0.010, 0.012);
    cabBatcher.add(ambientStripMat, ambientStripGeo, {
      x: 0.02,
      y: 2.135,
      z: 2.41,
      layer: 1,
    });
    const footwellStripGeo = new THREE.BoxGeometry(0.54, 0.012, 0.02);
    cabBatcher.add(ambientStripMat, footwellStripGeo, {
      x: 0.58,
      y: 1.88,
      z: 2.38,
      layer: 1,
    });

    const domeLampMat = new THREE.MeshStandardMaterial({
      color: '#fef3c7',
      emissive: '#fde68a',
      emissiveIntensity: 0.05,
      roughness: 0.3,
    });
    const domeLampGeo = new THREE.BoxGeometry(0.26, 0.02, 0.14);
    cabBatcher.add(domeLampMat, domeLampGeo, {
      x: 0,
      y: 3.215,
      z: 2.18,
      layer: 1,
    });

    // Tractor-Trailer Suzie Coils (Red/Yellow/Black spiral air & ABS lines behind cab)
    const suzieCoilsGroup = new THREE.Group();
    suzieCoilsGroup.position.set(0, 1.92, 0.58);
    const coilMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 });
    const coilBatcher = new GeometryBatcher();
    const coilGeos: THREE.BufferGeometry[] = [];
    for (const [cx, colorHex] of [
      [-0.18, '#dc2626'],
      [0, '#eab308'],
      [0.18, '#1e293b'],
    ] as const) {
      const pts: THREE.Vector3[] = [];
      for (let s = 0; s <= 24; s++) {
        const u = s / 24;
        const ang = u * Math.PI * 10;
        pts.push(
          new THREE.Vector3(
            cx + Math.cos(ang) * 0.045,
            -Math.sin(u * Math.PI) * 0.16 + Math.sin(ang) * 0.045,
            -u * 0.95
          )
        );
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      const tGeo = new THREE.TubeGeometry(curve, 24, 0.014, 5, false);
      coilGeos.push(tGeo);
      coilBatcher.add(coilMat, tGeo, { colorHex });
    }
    coilBatcher.flush(suzieCoilsGroup, disposables);
    tractorRoot.add(suzieCoilsGroup);

    // 4. All 12 Tractor + Trailer Wheels rendered via ONLY 2 InstancedMeshes with sculpted LatheGeometry profiles
    const wheelRadius = 0.52;
    const tireProfile: THREE.Vector2[] = [
      new THREE.Vector2(0.27, -0.17),
      new THREE.Vector2(0.495, -0.17),
      new THREE.Vector2(0.52, -0.125),
      new THREE.Vector2(0.52, 0.125),
      new THREE.Vector2(0.495, 0.17),
      new THREE.Vector2(0.27, 0.17),
    ];
    const tireGeo = new THREE.LatheGeometry(tireProfile, 18);
    tireGeo.rotateZ(Math.PI / 2);

    const rimProfile: THREE.Vector2[] = [
      new THREE.Vector2(0.075, -0.18),
      new THREE.Vector2(0.23, -0.155),
      new THREE.Vector2(0.285, -0.172),
      new THREE.Vector2(0.285, 0.172),
      new THREE.Vector2(0.23, 0.155),
      new THREE.Vector2(0.075, 0.18),
    ];
    const hubRimGeo = new THREE.LatheGeometry(rimProfile, 14);
    hubRimGeo.rotateZ(Math.PI / 2);

    const wheelAnchors: THREE.Object3D[] = [];
    const wheelTireInst = new THREE.InstancedMesh(tireGeo, tireMat, 12);
    const wheelRimInst = new THREE.InstancedMesh(hubRimGeo, rimMat, 12);
    wheelTireInst.frustumCulled = false;
    wheelRimInst.frustumCulled = false;
    wheelGroup.add(wheelTireInst, wheelRimInst);

    const frontWheelSteerPivots: THREE.Group[] = [];
    const tractorWheelSpinMeshes: THREE.Object3D[] = [];

    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 1.04, wheelRadius, 1.85);
      const wheel = new THREE.Object3D();
      pivot.add(wheel);
      tractorRoot.add(pivot);
      frontWheelSteerPivots.push(pivot);
      tractorWheelSpinMeshes.push(wheel);
      wheelAnchors.push(wheel);
    }

    for (const rz of [-1.15, -2.35]) {
      for (const side of [-1, 1]) {
        const wheel = new THREE.Object3D();
        wheel.position.set(side * 1.04, wheelRadius, rz);
        tractorRoot.add(wheel);
        tractorWheelSpinMeshes.push(wheel);
        wheelAnchors.push(wheel);
      }
    }

    // 5. Semi-Trailer (13.6m length, Reefer unit, Underrun guards, 1-DC Atlas Container)
    const trailerRoot = new THREE.Group();
    trailerRoot.name = 'SemiTrailer';
    tractorRoot.add(wheelGroup);

    const trailerFrameGeo = new THREE.BoxGeometry(2.15, 0.24, 13.2);
    trailerBatcher.add(darkChassisMat, trailerFrameGeo, {
      x: 0,
      y: 1.08,
      z: 0,
      colorHex: '#222b38',
      castShadow: true,
    });

    const sideGuardGeo = new THREE.BoxGeometry(0.08, 0.14, 5.2);
    for (const gx of [-1.18, 1.18]) {
      for (const gy of [0.58, 0.82]) {
        trailerBatcher.add(metalMat, sideGuardGeo, {
          x: gx,
          y: gy,
          z: 0.4,
          colorHex: '#cbd5e1',
        });
      }
    }

    // Amber LED side outline markers along trailer chassis rails
    for (const sx of [-1.22, 1.22]) {
      for (const sz of [-5.1, -1.8, 1.5, 4.8]) {
        trailerBatcher.add(sideMarkerMat, sideMarkGeo, { x: sx, y: 1.07, z: sz });
      }
    }

    const remapBoxAtlasUvs = (geo: THREE.BoxGeometry): void => {
      const uvAttr = geo.attributes.uv as THREE.BufferAttribute;
      for (let v = 0; v < 8; v++) {
        uvAttr.setY(v, uvAttr.getY(v) * 0.5 + 0.5);
      }
      for (let v = 8; v < 12; v++) {
        uvAttr.setXY(v, uvAttr.getX(v) * 0.5, uvAttr.getY(v) * 0.5);
      }
      for (let v = 12; v < 20; v++) {
        uvAttr.setXY(v, 0.54 + uvAttr.getX(v) * 0.04, 0.05 + uvAttr.getY(v) * 0.04);
      }
      for (let v = 20; v < 24; v++) {
        uvAttr.setXY(v, uvAttr.getX(v) * 0.5 + 0.5, uvAttr.getY(v) * 0.5);
      }
      uvAttr.needsUpdate = true;
    };

    let currentContainerPbr: PbrTextureSet = this.textures.getContainerAtlasTextures('#e2e8f0', 'EUROHAUL');
    let pbrDetailEnabled = true;

    const containerMat = new THREE.MeshStandardMaterial({
      map: currentContainerPbr.map,
      roughnessMap: currentContainerPbr.roughnessMap,
      bumpMap: currentContainerPbr.bumpMap,
      bumpScale: 0.04,
      roughness: 0.48,
      metalness: 0.24,
    });
    const containerGeo = new THREE.BoxGeometry(2.5, 2.75, 13.4);
    remapBoxAtlasUvs(containerGeo);

    // Variant 1: Standard Reefer / Insulated Eurobox Trailer (visible by default)
    const reeferGroup = new THREE.Group();
    const trailerContainerMesh = new THREE.Mesh(containerGeo, containerMat);
    trailerContainerMesh.position.set(0, 2.58, 0);
    trailerContainerMesh.castShadow = true;
    trailerContainerMesh.receiveShadow = true;
    reeferGroup.add(trailerContainerMesh);

    const reeferBodyGeo = new THREE.BoxGeometry(1.75, 1.18, 0.56);
    const reeferMat = new THREE.MeshStandardMaterial({ color: '#f1f5f9', roughness: 0.42 });
    const reeferGrilleGeo = new THREE.BoxGeometry(1.18, 0.66, 0.6);
    const reeferBatcher = new GeometryBatcher();
    reeferBatcher.add(reeferMat, reeferBodyGeo, { x: 0, y: 3.05, z: 6.95, castShadow: true });
    reeferBatcher.add(darkChassisMat, reeferGrilleGeo, {
      x: 0,
      y: 3.05,
      z: 6.96,
      colorHex: '#1e2736',
    });
    reeferBatcher.flush(reeferGroup, disposables);
    trailerRoot.add(reeferGroup);

    // Variant 2: Maritime ISO Container on Skeletal Twistlock Chassis
    const containerGroup = new THREE.Group();
    containerGroup.visible = false;
    const isoContainerGeo = new THREE.BoxGeometry(2.44, 2.58, 12.2);
    remapBoxAtlasUvs(isoContainerGeo);
    const isoContainerMesh = new THREE.Mesh(isoContainerGeo, containerMat);
    isoContainerMesh.position.set(0, 2.5, -0.2);
    isoContainerMesh.castShadow = true;
    isoContainerMesh.receiveShadow = true;
    containerGroup.add(isoContainerMesh);

    const cargoSolidMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.62,
      metalness: 0.24,
    });
    const containerChassisBatcher = new GeometryBatcher();
    const bolsterGeo = new THREE.BoxGeometry(2.48, 0.16, 0.34);
    const lockGeo = new THREE.BoxGeometry(0.18, 0.14, 0.18);
    const gooseneckDeckGeo = new THREE.BoxGeometry(2.26, 0.14, 1.15);
    containerChassisBatcher.add(cargoSolidMat, gooseneckDeckGeo, {
      x: 0,
      y: 1.18,
      z: 6.22,
      colorHex: '#1e293b',
    });
    for (const bz of [-6.25, -0.2, 5.85]) {
      containerChassisBatcher.add(cargoSolidMat, bolsterGeo, {
        x: 0,
        y: 1.2,
        z: bz,
        colorHex: '#334155',
      });
      if (bz !== -0.2) {
        for (const lx of [-1.14, 1.14]) {
          containerChassisBatcher.add(cargoSolidMat, lockGeo, {
            x: lx,
            y: 1.28,
            z: bz,
            colorHex: '#f59e0b',
          });
        }
      }
    }
    containerChassisBatcher.flush(containerGroup, disposables);
    trailerRoot.add(containerGroup);

    // Variant 3: Timber / Pine Logs Flatbed Carrier (1 batched Draw Call)
    const logsGroup = new THREE.Group();
    logsGroup.visible = false;
    const flatDeckGeo = new THREE.BoxGeometry(2.48, 0.16, 13.2);
    const headboardGeo = new THREE.BoxGeometry(2.48, 1.55, 0.14);
    const stakeGeo = new THREE.BoxGeometry(0.11, 1.48, 0.12);
    const logGeo = new THREE.CylinderGeometry(0.27, 0.29, 11.8, 8);
    logGeo.rotateX(Math.PI / 2);
    const strapBandGeo = new THREE.BoxGeometry(2.38, 1.38, 0.12);
    const logsBatcher = new GeometryBatcher();
    logsBatcher.add(cargoSolidMat, flatDeckGeo, {
      x: 0,
      y: 1.26,
      z: 0,
      colorHex: '#6b4c35',
      receiveShadow: true,
    });
    logsBatcher.add(cargoSolidMat, headboardGeo, {
      x: 0,
      y: 2.08,
      z: 6.52,
      colorHex: '#1e293b',
      castShadow: true,
    });
    for (const sx of [-1.18, 1.18]) {
      for (const sz of [-5.2, -2.6, 0, 2.6, 5.2]) {
        logsBatcher.add(cargoSolidMat, stakeGeo, {
          x: sx,
          y: 2.04,
          z: sz,
          colorHex: '#b91c1c',
          castShadow: true,
        });
      }
    }
    const logColors = ['#92400e', '#a16207', '#78350f', '#b45309'];
    let logIdx = 0;
    for (const [tierY, cols] of [
      [1.62, [-0.82, -0.28, 0.28, 0.82]],
      [2.1, [-0.82, -0.28, 0.28, 0.82]],
      [2.56, [-0.55, 0, 0.55]],
    ] as [number, number[]][]) {
      for (const lx of cols) {
        logsBatcher.add(cargoSolidMat, logGeo, {
          x: lx,
          y: tierY,
          z: -0.25,
          colorHex: logColors[logIdx % logColors.length]!,
          castShadow: true,
        });
        logIdx += 1;
      }
    }
    for (const bz of [-4.2, -1.4, 1.4, 4.2]) {
      logsBatcher.add(cargoSolidMat, strapBandGeo, {
        x: 0,
        y: 2.08,
        z: bz,
        colorHex: '#f59e0b',
      });
    }
    logsBatcher.flush(logsGroup, disposables);
    trailerRoot.add(logsGroup);

    // Variant 4: Heavy Industrial CNC / Wind Equipment Flatbed (1 batched Draw Call)
    const machineryGroup = new THREE.Group();
    machineryGroup.visible = false;
    const skidGeo = new THREE.BoxGeometry(2.15, 0.18, 11.4);
    const machineUnitGeo = new THREE.BoxGeometry(2.05, 1.65, 4.4);
    const cabinetGeo = new THREE.BoxGeometry(1.75, 1.25, 2.4);
    const spindleHoodGeo = new THREE.CylinderGeometry(0.56, 0.62, 1.9, 10);
    spindleHoodGeo.rotateX(Math.PI / 2);
    const hazardBarGeo = new THREE.BoxGeometry(2.1, 0.14, 0.14);
    const machineryBatcher = new GeometryBatcher();
    machineryBatcher.add(cargoSolidMat, flatDeckGeo, {
      x: 0,
      y: 1.26,
      z: 0,
      colorHex: '#334155',
      receiveShadow: true,
    });
    machineryBatcher.add(cargoSolidMat, headboardGeo, {
      x: 0,
      y: 2.08,
      z: 6.52,
      colorHex: '#1e293b',
      castShadow: true,
    });
    machineryBatcher.add(cargoSolidMat, skidGeo, {
      x: 0,
      y: 1.42,
      z: -0.2,
      colorHex: '#78350f',
    });
    machineryBatcher.add(cargoSolidMat, machineUnitGeo, {
      x: 0,
      y: 2.34,
      z: 2.2,
      colorHex: '#1d4ed8',
      castShadow: true,
    });
    machineryBatcher.add(cargoSolidMat, cabinetGeo, {
      x: 0,
      y: 2.14,
      z: -2.2,
      colorHex: '#0f766e',
      castShadow: true,
    });
    machineryBatcher.add(cargoSolidMat, spindleHoodGeo, {
      x: 0,
      y: 2.55,
      z: -4.4,
      colorHex: '#cbd5e1',
      castShadow: true,
    });
    for (const hz of [4.42, -5.45]) {
      machineryBatcher.add(cargoSolidMat, hazardBarGeo, {
        x: 0,
        y: 1.56,
        z: hz,
        colorHex: '#facc15',
      });
    }
    machineryBatcher.flush(machineryGroup, disposables);
    trailerRoot.add(machineryGroup);

    const kingpinGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.34, 10);
    trailerBatcher.add(metalMat, kingpinGeo, {
      x: 0,
      y: 0.88,
      z: 5.2,
      colorHex: '#e2e8f0',
    });

    const trailerLandingGear = new THREE.Group();
    trailerLandingGear.position.set(0, 0.85, 3.3);
    const legGeo = new THREE.BoxGeometry(0.14, 0.95, 0.14);
    const footGeo = new THREE.BoxGeometry(0.32, 0.08, 0.32);
    const braceGeo = new THREE.BoxGeometry(1.56, 0.08, 0.08);
    const lgBatcher = new GeometryBatcher();
    lgBatcher.add(darkChassisMat, braceGeo, { y: -0.15, colorHex: '#222b38' });
    for (const lx of [-0.78, 0.78]) {
      lgBatcher.add(darkChassisMat, legGeo, { x: lx, colorHex: '#222b38' });
      lgBatcher.add(darkChassisMat, footGeo, { x: lx, y: -0.48, colorHex: '#222b38' });
    }
    lgBatcher.flush(trailerLandingGear, disposables);
    trailerRoot.add(trailerLandingGear);

    // Trailer rear wheel fenders & underrun bumper + full taillight cluster (batched)
    const trFenderGeo = new THREE.BoxGeometry(0.58, 0.16, 3.4);
    for (const fx of [-1.05, 1.05]) {
      trailerBatcher.add(darkChassisMat, trFenderGeo, {
        x: fx,
        y: 1.08,
        z: -4.5,
        colorHex: '#1e2736',
      });
    }

    const trRearGeo = new THREE.BoxGeometry(2.44, 0.24, 0.22);
    trailerBatcher.add(metalMat, trRearGeo, {
      x: 0,
      y: 0.68,
      z: -6.68,
      colorHex: '#cbd5e1',
    });
    // Trailer rear dock bumpers, mudflaps, EU plate, spare wheel carrier & upper corner outline LEDs
    const dockBumperGeo = new THREE.BoxGeometry(0.18, 0.28, 0.14);
    const trMudflapGeo = new THREE.BoxGeometry(0.58, 0.44, 0.04);
    for (const side of [-1, 1]) {
      trailerBatcher.add(darkChassisMat, dockBumperGeo, {
        x: side * 1.06,
        y: 1.08,
        z: -6.74,
        colorHex: '#18202c',
      });
      trailerBatcher.add(darkChassisMat, trMudflapGeo, {
        x: side * 1.05,
        y: 0.48,
        z: -6.28,
        colorHex: '#18202c',
      });
      trailerBatcher.add(brakeMat, sideMarkGeo, {
        x: side * 1.22,
        y: 3.88,
        z: -6.66,
        rotY: Math.PI / 2,
      });
    }
    const spareTireGeo = new THREE.CylinderGeometry(0.44, 0.44, 0.28, 12);
    trailerBatcher.add(darkChassisMat, spareTireGeo, {
      x: -0.58,
      y: 0.78,
      z: -0.55,
      colorHex: '#18181b',
    });
    trailerBatcher.add(plateMat, plateGeo, {
      x: 0,
      y: 0.68,
      z: -6.80,
      rotY: Math.PI,
    });
    disposables.push(dockBumperGeo, trMudflapGeo, spareTireGeo);

    trailerBatcher.add(brakeMat, lampSmallGeo, { x: 0.86, y: 0.68, z: -6.78 });
    trailerBatcher.add(brakeMat, lampSmallGeo, { x: -0.86, y: 0.68, z: -6.78 });
    trailerBatcher.add(leftSignalMat, lampSmallGeo, { x: 1.08, y: 0.68, z: -6.78 });
    trailerBatcher.add(rightSignalMat, lampSmallGeo, { x: -1.08, y: 0.68, z: -6.78 });
    trailerBatcher.add(reverseMat, lampSmallGeo, { x: 0.62, y: 0.68, z: -6.78 });
    trailerBatcher.add(reverseMat, lampSmallGeo, { x: -0.62, y: 0.68, z: -6.78 });

    tractorBatcher.flush(tractorRoot, disposables);
    cabBatcher.flush(cabSuspensionGroup, disposables);
    trailerBatcher.flush(trailerRoot, disposables);

    // Triple trailer axles (anchor transforms -> InstancedMesh wheels)
    const trailerWheelSpinMeshes: THREE.Object3D[] = [];
    for (const tz of [-3.4, -4.5, -5.6]) {
      for (const side of [-1, 1]) {
        const wheel = new THREE.Object3D();
        wheel.position.set(side * 1.05, wheelRadius, tz);
        trailerRoot.add(wheel);
        trailerWheelSpinMeshes.push(wheel);
        wheelAnchors.push(wheel);
      }
    }

    // 6. Zero-cost Contact AO (always enabled at y=0.032; opacity boosts when directional shadowMap is off)
    const blobTex = this.textures.getBlobShadowTexture();
    const blobMat = new THREE.MeshBasicMaterial({
      map: blobTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.48,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const tractorBlobGeo = new THREE.PlaneGeometry(3.5, 7.6);
    const tractorBlob = new THREE.Mesh(tractorBlobGeo, blobMat);
    tractorBlob.rotation.x = -Math.PI / 2;
    tractorBlob.position.set(0, 0.032, -0.1);
    tractorRoot.add(tractorBlob);

    const trailerBlobGeo = new THREE.PlaneGeometry(3.5, 14.6);
    const trailerBlob = new THREE.Mesh(trailerBlobGeo, blobMat);
    trailerBlob.rotation.x = -Math.PI / 2;
    trailerBlob.position.set(0, 0.032, 0);
    trailerRoot.add(trailerBlob);

    disposables.push(
      blobMat,
      tractorBlobGeo,
      trailerBlobGeo,
      railGeo,
      deckGeo,
      fifthWheelGeo,
      fuelTankGeo,
      strapGeo,
      airTankGeo,
      bumperGeo,
      bumperLipGeo,
      fogGeo,
      mudguardGeo,
      flapGeo,
      sideMarkGeo,
      rearBarGeo,
      lampSmallGeo,
      headLampGeo,
      drlGeo,
      glowMat,
      glowGeo,
      beamGeo,
      beamMat,
      groundPoolGeo,
      groundPoolMat,
      cabLowerGeo,
      grilleUpperGeo,
      grilleLowerGeo,
      slatGeo,
      emblemGeo,
      handleGeo,
      stepGeo,
      cabBackGeo,
      sideDeflectorGeo,
      cabBackInnerGeo,
      stackGeo,
      stackTipGeo,
      heatShieldGeo,
      cabRoofGeo,
      headlinerGeo,
      headerBeamGeo,
      cabFloorGeo,
      bPillarGeo,
      roofRailGeo,
      doorTrimGeo,
      sideGlassGeo,
      spoilerGeo,
      lightboxGeo,
      lightboxMat,
      visorGeo,
      markerGeo,
      pillarGeo,
      sideLowerDoorGeo,
      windshieldGeo,
      wiperArmGeo,
      wiperGeo,
      mirrorArmGeo,
      mirrorHousingGeo,
      mirrorCapGeo,
      leftMirrorGlassGeo,
      rightMirrorGlassGeo,
      leftDoorMirrorMat,
      rightDoorMirrorMat,
      blindMirrorGeo,
      rainGlassGeo,
      rainGlassMat,
      stalkRodGeo,
      stalkTipGeo,
      stalkMat,
      cordGeo,
      cordMat,
      pennantGeo,
      pennantMat,
      ambientStripMat,
      ambientStripGeo,
      footwellStripGeo,
      domeLampMat,
      domeLampGeo,
      coilMat,
      ...coilGeos,
      dashBodyGeo,
      centerConsoleGeo,
      cowlGeo,
      clusterGeo,
      clusterMat,
      gpsBezelGeo,
      gpsGeo,
      gpsMat,
      seatCushionGeo,
      seatBackGeo,
      steeringColumnGeo,
      rimTorusGeo,
      spokeGeo,
      spokeLowerGeo,
      hubGeo,
      wheelBadgeGeo,
      tireGeo,
      hubRimGeo,
      trailerFrameGeo,
      sideGuardGeo,
      containerMat,
      containerGeo,
      isoContainerGeo,
      cargoSolidMat,
      bolsterGeo,
      lockGeo,
      gooseneckDeckGeo,
      flatDeckGeo,
      headboardGeo,
      stakeGeo,
      logGeo,
      strapBandGeo,
      skidGeo,
      machineUnitGeo,
      cabinetGeo,
      spindleHoodGeo,
      hazardBarGeo,
      reeferBodyGeo,
      reeferMat,
      reeferGrilleGeo,
      kingpinGeo,
      legGeo,
      footGeo,
      braceGeo,
      trFenderGeo,
      trRearGeo
    );

    const applyContainerPbr = () => {
      containerMat.map = currentContainerPbr.map;
      containerMat.roughnessMap = pbrDetailEnabled ? currentContainerPbr.roughnessMap : null;
      containerMat.bumpMap = pbrDetailEnabled ? currentContainerPbr.bumpMap : null;
      containerMat.bumpScale = pbrDetailEnabled ? 0.04 : 0;
      containerMat.needsUpdate = true;
    };

    const setPaintColor = (hex: string): void => {
      paintMat.color.set(hex);
    };

    const setTrailerCargoVisual = (
      colorHex: string,
      label: string,
      cargoType: TrailerCargoType = 'reefer'
    ): void => {
      if (cargoType === 'reefer' || cargoType === 'container') {
        currentContainerPbr = this.textures.getContainerAtlasTextures(colorHex, label);
        applyContainerPbr();
      }
      reeferGroup.visible = cargoType === 'reefer';
      containerGroup.visible = cargoType === 'container';
      logsGroup.visible = cargoType === 'logs';
      machineryGroup.visible = cargoType === 'machinery';
    };

    const setBlobShadowVisible = (shadowsDisabled: boolean): void => {
      tractorBlob.visible = true;
      trailerBlob.visible = true;
      blobMat.opacity = shadowsDisabled ? 0.78 : 0.48;
    };

    const setPbrDetailEnabled = (enabled: boolean): void => {
      pbrDetailEnabled = enabled;
      applyContainerPbr();
    };

    const invTractorMat = new THREE.Matrix4();
    const relWheelMat = new THREE.Matrix4();

    const syncWheelInstances = (): void => {
      tractorRoot.updateMatrixWorld(true);
      trailerRoot.updateMatrixWorld(true);
      invTractorMat.copy(tractorRoot.matrixWorld).invert();
      for (let i = 0; i < wheelAnchors.length; i++) {
        relWheelMat.multiplyMatrices(invTractorMat, wheelAnchors[i]!.matrixWorld);
        wheelTireInst.setMatrixAt(i, relWheelMat);
        wheelRimInst.setMatrixAt(i, relWheelMat);
      }
      wheelTireInst.instanceMatrix.needsUpdate = true;
      wheelRimInst.instanceMatrix.needsUpdate = true;
    };

    const setDoorMirrorTextures = (leftTex: THREE.Texture, rightTex: THREE.Texture): void => {
      leftDoorMirrorMat.map = leftTex;
      leftDoorMirrorMat.color.setHex(0xffffff);
      leftDoorMirrorMat.needsUpdate = true;
      rightDoorMirrorMat.map = rightTex;
      rightDoorMirrorMat.color.setHex(0xffffff);
      rightDoorMirrorMat.needsUpdate = true;
    };

    let pendantAngZ = 0;
    let pendantVelZ = 0;
    let pendantAngX = 0;
    let pendantVelX = 0;

    const updateInteriorDetails = (opts: {
      dtSec: number;
      leftBlinker: boolean;
      rightBlinker: boolean;
      retarderLevel: number;
      cabRoll: number;
      cabPitch: number;
      nightFactor: number;
      cabLightOn: boolean;
      trailerAttached: boolean;
      showRainGlass: boolean;
      rainIntensity?: number;
      showCabPendant?: boolean;
    }): void => {
      cabPendantPivot.visible = opts.showCabPendant ?? true;
      const safeDt = Math.min(0.033, Math.max(0.001, opts.dtSec));
      const leftTarget = opts.leftBlinker ? 0.24 : opts.rightBlinker ? -0.24 : 0;
      leftStalkPivot.rotation.z += (leftTarget - leftStalkPivot.rotation.z) * Math.min(1, safeDt * 18);

      const rightTarget = -opts.retarderLevel * 0.13;
      rightStalkPivot.rotation.z += (rightTarget - rightStalkPivot.rotation.z) * Math.min(1, safeDt * 18);

      // Damped pendulum for cab pennant
      const targetZ = -opts.cabRoll * 2.8;
      const targetX = opts.cabPitch * 2.6;
      const k = 28;
      const c = 4.2;
      pendantVelZ += (k * (targetZ - pendantAngZ) - c * pendantVelZ) * safeDt;
      pendantAngZ = THREE.MathUtils.clamp(pendantAngZ + pendantVelZ * safeDt, -0.45, 0.45);
      pendantVelX += (k * (targetX - pendantAngX) - c * pendantVelX) * safeDt;
      pendantAngX = THREE.MathUtils.clamp(pendantAngX + pendantVelX * safeDt, -0.45, 0.45);
      cabPendantPivot.rotation.set(pendantAngX, 0, pendantAngZ);

      // Night cab ambient accent & toggleable dome light
      ambientStripMat.emissiveIntensity = opts.nightFactor > 0.2 ? (opts.nightFactor - 0.2) * 1.45 : 0;
      domeLampMat.emissiveIntensity = opts.cabLightOn ? 2.4 : 0.05;
      cabInteriorMat.emissive.set(opts.cabLightOn ? '#5c4e38' : '#222e42');
      cabInteriorMat.emissiveIntensity = opts.cabLightOn ? 0.72 : 0.34;

      // Suzie coils tuck/stretch cleanly when trailer detached/attached
      suzieCoilsGroup.scale.z = opts.trailerAttached ? 1.0 : 0.28;
      suzieCoilsGroup.position.y = opts.trailerAttached ? 1.92 : 1.72;

      const rainAlpha = THREE.MathUtils.clamp(((opts.rainIntensity ?? 0) - 0.16) / 0.55, 0, 1);
      rainGlassMat.opacity = rainAlpha * 0.68;
      rainGlassMesh.visible = opts.showRainGlass && rainAlpha > 0.01;
    };

    const getWiperAngle = (): number => wiperPivots[0]?.rotation.z ?? -0.02;

    const updateWipers = (elapsedSec: number, mode: WipersMode): void => {
      const targetAngle =
        mode === 0
          ? -0.02
          : -0.02 - (0.5 - 0.5 * Math.cos(elapsedSec * (mode === 1 ? 3.8 : 6.4))) * 1.48;
      for (let i = 0; i < wiperPivots.length; i++) {
        wiperPivots[i]!.rotation.z += (targetAngle - wiperPivots[i]!.rotation.z) * 0.35;
      }
    };

    const updateLights = (opts: {
      headlightMode: HeadlightMode;
      nightFactor: number;
      rainIntensity?: number;
      braking: boolean;
      reversing: boolean;
      leftBlinkerLit: boolean;
      rightBlinkerLit: boolean;
    }): void => {
      const mode = opts.headlightMode;
      const weatherLit = Math.max(opts.nightFactor, (opts.rainIntensity ?? 0) * 0.85);
      drlMat.emissiveIntensity = mode === 0 ? 0.85 : 1.55;
      headlightEmissiveMat.emissiveIntensity = mode === 0 ? 0.12 : mode === 1 ? 1.65 : 2.8;
      fogLampMat.emissiveIntensity = mode === 2 ? 1.4 : mode === 1 ? 0.6 : 0.12;
      glowMat.opacity =
        mode === 0 ? 0 : (mode === 1 ? 0.38 : 0.65) * (0.42 + weatherLit * 0.58);
      spotLight.intensity =
        mode === 0 ? 0 : mode === 1 ? 42 + weatherLit * 52 : 82 + weatherLit * 102;
      spotLight.distance = mode === 2 ? 125 : 85;
      beamMat.opacity =
        mode === 0 ? 0 : (mode === 1 ? 0.065 : 0.13) * (0.35 + weatherLit * 0.85);
      groundPoolMat.opacity =
        mode === 0 ? 0 : (mode === 1 ? 0.18 : 0.3) * (0.3 + weatherLit * 0.7);
      sideMarkerMat.emissiveIntensity = mode > 0 || weatherLit > 0.2 ? 1.95 : 0.25;

      brakeMat.emissiveIntensity = opts.braking ? 2.5 : mode > 0 || weatherLit > 0.2 ? 0.72 : 0.15;
      reverseMat.emissiveIntensity = opts.reversing ? 2.1 : 0.0;
      leftSignalMat.emissiveIntensity = opts.leftBlinkerLit ? 2.7 : 0.0;
      rightSignalMat.emissiveIntensity = opts.rightBlinkerLit ? 2.7 : 0.0;
    };

    const dispose = (): void => {
      for (const d of disposables) {
        d.dispose();
      }
    };

    return {
      tractorRoot,
      cabSuspensionGroup,
      steeringWheel,
      frontWheelSteerPivots,
      tractorWheelSpinMeshes,
      trailerRoot,
      trailerWheelSpinMeshes,
      trailerLandingGear,
      trailerContainerMesh,
      setPaintColor,
      setTrailerCargoVisual,
      setBlobShadowVisible,
      setPbrDetailEnabled,
      setDoorMirrorTextures,
      updateInteriorDetails,
      getWiperAngle,
      updateWipers,
      syncWheelInstances,
      updateLights,
      dispose,
    };
  }
}
