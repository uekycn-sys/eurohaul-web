import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface VehicleModelPair {
  paintGeo: THREE.BufferGeometry;
  detailGeo: THREE.BufferGeometry;
}

interface PartSpec {
  geo: THREE.BufferGeometry;
  matrix?: THREE.Matrix4;
  colorHex?: string;
}

const _tmpMat = new THREE.Matrix4();
const _tmpPos = new THREE.Vector3();
const _tmpQuat = new THREE.Quaternion();
const _tmpEuler = new THREE.Euler();
const _tmpScale = new THREE.Vector3(1, 1, 1);
const _tmpColor = new THREE.Color();

function makeTransform(
  x = 0,
  y = 0,
  z = 0,
  rotX = 0,
  rotY = 0,
  rotZ = 0,
  scaleX = 1,
  scaleY = 1,
  scaleZ = 1
): THREE.Matrix4 {
  _tmpPos.set(x, y, z);
  _tmpEuler.set(rotX, rotY, rotZ, 'YXZ');
  _tmpQuat.setFromEuler(_tmpEuler);
  _tmpScale.set(scaleX, scaleY, scaleZ);
  return _tmpMat.clone().compose(_tmpPos, _tmpQuat, _tmpScale);
}

/**
 * Normalizes mixed indexed/non-indexed BufferGeometries (e.g. Extrude + Box + Cylinder)
 * and merges them into a single draw-call-ready BufferGeometry.
 */
export function mergeNormalizedParts(
  parts: PartSpec[],
  withVertexColors: boolean
): THREE.BufferGeometry {
  const baked: THREE.BufferGeometry[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    let g = part.geo.index ? part.geo.toNonIndexed() : part.geo.clone();
    if (part.matrix) {
      g.applyMatrix4(part.matrix);
    }
    if (g.attributes.uv) {
      g.deleteAttribute('uv');
    }
    g.computeVertexNormals();

    if (withVertexColors) {
      const count = g.attributes.position?.count ?? 0;
      _tmpColor.set(part.colorHex ?? '#ffffff');
      const colors = new Float32Array(count * 3);
      for (let c = 0; c < count; c++) {
        colors[c * 3] = _tmpColor.r;
        colors[c * 3 + 1] = _tmpColor.g;
        colors[c * 3 + 2] = _tmpColor.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }
    baked.push(g);
  }

  const merged = mergeGeometries(baked, false);
  for (let i = 0; i < baked.length; i++) {
    baked[i]!.dispose();
  }
  if (!merged) {
    return new THREE.BoxGeometry(1, 1, 1);
  }
  return merged;
}

function addWheelsToParts(
  parts: PartSpec[],
  disposables: THREE.BufferGeometry[],
  axleZs: number[],
  halfTrack: number,
  radius: number,
  tireWidth: number
): void {
  const tireGeo = new THREE.CylinderGeometry(radius, radius, tireWidth, 12);
  tireGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(radius * 0.62, radius * 0.62, tireWidth + 0.02, 10);
  rimGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(radius * 0.22, radius * 0.22, tireWidth + 0.04, 8);
  hubGeo.rotateZ(Math.PI / 2);
  disposables.push(tireGeo, rimGeo, hubGeo);

  for (const az of axleZs) {
    for (const side of [-1, 1]) {
      const m = makeTransform(side * halfTrack, radius, az);
      parts.push({ geo: tireGeo, matrix: m, colorHex: '#18181b' });
      parts.push({ geo: rimGeo, matrix: m, colorHex: '#cbd5e1' });
      parts.push({ geo: hubGeo, matrix: m, colorHex: '#64748b' });
    }
  }
}

function extrudeSideProfile(
  shape: THREE.Shape,
  bodyWidth: number,
  bevelThickness = 0.06,
  bevelSize = 0.05
): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: bodyWidth,
    bevelEnabled: true,
    bevelThickness,
    bevelSize,
    bevelSegments: 1,
  });
  geo.translate(0, 0, -bodyWidth * 0.5);
  geo.rotateY(-Math.PI / 2);
  return geo;
}

