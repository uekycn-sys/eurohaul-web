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
    const glassMat = new THREE.MeshStandardMaterial({
      color: '#26466d',
      roughness: 0.06,
      metalness: 0.35,
      envMapIntensity: 1.4,
      transparent: true,
      opacity: 0.24,
    });
    const tireMat = new THREE.MeshStandardMaterial({ color: '#1b1d22', roughness: 0.88 });
    const rimMat = new THREE.MeshStandardMaterial({
      color: '#dce3ec',
      metalness: 0.85,
      roughness: 0.22,
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

    const headlinerGeo = new THREE.PlaneGeometry(2.18, 1.9);
    cabBatcher.add(cabInteriorMat, headlinerGeo, {
      x: 0,
      y: 3.22,
      z: 1.82,
      rotX: Math.PI / 2,
      colorHex: '#64748b',
      layer: 1,
    });

    const spoilerGeo = new THREE.BoxGeometry(2.36, 0.44, 0.96);
    cabBatcher.add(paintMat, spoilerGeo, { x: 0, y: 3.56, z: 1.08, rotX: 0.22 });

    const lightboxGeo = new THREE.BoxGeometry(1.42, 0.22, 0.14);
    const lightboxMat = new THREE.MeshStandardMaterial({
      color: '#f8fafc',
      emissive: '#fef3c7',
      emissiveIntensity: 0.72,
    });
    cabBatcher.add(lightboxMat, lightboxGeo, { x: 0, y: 3.47, z: 2.74 });

    // Slimmer, higher external sunvisor for open upper windshield sightline
    const visorGeo = new THREE.BoxGeometry(2.42, 0.075, 0.26);
    cabBatcher.add(darkChassisMat, visorGeo, {
      x: 0,
      y: 3.25,
      z: 2.94,
      rotX: 0.16,
      colorHex: '#1e2736',
    });

    const markerGeo = new THREE.BoxGeometry(0.16, 0.065, 0.08);
    const markerMat = new THREE.MeshStandardMaterial({
      color: '#fbbf24',
      emissive: '#f59e0b',
      emissiveIntensity: 1.0,
    });
    for (const mx of [-0.82, -0.41, 0, 0.41, 0.82]) {
      cabBatcher.add(markerMat, markerGeo, { x: mx, y: 3.28, z: 3.06 });
    }

    // Slim matte-charcoal A-pillars with beveled outer angle to minimize corner blindspots
    const pillarGeo = new THREE.BoxGeometry(0.052, 1.24, 0.082);
    for (const side of [-1, 1]) {
      cabBatcher.add(darkChassisMat, pillarGeo, {
        x: side * 1.19,
        y: 2.6,
        z: 2.86,
        rotX: -0.08,
        rotY: side * 0.25,
        colorHex: '#283242',
      });
    }

    const sideLowerDoorGeo = new THREE.BoxGeometry(0.12, 0.48, 1.45);
    for (const sx of [-1.17, 1.17]) {
      cabBatcher.add(paintMat, sideLowerDoorGeo, { x: sx, y: 2.08, z: 2.12 });
    }

    const windshieldGeo = new THREE.PlaneGeometry(2.28, 1.22);
    const windshield = new THREE.Mesh(windshieldGeo, glassMat);
    windshield.position.set(0, 2.62, 2.89);
    windshield.rotation.x = -0.08;
    windshield.layers.set(1);
    cabSuspensionGroup.add(windshield);

    const wiperGeo = new THREE.BoxGeometry(0.76, 0.03, 0.04);
    const wiperPivots: THREE.Group[] = [];
    for (const wx of [-0.1, 0.72]) {
      const pivot = new THREE.Group();
      pivot.position.set(wx, 2.04, 2.94);
      const blade = new THREE.Mesh(wiperGeo, wiperMat);
      blade.position.set(-0.36, 0.04, 0);
      blade.layers.set(1);
      pivot.add(blade);
      pivot.rotation.z = -0.06;
      cabSuspensionGroup.add(pivot);
      wiperPivots.push(pivot);
    }

    // Compact aerodynamic mirror arms & housings positioned to keep diagonal A-pillar view open
    const mirrorArmGeo = new THREE.BoxGeometry(0.19, 0.036, 0.04);
    const mirrorHousingGeo = new THREE.BoxGeometry(0.11, 0.36, 0.14);
    for (const side of [-1, 1]) {
      cabBatcher.add(darkChassisMat, mirrorArmGeo, {
        x: side * 1.31,
        y: 2.48,
        z: 2.68,
        colorHex: '#252f3f',
      });
      cabBatcher.add(darkChassisMat, mirrorHousingGeo, {
        x: side * 1.43,
        y: 2.44,
        z: 2.66,
        colorHex: '#252f3f',
      });
    }

    const dashTex = this.textures.getDynamicDashboardTexture();
    const dashBodyGeo = new THREE.BoxGeometry(2.16, 0.44, 0.54);
    cabBatcher.add(cabInteriorMat, dashBodyGeo, {
      x: 0,
      y: 1.98,
      z: 2.58,
      colorHex: '#3b4656',
      layer: 1,
    });

    const cowlGeo = new THREE.BoxGeometry(2.18, 0.08, 0.38);
    cabBatcher.add(cabInteriorMat, cowlGeo, {
      x: 0,
      y: 2.18,
      z: 2.72,
      colorHex: '#4c586b',
      layer: 1,
    });

    // Dynamic glowing instrument cluster (Layer 1: skipped by mirrors)
    const clusterGeo = new THREE.PlaneGeometry(0.72, 0.25);
    const clusterMat = new THREE.MeshBasicMaterial({ map: dashTex });
    const cluster = new THREE.Mesh(clusterGeo, clusterMat);
    cluster.position.set(0.58, 2.27, 2.33);
    cluster.rotation.y = Math.PI;
    cluster.rotation.x = 0.22;
    cluster.layers.set(1);
    cabSuspensionGroup.add(cluster);

    // Live SatNav GPS unit mounted cleanly on left A-pillar dash corner (Layer 1: skipped by mirrors)
    const gpsTex = this.textures.getDynamicCabGpsTexture();
    const gpsGroup = new THREE.Group();
    gpsGroup.position.set(0.95, 2.41, 2.42);
    gpsGroup.rotation.y = Math.PI - 0.34;
    const gpsBezelGeo = new THREE.BoxGeometry(0.36, 0.23, 0.04);
    const gpsBezel = new THREE.Mesh(gpsBezelGeo, wiperMat);
    gpsBezel.layers.set(1);
    const gpsGeo = new THREE.PlaneGeometry(0.32, 0.19);
    const gpsMat = new THREE.MeshBasicMaterial({ map: gpsTex });
    const gpsMesh = new THREE.Mesh(gpsGeo, gpsMat);
    gpsMesh.position.z = 0.025;
    gpsMesh.layers.set(1);
    gpsGroup.add(gpsBezel, gpsMesh);
    cabSuspensionGroup.add(gpsGroup);

    // Driver & Passenger seats (batched, Layer 1)
    const seatGeo = new THREE.BoxGeometry(0.56, 0.92, 0.48);
    for (const sx of [-0.58, 0.58]) {
      cabBatcher.add(cabInteriorMat, seatGeo, {
        x: sx,
        y: 2.12,
        z: 1.72,
        colorHex: '#4c586b',
        layer: 1,
      });
    }

    // 4-Spoke European Multi-Function Steering Wheel (LHD on +X = 0.58, Layer 1)
    const steeringColumnGeo = new THREE.CylinderGeometry(0.055, 0.065, 0.28, 10);
    steeringColumnGeo.rotateX(Math.PI / 2 - 0.36);
    cabBatcher.add(cabInteriorMat, steeringColumnGeo, {
      x: 0.58,
      y: 2.17,
      z: 2.27,
      colorHex: '#3b4656',
      layer: 1,
    });

    const wheelGroup = new THREE.Group();
    const steeringWheel = new THREE.Group();
    steeringWheel.position.set(0.58, 2.26, 2.17);
    steeringWheel.rotation.x = -0.36;
    const rimTorusGeo = new THREE.TorusGeometry(0.21, 0.026, 8, 24);
    const spokeGeo = new THREE.BoxGeometry(0.39, 0.042, 0.022);
    const spokeLowerGeo = new THREE.BoxGeometry(0.055, 0.19, 0.022);
    const hubGeo = new THREE.CylinderGeometry(0.065, 0.065, 0.045, 14);
    hubGeo.rotateX(Math.PI / 2);
    const wheelBadgeGeo = new THREE.CylinderGeometry(0.026, 0.026, 0.05, 12);
    wheelBadgeGeo.rotateX(Math.PI / 2);
    const wheelMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.52, metalness: 0.25 });
    const swBatcher = new GeometryBatcher();
    swBatcher.add(wheelMat, rimTorusGeo, { colorHex: '#4c586b', layer: 1 });
    swBatcher.add(wheelMat, spokeGeo, { colorHex: '#3b4656', layer: 1 });
    swBatcher.add(wheelMat, spokeLowerGeo, { y: -0.1, colorHex: '#cbd5e1', layer: 1 });
    swBatcher.add(wheelMat, hubGeo, { colorHex: '#3b4656', layer: 1 });
    swBatcher.add(wheelMat, wheelBadgeGeo, { colorHex: '#e2e8f0', layer: 1 });
    swBatcher.flush(steeringWheel, disposables);
    disposables.push(wheelMat);
    cabSuspensionGroup.add(steeringWheel);

    // 4. All 12 Tractor + Trailer Wheels rendered via ONLY 2 InstancedMeshes (2 DC instead of 24!)
    const wheelRadius = 0.52;
    const tireGeo = new THREE.CylinderGeometry(wheelRadius, wheelRadius, 0.34, 18);
    tireGeo.rotateZ(Math.PI / 2);
    const hubRimGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.36, 12);
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
      spoilerGeo,
      lightboxGeo,
      lightboxMat,
      visorGeo,
      markerGeo,
      markerMat,
      pillarGeo,
      sideLowerDoorGeo,
      windshieldGeo,
      wiperGeo,
      mirrorArmGeo,
      mirrorHousingGeo,
      dashBodyGeo,
      cowlGeo,
      clusterGeo,
      clusterMat,
      gpsBezelGeo,
      gpsGeo,
      gpsMat,
      seatGeo,
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

    const updateWipers = (elapsedSec: number, mode: WipersMode): void => {
      const targetAngle =
        mode === 0
          ? -0.06
          : -0.06 - (0.5 - 0.5 * Math.cos(elapsedSec * (mode === 1 ? 3.8 : 6.4))) * 1.45;
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
      updateWipers,
      syncWheelInstances,
      updateLights,
      dispose,
    };
  }
}
