import * as THREE from 'three';
import { ProceduralTextures } from '../graphics/ProceduralTextures';
import { HeadlightMode } from '../store/useGameStore';

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
  setTrailerCargoVisual: (colorHex: string, label: string) => void;
  updateLights: (opts: {
    headlightMode: HeadlightMode;
    nightFactor: number;
    braking: boolean;
    reversing: boolean;
    leftBlinkerLit: boolean;
    rightBlinkerLit: boolean;
  }) => void;
  dispose: () => void;
}

/**
 * Builds a stylized-realistic European 6x2 cab-over tractor and 13.6m semi-trailer
 * with articulated interior steering wheel, exterior mirrors, landing gear, and active lighting.
 */
export class TruckMeshBuilder {
  private readonly textures: ProceduralTextures;

  constructor(textures: ProceduralTextures) {
    this.textures = textures;
  }

  public build(initialPaintHex: string): TruckVisualRefs {
    const disposables: { dispose: () => void }[] = [];

    const tractorRoot = new THREE.Group();
    tractorRoot.name = 'TractorUnit';

    const cabSuspensionGroup = new THREE.Group();
    tractorRoot.add(cabSuspensionGroup);

    // Shared materials
    const paintMat = new THREE.MeshStandardMaterial({
      color: initialPaintHex,
      roughness: 0.3,
      metalness: 0.55,
    });
    const darkChassisMat = new THREE.MeshStandardMaterial({
      color: '#1e293b',
      roughness: 0.72,
      metalness: 0.4,
    });
    const chromeMat = new THREE.MeshStandardMaterial({
      color: '#e2e8f0',
      roughness: 0.2,
      metalness: 0.88,
    });
    const trimMat = new THREE.MeshStandardMaterial({
      color: '#0f172a',
      roughness: 0.65,
      metalness: 0.25,
    });
    const glassMat = new THREE.MeshStandardMaterial({
      color: '#1e3a5f',
      roughness: 0.1,
      metalness: 0.2,
      transparent: true,
      opacity: 0.36,
    });
    const tireMat = new THREE.MeshStandardMaterial({ color: '#18181b', roughness: 0.9 });
    const rimMat = new THREE.MeshStandardMaterial({ color: '#cbd5e1', metalness: 0.75, roughness: 0.28 });

    // Dynamic light materials
    const headlightEmissiveMat = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      emissive: '#fef9c3',
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

    disposables.push(
      paintMat,
      darkChassisMat,
      chromeMat,
      trimMat,
      glassMat,
      tireMat,
      rimMat,
      headlightEmissiveMat,
      brakeMat,
      reverseMat,
      leftSignalMat,
      rightSignalMat
    );

    // 1. Chassis rails, bumper, fuel tanks & fifth wheel
    const railGeo = new THREE.BoxGeometry(0.16, 0.28, 6.2);
    for (const rx of [-0.46, 0.46]) {
      const rail = new THREE.Mesh(railGeo, darkChassisMat);
      rail.position.set(rx, 0.68, -0.15);
      rail.castShadow = true;
      tractorRoot.add(rail);
    }

    const deckGeo = new THREE.BoxGeometry(1.15, 0.14, 2.7);
    const deck = new THREE.Mesh(deckGeo, trimMat);
    deck.position.set(0, 0.85, -1.75);
    tractorRoot.add(deck);

    // Fifth-wheel saddle plate at z = -1.65
    const fifthWheelGeo = new THREE.CylinderGeometry(0.48, 0.52, 0.14, 16);
    const fifthWheel = new THREE.Mesh(fifthWheelGeo, darkChassisMat);
    fifthWheel.position.set(0, 0.96, -1.65);
    tractorRoot.add(fifthWheel);

    // Side fuel tanks
    const tankGeo = new THREE.BoxGeometry(0.56, 0.62, 1.9);
    for (const tx of [-0.88, 0.88]) {
      const tank = new THREE.Mesh(tankGeo, chromeMat);
      tank.position.set(tx, 0.62, -0.35);
      tank.castShadow = true;
      tractorRoot.add(tank);
    }

    // Front bumper & grille skirt
    const bumperGeo = new THREE.BoxGeometry(2.48, 0.44, 0.45);
    const bumper = new THREE.Mesh(bumperGeo, trimMat);
    bumper.position.set(0, 0.56, 2.86);
    bumper.castShadow = true;
    tractorRoot.add(bumper);

    // Rear mudguards & taillight bar
    const mudguardGeo = new THREE.BoxGeometry(0.65, 0.22, 2.65);
    for (const mx of [-0.94, 0.94]) {
      const mg = new THREE.Mesh(mudguardGeo, trimMat);
      mg.position.set(mx, 1.06, -1.72);
      tractorRoot.add(mg);
    }

    const rearBarGeo = new THREE.BoxGeometry(2.35, 0.24, 0.18);
    const rearBar = new THREE.Mesh(rearBarGeo, trimMat);
    rearBar.position.set(0, 0.66, -3.18);
    tractorRoot.add(rearBar);

    const lampSmallGeo = new THREE.BoxGeometry(0.22, 0.14, 0.08);
    const tBrakeL = new THREE.Mesh(lampSmallGeo, brakeMat);
    tBrakeL.position.set(0.88, 0.66, -3.26);
    const tBrakeR = new THREE.Mesh(lampSmallGeo, brakeMat);
    tBrakeR.position.set(-0.88, 0.66, -3.26);
    const tSigL = new THREE.Mesh(lampSmallGeo, leftSignalMat);
    tSigL.position.set(1.08, 0.66, -3.26);
    const tSigR = new THREE.Mesh(lampSmallGeo, rightSignalMat);
    tSigR.position.set(-1.08, 0.66, -3.26);
    const tRevL = new THREE.Mesh(lampSmallGeo, reverseMat);
    tRevL.position.set(0.64, 0.66, -3.26);
    tractorRoot.add(tBrakeL, tBrakeR, tSigL, tSigR, tRevL);

    // Front headlights + indicators + volumetric beam cones + SpotLight
    const headLampGeo = new THREE.BoxGeometry(0.38, 0.18, 0.12);
    const hlL = new THREE.Mesh(headLampGeo, headlightEmissiveMat);
    hlL.position.set(0.92, 0.72, 3.06);
    const hlR = new THREE.Mesh(headLampGeo, headlightEmissiveMat);
    hlR.position.set(-0.92, 0.72, 3.06);
    const fSigL = new THREE.Mesh(lampSmallGeo, leftSignalMat);
    fSigL.position.set(1.16, 0.72, 3.04);
    const fSigR = new THREE.Mesh(lampSmallGeo, rightSignalMat);
    fSigR.position.set(-1.16, 0.72, 3.04);
    tractorRoot.add(hlL, hlR, fSigL, fSigR);

    const beamGeo = new THREE.ConeGeometry(2.6, 18, 14, 1, true);
    beamGeo.translate(0, -9, 0);
    beamGeo.rotateX(Math.PI / 2);
    const beamMat = new THREE.MeshBasicMaterial({
      color: '#fef3c7',
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const beamL = new THREE.Mesh(beamGeo, beamMat);
    beamL.position.set(0.9, 0.74, 3.12);
    const beamR = new THREE.Mesh(beamGeo, beamMat);
    beamR.position.set(-0.9, 0.74, 3.12);
    tractorRoot.add(beamL, beamR);

    // Single combined SpotLight for low GPU overhead
    const spotLight = new THREE.SpotLight('#fffbeb', 0, 75, Math.PI / 4.2, 0.48, 1.35);
    spotLight.position.set(0, 1.05, 3.1);
    const spotTarget = new THREE.Object3D();
    spotTarget.position.set(0, 0.1, 26);
    tractorRoot.add(spotLight, spotTarget);
    spotLight.target = spotTarget;

    // 2. Cab Suspension Group (Cab shell + Grille + Interior + Mirrors)
    const cabLowerGeo = new THREE.BoxGeometry(2.44, 1.05, 2.38);
    const cabLower = new THREE.Mesh(cabLowerGeo, paintMat);
    cabLower.position.set(0, 1.38, 1.78);
    cabLower.castShadow = true;
    cabSuspensionGroup.add(cabLower);

    // Front radiator grille
    const grilleGeo = new THREE.BoxGeometry(1.72, 0.86, 0.12);
    const grille = new THREE.Mesh(grilleGeo, trimMat);
    grille.position.set(0, 1.35, 2.98);
    cabSuspensionGroup.add(grille);

    const slatGeo = new THREE.BoxGeometry(1.52, 0.06, 0.15);
    for (let i = 0; i < 4; i++) {
      const slat = new THREE.Mesh(slatGeo, chromeMat);
      slat.position.set(0, 1.08 + i * 0.18, 2.99);
      cabSuspensionGroup.add(slat);
    }

    // Cab roof & back wall & A/B pillars (leaving windshield transparent for 1st-person view!)
    const cabBackGeo = new THREE.BoxGeometry(2.44, 1.45, 0.82);
    const cabBack = new THREE.Mesh(cabBackGeo, paintMat);
    cabBack.position.set(0, 2.58, 1.0);
    cabBack.castShadow = true;
    cabSuspensionGroup.add(cabBack);

    const cabRoofGeo = new THREE.BoxGeometry(2.42, 0.24, 2.34);
    const cabRoof = new THREE.Mesh(cabRoofGeo, paintMat);
    cabRoof.position.set(0, 3.32, 1.76);
    cabRoof.castShadow = true;
    cabSuspensionGroup.add(cabRoof);

    // Aerodynamic roof spoiler
    const spoilerGeo = new THREE.BoxGeometry(2.36, 0.42, 0.95);
    const spoiler = new THREE.Mesh(spoilerGeo, paintMat);
    spoiler.position.set(0, 3.55, 1.08);
    spoiler.rotation.x = 0.22;
    cabSuspensionGroup.add(spoiler);

    // Sun visor & roof amber marker lights
    const visorGeo = new THREE.BoxGeometry(2.42, 0.18, 0.34);
    const visor = new THREE.Mesh(visorGeo, trimMat);
    visor.position.set(0, 3.16, 2.96);
    visor.rotation.x = 0.22;
    cabSuspensionGroup.add(visor);

    const markerGeo = new THREE.BoxGeometry(0.16, 0.08, 0.08);
    const markerMat = new THREE.MeshStandardMaterial({
      color: '#fbbf24',
      emissive: '#f59e0b',
      emissiveIntensity: 0.9,
    });
    for (const mx of [-0.72, -0.24, 0.24, 0.72]) {
      const mk = new THREE.Mesh(markerGeo, markerMat);
      mk.position.set(mx, 3.24, 3.08);
      cabSuspensionGroup.add(mk);
    }

    // A-pillars & side cab frames
    const pillarGeo = new THREE.BoxGeometry(0.14, 1.25, 0.16);
    for (const px of [-1.15, 1.15]) {
      const aPillar = new THREE.Mesh(pillarGeo, trimMat);
      aPillar.position.set(px, 2.58, 2.86);
      aPillar.rotation.x = -0.08;
      cabSuspensionGroup.add(aPillar);
    }

    // Side window pillars & door upper frames
    const sideLowerDoorGeo = new THREE.BoxGeometry(0.12, 0.48, 1.45);
    for (const sx of [-1.17, 1.17]) {
      const sDoor = new THREE.Mesh(sideLowerDoorGeo, paintMat);
      sDoor.position.set(sx, 2.1, 2.12);
      cabSuspensionGroup.add(sDoor);
    }

    // Windshield glass
    const windshieldGeo = new THREE.PlaneGeometry(2.16, 1.18);
    const windshield = new THREE.Mesh(windshieldGeo, glassMat);
    windshield.position.set(0, 2.58, 2.89);
    windshield.rotation.x = -0.08;
    cabSuspensionGroup.add(windshield);

    // Exterior side mirrors
    const mirrorArmGeo = new THREE.BoxGeometry(0.28, 0.07, 0.07);
    const mirrorHousingGeo = new THREE.BoxGeometry(0.18, 0.52, 0.22);
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(mirrorArmGeo, trimMat);
      arm.position.set(side * 1.32, 2.66, 2.74);
      const housing = new THREE.Mesh(mirrorHousingGeo, trimMat);
      housing.position.set(side * 1.44, 2.54, 2.74);
      cabSuspensionGroup.add(arm, housing);
    }

    // 3. Detailed Cab Interior (Dashboard, GPS screen, Rotating Steering Wheel, Driver Seat)
    const dashTex = this.textures.getDashboardTexture();
    const dashBodyGeo = new THREE.BoxGeometry(2.14, 0.46, 0.56);
    const dashBody = new THREE.Mesh(dashBodyGeo, trimMat);
    dashBody.position.set(0, 2.02, 2.58);
    cabSuspensionGroup.add(dashBody);

    const clusterGeo = new THREE.PlaneGeometry(0.76, 0.26);
    const clusterMat = new THREE.MeshBasicMaterial({ map: dashTex });
    const cluster = new THREE.Mesh(clusterGeo, clusterMat);
    cluster.position.set(0.62, 2.16, 2.29);
    cluster.rotation.y = Math.PI;
    cluster.rotation.x = 0.25;
    cabSuspensionGroup.add(cluster);

    // Center GPS unit glow
    const gpsGeo = new THREE.PlaneGeometry(0.32, 0.2);
    const gpsMat = new THREE.MeshBasicMaterial({ color: '#0ea5e9' });
    const gpsMesh = new THREE.Mesh(gpsGeo, gpsMat);
    gpsMesh.position.set(0.05, 2.12, 2.29);
    gpsMesh.rotation.y = Math.PI;
    cabSuspensionGroup.add(gpsMesh);

    // Steering wheel assembly (LHD on +X = 0.62)
    const steeringWheel = new THREE.Group();
    steeringWheel.position.set(0.62, 2.14, 2.18);
    steeringWheel.rotation.x = -0.45;
    const rimTorusGeo = new THREE.TorusGeometry(0.21, 0.025, 8, 20);
    const steeringRim = new THREE.Mesh(rimTorusGeo, trimMat);
    const spokeGeo = new THREE.BoxGeometry(0.38, 0.035, 0.02);
    const spoke1 = new THREE.Mesh(spokeGeo, trimMat);
    const spoke2 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.18, 0.02), trimMat);
    spoke2.position.y = -0.09;
    const hubGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.04, 12);
    hubGeo.rotateX(Math.PI / 2);
    const hub = new THREE.Mesh(hubGeo, chromeMat);
    steeringWheel.add(steeringRim, spoke1, spoke2, hub);
    cabSuspensionGroup.add(steeringWheel);

    // 4. Tractor Wheels (Front steered axle + 2 Rear drive/tag axles)
    const wheelRadius = 0.52;
    const tireGeo = new THREE.CylinderGeometry(wheelRadius, wheelRadius, 0.34, 18);
    tireGeo.rotateZ(Math.PI / 2);
    const hubRimGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.36, 12);
    hubRimGeo.rotateZ(Math.PI / 2);

    const createWheel = (isDual: boolean): THREE.Group => {
      const g = new THREE.Group();
      const tire = new THREE.Mesh(tireGeo, tireMat);
      tire.castShadow = true;
      const rim = new THREE.Mesh(hubRimGeo, rimMat);
      g.add(tire, rim);
      if (isDual) {
        const inner = new THREE.Mesh(tireGeo, tireMat);
        inner.position.x = 0.26;
        g.add(inner);
      }
      return g;
    };

    const frontWheelSteerPivots: THREE.Group[] = [];
    const tractorWheelSpinMeshes: THREE.Object3D[] = [];

    // Front axle z = +1.85
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 1.04, wheelRadius, 1.85);
      const wheel = createWheel(false);
      pivot.add(wheel);
      tractorRoot.add(pivot);
      frontWheelSteerPivots.push(pivot);
      tractorWheelSpinMeshes.push(wheel);
    }

    // Dual rear axles at z = -1.15 and z = -2.35
    for (const rz of [-1.15, -2.35]) {
      for (const side of [-1, 1]) {
        const wheel = createWheel(false);
        wheel.position.set(side * 1.04, wheelRadius, rz);
        tractorRoot.add(wheel);
        tractorWheelSpinMeshes.push(wheel);
      }
    }

    // 5. Semi-Trailer (13.6m length, kingpin at local z = +5.2m)
    const trailerRoot = new THREE.Group();
    trailerRoot.name = 'SemiTrailer';

    const trailerFrameGeo = new THREE.BoxGeometry(2.15, 0.24, 13.2);
    const trailerFrame = new THREE.Mesh(trailerFrameGeo, darkChassisMat);
    trailerFrame.position.set(0, 1.08, 0);
    trailerFrame.castShadow = true;
    trailerRoot.add(trailerFrame);

    const containerTex = this.textures.getContainerTexture('#e2e8f0', 'EUROHAUL CARGO');
    const containerMat = new THREE.MeshStandardMaterial({
      map: containerTex,
      roughness: 0.5,
      metalness: 0.22,
    });
    const containerGeo = new THREE.BoxGeometry(2.5, 2.75, 13.4);
    const trailerContainerMesh = new THREE.Mesh(containerGeo, containerMat);
    trailerContainerMesh.position.set(0, 2.58, 0);
    trailerContainerMesh.castShadow = true;
    trailerContainerMesh.receiveShadow = true;
    trailerRoot.add(trailerContainerMesh);

    // Kingpin cylinder under trailer nose
    const kingpinGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.34, 10);
    const kingpin = new THREE.Mesh(kingpinGeo, chromeMat);
    kingpin.position.set(0, 0.88, 5.2);
    trailerRoot.add(kingpin);

    // Trailer landing gear legs (lowered when detached)
    const trailerLandingGear = new THREE.Group();
    trailerLandingGear.position.set(0, 0.56, 3.3);
    const legGeo = new THREE.BoxGeometry(0.14, 0.95, 0.14);
    const footGeo = new THREE.BoxGeometry(0.32, 0.08, 0.32);
    for (const lx of [-0.78, 0.78]) {
      const leg = new THREE.Mesh(legGeo, darkChassisMat);
      const foot = new THREE.Mesh(footGeo, darkChassisMat);
      foot.position.y = -0.48;
      leg.position.x = lx;
      foot.position.x = lx;
      trailerLandingGear.add(leg, foot);
    }
    trailerLandingGear.position.y = 0.85; // Raised initially when attached
    trailerRoot.add(trailerLandingGear);

    // Trailer rear bumper & taillights
    const trRearGeo = new THREE.BoxGeometry(2.42, 0.24, 0.2);
    const trRear = new THREE.Mesh(trRearGeo, trimMat);
    trRear.position.set(0, 0.72, -6.66);
    trailerRoot.add(trRear);

    const trBrakeL = new THREE.Mesh(lampSmallGeo, brakeMat);
    trBrakeL.position.set(0.86, 0.72, -6.76);
    const trBrakeR = new THREE.Mesh(lampSmallGeo, brakeMat);
    trBrakeR.position.set(-0.86, 0.72, -6.76);
    const trSigL = new THREE.Mesh(lampSmallGeo, leftSignalMat);
    trSigL.position.set(1.08, 0.72, -6.76);
    const trSigR = new THREE.Mesh(lampSmallGeo, rightSignalMat);
    trSigR.position.set(-1.08, 0.72, -6.76);
    trailerRoot.add(trBrakeL, trBrakeR, trSigL, trSigR);

    // Triple trailer axles near rear (z = -3.4, -4.5, -5.6)
    const trailerWheelSpinMeshes: THREE.Object3D[] = [];
    for (const tz of [-3.4, -4.5, -5.6]) {
      for (const side of [-1, 1]) {
        const wheel = createWheel(false);
        wheel.position.set(side * 1.05, wheelRadius, tz);
        trailerRoot.add(wheel);
        trailerWheelSpinMeshes.push(wheel);
      }
    }

    disposables.push(
      railGeo,
      deckGeo,
      fifthWheelGeo,
      tankGeo,
      bumperGeo,
      mudguardGeo,
      rearBarGeo,
      lampSmallGeo,
      headLampGeo,
      beamGeo,
      beamMat,
      cabLowerGeo,
      grilleGeo,
      slatGeo,
      cabBackGeo,
      cabRoofGeo,
      spoilerGeo,
      visorGeo,
      markerGeo,
      markerMat,
      pillarGeo,
      sideLowerDoorGeo,
      windshieldGeo,
      mirrorArmGeo,
      mirrorHousingGeo,
      dashBodyGeo,
      clusterGeo,
      clusterMat,
      gpsGeo,
      gpsMat,
      rimTorusGeo,
      spokeGeo,
      hubGeo,
      tireGeo,
      hubRimGeo,
      trailerFrameGeo,
      containerMat,
      containerGeo,
      kingpinGeo,
      legGeo,
      footGeo,
      trRearGeo
    );

    const setPaintColor = (hex: string): void => {
      paintMat.color.set(hex);
    };

    const setTrailerCargoVisual = (colorHex: string, label: string): void => {
      containerMat.map = this.textures.getContainerTexture(colorHex, label);
      containerMat.needsUpdate = true;
    };

    const updateLights = (opts: {
      headlightMode: HeadlightMode;
      nightFactor: number;
      braking: boolean;
      reversing: boolean;
      leftBlinkerLit: boolean;
      rightBlinkerLit: boolean;
    }): void => {
      const mode = opts.headlightMode;
      headlightEmissiveMat.emissiveIntensity = mode === 0 ? 0.08 : mode === 1 ? 1.4 : 2.5;
      spotLight.intensity = mode === 0 ? 0 : mode === 1 ? 35 + opts.nightFactor * 45 : 70 + opts.nightFactor * 90;
      spotLight.distance = mode === 2 ? 115 : 75;
      beamMat.opacity = mode === 0 ? 0 : (mode === 1 ? 0.06 : 0.12) * (0.35 + opts.nightFactor * 0.85);

      brakeMat.emissiveIntensity = opts.braking ? 2.2 : mode > 0 ? 0.55 : 0.12;
      reverseMat.emissiveIntensity = opts.reversing ? 1.8 : 0.0;
      leftSignalMat.emissiveIntensity = opts.leftBlinkerLit ? 2.4 : 0.0;
      rightSignalMat.emissiveIntensity = opts.rightBlinkerLit ? 2.4 : 0.0;
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
      updateLights,
      dispose,
    };
  }
}