/**
 * European 3-box passenger sedan (~4.55m x 1.84m x 1.44m, ground at y = 0, +Z forward).
 */
export function createSedanGeometries(): VehicleModelPair {
  const disposables: THREE.BufferGeometry[] = [];
  const paintParts: PartSpec[] = [];
  const detailParts: PartSpec[] = [];

  const bodyShape = new THREE.Shape();
  bodyShape.moveTo(-2.16, 0.28);
  bodyShape.lineTo(2.12, 0.28);
  bodyShape.lineTo(2.22, 0.48);
  bodyShape.lineTo(2.14, 0.78);
  bodyShape.lineTo(1.22, 0.90);
  bodyShape.lineTo(0.54, 1.38);
  bodyShape.lineTo(-0.74, 1.38);
  bodyShape.lineTo(-1.46, 0.98);
  bodyShape.lineTo(-2.16, 0.90);
  bodyShape.lineTo(-2.22, 0.52);
  bodyShape.closePath();

  const bodyGeo = extrudeSideProfile(bodyShape, 1.70, 0.065, 0.055);
  const mirrorCapGeo = new THREE.BoxGeometry(0.14, 0.09, 0.16);
  const archFlareGeo = new THREE.BoxGeometry(0.08, 0.14, 0.74);
  disposables.push(bodyGeo, mirrorCapGeo, archFlareGeo);

  paintParts.push({ geo: bodyGeo });
  for (const side of [-1, 1]) {
    paintParts.push({
      geo: mirrorCapGeo,
      matrix: makeTransform(side * 0.96, 0.95, 0.62, 0, side * -0.15, 0),
    });
    for (const az of [1.38, -1.36]) {
      paintParts.push({
        geo: archFlareGeo,
        matrix: makeTransform(side * 0.90, 0.44, az),
      });
    }
  }

  // Windshield, rear glass, side greenhouse & B-pillars
  const windshieldGeo = new THREE.BoxGeometry(1.54, 0.04, 0.80);
  const rearGlassGeo = new THREE.BoxGeometry(1.50, 0.04, 0.78);
  const sideGlassGeo = new THREE.BoxGeometry(0.04, 0.38, 1.66);
  const bPillarGeo = new THREE.BoxGeometry(0.05, 0.40, 0.12);
  const grilleGeo = new THREE.BoxGeometry(1.06, 0.24, 0.06);
  const grilleBarGeo = new THREE.BoxGeometry(1.10, 0.035, 0.08);
  const splitterGeo = new THREE.BoxGeometry(1.76, 0.12, 0.26);
  const rearDiffuserGeo = new THREE.BoxGeometry(1.74, 0.16, 0.22);
  const plateGeo = new THREE.BoxGeometry(0.46, 0.11, 0.03);
  const exhaustGeo = new THREE.CylinderGeometry(0.038, 0.038, 0.12, 8);
  exhaustGeo.rotateX(Math.PI / 2);

  disposables.push(
    windshieldGeo,
    rearGlassGeo,
    sideGlassGeo,
    bPillarGeo,
    grilleGeo,
    grilleBarGeo,
    splitterGeo,
    rearDiffuserGeo,
    plateGeo,
    exhaustGeo
  );

  detailParts.push({
    geo: windshieldGeo,
    matrix: makeTransform(0, 1.16, 0.90, 0.60, 0, 0),
    colorHex: '#172536',
  });
  detailParts.push({
    geo: rearGlassGeo,
    matrix: makeTransform(0, 1.19, -1.10, -0.50, 0, 0),
    colorHex: '#172536',
  });
  for (const side of [-1, 1]) {
    detailParts.push({
      geo: sideGlassGeo,
      matrix: makeTransform(side * 0.89, 1.14, -0.14),
      colorHex: '#1b2a3d',
    });
    detailParts.push({
      geo: bPillarGeo,
      matrix: makeTransform(side * 0.90, 1.14, -0.12),
      colorHex: '#111827',
    });
    detailParts.push({
      geo: exhaustGeo,
      matrix: makeTransform(side * 0.54, 0.26, -2.23),
      colorHex: '#94a3b8',
    });
  }

  detailParts.push({
    geo: grilleGeo,
    matrix: makeTransform(0, 0.58, 2.24),
    colorHex: '#111827',
  });
  detailParts.push({
    geo: grilleBarGeo,
    matrix: makeTransform(0, 0.61, 2.25),
    colorHex: '#cbd5e1',
  });
  detailParts.push({
    geo: splitterGeo,
    matrix: makeTransform(0, 0.29, 2.13),
    colorHex: '#1f2937',
  });
  detailParts.push({
    geo: rearDiffuserGeo,
    matrix: makeTransform(0, 0.30, -2.16),
    colorHex: '#1f2937',
  });
  detailParts.push({
    geo: plateGeo,
    matrix: makeTransform(0, 0.44, 2.27),
    colorHex: '#f1f5f9',
  });
  detailParts.push({
    geo: plateGeo,
    matrix: makeTransform(0, 0.62, -2.27),
    colorHex: '#f1f5f9',
  });

  addWheelsToParts(detailParts, disposables, [1.38, -1.36], 0.84, 0.34, 0.24);

  const paintGeo = mergeNormalizedParts(paintParts, false);
  const detailGeo = mergeNormalizedParts(detailParts, true);
  for (const d of disposables) d.dispose();
  return { paintGeo, detailGeo };
}

