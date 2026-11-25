import * as THREE from 'three';
import { PbrTextureSet, ProceduralTextures } from '../graphics/ProceduralTextures';
import { HeadlightMode, WipersMode } from '../store/useGameStore';

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
  setBlobShadowVisible: (visible: boolean) => void;
  setPbrDetailEnabled: (enabled: boolean) => void;
  updateWipers: (elapsedSec: number, mode: WipersMode) => void;
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
      color: '#222b38',
      roughness: 0.65,
      metalness: 0.48,
    });
    const chromeMat = new THREE.MeshStandardMaterial({
      color: '#e2e8f0',
      roughness: 0.14,
      metalness: 0.92,
      envMapIntensity: 1.3,
    });
    const aluminumMat = new THREE.MeshStandardMaterial({
      color: '#cbd5e1',
      roughness: 0.28,
      metalness: 0.85,
      envMapIntensity: 1.1,
    });
    const trimMat = new THREE.MeshStandardMaterial({
      color: '#1e2736',
      roughness: 0.62,
      metalness: 0.22,
    });
    // Interior soft-touch charcoal/slate materials (never pitch black!)
    const cabCharcoalMat = new THREE.MeshStandardMaterial({
      color: '#3b4656',
      roughness: 0.72,
      metalness: 0.1,
      emissive: '#1e293b',
      emissiveIntensity: 0.32,
    });
    const cabLeatherMat = new THREE.MeshStandardMaterial({
      color: '#4c586b',
      roughness: 0.64,
      metalness: 0.08,
      emissive: '#263348',
      emissiveIntensity: 0.36,
    });
    const cabHeadlinerMat = new THREE.MeshStandardMaterial({
      color: '#64748b',
      roughness: 0.82,
      metalness: 0.04,
      emissive: '#334155',
      emissiveIntensity: 0.38,
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

    disposables.push(
      paintMat,
      darkChassisMat,
      chromeMat,
      aluminumMat,
      trimMat,
      cabCharcoalMat,
      cabLeatherMat,
      cabHeadlinerMat,
      glassMat,
      tireMat,
      rimMat,
      drlMat,
      headlightEmissiveMat,
      fogLampMat,
      brakeMat,
      reverseMat,
      leftSignalMat,
      rightSignalMat
    );

    // 1. Chassis Frame, Fifth Wheel, Aluminum Fuel Tanks, Air Tanks & Catwalk
    const railGeo = new THREE.BoxGeometry(0.16, 0.28, 6.25);
    for (const rx of [-0.46, 0.46]) {
      const rail = new THREE.Mesh(railGeo, darkChassisMat);
      rail.position.set(rx, 0.68, -0.15);
      rail.castShadow = true;
      tractorRoot.add(rail);
    }

    const deckGeo = new THREE.BoxGeometry(1.18, 0.12, 2.8);
    const deck = new THREE.Mesh(deckGeo, aluminumMat);
    deck.position.set(0, 0.85, -1.75);
    tractorRoot.add(deck);

    const fifthWheelGeo = new THREE.CylinderGeometry(0.5, 0.54, 0.14, 16);
    const fifthWheel = new THREE.Mesh(fifthWheelGeo, darkChassisMat);
    fifthWheel.position.set(0, 0.96, -1.65);
    tractorRoot.add(fifthWheel);

    // Brushed aluminum cylindrical/D-shaped fuel tanks + black mounting straps
    const fuelTankGeo = new THREE.CylinderGeometry(0.32, 0.32, 1.88, 12);
    fuelTankGeo.rotateX(Math.PI / 2);
    const strapGeo = new THREE.TorusGeometry(0.33, 0.025, 6, 14);
    for (const tx of [-0.88, 0.88]) {
      const tank = new THREE.Mesh(fuelTankGeo, aluminumMat);
      tank.position.set(tx, 0.64, -0.35);
      tank.castShadow = true;
      tractorRoot.add(tank);
      for (const sz of [-0.9, 0.2]) {
        const strap = new THREE.Mesh(strapGeo, trimMat);
        strap.position.set(tx, 0.64, sz);
        tractorRoot.add(strap);
      }
    }

    // Compressed air tanks tucked inside rear frame
    const airTankGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.72, 10);
    airTankGeo.rotateZ(Math.PI / 2);
    for (const az of [0.15, 0.42]) {
      const at = new THREE.Mesh(airTankGeo, darkChassisMat);
      at.position.set(0, 0.56, az);
      tractorRoot.add(at);
    }

    // Sculpted front bumper with recessed fog lights & air intake dam
    const bumperGeo = new THREE.BoxGeometry(2.48, 0.44, 0.48);
    const bumper = new THREE.Mesh(bumperGeo, trimMat);
    bumper.position.set(0, 0.56, 2.88);
    bumper.castShadow = true;
    tractorRoot.add(bumper);

    const bumperLipGeo = new THREE.BoxGeometry(2.38, 0.1, 0.52);
    const bumperLip = new THREE.Mesh(bumperLipGeo, paintMat);
    bumperLip.position.set(0, 0.36, 2.9);
    tractorRoot.add(bumperLip);

    // Fog lamps in lower bumper
    const fogGeo = new THREE.BoxGeometry(0.24, 0.11, 0.08);
    for (const fx of [-0.88, 0.88]) {
      const fog = new THREE.Mesh(fogGeo, fogLampMat);
      fog.position.set(fx, 0.48, 3.12);
      tractorRoot.add(fog);
    }

    // Rear wheel arches / mudguards & rear taillight bar
    const mudguardGeo = new THREE.BoxGeometry(0.65, 0.2, 2.75);
    for (const mx of [-0.94, 0.94]) {
      const mg = new THREE.Mesh(mudguardGeo, trimMat);
      mg.position.set(mx, 1.07, -1.72);
      tractorRoot.add(mg);
    }

    const rearBarGeo = new THREE.BoxGeometry(2.38, 0.24, 0.18);
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

    // Headlight pods + LED DRL strips + additive halo sprites + SpotLight
    const headLampGeo = new THREE.BoxGeometry(0.38, 0.18, 0.1);
    const drlGeo = new THREE.BoxGeometry(0.42, 0.05, 0.11);
    const hlL = new THREE.Mesh(headLampGeo, headlightEmissiveMat);
    hlL.position.set(0.9, 0.72, 3.09);
    const hlR = new THREE.Mesh(headLampGeo, headlightEmissiveMat);
    hlR.position.set(-0.9, 0.72, 3.09);
    const drlL = new THREE.Mesh(drlGeo, drlMat);
    drlL.position.set(0.9, 0.83, 3.09);
    const drlR = new THREE.Mesh(drlGeo, drlMat);
    drlR.position.set(-0.9, 0.83, 3.09);
    const fSigL = new THREE.Mesh(lampSmallGeo, leftSignalMat);
    fSigL.position.set(1.15, 0.72, 3.07);
    const fSigR = new THREE.Mesh(lampSmallGeo, rightSignalMat);
    fSigR.position.set(-1.15, 0.72, 3.07);
    tractorRoot.add(hlL, hlR, drlL, drlR, fSigL, fSigR);

    // Lightweight additive headlight glow flares (replaces heavy Bloom!)
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
    const glowR = new THREE.Mesh(glowGeo, glowMat);
    glowR.position.set(-0.9, 0.72, 3.16);
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
    const beamR = new THREE.Mesh(beamGeo, beamMat);
    beamR.position.set(-0.9, 0.74, 3.16);
    beamR.rotation.x = 0.06;
    tractorRoot.add(beamL, beamR);

    const spotLight = new THREE.SpotLight('#fffbeb', 0, 80, Math.PI / 4.2, 0.48, 1.35);
    spotLight.position.set(0, 1.05, 3.12);
    const spotTarget = new THREE.Object3D();
    spotTarget.position.set(0, 0.1, 26);
    tractorRoot.add(spotLight, spotTarget);
    spotLight.target = spotTarget;

    // 2. Cab Suspension Group (Exterior Body + Stacks + Aero + Lit Interior)
    const cabLowerGeo = new THREE.BoxGeometry(2.44, 1.05, 2.38);
    const cabLower = new THREE.Mesh(cabLowerGeo, paintMat);
    cabLower.position.set(0, 1.38, 1.78);
    cabLower.castShadow = true;
    cabSuspensionGroup.add(cabLower);

    // Layered radiator grille + chrome slats + central V-emblem bar
    const grilleUpperGeo = new THREE.BoxGeometry(1.78, 0.56, 0.12);
    const grilleUpper = new THREE.Mesh(grilleUpperGeo, trimMat);
    grilleUpper.position.set(0, 1.62, 2.98);
    const grilleLowerGeo = new THREE.BoxGeometry(1.56, 0.34, 0.12);
    const grilleLower = new THREE.Mesh(grilleLowerGeo, trimMat);
    grilleLower.position.set(0, 1.12, 2.98);
    cabSuspensionGroup.add(grilleUpper, grilleLower);

    const slatGeo = new THREE.BoxGeometry(1.62, 0.055, 0.15);
    for (let i = 0; i < 4; i++) {
      const slat = new THREE.Mesh(slatGeo, chromeMat);
      slat.position.set(0, 1.14 + i * 0.21, 3.0);
      cabSuspensionGroup.add(slat);
    }
    const emblemGeo = new THREE.BoxGeometry(0.44, 0.12, 0.16);
    const emblem = new THREE.Mesh(emblemGeo, chromeMat);
    emblem.position.set(0, 1.62, 3.01);
    cabSuspensionGroup.add(emblem);

    // Door handles & two-tier boarding steps
    const handleGeo = new THREE.BoxGeometry(0.06, 0.08, 0.24);
    const stepGeo = new THREE.BoxGeometry(0.24, 0.06, 0.56);
    for (const side of [-1, 1]) {
      const handle = new THREE.Mesh(handleGeo, trimMat);
      handle.position.set(side * 1.24, 1.72, 1.86);
      cabSuspensionGroup.add(handle);
      for (const sy of [0.58, 0.86]) {
        const step = new THREE.Mesh(stepGeo, aluminumMat);
        step.position.set(side * 1.14, sy, 2.22);
        cabSuspensionGroup.add(step);
      }
    }

    // Cab back wall (painted outside, soft charcoal inside) + vertical chrome exhaust stacks
    const cabBackGeo = new THREE.BoxGeometry(2.44, 1.45, 0.82);
    const cabBack = new THREE.Mesh(cabBackGeo, paintMat);
    cabBack.position.set(0, 2.58, 1.0);
    cabBack.castShadow = true;
    cabSuspensionGroup.add(cabBack);

    const cabBackInnerGeo = new THREE.PlaneGeometry(2.18, 1.32);
    const cabBackInner = new THREE.Mesh(cabBackInnerGeo, cabCharcoalMat);
    cabBackInner.position.set(0, 2.58, 1.42);
    cabSuspensionGroup.add(cabBackInner);

    // Vertical twin chrome exhaust stacks behind cab
    const stackGeo = new THREE.CylinderGeometry(0.085, 0.095, 2.35, 10);
    const stackTipGeo = new THREE.CylinderGeometry(0.105, 0.085, 0.28, 10);
    for (const sx of [-1.06, 1.06]) {
      const stack = new THREE.Mesh(stackGeo, chromeMat);
      stack.position.set(sx, 2.35, 0.52);
      stack.castShadow = true;
      const tip = new THREE.Mesh(stackTipGeo, chromeMat);
      tip.position.set(sx, 3.58, 0.48);
      tip.rotation.x = -0.25;
      cabSuspensionGroup.add(stack, tip);
    }

    // Cab roof + interior headliner + aerodynamic fairing + lightbox
    const cabRoofGeo = new THREE.BoxGeometry(2.42, 0.22, 2.34);
    const cabRoof = new THREE.Mesh(cabRoofGeo, paintMat);
    cabRoof.position.set(0, 3.34, 1.76);
    cabRoof.castShadow = true;
    cabSuspensionGroup.add(cabRoof);

    const headlinerGeo = new THREE.PlaneGeometry(2.18, 1.9);
    const headliner = new THREE.Mesh(headlinerGeo, cabHeadlinerMat);
    headliner.rotation.x = Math.PI / 2;
    headliner.position.set(0, 3.22, 1.82);
    cabSuspensionGroup.add(headliner);

    const spoilerGeo = new THREE.BoxGeometry(2.36, 0.44, 0.96);
    const spoiler = new THREE.Mesh(spoilerGeo, paintMat);
    spoiler.position.set(0, 3.56, 1.08);
    spoiler.rotation.x = 0.22;
    cabSuspensionGroup.add(spoiler);

    // Roof lightbox badge & sleek exterior sun visor
    const lightboxGeo = new THREE.BoxGeometry(1.42, 0.24, 0.14);
    const lightboxMat = new THREE.MeshStandardMaterial({
      color: '#f8fafc',
      emissive: '#fef3c7',
      emissiveIntensity: 0.72,
    });
    const lightbox = new THREE.Mesh(lightboxGeo, lightboxMat);
    lightbox.position.set(0, 3.46, 2.74);
    cabSuspensionGroup.add(lightbox);

    const visorGeo = new THREE.BoxGeometry(2.42, 0.16, 0.34);
    const visor = new THREE.Mesh(visorGeo, trimMat);
    visor.position.set(0, 3.17, 2.95);
    visor.rotation.x = 0.22;
    cabSuspensionGroup.add(visor);

    const markerGeo = new THREE.BoxGeometry(0.16, 0.075, 0.08);
    const markerMat = new THREE.MeshStandardMaterial({
      color: '#fbbf24',
      emissive: '#f59e0b',
      emissiveIntensity: 1.0,
    });
    for (const mx of [-0.82, -0.41, 0, 0.41, 0.82]) {
      const mk = new THREE.Mesh(markerGeo, markerMat);
      mk.position.set(mx, 3.24, 3.08);
      cabSuspensionGroup.add(mk);
    }

    // Slim A-pillars (0.08m wide so forward view is unobstructed!)
    const pillarGeo = new THREE.BoxGeometry(0.08, 1.24, 0.11);
    for (const px of [-1.17, 1.17]) {
      const aPillar = new THREE.Mesh(pillarGeo, trimMat);
      aPillar.position.set(px, 2.6, 2.86);
      aPillar.rotation.x = -0.08;
      cabSuspensionGroup.add(aPillar);
    }

    // Side door lower trims & interior door panels
    const sideLowerDoorGeo = new THREE.BoxGeometry(0.12, 0.48, 1.45);
    for (const sx of [-1.17, 1.17]) {
      const sDoor = new THREE.Mesh(sideLowerDoorGeo, paintMat);
      sDoor.position.set(sx, 2.08, 2.12);
      cabSuspensionGroup.add(sDoor);
    }

    // Reflective tinted windshield + animated dual wiper blades pivoted at base
    const windshieldGeo = new THREE.PlaneGeometry(2.24, 1.18);
    const windshield = new THREE.Mesh(windshieldGeo, glassMat);
    windshield.position.set(0, 2.6, 2.89);
    windshield.rotation.x = -0.08;
    cabSuspensionGroup.add(windshield);

    const wiperGeo = new THREE.BoxGeometry(0.76, 0.03, 0.04);
    const wiperPivots: THREE.Group[] = [];
    for (const wx of [-0.1, 0.72]) {
      const pivot = new THREE.Group();
      pivot.position.set(wx, 2.04, 2.94);
      const blade = new THREE.Mesh(wiperGeo, trimMat);
      blade.position.set(-0.36, 0.04, 0);
      pivot.add(blade);
      pivot.rotation.z = -0.06;
      cabSuspensionGroup.add(pivot);
      wiperPivots.push(pivot);
    }

    // Sleek exterior mirrors positioned clear of forward sightlines
    const mirrorArmGeo = new THREE.BoxGeometry(0.26, 0.055, 0.055);
    const mirrorHousingGeo = new THREE.BoxGeometry(0.16, 0.48, 0.2);
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(mirrorArmGeo, trimMat);
      arm.position.set(side * 1.34, 2.62, 2.74);
      const housing = new THREE.Mesh(mirrorHousingGeo, trimMat);
      housing.position.set(side * 1.46, 2.52, 2.74);
      cabSuspensionGroup.add(arm, housing);
    }

    // 3. Detailed Lit Cab Interior (Charcoal Dash, Dynamic Gauges, GPS, Multi-Function Steering Wheel, Seats)
    const dashTex = this.textures.getDynamicDashboardTexture();
    const dashBodyGeo = new THREE.BoxGeometry(2.16, 0.44, 0.54);
    const dashBody = new THREE.Mesh(dashBodyGeo, cabCharcoalMat);
    dashBody.position.set(0, 1.98, 2.58);
    cabSuspensionGroup.add(dashBody);

    // Hood / cowl rim visible through lower windshield
    const cowlGeo = new THREE.BoxGeometry(2.18, 0.08, 0.38);
    const cowl = new THREE.Mesh(cowlGeo, cabLeatherMat);
    cowl.position.set(0, 2.18, 2.72);
    cabSuspensionGroup.add(cowl);

    // Dynamic glowing instrument cluster (raised slightly so it sits clearly above bottom HUD)
    const clusterGeo = new THREE.PlaneGeometry(0.72, 0.25);
    const clusterMat = new THREE.MeshBasicMaterial({ map: dashTex });
    const cluster = new THREE.Mesh(clusterGeo, clusterMat);
    cluster.position.set(0.58, 2.27, 2.33);
    cluster.rotation.y = Math.PI;
    cluster.rotation.x = 0.22;
    cabSuspensionGroup.add(cluster);

    // Live SatNav GPS unit mounted cleanly on left A-pillar dash corner (clear of HUD Route Advisor!)
    const gpsTex = this.textures.getDynamicCabGpsTexture();
    const gpsGroup = new THREE.Group();
    gpsGroup.position.set(0.95, 2.41, 2.42);
    gpsGroup.rotation.y = Math.PI - 0.34;
    const gpsBezelGeo = new THREE.BoxGeometry(0.36, 0.23, 0.04);
    const gpsBezel = new THREE.Mesh(gpsBezelGeo, trimMat);
    const gpsGeo = new THREE.PlaneGeometry(0.32, 0.19);
    const gpsMat = new THREE.MeshBasicMaterial({ map: gpsTex });
    const gpsMesh = new THREE.Mesh(gpsGeo, gpsMat);
    gpsMesh.position.z = 0.025;
    gpsGroup.add(gpsBezel, gpsMesh);
    cabSuspensionGroup.add(gpsGroup);

    // Driver & Passenger seats (adds richness in chase & orbit views)
    const seatGeo = new THREE.BoxGeometry(0.56, 0.92, 0.48);
    for (const sx of [-0.58, 0.58]) {
      const seat = new THREE.Mesh(seatGeo, cabLeatherMat);
      seat.position.set(sx, 2.12, 1.72);
      cabSuspensionGroup.add(seat);
    }

    // 4-Spoke European Multi-Function Steering Wheel (LHD on +X = 0.58)
    const steeringColumnGeo = new THREE.CylinderGeometry(0.055, 0.065, 0.28, 10);
    steeringColumnGeo.rotateX(Math.PI / 2 - 0.36);
    const steeringColumn = new THREE.Mesh(steeringColumnGeo, cabCharcoalMat);
    steeringColumn.position.set(0.58, 2.17, 2.27);
    cabSuspensionGroup.add(steeringColumn);

    const steeringWheel = new THREE.Group();
    steeringWheel.position.set(0.58, 2.26, 2.17);
    steeringWheel.rotation.x = -0.36;
    const rimTorusGeo = new THREE.TorusGeometry(0.21, 0.026, 8, 24);
    const steeringRim = new THREE.Mesh(rimTorusGeo, cabLeatherMat);
    const spokeGeo = new THREE.BoxGeometry(0.39, 0.042, 0.022);
    const spokeH = new THREE.Mesh(spokeGeo, cabCharcoalMat);
    const spokeLowerGeo = new THREE.BoxGeometry(0.055, 0.19, 0.022);
    const spokeV = new THREE.Mesh(spokeLowerGeo, chromeMat);
    spokeV.position.y = -0.1;
    const hubGeo = new THREE.CylinderGeometry(0.065, 0.065, 0.045, 14);
    hubGeo.rotateX(Math.PI / 2);
    const hub = new THREE.Mesh(hubGeo, cabCharcoalMat);
    const wheelBadgeGeo = new THREE.CylinderGeometry(0.026, 0.026, 0.05, 12);
    wheelBadgeGeo.rotateX(Math.PI / 2);
    const wheelBadge = new THREE.Mesh(wheelBadgeGeo, chromeMat);
    steeringWheel.add(steeringRim, spokeH, spokeV, hub, wheelBadge);
    cabSuspensionGroup.add(steeringWheel);

    // 4. Tractor Wheels (Front steered axle + 2 Rear drive/tag axles)
    const wheelRadius = 0.52;
    const tireGeo = new THREE.CylinderGeometry(wheelRadius, wheelRadius, 0.34, 18);
    tireGeo.rotateZ(Math.PI / 2);
    const hubRimGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.36, 12);
    hubRimGeo.rotateZ(Math.PI / 2);

    const createWheel = (): THREE.Group => {
      const g = new THREE.Group();
      const tire = new THREE.Mesh(tireGeo, tireMat);
      tire.castShadow = true;
      const rim = new THREE.Mesh(hubRimGeo, rimMat);
      g.add(tire, rim);
      return g;
    };

    const frontWheelSteerPivots: THREE.Group[] = [];
    const tractorWheelSpinMeshes: THREE.Object3D[] = [];

    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 1.04, wheelRadius, 1.85);
      const wheel = createWheel();
      pivot.add(wheel);
      tractorRoot.add(pivot);
      frontWheelSteerPivots.push(pivot);
      tractorWheelSpinMeshes.push(wheel);
    }

    for (const rz of [-1.15, -2.35]) {
      for (const side of [-1, 1]) {
        const wheel = createWheel();
        wheel.position.set(side * 1.04, wheelRadius, rz);
        tractorRoot.add(wheel);
        tractorWheelSpinMeshes.push(wheel);
      }
    }

    // 5. Semi-Trailer (13.6m length, Reefer unit, Underrun guards, PBR Container)
    const trailerRoot = new THREE.Group();
    trailerRoot.name = 'SemiTrailer';

    const trailerFrameGeo = new THREE.BoxGeometry(2.15, 0.24, 13.2);
    const trailerFrame = new THREE.Mesh(trailerFrameGeo, darkChassisMat);
    trailerFrame.position.set(0, 1.08, 0);
    trailerFrame.castShadow = true;
    trailerRoot.add(trailerFrame);

    // Aluminum side underrun protection bars
    const sideGuardGeo = new THREE.BoxGeometry(0.08, 0.14, 5.2);
    for (const gx of [-1.18, 1.18]) {
      for (const gy of [0.58, 0.82]) {
        const guard = new THREE.Mesh(sideGuardGeo, aluminumMat);
        guard.position.set(gx, gy, 0.4);
        trailerRoot.add(guard);
      }
    }

    // Container with dedicated 6-face materials: corrugated sides, clean ribbed roof, and TIR rear double-doors
    let currentContainerPbr: PbrTextureSet = this.textures.getContainerTextures('#e2e8f0', 'EUROHAUL');
    let pbrDetailEnabled = true;

    const containerMat = new THREE.MeshStandardMaterial({
      map: currentContainerPbr.map,
      roughnessMap: currentContainerPbr.roughnessMap,
      bumpMap: currentContainerPbr.bumpMap,
      bumpScale: 0.04,
      roughness: 0.48,
      metalness: 0.24,
    });
    const containerRoofMat = new THREE.MeshStandardMaterial({
      map: this.textures.getContainerRoofTexture('#e2e8f0'),
      roughness: 0.52,
      metalness: 0.18,
    });
    const containerFrontEndMat = new THREE.MeshStandardMaterial({
      color: '#e2e8f0',
      roughness: 0.5,
      metalness: 0.24,
    });
    const containerRearDoorMat = new THREE.MeshStandardMaterial({
      map: this.textures.getContainerRearDoorTexture('#e2e8f0'),
      roughness: 0.45,
      metalness: 0.28,
    });
    const containerGeo = new THREE.BoxGeometry(2.5, 2.75, 13.4);
    const trailerContainerMesh = new THREE.Mesh(containerGeo, [
      containerMat, // +X
      containerMat, // -X
      containerRoofMat, // +Y roof (upright, no logo text!)
      darkChassisMat, // -Y floor underside
      containerFrontEndMat, // +Z front bulkhead
      containerRearDoorMat, // -Z TIR double rear doors
    ]);
    trailerContainerMesh.position.set(0, 2.58, 0);
    trailerContainerMesh.castShadow = true;
    trailerContainerMesh.receiveShadow = true;
    trailerRoot.add(trailerContainerMesh);

    // Front Reefer refrigeration unit mounted above kingpin bulkhead
    const reeferBodyGeo = new THREE.BoxGeometry(1.75, 1.18, 0.56);
    const reeferMat = new THREE.MeshStandardMaterial({ color: '#f1f5f9', roughness: 0.42 });
    const reeferUnit = new THREE.Mesh(reeferBodyGeo, reeferMat);
    reeferUnit.position.set(0, 3.05, 6.95);
    reeferUnit.castShadow = true;
    const reeferGrilleGeo = new THREE.BoxGeometry(1.18, 0.66, 0.6);
    const reeferGrille = new THREE.Mesh(reeferGrilleGeo, trimMat);
    reeferGrille.position.set(0, 3.05, 6.96);
    trailerRoot.add(reeferUnit, reeferGrille);

    // Kingpin & landing gear legs
    const kingpinGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.34, 10);
    const kingpin = new THREE.Mesh(kingpinGeo, chromeMat);
    kingpin.position.set(0, 0.88, 5.2);
    trailerRoot.add(kingpin);

    const trailerLandingGear = new THREE.Group();
    trailerLandingGear.position.set(0, 0.85, 3.3);
    const legGeo = new THREE.BoxGeometry(0.14, 0.95, 0.14);
    const footGeo = new THREE.BoxGeometry(0.32, 0.08, 0.32);
    const braceGeo = new THREE.BoxGeometry(1.56, 0.08, 0.08);
    const brace = new THREE.Mesh(braceGeo, darkChassisMat);
    brace.position.y = -0.15;
    trailerLandingGear.add(brace);
    for (const lx of [-0.78, 0.78]) {
      const leg = new THREE.Mesh(legGeo, darkChassisMat);
      const foot = new THREE.Mesh(footGeo, darkChassisMat);
      foot.position.y = -0.48;
      leg.position.x = lx;
      foot.position.x = lx;
      trailerLandingGear.add(leg, foot);
    }
    trailerRoot.add(trailerLandingGear);

    // Trailer rear wheel fenders & underrun bumper + full taillight cluster
    const trFenderGeo = new THREE.BoxGeometry(0.58, 0.16, 3.4);
    for (const fx of [-1.05, 1.05]) {
      const f = new THREE.Mesh(trFenderGeo, trimMat);
      f.position.set(fx, 1.08, -4.5);
      trailerRoot.add(f);
    }

    const trRearGeo = new THREE.BoxGeometry(2.44, 0.24, 0.22);
    const trRear = new THREE.Mesh(trRearGeo, aluminumMat);
    trRear.position.set(0, 0.68, -6.68);
    trailerRoot.add(trRear);

    const trBrakeL = new THREE.Mesh(lampSmallGeo, brakeMat);
    trBrakeL.position.set(0.86, 0.68, -6.78);
    const trBrakeR = new THREE.Mesh(lampSmallGeo, brakeMat);
    trBrakeR.position.set(-0.86, 0.68, -6.78);
    const trSigL = new THREE.Mesh(lampSmallGeo, leftSignalMat);
    trSigL.position.set(1.08, 0.68, -6.78);
    const trSigR = new THREE.Mesh(lampSmallGeo, rightSignalMat);
    trSigR.position.set(-1.08, 0.68, -6.78);
    const trRevL = new THREE.Mesh(lampSmallGeo, reverseMat);
    trRevL.position.set(0.62, 0.68, -6.78);
    const trRevR = new THREE.Mesh(lampSmallGeo, reverseMat);
    trRevR.position.set(-0.62, 0.68, -6.78);
    trailerRoot.add(trBrakeL, trBrakeR, trSigL, trSigR, trRevL, trRevR);

    // Triple trailer axles
    const trailerWheelSpinMeshes: THREE.Object3D[] = [];
    for (const tz of [-3.4, -4.5, -5.6]) {
      for (const side of [-1, 1]) {
        const wheel = createWheel();
        wheel.position.set(side * 1.05, wheelRadius, tz);
        trailerRoot.add(wheel);
        trailerWheelSpinMeshes.push(wheel);
      }
    }

    // 6. Fake Blob Shadows (used on mobile_fast when real-time shadowMap is off)
    const blobTex = this.textures.getBlobShadowTexture();
    const blobMat = new THREE.MeshBasicMaterial({
      map: blobTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.75,
    });
    const tractorBlobGeo = new THREE.PlaneGeometry(3.6, 7.6);
    const tractorBlob = new THREE.Mesh(tractorBlobGeo, blobMat);
    tractorBlob.rotation.x = -Math.PI / 2;
    tractorBlob.position.set(0, 0.06, -0.1);
    tractorBlob.visible = false;
    tractorRoot.add(tractorBlob);

    const trailerBlobGeo = new THREE.PlaneGeometry(3.6, 14.6);
    const trailerBlob = new THREE.Mesh(trailerBlobGeo, blobMat);
    trailerBlob.rotation.x = -Math.PI / 2;
    trailerBlob.position.set(0, 0.06, 0);
    trailerBlob.visible = false;
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
      rearBarGeo,
      lampSmallGeo,
      headLampGeo,
      drlGeo,
      glowMat,
      glowGeo,
      beamGeo,
      beamMat,
      cabLowerGeo,
      grilleUpperGeo,
      grilleLowerGeo,
      slatGeo,
      emblemGeo,
      handleGeo,
      stepGeo,
      cabBackGeo,
      cabBackInnerGeo,
      stackGeo,
      stackTipGeo,
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
      containerRoofMat,
      containerFrontEndMat,
      containerRearDoorMat,
      containerGeo,
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

    const setTrailerCargoVisual = (colorHex: string, label: string): void => {
      currentContainerPbr = this.textures.getContainerTextures(colorHex, label);
      containerRoofMat.map = this.textures.getContainerRoofTexture(colorHex);
      containerRoofMat.needsUpdate = true;
      containerFrontEndMat.color.set(colorHex);
      containerRearDoorMat.map = this.textures.getContainerRearDoorTexture(colorHex);
      containerRearDoorMat.needsUpdate = true;
      applyContainerPbr();
    };

    const setBlobShadowVisible = (visible: boolean): void => {
      tractorBlob.visible = visible;
      trailerBlob.visible = visible;
    };

    const setPbrDetailEnabled = (enabled: boolean): void => {
      pbrDetailEnabled = enabled;
      applyContainerPbr();
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
      braking: boolean;
      reversing: boolean;
      leftBlinkerLit: boolean;
      rightBlinkerLit: boolean;
    }): void => {
      const mode = opts.headlightMode;
      drlMat.emissiveIntensity = mode === 0 ? 0.85 : 1.55;
      headlightEmissiveMat.emissiveIntensity = mode === 0 ? 0.12 : mode === 1 ? 1.65 : 2.8;
      fogLampMat.emissiveIntensity = mode === 2 ? 1.4 : mode === 1 ? 0.55 : 0.1;
      glowMat.opacity = mode === 0 ? 0 : (mode === 1 ? 0.35 : 0.62) * (0.4 + opts.nightFactor * 0.6);
      spotLight.intensity = mode === 0 ? 0 : mode === 1 ? 38 + opts.nightFactor * 48 : 75 + opts.nightFactor * 95;
      spotLight.distance = mode === 2 ? 120 : 80;
      beamMat.opacity = mode === 0 ? 0 : (mode === 1 ? 0.06 : 0.12) * (0.35 + opts.nightFactor * 0.85);

      brakeMat.emissiveIntensity = opts.braking ? 2.4 : mode > 0 ? 0.6 : 0.14;
      reverseMat.emissiveIntensity = opts.reversing ? 2.0 : 0.0;
      leftSignalMat.emissiveIntensity = opts.leftBlinkerLit ? 2.6 : 0.0;
      rightSignalMat.emissiveIntensity = opts.rightBlinkerLit ? 2.6 : 0.0;
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
      updateLights,
      dispose,
    };
  }
}