/**
 * European high-roof panel van (~5.4m x 2.02m x 2.38m, ground at y = 0, +Z forward).
 */
export function createVanGeometries(): VehicleModelPair {
  const disposables: THREE.BufferGeometry[] = [];
  const paintParts: PartSpec[] = [];
  const detailParts: PartSpec[] = [];

  const vanShape = new THREE.Shape();
  vanShape.moveTo(-2.62, 0.32);
  vanShape.lineTo(2.58, 0.32);
  vanShape.lineTo(2.66, 0.64);
  vanShape.lineTo(2.54, 1.12);
  vanShape.lineTo(1.94, 1.32);
  vanShape.lineTo(1.22, 2.30);
  vanShape.lineTo(-2.54, 2.32);
  vanShape.lineTo(-2.66, 1.98);
  vanShape.lineTo(-2.66, 0.56);
  vanShape.closePath();

  const bodyGeo = extrudeSideProfile(vanShape, 1.90, 0.055, 0.045);
  disposables.push(bodyGeo);
  paintParts.push({ geo: bodyGeo });

  const windshieldGeo = new THREE.BoxGeometry(1.76, 0.05, 1.16);
  const cabSideWinGeo = new THREE.BoxGeometry(0.05, 0.58, 0.88);
  const bumperFrontGeo = new THREE.BoxGeometry(1.98, 0.26, 0.28);
  const bumperRearGeo = new THREE.BoxGeometry(1.98, 0.22, 0.24);
  const grilleGeo = new THREE.BoxGeometry(1.18, 0.34, 0.06);
  const grilleBarGeo = new THREE.BoxGeometry(1.22, 0.05, 0.08);
  const rubStripGeo = new THREE.BoxGeometry(0.05, 0.16, 4.10);
  const mirrorArmGeo = new THREE.BoxGeometry(0.18, 0.04, 0.05);
  const mirrorHousingGeo = new THREE.BoxGeometry(0.10, 0.26, 0.14);
  const rearSeamGeo = new THREE.BoxGeometry(0.03, 1.72, 0.04);
  const plateGeo = new THREE.BoxGeometry(0.50, 0.12, 0.03);

  disposables.push(
    windshieldGeo,
    cabSideWinGeo,
    bumperFrontGeo,
    bumperRearGeo,
    grilleGeo,
    grilleBarGeo,
    rubStripGeo,
    mirrorArmGeo,
    mirrorHousingGeo,
    rearSeamGeo,
    plateGeo
  );

  detailParts.push({
    geo: windshieldGeo,
    matrix: makeTransform(0, 1.82, 1.56, 0.92, 0, 0),
    colorHex: '#172536',
  });
  for (const side of [-1, 1]) {
    detailParts.push({
      geo: cabSideWinGeo,
      matrix: makeTransform(side * 0.99, 1.74, 1.48),
      colorHex: '#1b2a3d',
    });
    detailParts.push({
      geo: rubStripGeo,
      matrix: makeTransform(side * 1.00, 0.86, -0.22),
      colorHex: '#1f2937',
    });
    detailParts.push({
      geo: mirrorArmGeo,
      matrix: makeTransform(side * 1.06, 1.56, 1.78),
      colorHex: '#1f2937',
    });
    detailParts.push({
      geo: mirrorHousingGeo,
      matrix: makeTransform(side * 1.14, 1.62, 1.78),
      colorHex: '#111827',
    });
  }

  detailParts.push({
    geo: bumperFrontGeo,
    matrix: makeTransform(0, 0.42, 2.58),
    colorHex: '#1f2937',
  });
  detailParts.push({
    geo: bumperRearGeo,
    matrix: makeTransform(0, 0.40, -2.60),
    colorHex: '#1f2937',
  });
  detailParts.push({
    geo: grilleGeo,
    matrix: makeTransform(0, 0.92, 2.64),
    colorHex: '#111827',
  });
  detailParts.push({
    geo: grilleBarGeo,
    matrix: makeTransform(0, 0.96, 2.66),
    colorHex: '#cbd5e1',
  });
  detailParts.push({
    geo: rearSeamGeo,
    matrix: makeTransform(0, 1.42, -2.70),
    colorHex: '#334155',
  });
  detailParts.push({
    geo: plateGeo,
    matrix: makeTransform(0, 0.44, 2.72),
    colorHex: '#f1f5f9',
  });
  detailParts.push({
    geo: plateGeo,
    matrix: makeTransform(-0.36, 0.84, -2.71),
    colorHex: '#f1f5f9',
  });

  addWheelsToParts(detailParts, disposables, [1.72, -1.68], 0.92, 0.37, 0.25);

  const paintGeo = mergeNormalizedParts(paintParts, false);
  const detailGeo = mergeNormalizedParts(detailParts, true);
  for (const d of disposables) d.dispose();
  return { paintGeo, detailGeo };
}

/**
 * European cab-over 6x2 semi tractor centered so TrafficSystem bodyCenterOff = 3.1 places
 * the front grille flush at +5.15m ahead of tractor anchor (ground at y = 0, +Z forward).
 */
export function createSemiTractorGeometries(): VehicleModelPair {
  const disposables: THREE.BufferGeometry[] = [];
  const paintParts: PartSpec[] = [];
  const detailParts: PartSpec[] = [];

  // Cab silhouette (z from +0.15 rear cab wall to +2.05 front grille)
  const cabShape = new THREE.Shape();
  cabShape.moveTo(0.15, 0.72);
  cabShape.lineTo(1.98, 0.72);
  cabShape.lineTo(2.05, 1.45);
  cabShape.lineTo(1.96, 2.98);
  cabShape.lineTo(1.62, 3.38);
  cabShape.lineTo(0.20, 3.50);
  cabShape.lineTo(0.12, 3.05);
  cabShape.closePath();

  const cabGeo = extrudeSideProfile(cabShape, 2.34, 0.05, 0.045);
  const sideSkirtGeo = new THREE.BoxGeometry(0.10, 0.46, 2.15);
  const fenderTopGeo = new THREE.BoxGeometry(0.46, 0.14, 2.10);
  disposables.push(cabGeo, sideSkirtGeo, fenderTopGeo);

  paintParts.push({ geo: cabGeo });
  for (const side of [-1, 1]) {
    paintParts.push({
      geo: sideSkirtGeo,
      matrix: makeTransform(side * 1.12, 0.72, -0.95),
    });
    paintParts.push({
      geo: fenderTopGeo,
      matrix: makeTransform(side * 1.00, 1.06, -1.55),
    });
  }

  // Windshield, side door windows, sunvisor, multi-slat grille, twin-arm mirrors, chassis & fuel tanks
  const windshieldGeo = new THREE.BoxGeometry(2.14, 0.92, 0.06);
  const sideWinGeo = new THREE.BoxGeometry(0.05, 0.74, 1.12);
  const sunvisorGeo = new THREE.BoxGeometry(2.38, 0.14, 0.22);
  const grilleGeo = new THREE.BoxGeometry(1.74, 0.96, 0.06);
  const grilleSlatGeo = new THREE.BoxGeometry(1.64, 0.06, 0.08);
  const frontBumperGeo = new THREE.BoxGeometry(2.42, 0.36, 0.32);
  const mirrorArmGeo = new THREE.BoxGeometry(0.22, 0.04, 0.04);
  const mirrorBodyGeo = new THREE.BoxGeometry(0.10, 0.44, 0.18);
  const railGeo = new THREE.BoxGeometry(0.18, 0.26, 2.75);
  const fifthWheelGeo = new THREE.CylinderGeometry(0.48, 0.52, 0.14, 12);
  const fuelTankGeo = new THREE.CylinderGeometry(0.30, 0.30, 1.45, 10);
  fuelTankGeo.rotateX(Math.PI / 2);
  const plateGeo = new THREE.BoxGeometry(0.54, 0.13, 0.03);

  disposables.push(
    windshieldGeo,
    sideWinGeo,
    sunvisorGeo,
    grilleGeo,
    grilleSlatGeo,
    frontBumperGeo,
    mirrorArmGeo,
    mirrorBodyGeo,
    railGeo,
    fifthWheelGeo,
    fuelTankGeo,
    plateGeo
  );

  detailParts.push({
    geo: windshieldGeo,
    matrix: makeTransform(0, 2.52, 2.02, -0.07, 0, 0),
    colorHex: '#162233',
  });
  detailParts.push({
    geo: sunvisorGeo,
    matrix: makeTransform(0, 3.06, 2.09, 0.18, 0, 0),
    colorHex: '#111827',
  });
  detailParts.push({
    geo: grilleGeo,
    matrix: makeTransform(0, 1.44, 2.05),
    colorHex: '#111827',
  });
  for (let i = 0; i < 3; i++) {
    detailParts.push({
      geo: grilleSlatGeo,
      matrix: makeTransform(0, 1.12 + i * 0.28, 2.07),
      colorHex: '#cbd5e1',
    });
  }
  detailParts.push({
    geo: frontBumperGeo,
    matrix: makeTransform(0, 0.56, 1.98),
    colorHex: '#1e2736',
  });
  detailParts.push({
    geo: plateGeo,
    matrix: makeTransform(0, 0.52, 2.15),
    colorHex: '#f1f5f9',
  });

  for (const side of [-1, 1]) {
    detailParts.push({
      geo: sideWinGeo,
      matrix: makeTransform(side * 1.21, 2.52, 1.14),
      colorHex: '#1b2a3d',
    });
    detailParts.push({
      geo: mirrorArmGeo,
      matrix: makeTransform(side * 1.28, 2.74, 1.88),
      colorHex: '#94a3b8',
    });
    detailParts.push({
      geo: mirrorArmGeo,
      matrix: makeTransform(side * 1.28, 2.40, 1.88),
      colorHex: '#94a3b8',
    });
    detailParts.push({
      geo: mirrorBodyGeo,
      matrix: makeTransform(side * 1.38, 2.58, 1.88),
      colorHex: '#18202c',
    });
    detailParts.push({
      geo: railGeo,
      matrix: makeTransform(side * 0.44, 0.72, -1.05),
      colorHex: '#222b38',
    });
    detailParts.push({
      geo: fuelTankGeo,
      matrix: makeTransform(side * 0.86, 0.68, -0.68),
      colorHex: '#cbd5e1',
    });
  }

  detailParts.push({
    geo: fifthWheelGeo,
    matrix: makeTransform(0, 0.94, -1.35),
    colorHex: '#1e2736',
  });

  addWheelsToParts(detailParts, disposables, [1.05, -1.15, -2.05], 1.02, 0.48, 0.30);

  const paintGeo = mergeNormalizedParts(paintParts, false);
  const detailGeo = mergeNormalizedParts(detailParts, true);
  for (const d of disposables) d.dispose();
  return { paintGeo, detailGeo };
}

/**
 * 10.2m articulated reefer semi-trailer (ground at y = 0, centered at origin).
 */
export function createSemiTrailerGeometries(): VehicleModelPair {
  const disposables: THREE.BufferGeometry[] = [];
  const paintParts: PartSpec[] = [];
  const detailParts: PartSpec[] = [];

  const boxGeo = new THREE.BoxGeometry(2.42, 2.66, 10.0);
  const roofCapGeo = new THREE.BoxGeometry(2.30, 0.08, 9.9);
  const reeferUnitGeo = new THREE.BoxGeometry(1.66, 1.08, 0.46);
  disposables.push(boxGeo, roofCapGeo, reeferUnitGeo);

  paintParts.push({ geo: boxGeo, matrix: makeTransform(0, 2.48, 0) });
  paintParts.push({ geo: roofCapGeo, matrix: makeTransform(0, 3.84, 0) });
  paintParts.push({ geo: reeferUnitGeo, matrix: makeTransform(0, 3.04, 5.12) });

  const frameGeo = new THREE.BoxGeometry(2.02, 0.22, 9.8);
  const sideGuardGeo = new THREE.BoxGeometry(0.07, 0.12, 3.6);
  const reeferGrilleGeo = new THREE.BoxGeometry(1.12, 0.58, 0.08);
  const landingLegGeo = new THREE.BoxGeometry(0.14, 0.78, 0.14);
  const lockRodGeo = new THREE.CylinderGeometry(0.025, 0.025, 2.52, 6);
  const rearBarGeo = new THREE.BoxGeometry(2.38, 0.22, 0.20);
  const fenderGeo = new THREE.BoxGeometry(0.54, 0.14, 3.10);
  const mudflapGeo = new THREE.BoxGeometry(0.54, 0.42, 0.04);
  const plateGeo = new THREE.BoxGeometry(0.54, 0.13, 0.03);

  disposables.push(
    frameGeo,
    sideGuardGeo,
    reeferGrilleGeo,
    landingLegGeo,
    lockRodGeo,
    rearBarGeo,
    fenderGeo,
    mudflapGeo,
    plateGeo
  );

  detailParts.push({
    geo: frameGeo,
    matrix: makeTransform(0, 1.04, 0),
    colorHex: '#222b38',
  });
  detailParts.push({
    geo: reeferGrilleGeo,
    matrix: makeTransform(0, 3.04, 5.34),
    colorHex: '#1e2736',
  });
  detailParts.push({
    geo: rearBarGeo,
    matrix: makeTransform(0, 0.66, -4.98),
    colorHex: '#cbd5e1',
  });
  detailParts.push({
    geo: plateGeo,
    matrix: makeTransform(0, 0.66, -5.09),
    colorHex: '#f1f5f9',
  });

  for (const side of [-1, 1]) {
    for (const gy of [0.60, 0.82]) {
      detailParts.push({
        geo: sideGuardGeo,
        matrix: makeTransform(side * 1.15, gy, 0.45),
        colorHex: '#cbd5e1',
      });
    }
    detailParts.push({
      geo: landingLegGeo,
      matrix: makeTransform(side * 0.74, 0.76, 2.65),
      colorHex: '#1e2736',
    });
    detailParts.push({
      geo: fenderGeo,
      matrix: makeTransform(side * 1.02, 1.04, -3.25),
      colorHex: '#1e2736',
    });
    detailParts.push({
      geo: mudflapGeo,
      matrix: makeTransform(side * 1.02, 0.48, -4.78),
      colorHex: '#18202c',
    });
    for (const lx of [0.24, 0.56]) {
      detailParts.push({
        geo: lockRodGeo,
        matrix: makeTransform(side * lx, 2.48, -5.02),
        colorHex: '#94a3b8',
      });
    }
  }

  addWheelsToParts(detailParts, disposables, [-2.25, -3.25, -4.25], 1.02, 0.48, 0.30);

  const paintGeo = mergeNormalizedParts(paintParts, false);
  const detailGeo = mergeNormalizedParts(detailParts, true);
  for (const d of disposables) d.dispose();
  return { paintGeo, detailGeo };
}
