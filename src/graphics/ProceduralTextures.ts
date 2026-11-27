import * as THREE from 'three';
import { QualityPreset, WipersMode } from '../store/useGameStore';

export interface PbrTextureSet {
  map: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
}

export interface DashboardDrawState {
  speedKmh: number;
  rpm: number;
  gearLabel: string;
  fuelPct: number;
  parkingBrake: boolean;
  leftBlinker: boolean;
  rightBlinker: boolean;
  cruiseControlKmh?: number | null;
  airPressureBar?: number;
  lowAirWarning?: boolean;
  engineRunning?: boolean;
  exhaustBrakeActive?: boolean;
  retarderLevel?: number;
  brakeTempC?: number;
}

export interface CabGpsRoadPolyline {
  points: { x: number; z: number }[];
  isMotorway: boolean;
  minX?: number;
  maxX?: number;
  minZ?: number;
  maxZ?: number;
}

export interface CabGpsDrawState {
  speedKmh: number;
  speedLimitKmh: number;
  distanceMeters: number;
  hasActiveJob: boolean;
  instruction: string;
  truckX?: number;
  truckZ?: number;
  truckHeadingRad?: number;
  turnDir?: 'straight' | 'left' | 'right' | 'arrive';
  turnDistMeters?: number | null;
  roadPolylines?: CabGpsRoadPolyline[];
  routePoints?: { x: number; z: number }[];
  destPoint?: { x: number; z: number } | null;
}

/**
 * Procedural CanvasTexture PBR factory producing Albedo, Roughness, and Bump maps
 * with zero external asset URLs, tier-adaptive resolution, and clean disposal.
 */
export class ProceduralTextures {
  private readonly cache = new Map<string, THREE.CanvasTexture>();
  private anisotropy = 4;
  private detailSize = 512;

  private dashCanvas: HTMLCanvasElement | null = null;
  private dashCtx: CanvasRenderingContext2D | null = null;
  private dashTexture: THREE.CanvasTexture | null = null;
  private lastDashKey = '';

  private gpsCanvas: HTMLCanvasElement | null = null;
  private gpsCtx: CanvasRenderingContext2D | null = null;
  private gpsTexture: THREE.CanvasTexture | null = null;
  private lastGpsKey = '';

  private rainCanvas: HTMLCanvasElement | null = null;
  private rainCtx: CanvasRenderingContext2D | null = null;
  private rainTexture: THREE.CanvasTexture | null = null;
  private rainAccumSec = 0;
  private prevWiperAngle = -0.02;
  private readonly rainDrops: { x: number; y: number; r: number; vy: number }[] = [];

  public configureQuality(preset: QualityPreset): void {
    this.anisotropy =
      preset === 'mobile_fast' ? 1 : preset === 'mobile_balanced' ? 2 : preset === 'high' ? 4 : 8;
    this.detailSize = preset === 'high' || preset === 'ultra' ? 1024 : 512;

    for (const tex of this.cache.values()) {
      tex.anisotropy = this.anisotropy;
      tex.needsUpdate = true;
    }
  }

  public getRoadTextures(lanes: number, roadClass: 'motorway' | 'national' | 'urban'): PbrTextureSet {
    const key = `road_${lanes}_${roadClass}_${this.detailSize}`;
    const mapKey = `${key}_albedo`;
    const roughKey = `${key}_rough`;
    const bumpKey = `${key}_bump`;

    const existingMap = this.cache.get(mapKey);
    const existingRough = this.cache.get(roughKey);
    const existingBump = this.cache.get(bumpKey);
    if (existingMap && existingRough && existingBump) {
      return { map: existingMap, roughnessMap: existingRough, bumpMap: existingBump };
    }

    const size = this.detailSize;
    const albedoCanvas = document.createElement('canvas');
    albedoCanvas.width = size;
    albedoCanvas.height = size;
    const ctx = albedoCanvas.getContext('2d')!;

    const roughCanvas = document.createElement('canvas');
    roughCanvas.width = size;
    roughCanvas.height = size;
    const rCtx = roughCanvas.getContext('2d')!;

    const bumpCanvas = document.createElement('canvas');
    bumpCanvas.width = size;
    bumpCanvas.height = size;
    const bCtx = bumpCanvas.getContext('2d')!;

    const baseShade = roadClass === 'motorway' ? 52 : roadClass === 'national' ? 60 : 66;
    ctx.fillStyle = `rgb(${baseShade}, ${baseShade + 2}, ${baseShade + 6})`;
    ctx.fillRect(0, 0, size, size);

    rCtx.fillStyle = 'rgb(222, 222, 222)';
    rCtx.fillRect(0, 0, size, size);

    bCtx.fillStyle = 'rgb(128, 128, 128)';
    bCtx.fillRect(0, 0, size, size);

    let seed = lanes * 131 + (roadClass === 'motorway' ? 17 : 53);
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const sScale = size / 512;

    // Multi-frequency asphalt aggregate stone grain
    const grainCount = Math.floor(6500 * sScale);
    for (let i = 0; i < grainCount; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const sz = (1 + rand() * 2.4) * sScale;
      const delta = Math.floor((rand() - 0.5) * 28);
      const c = Math.max(22, Math.min(115, baseShade + delta));
      ctx.fillStyle = `rgb(${c}, ${c + 1}, ${c + 3})`;
      ctx.fillRect(x, y, sz, sz);

      const rc = Math.max(150, Math.min(248, 218 + delta));
      rCtx.fillStyle = `rgb(${rc}, ${rc}, ${rc})`;
      rCtx.fillRect(x, y, sz, sz);

      const bc = Math.max(70, Math.min(200, 128 + delta * 2));
      bCtx.fillStyle = `rgb(${bc}, ${bc}, ${bc})`;
      bCtx.fillRect(x, y, sz, sz);
    }

    // Subtle shoulder edge cracks
    ctx.strokeStyle = 'rgba(20, 22, 26, 0.55)';
    ctx.lineWidth = 1.4 * sScale;
    bCtx.strokeStyle = 'rgb(52, 52, 52)';
    bCtx.lineWidth = 1.8 * sScale;
    for (let c = 0; c < 14; c++) {
      const sideX = rand() < 0.5 ? 28 * sScale : size - 28 * sScale;
      let cx = sideX;
      let cy = rand() * size;
      ctx.beginPath();
      bCtx.beginPath();
      ctx.moveTo(cx, cy);
      bCtx.moveTo(cx, cy);
      for (let seg = 0; seg < 4; seg++) {
        cx += (sideX < size / 2 ? 1 : -1) * (8 + rand() * 14) * sScale;
        cy += (rand() - 0.5) * 28 * sScale;
        ctx.lineTo(cx, cy);
        bCtx.lineTo(cx, cy);
      }
      ctx.stroke();
      bCtx.stroke();
    }

    // Longitudinal tire tracks (darker albedo, smoother roughness)
    const laneCount = Math.max(2, lanes);
    const usableStart = 32 * sScale;
    const usableWidth = size - usableStart * 2;
    const laneW = usableWidth / laneCount;

    for (let l = 0; l < laneCount; l++) {
      const cx = usableStart + laneW * (l + 0.5);
      const trackOffset = laneW * 0.22;
      for (const offset of [-trackOffset, trackOffset]) {
        const w = 32 * sScale;
        const grad = ctx.createLinearGradient(cx + offset - w * 0.5, 0, cx + offset + w * 0.5, 0);
        grad.addColorStop(0, 'rgba(20, 22, 26, 0)');
        grad.addColorStop(0.5, 'rgba(20, 22, 26, 0.26)');
        grad.addColorStop(1, 'rgba(20, 22, 26, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(cx + offset - w * 0.5, 0, w, size);

        const rGrad = rCtx.createLinearGradient(cx + offset - w * 0.5, 0, cx + offset + w * 0.5, 0);
        rGrad.addColorStop(0, 'rgba(135, 135, 135, 0)');
        rGrad.addColorStop(0.5, 'rgba(135, 135, 135, 0.42)');
        rGrad.addColorStop(1, 'rgba(135, 135, 135, 0)');
        rCtx.fillStyle = rGrad;
        rCtx.fillRect(cx + offset - w * 0.5, 0, w, size);
      }
    }

    // Reflective European road markings (white solid outer edges + European white centerlines; zero US yellow lines)
    const paintPaint = (x: number, y: number, w: number, h: number, color: string) => {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w, h);
      rCtx.fillStyle = 'rgb(115, 115, 115)';
      rCtx.fillRect(x, y, w, h);
      bCtx.fillStyle = 'rgb(165, 165, 165)';
      bCtx.fillRect(x, y, w, h);
    };

    paintPaint(22 * sScale, 0, 7 * sScale, size, '#e5e7eb');
    paintPaint(size - 29 * sScale, 0, 7 * sScale, size, '#e5e7eb');

    if (roadClass === 'motorway' && laneCount >= 4) {
      // European divided motorway: twin solid white center lines flanking dark median strip
      ctx.fillStyle = '#20252d';
      ctx.fillRect(size / 2 - 8 * sScale, 0, 16 * sScale, size);
      paintPaint(size / 2 - 12 * sScale, 0, 5 * sScale, size, '#f8fafc');
      paintPaint(size / 2 + 7 * sScale, 0, 5 * sScale, size, '#f8fafc');
    } else {
      for (let y = 16 * sScale; y < size; y += 96 * sScale) {
        paintPaint(size / 2 - 3 * sScale, y, 6 * sScale, 48 * sScale, '#f8fafc');
      }
    }

    if (laneCount >= 4) {
      for (let l = 1; l < laneCount; l++) {
        if (l === laneCount / 2) continue;
        const x = usableStart + laneW * l - 2.5 * sScale;
        for (let y = 24 * sScale; y < size; y += 96 * sScale) {
          paintPaint(x, y, 5 * sScale, 44 * sScale, 'rgba(241, 245, 249, 0.88)');
        }
      }
    }

    const map = new THREE.CanvasTexture(albedoCanvas);
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = this.anisotropy;

    const roughnessMap = new THREE.CanvasTexture(roughCanvas);
    roughnessMap.wrapS = THREE.RepeatWrapping;
    roughnessMap.wrapT = THREE.RepeatWrapping;
    roughnessMap.anisotropy = this.anisotropy;

    const bumpMap = new THREE.CanvasTexture(bumpCanvas);
    bumpMap.wrapS = THREE.RepeatWrapping;
    bumpMap.wrapT = THREE.RepeatWrapping;
    bumpMap.anisotropy = this.anisotropy;

    this.cache.set(mapKey, map);
    this.cache.set(roughKey, roughnessMap);
    this.cache.set(bumpKey, bumpMap);
    return { map, roughnessMap, bumpMap };
  }

  public getYardConcreteTextures(): PbrTextureSet {
    const key = `yard_concrete_${this.detailSize}`;
    const mapKey = `${key}_albedo`;
    const roughKey = `${key}_rough`;
    const bumpKey = `${key}_bump`;

    const existingMap = this.cache.get(mapKey);
    const existingRough = this.cache.get(roughKey);
    const existingBump = this.cache.get(bumpKey);
    if (existingMap && existingRough && existingBump) {
      return { map: existingMap, roughnessMap: existingRough, bumpMap: existingBump };
    }

    const size = this.detailSize;
    const s = size / 512;

    const albedoCanvas = document.createElement('canvas');
    albedoCanvas.width = size;
    albedoCanvas.height = size;
    const ctx = albedoCanvas.getContext('2d')!;

    const roughCanvas = document.createElement('canvas');
    roughCanvas.width = size;
    roughCanvas.height = size;
    const rCtx = roughCanvas.getContext('2d')!;

    const bumpCanvas = document.createElement('canvas');
    bumpCanvas.width = size;
    bumpCanvas.height = size;
    const bCtx = bumpCanvas.getContext('2d')!;

    ctx.fillStyle = '#68707c';
    ctx.fillRect(0, 0, size, size);
    rCtx.fillStyle = 'rgb(212, 212, 212)';
    rCtx.fillRect(0, 0, size, size);
    bCtx.fillStyle = 'rgb(138, 138, 138)';
    bCtx.fillRect(0, 0, size, size);

    let seed = 7731;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    // Concrete slab grain & mottling
    for (let i = 0; i < Math.floor(4200 * s); i++) {
      const x = rand() * size;
      const y = rand() * size;
      const sz = (1.5 + rand() * 3.5) * s;
      const d = Math.floor((rand() - 0.5) * 26);
      ctx.fillStyle = `rgb(${104 + d}, ${112 + d}, ${124 + d})`;
      ctx.fillRect(x, y, sz, sz);
      const b = Math.max(90, Math.min(185, 138 + d));
      bCtx.fillStyle = `rgb(${b}, ${b}, ${b})`;
      bCtx.fillRect(x, y, sz, sz);
    }

    // Oil stains & tire scuff blotches
    for (let i = 0; i < 16; i++) {
      const ox = rand() * size;
      const oy = rand() * size;
      const rad = (14 + rand() * 26) * s;
      const grad = ctx.createRadialGradient(ox, oy, 2, ox, oy, rad);
      grad.addColorStop(0, 'rgba(30, 34, 40, 0.32)');
      grad.addColorStop(1, 'rgba(30, 34, 40, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(ox, oy, rad, 0, Math.PI * 2);
      ctx.fill();

      const rGrad = rCtx.createRadialGradient(ox, oy, 2, ox, oy, rad);
      rGrad.addColorStop(0, 'rgba(110, 110, 110, 0.55)');
      rGrad.addColorStop(1, 'rgba(110, 110, 110, 0)');
      rCtx.fillStyle = rGrad;
      rCtx.beginPath();
      rCtx.arc(ox, oy, rad, 0, Math.PI * 2);
      rCtx.fill();
    }

    // Concrete expansion joint grid (4x4 slabs)
    const step = size / 4;
    ctx.strokeStyle = 'rgba(38, 43, 52, 0.72)';
    ctx.lineWidth = 3 * s;
    bCtx.strokeStyle = 'rgb(46, 46, 46)';
    bCtx.lineWidth = 4 * s;
    for (let g = 0; g <= size; g += step) {
      ctx.beginPath();
      ctx.moveTo(g, 0);
      ctx.lineTo(g, size);
      ctx.moveTo(0, g);
      ctx.lineTo(size, g);
      ctx.stroke();

      bCtx.beginPath();
      bCtx.moveTo(g, 0);
      bCtx.lineTo(g, size);
      bCtx.moveTo(0, g);
      bCtx.lineTo(size, g);
      bCtx.stroke();
    }

    // Subtle curved yard tire scuff marks (clean industrial concrete without repeated hazard stripes)
    ctx.strokeStyle = 'rgba(28, 32, 38, 0.22)';
    ctx.lineWidth = 4 * s;
    for (let i = 0; i < 4; i++) {
      const sy = (80 + i * 110) * s;
      ctx.beginPath();
      ctx.moveTo(20 * s, sy);
      ctx.quadraticCurveTo(size * 0.5, sy + (i % 2 === 0 ? 18 : -18) * s, size - 20 * s, sy + 6 * s);
      ctx.stroke();
    }

    const map = new THREE.CanvasTexture(albedoCanvas);
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(14, 15);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = this.anisotropy;

    const roughnessMap = new THREE.CanvasTexture(roughCanvas);
    roughnessMap.wrapS = THREE.RepeatWrapping;
    roughnessMap.wrapT = THREE.RepeatWrapping;
    roughnessMap.repeat.set(14, 15);
    roughnessMap.anisotropy = this.anisotropy;

    const bumpMap = new THREE.CanvasTexture(bumpCanvas);
    bumpMap.wrapS = THREE.RepeatWrapping;
    bumpMap.wrapT = THREE.RepeatWrapping;
    bumpMap.repeat.set(14, 15);
    bumpMap.anisotropy = this.anisotropy;

    this.cache.set(mapKey, map);
    this.cache.set(roughKey, roughnessMap);
    this.cache.set(bumpKey, bumpMap);
    return { map, roughnessMap, bumpMap };
  }

  public getTerrainTextures(): PbrTextureSet {
    const key = `terrain_grass_${this.detailSize}`;
    const mapKey = `${key}_albedo`;
    const roughKey = `${key}_rough`;
    const bumpKey = `${key}_bump`;

    const existingMap = this.cache.get(mapKey);
    const existingRough = this.cache.get(roughKey);
    const existingBump = this.cache.get(bumpKey);
    if (existingMap && existingRough && existingBump) {
      return { map: existingMap, roughnessMap: existingRough, bumpMap: existingBump };
    }

    const size = this.detailSize;
    const s = size / 512;

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    const roughCanvas = document.createElement('canvas');
    roughCanvas.width = size;
    roughCanvas.height = size;
    const rCtx = roughCanvas.getContext('2d')!;

    const bumpCanvas = document.createElement('canvas');
    bumpCanvas.width = size;
    bumpCanvas.height = size;
    const bCtx = bumpCanvas.getContext('2d')!;

    ctx.fillStyle = '#485d3d';
    ctx.fillRect(0, 0, size, size);
    rCtx.fillStyle = 'rgb(235, 235, 235)';
    rCtx.fillRect(0, 0, size, size);
    bCtx.fillStyle = 'rgb(128, 128, 128)';
    bCtx.fillRect(0, 0, size, size);

    let seed = 9001;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    // Broad organic biome patches (meadow green, dry grass ochre, rich soil)
    for (let i = 0; i < 160; i++) {
      const px = rand() * size;
      const py = rand() * size;
      const rad = (18 + rand() * 44) * s;
      const palette = i % 4 === 0 ? [92, 86, 56] : i % 3 === 0 ? [62, 84, 48] : [76, 102, 58];
      const grad = ctx.createRadialGradient(px, py, 2, px, py, rad);
      grad.addColorStop(0, `rgba(${palette[0]}, ${palette[1]}, ${palette[2]}, 0.34)`);
      grad.addColorStop(1, `rgba(${palette[0]}, ${palette[1]}, ${palette[2]}, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(px, py, rad, 0, Math.PI * 2);
      ctx.fill();
    }

    // Fine foliage/soil micro-detail
    for (let i = 0; i < Math.floor(6800 * s); i++) {
      const x = rand() * size;
      const y = rand() * size;
      const r = (1.5 + rand() * 3.8) * s;
      const g = Math.floor(72 + rand() * 38);
      const red = Math.floor(56 + rand() * 34);
      const b = Math.floor(42 + rand() * 22);
      ctx.fillStyle = `rgba(${red}, ${g}, ${b}, 0.28)`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();

      const bc = Math.floor(96 + rand() * 68);
      bCtx.fillStyle = `rgba(${bc}, ${bc}, ${bc}, 0.4)`;
      bCtx.fillRect(x, y, r, r);
    }

    const map = new THREE.CanvasTexture(canvas);
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(90, 90);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = this.anisotropy;

    const roughnessMap = new THREE.CanvasTexture(roughCanvas);
    roughnessMap.wrapS = THREE.RepeatWrapping;
    roughnessMap.wrapT = THREE.RepeatWrapping;
    roughnessMap.repeat.set(90, 90);

    const bumpMap = new THREE.CanvasTexture(bumpCanvas);
    bumpMap.wrapS = THREE.RepeatWrapping;
    bumpMap.wrapT = THREE.RepeatWrapping;
    bumpMap.repeat.set(90, 90);

    this.cache.set(mapKey, map);
    this.cache.set(roughKey, roughnessMap);
    this.cache.set(bumpKey, bumpMap);
    return { map, roughnessMap, bumpMap };
  }

  public getContainerTextures(baseHex: string, label = 'EUROHAUL'): PbrTextureSet {
    const key = `container_${baseHex}_${label}_${this.detailSize}`;
    const mapKey = `${key}_albedo`;
    const roughKey = `${key}_rough`;
    const bumpKey = `${key}_bump`;

    const existingMap = this.cache.get(mapKey);
    const existingRough = this.cache.get(roughKey);
    const existingBump = this.cache.get(bumpKey);
    if (existingMap && existingRough && existingBump) {
      return { map: existingMap, roughnessMap: existingRough, bumpMap: existingBump };
    }

    const w = this.detailSize;
    const h = this.detailSize / 2;
    const s = w / 512;

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;

    const roughCanvas = document.createElement('canvas');
    roughCanvas.width = w;
    roughCanvas.height = h;
    const rCtx = roughCanvas.getContext('2d')!;

    const bumpCanvas = document.createElement('canvas');
    bumpCanvas.width = w;
    bumpCanvas.height = h;
    const bCtx = bumpCanvas.getContext('2d')!;

    ctx.fillStyle = baseHex;
    ctx.fillRect(0, 0, w, h);
    rCtx.fillStyle = 'rgb(142, 142, 142)';
    rCtx.fillRect(0, 0, w, h);
    bCtx.fillStyle = 'rgb(128, 128, 128)';
    bCtx.fillRect(0, 0, w, h);

    // Corrugated steel vertical ribs with bevel shading in Albedo + Bump
    const ribStep = 16 * s;
    for (let x = 0; x < w; x += ribStep) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
      ctx.fillRect(x, 0, 5 * s, h);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.fillRect(x + 5 * s, 0, 4 * s, h);

      bCtx.fillStyle = 'rgb(76, 76, 76)';
      bCtx.fillRect(x, 0, 5 * s, h);
      bCtx.fillStyle = 'rgb(186, 186, 186)';
      bCtx.fillRect(x + 5 * s, 0, 6 * s, h);
    }

    // Top & bottom structural rails + rivet rows
    ctx.fillStyle = 'rgba(15, 23, 42, 0.5)';
    ctx.fillRect(0, 0, w, 16 * s);
    ctx.fillRect(0, h - 16 * s, w, 16 * s);

    ctx.fillStyle = 'rgba(226, 232, 240, 0.55)';
    bCtx.fillStyle = 'rgb(220, 220, 220)';
    for (let x = 8 * s; x < w; x += 14 * s) {
      ctx.fillRect(x, 6 * s, 2.5 * s, 2.5 * s);
      ctx.fillRect(x, h - 9 * s, 2.5 * s, 2.5 * s);
      bCtx.fillRect(x, 6 * s, 3 * s, 3 * s);
      bCtx.fillRect(x, h - 9 * s, 3 * s, 3 * s);
    }

    // Crisp fleet branding band
    ctx.fillStyle = 'rgba(248, 250, 252, 0.94)';
    ctx.fillRect(42 * s, 82 * s, 428 * s, 76 * s);
    ctx.fillStyle = '#d97706';
    ctx.fillRect(42 * s, 82 * s, 14 * s, 76 * s);

    ctx.fillStyle = '#0f172a';
    ctx.font = `bold ${Math.round(34 * s)}px Inter, Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, w * 0.5 + 4 * s, 114 * s);

    ctx.fillStyle = '#475569';
    ctx.font = `bold ${Math.round(12 * s)}px monospace`;
    ctx.fillText('EUROHAUL LOGISTICS · TIR', w * 0.5 + 4 * s, 142 * s);

    // European yellow side reflective safety tape along bottom rail
    for (let x = 14 * s; x < w - 28 * s; x += 34 * s) {
      ctx.fillStyle = '#facc15';
      ctx.fillRect(x, h - 24 * s, 22 * s, 6 * s);
      rCtx.fillStyle = 'rgb(60, 60, 60)';
      rCtx.fillRect(x, h - 24 * s, 22 * s, 6 * s);
    }

    // Red-and-white diagonal European corner hazard chevrons
    for (const startX of [10 * s, w - 58 * s]) {
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = i % 2 === 0 ? '#dc2626' : '#f8fafc';
        ctx.fillRect(startX + i * 12 * s, h - 42 * s, 12 * s, 14 * s);
      }
    }

    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = this.anisotropy;

    const roughnessMap = new THREE.CanvasTexture(roughCanvas);
    roughnessMap.anisotropy = this.anisotropy;

    const bumpMap = new THREE.CanvasTexture(bumpCanvas);
    bumpMap.anisotropy = this.anisotropy;

    this.cache.set(mapKey, map);
    this.cache.set(roughKey, roughnessMap);
    this.cache.set(bumpKey, bumpMap);
    return { map, roughnessMap, bumpMap };
  }

  public getContainerRoofTexture(baseHex: string): THREE.CanvasTexture {
    const key = `container_roof_${baseHex}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = baseHex === '#f8fafc' ? '#f1f5f9' : '#e2e8f0';
    ctx.fillRect(0, 0, 256, 512);

    // Longitudinal roof ribs & side edge rails
    for (let y = 0; y < 512; y += 24) {
      ctx.fillStyle = 'rgba(15, 23, 42, 0.08)';
      ctx.fillRect(14, y, 228, 6);
    }
    ctx.fillStyle = baseHex;
    ctx.fillRect(0, 0, 14, 512);
    ctx.fillRect(242, 0, 14, 512);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.anisotropy;
    this.cache.set(key, tex);
    return tex;
  }

  public getContainerRearDoorTexture(baseHex: string): THREE.CanvasTexture {
    const key = `container_rear_${baseHex}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = baseHex;
    ctx.fillRect(0, 0, 256, 256);

    // Double door recessed frame & center seam
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.72)';
    ctx.lineWidth = 6;
    ctx.strokeRect(10, 10, 236, 236);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(128, 10);
    ctx.lineTo(128, 246);
    ctx.stroke();

    // 4 stainless vertical locking bars
    ctx.fillStyle = '#cbd5e1';
    for (const bx of [54, 102, 150, 198]) {
      ctx.fillRect(bx - 3, 18, 6, 220);
      ctx.fillStyle = '#475569';
      ctx.fillRect(bx - 6, 148, 12, 16);
      ctx.fillStyle = '#cbd5e1';
    }

    // Blue TIR plate & amber/red ECE rear marker plates
    ctx.fillStyle = '#1e3a8a';
    ctx.fillRect(26, 28, 52, 28);
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 2;
    ctx.strokeRect(26, 28, 52, 28);
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 17px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('TIR', 52, 43);

    // Yellow reflective ECE70 heavy-trailer chevrons
    for (const mx of [24, 168]) {
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(mx, 206, 64, 22);
      ctx.fillStyle = '#facc15';
      ctx.fillRect(mx + 10, 210, 44, 14);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.anisotropy;
    this.cache.set(key, tex);
    return tex;
  }

  public getContainerAtlasTextures(baseHex: string, label = 'EUROHAUL'): PbrTextureSet {
    const key = `container_atlas_${baseHex}_${label}_${this.detailSize}`;
    const mapKey = `${key}_albedo`;
    const roughKey = `${key}_rough`;
    const bumpKey = `${key}_bump`;

    const existingMap = this.cache.get(mapKey);
    const existingRough = this.cache.get(roughKey);
    const existingBump = this.cache.get(bumpKey);
    if (existingMap && existingRough && existingBump) {
      return { map: existingMap, roughnessMap: existingRough, bumpMap: existingBump };
    }

    const w = this.detailSize;
    const h = this.detailSize; // Square 2-band atlas: top half sides, bottom-left roof, bottom-right rear doors
    const halfH = h / 2;
    const halfW = w / 2;
    const s = w / 512;

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;

    const roughCanvas = document.createElement('canvas');
    roughCanvas.width = w;
    roughCanvas.height = h;
    const rCtx = roughCanvas.getContext('2d')!;

    const bumpCanvas = document.createElement('canvas');
    bumpCanvas.width = w;
    bumpCanvas.height = h;
    const bCtx = bumpCanvas.getContext('2d')!;

    rCtx.fillStyle = 'rgb(142, 142, 142)';
    rCtx.fillRect(0, 0, w, h);
    bCtx.fillStyle = 'rgb(128, 128, 128)';
    bCtx.fillRect(0, 0, w, h);

    // 1. Top half (y: 0..halfH): corrugated side walls
    ctx.fillStyle = baseHex;
    ctx.fillRect(0, 0, w, halfH);
    const ribStep = 16 * s;
    for (let x = 0; x < w; x += ribStep) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
      ctx.fillRect(x, 0, 5 * s, halfH);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.fillRect(x + 5 * s, 0, 4 * s, halfH);

      bCtx.fillStyle = 'rgb(76, 76, 76)';
      bCtx.fillRect(x, 0, 5 * s, halfH);
      bCtx.fillStyle = 'rgb(186, 186, 186)';
      bCtx.fillRect(x + 5 * s, 0, 6 * s, halfH);
    }
    ctx.fillStyle = 'rgba(15, 23, 42, 0.5)';
    ctx.fillRect(0, 0, w, 16 * s);
    ctx.fillRect(0, halfH - 16 * s, w, 16 * s);

    ctx.fillStyle = 'rgba(248, 250, 252, 0.94)';
    ctx.fillRect(42 * s, 82 * s, 428 * s, 76 * s);
    ctx.fillStyle = '#d97706';
    ctx.fillRect(42 * s, 82 * s, 14 * s, 76 * s);
    ctx.fillStyle = '#0f172a';
    ctx.font = `bold ${Math.round(34 * s)}px Inter, Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, w * 0.5 + 4 * s, 114 * s);
    ctx.fillStyle = '#475569';
    ctx.font = `bold ${Math.round(12 * s)}px monospace`;
    ctx.fillText('EUROHAUL LOGISTICS · TIR', w * 0.5 + 4 * s, 142 * s);

    for (let x = 14 * s; x < w - 28 * s; x += 34 * s) {
      ctx.fillStyle = '#facc15';
      ctx.fillRect(x, halfH - 24 * s, 22 * s, 6 * s);
      rCtx.fillStyle = 'rgb(60, 60, 60)';
      rCtx.fillRect(x, halfH - 24 * s, 22 * s, 6 * s);
    }

    // 2. Bottom-left (0..halfW, halfH..h): clean ribbed trailer roof
    ctx.fillStyle = baseHex === '#f8fafc' ? '#f1f5f9' : '#e2e8f0';
    ctx.fillRect(0, halfH, halfW, halfH);
    for (let y = halfH; y < h; y += 22 * s) {
      ctx.fillStyle = 'rgba(15, 23, 42, 0.08)';
      ctx.fillRect(10 * s, y, halfW - 20 * s, 6 * s);
    }
    ctx.fillStyle = baseHex;
    ctx.fillRect(0, halfH, 12 * s, halfH);
    ctx.fillRect(halfW - 12 * s, halfH, 12 * s, halfH);

    // 3. Bottom-right (halfW..w, halfH..h): TIR double rear doors
    ctx.fillStyle = baseHex;
    ctx.fillRect(halfW, halfH, halfW, halfH);
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.72)';
    ctx.lineWidth = 6 * s;
    ctx.strokeRect(halfW + 10 * s, halfH + 10 * s, halfW - 20 * s, halfH - 20 * s);
    ctx.lineWidth = 4 * s;
    ctx.beginPath();
    ctx.moveTo(halfW + halfW * 0.5, halfH + 10 * s);
    ctx.lineTo(halfW + halfW * 0.5, h - 10 * s);
    ctx.stroke();

    ctx.fillStyle = '#cbd5e1';
    for (const frac of [0.21, 0.4, 0.6, 0.79]) {
      const bx = halfW + halfW * frac;
      ctx.fillRect(bx - 3 * s, halfH + 18 * s, 6 * s, halfH - 36 * s);
      ctx.fillStyle = '#475569';
      ctx.fillRect(bx - 6 * s, halfH + halfH * 0.58, 12 * s, 16 * s);
      ctx.fillStyle = '#cbd5e1';
    }

    ctx.fillStyle = '#1e3a8a';
    ctx.fillRect(halfW + 24 * s, halfH + 26 * s, 54 * s, 28 * s);
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 2 * s;
    ctx.strokeRect(halfW + 24 * s, halfH + 26 * s, 54 * s, 28 * s);
    ctx.fillStyle = '#f8fafc';
    ctx.font = `bold ${Math.round(17 * s)}px monospace`;
    ctx.fillText('TIR', halfW + 51 * s, halfH + 41 * s);

    for (const ox of [24 * s, halfW - 88 * s]) {
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(halfW + ox, h - 42 * s, 64 * s, 22 * s);
      ctx.fillStyle = '#facc15';
      ctx.fillRect(halfW + ox + 10 * s, h - 38 * s, 44 * s, 14 * s);
    }

    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = this.anisotropy;
    const roughnessMap = new THREE.CanvasTexture(roughCanvas);
    roughnessMap.anisotropy = this.anisotropy;
    const bumpMap = new THREE.CanvasTexture(bumpCanvas);
    bumpMap.anisotropy = this.anisotropy;

    this.cache.set(mapKey, map);
    this.cache.set(roughKey, roughnessMap);
    this.cache.set(bumpKey, bumpMap);
    return { map, roughnessMap, bumpMap };
  }

  public getDynamicCabGpsTexture(): THREE.CanvasTexture {
    if (this.gpsTexture) return this.gpsTexture;

    this.gpsCanvas = document.createElement('canvas');
    this.gpsCanvas.width = 384;
    this.gpsCanvas.height = 240;
    this.gpsCtx = this.gpsCanvas.getContext('2d')!;
    this.gpsTexture = new THREE.CanvasTexture(this.gpsCanvas);
    this.gpsTexture.colorSpace = THREE.SRGBColorSpace;
    this.updateDynamicCabGps({
      speedKmh: 0,
      speedLimitKmh: 50,
      distanceMeters: 0,
      hasActiveJob: false,
      instruction: '自由漫游模式',
    });
    return this.gpsTexture;
  }

  public updateDynamicCabGps(state: CabGpsDrawState): void {
    if (!this.gpsCtx || !this.gpsTexture) return;
    const qx = Math.round((state.truckX ?? 0) / 4);
    const qz = Math.round((state.truckZ ?? 0) / 4);
    const qh = Math.round((state.truckHeadingRad ?? 0) * 12);
    const distBucket = Math.round(state.distanceMeters / 30);
    const turnDir = state.turnDir ?? 'straight';
    const turnDistBucket =
      state.turnDistMeters !== null && state.turnDistMeters !== undefined
        ? Math.round(state.turnDistMeters / 10)
        : 'n';
    const key = `${qx}_${qz}_${qh}_${state.speedKmh}_${state.speedLimitKmh}_${distBucket}_${state.hasActiveJob}_${state.instruction}_${turnDir}_${turnDistBucket}`;
    if (key === this.lastGpsKey) return;
    this.lastGpsKey = key;

    const w = 384;
    const h = 240;
    const ctx = this.gpsCtx;
    ctx.fillStyle = '#08101c';
    ctx.fillRect(0, 0, w, h);

    // Subtle map grid backdrop
    ctx.strokeStyle = 'rgba(51, 65, 85, 0.24)';
    ctx.lineWidth = 1;
    for (let gx = 48; gx < w; gx += 48) {
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, h - 46);
      ctx.stroke();
    }
    for (let gy = 48; gy < h - 46; gy += 48) {
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(w, gy);
      ctx.stroke();
    }

    const cx = w * 0.5;
    const cy = 142;

    if (
      state.roadPolylines &&
      state.roadPolylines.length > 0 &&
      state.truckX !== undefined &&
      state.truckZ !== undefined &&
      state.truckHeadingRad !== undefined
    ) {
      const tx = state.truckX;
      const tz = state.truckZ;
      const sinY = Math.sin(state.truckHeadingRad);
      const cosY = Math.cos(state.truckHeadingRad);
      const rightX = -cosY;
      const rightZ = sinY;
      const scale = Math.max(0.20, Math.min(0.42, 0.42 - (Math.min(100, state.speedKmh) / 100) * 0.20));

      const toGps = (wx: number, wz: number): [number, number] => {
        const dx = wx - tx;
        const dz = wz - tz;
        const lateral = dx * rightX + dz * rightZ;
        const forward = dx * sinY + dz * cosY;
        return [cx + lateral * scale, cy - forward * scale];
      };

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, w, 194);
      ctx.clip();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Dark road casings + crisp road cores (AABB-culled to visible GPS window)
      const cullRange = 260 / scale;
      const cullMinX = tx - cullRange;
      const cullMaxX = tx + cullRange;
      const cullMinZ = tz - cullRange;
      const cullMaxZ = tz + cullRange;
      for (let i = 0; i < state.roadPolylines.length; i++) {
        const poly = state.roadPolylines[i]!;
        if (poly.points.length < 2) continue;
        if (
          poly.maxX !== undefined &&
          (poly.maxX < cullMinX || poly.minX! > cullMaxX || poly.maxZ! < cullMinZ || poly.minZ! > cullMaxZ)
        ) {
          continue;
        }
        ctx.beginPath();
        for (let p = 0; p < poly.points.length; p++) {
          const [gx, gy] = toGps(poly.points[p]!.x, poly.points[p]!.z);
          if (p === 0) ctx.moveTo(gx, gy);
          else ctx.lineTo(gx, gy);
        }
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = poly.isMotorway ? 12 : 8.5;
        ctx.stroke();
        ctx.strokeStyle = poly.isMotorway ? '#64748b' : '#475569';
        ctx.lineWidth = poly.isMotorway ? 8.5 : 5.5;
        ctx.stroke();
      }

      // Active glowing purple GPS route ribbon
      if (state.routePoints && state.routePoints.length > 1) {
        ctx.beginPath();
        for (let i = 0; i < state.routePoints.length; i++) {
          const [gx, gy] = toGps(state.routePoints[i]!.x, state.routePoints[i]!.z);
          if (i === 0) ctx.moveTo(gx, gy);
          else ctx.lineTo(gx, gy);
        }
        ctx.strokeStyle = 'rgba(168, 85, 247, 0.35)';
        ctx.lineWidth = 11;
        ctx.stroke();
        ctx.strokeStyle = '#c084fc';
        ctx.lineWidth = 6;
        ctx.stroke();
      }

      if (state.destPoint) {
        const [dx, dy] = toGps(state.destPoint.x, state.destPoint.z);
        ctx.fillStyle = '#10b981';
        ctx.beginPath();
        ctx.arc(dx, dy, 7.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#f8fafc';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.restore();
    } else {
      ctx.strokeStyle = state.hasActiveJob ? '#a855f7' : '#38bdf8';
      ctx.lineWidth = 15;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx, 190);
      ctx.quadraticCurveTo(
        cx,
        112,
        turnDir === 'left' ? 124 : turnDir === 'right' ? 260 : cx,
        40
      );
      ctx.stroke();
    }

    // Player amber chevron
    ctx.fillStyle = '#f59e0b';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 12);
    ctx.lineTo(cx + 9.5, cy + 9.5);
    ctx.lineTo(cx, cy + 4.5);
    ctx.lineTo(cx - 9.5, cy + 9.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Top-left next turn card
    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.fillRect(12, 12, 68, 54);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(12, 12, 68, 54);
    ctx.fillStyle = turnDir === 'arrive' ? '#34d399' : turnDir === 'straight' ? '#38bdf8' : '#fbbf24';
    ctx.font = 'bold 23px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const turnGlyph =
      turnDir === 'left' ? '↰' : turnDir === 'right' ? '↱' : turnDir === 'arrive' ? '⚑' : '↑';
    ctx.fillText(turnGlyph, 46, 30);
    ctx.fillStyle = '#cbd5e1';
    ctx.font = 'bold 12px monospace';
    ctx.fillText(
      state.turnDistMeters != null ? `${state.turnDistMeters}m` : `${state.speedKmh}km/h`,
      46,
      52
    );

    // Speed limit circle
    const speeding = state.speedKmh > state.speedLimitKmh + 5;
    ctx.fillStyle = speeding ? '#dc2626' : '#ffffff';
    ctx.beginPath();
    ctx.arc(340, 39, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = speeding ? '#fecaca' : '#dc2626';
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.fillStyle = speeding ? '#ffffff' : '#0f172a';
    ctx.font = 'bold 17px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(state.speedLimitKmh), 340, 40);

    // Bottom bar distance + guidance
    ctx.fillStyle = 'rgba(11, 18, 32, 0.96)';
    ctx.fillRect(0, 194, w, 46);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 194);
    ctx.lineTo(w, 194);
    ctx.stroke();

    const distText = state.hasActiveJob
      ? `${(state.distanceMeters / 1000).toFixed(1)}km`
      : 'SATNAV';
    ctx.font = 'bold 13px monospace';
    const distWidth = ctx.measureText(distText).width;
    const badgeW = Math.ceil(distWidth) + 16;
    const badgeX = w - badgeW - 12;

    ctx.fillStyle = state.hasActiveJob ? 'rgba(16, 185, 129, 0.2)' : 'rgba(56, 189, 248, 0.14)';
    ctx.fillRect(badgeX, 203, badgeW, 28);
    ctx.fillStyle = state.hasActiveJob ? '#34d399' : '#38bdf8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(distText, badgeX + badgeW / 2, 217);

    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'left';
    const maxInstrWidth = Math.max(40, badgeX - 22);
    let instr = state.instruction.trim();
    if (!state.hasActiveJob && instr.includes('自由')) {
      instr = '自由漫游 · 货场接单';
    }
    if (ctx.measureText(instr).width > maxInstrWidth) {
      while (instr.length > 1 && ctx.measureText(`${instr}…`).width > maxInstrWidth) {
        instr = instr.slice(0, -1);
      }
      instr = `${instr}…`;
    }
    ctx.fillText(instr, 12, 217);

    this.gpsTexture.needsUpdate = true;
  }

  public getHighwayGantryTexture(
    routeCode: string,
    destinationLabel: string,
    distanceLabel: string,
    style: 'motorway' | 'national'
  ): THREE.CanvasTexture {
    const key = `gantry_${routeCode}_${destinationLabel}_${distanceLabel}_${style}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 192;
    const ctx = canvas.getContext('2d')!;

    const isMotorway = style === 'motorway';
    ctx.fillStyle = isMotorway ? '#1d4ed8' : '#eab308';
    ctx.fillRect(0, 0, 512, 192);

    // Outer white or black reflective border
    ctx.strokeStyle = isMotorway ? '#f8fafc' : '#0f172a';
    ctx.lineWidth = 8;
    ctx.strokeRect(8, 8, 496, 176);

    // Route shield badge
    ctx.fillStyle = isMotorway ? '#1e3a8a' : '#fef08a';
    ctx.fillRect(26, 30, 108, 56);
    ctx.strokeStyle = isMotorway ? '#ffffff' : '#0f172a';
    ctx.lineWidth = 4;
    ctx.strokeRect(26, 30, 108, 56);

    ctx.fillStyle = isMotorway ? '#ffffff' : '#0f172a';
    ctx.font = 'bold 34px Inter, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(routeCode, 80, 59);

    // Destination text & distance
    ctx.textAlign = 'left';
    ctx.font = 'bold 34px Inter, Arial, sans-serif';
    ctx.fillText(destinationLabel, 152, 62);

    ctx.font = 'bold 26px monospace';
    ctx.fillStyle = isMotorway ? '#bae6fd' : '#1e293b';
    ctx.fillText(`↑ ${distanceLabel}`, 152, 126);

    // Downward lane arrows
    ctx.fillStyle = isMotorway ? '#ffffff' : '#0f172a';
    ctx.font = 'bold 30px sans-serif';
    ctx.fillText('⬇   ⬇', 382, 134);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.anisotropy;
    this.cache.set(key, tex);
    return tex;
  }

  public getWarehouseDockTexture(accentHex: string): THREE.CanvasTexture {
    const key = `warehouse_dock_${accentHex}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 192;
    const ctx = canvas.getContext('2d')!;

    // Corrugated steel warehouse facade
    ctx.fillStyle = '#475569';
    ctx.fillRect(0, 0, 512, 192);
    for (let x = 0; x < 512; x += 8) {
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(x, 0, 3, 192);
    }

    // Upper branding fascia stripe
    ctx.fillStyle = accentHex;
    ctx.fillRect(0, 0, 512, 34);

    // 4 Numbered Loading Docks (Dock 1..4)
    for (let d = 0; d < 4; d++) {
      const dx = 28 + d * 120;
      // Yellow/black dock bumper frame
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(dx - 4, 62, 92, 130);
      // Roll-up shutter door
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(dx + 2, 70, 80, 122);
      for (let ry = 82; ry < 188; ry += 12) {
        ctx.fillStyle = '#334155';
        ctx.fillRect(dx + 4, ry, 76, 4);
      }
      // Dock number sign
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(dx + 16, 40, 52, 20);
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 13px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`DOCK ${d + 1}`, dx + 42, 50);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.anisotropy;
    this.cache.set(key, tex);
    return tex;
  }

  public getSpeedSignTexture(speedLimitKmh: number): THREE.CanvasTexture {
    const key = `sign_${speedLimitKmh}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(128, 128, 122, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#dc2626';
    ctx.lineWidth = 26;
    ctx.beginPath();
    ctx.arc(128, 128, 104, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 104px Inter, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(speedLimitKmh), 128, 134);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.cache.set(key, tex);
    return tex;
  }

  public getDynamicDashboardTexture(): THREE.CanvasTexture {
    if (this.dashTexture) return this.dashTexture;

    this.dashCanvas = document.createElement('canvas');
    this.dashCanvas.width = 640;
    this.dashCanvas.height = 224;
    this.dashCtx = this.dashCanvas.getContext('2d')!;
    this.dashTexture = new THREE.CanvasTexture(this.dashCanvas);
    this.dashTexture.colorSpace = THREE.SRGBColorSpace;

    this.updateDynamicDashboard({
      speedKmh: 0,
      rpm: 650,
      gearLabel: 'A1',
      fuelPct: 100,
      parkingBrake: true,
      leftBlinker: false,
      rightBlinker: false,
    });

    return this.dashTexture;
  }

  public updateDynamicDashboard(state: DashboardDrawState): void {
    if (!this.dashCtx || !this.dashTexture) return;
    const airBar = state.airPressureBar ?? 8.0;
    const engineRunning = state.engineRunning ?? true;
    const exh = Boolean(state.exhaustBrakeActive);
    const ret = state.retarderLevel ?? 0;
    const lowAir = Boolean(state.lowAirWarning);
    const key = `${state.speedKmh}_${Math.round(state.rpm / 25)}_${state.gearLabel}_${Math.round(state.fuelPct)}_${state.parkingBrake}_${state.leftBlinker}_${state.rightBlinker}_${state.cruiseControlKmh ?? 'none'}_${airBar.toFixed(1)}_${engineRunning}_${exh}_${ret}_${lowAir}`;
    if (key === this.lastDashKey) return;
    this.lastDashKey = key;

    const w = 640;
    const h = 224;
    const ctx = this.dashCtx;
    ctx.fillStyle = '#070c16';
    ctx.fillRect(0, 0, w, h);

    // Subtle brushed-aluminum instrument bezel frame
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 3;
    ctx.strokeRect(3, 3, w - 6, h - 6);

    const drawDial = (
      cx: number,
      cy: number,
      radius: number,
      ratio: number,
      title: string,
      valueText: string,
      labels: string[],
      redStartRatio: number,
      ecoBand?: [number, number]
    ) => {
      // Dial recessed background + outer metallic bezel ring
      ctx.fillStyle = '#0b1220';
      ctx.beginPath();
      ctx.arc(cx, cy, radius + 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, Math.PI * 0.75, Math.PI * 2.25);
      ctx.stroke();

      if (ecoBand) {
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(
          cx,
          cy,
          radius,
          Math.PI * 0.75 + ecoBand[0] * Math.PI * 1.5,
          Math.PI * 0.75 + ecoBand[1] * Math.PI * 1.5
        );
        ctx.stroke();
      }

      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(
        cx,
        cy,
        radius,
        Math.PI * 0.75 + redStartRatio * Math.PI * 1.5,
        Math.PI * 2.25
      );
      ctx.stroke();

      const totalTicks = (labels.length - 1) * 2;
      for (let i = 0; i <= totalTicks; i++) {
        const frac = i / totalTicks;
        const a = Math.PI * 0.75 + frac * Math.PI * 1.5;
        const major = i % 2 === 0;
        ctx.strokeStyle = frac >= redStartRatio ? '#f87171' : '#e2e8f0';
        ctx.lineWidth = major ? 2.5 : 1.2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * (radius - (major ? 12 : 7)), cy + Math.sin(a) * (radius - (major ? 12 : 7)));
        ctx.lineTo(cx + Math.cos(a) * (radius - 2), cy + Math.sin(a) * (radius - 2));
        ctx.stroke();

        if (major) {
          const lbl = labels[i / 2]!;
          ctx.fillStyle = frac >= redStartRatio ? '#fca5a5' : '#cbd5e1';
          ctx.font = 'bold 10px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(lbl, cx + Math.cos(a) * (radius - 22), cy + Math.sin(a) * (radius - 22));
        }
      }

      const needleAngle = Math.PI * 0.75 + Math.max(0, Math.min(1, ratio)) * Math.PI * 1.5;
      ctx.strokeStyle = '#f97316';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(cx - Math.cos(needleAngle) * 10, cy - Math.sin(needleAngle) * 10);
      ctx.lineTo(cx + Math.cos(needleAngle) * (radius - 13), cy + Math.sin(needleAngle) * (radius - 13));
      ctx.stroke();

      ctx.fillStyle = '#1e293b';
      ctx.beginPath();
      ctx.arc(cx, cy, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(title, cx, cy + 36);

      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 16px monospace';
      ctx.fillText(valueText, cx, cy + 56);
    };

    drawDial(
      110,
      112,
      74,
      state.speedKmh / 120,
      'KM/H',
      String(state.speedKmh),
      ['0', '20', '40', '60', '80', '100', '120'],
      0.78
    );
    drawDial(
      530,
      112,
      74,
      state.rpm / 2500,
      'RPM x100',
      String(Math.round(state.rpm)),
      ['0', '5', '10', '15', '20', '25'],
      0.84,
      [0.40, 0.60]
    );

    // Center High-Contrast Digital TFT MFD
    ctx.fillStyle = '#0c172b';
    ctx.fillRect(212, 16, 216, 192);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.strokeRect(212, 16, 216, 192);

    ctx.fillStyle = 'rgba(30, 41, 59, 0.65)';
    ctx.fillRect(214, 18, 212, 32);

    // Top row: Blinker arrows + Cruise + Air pressure readout
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = state.leftBlinker ? '#34d399' : '#334155';
    ctx.fillText('◄', 234, 34);
    ctx.fillStyle = state.rightBlinker ? '#34d399' : '#334155';
    ctx.fillText('►', 406, 34);

    ctx.font = 'bold 13px monospace';
    ctx.fillStyle = state.cruiseControlKmh != null ? '#34d399' : '#94a3b8';
    ctx.fillText(
      state.cruiseControlKmh != null ? `CC ${state.cruiseControlKmh}` : `${airBar.toFixed(1)} BAR`,
      320,
      34
    );

    // Core high-contrast digital speedometer
    ctx.fillStyle = engineRunning ? '#ffffff' : '#64748b';
    ctx.font = 'bold 48px monospace';
    ctx.fillText(String(state.speedKmh), 320, 86);

    ctx.fillStyle = lowAir ? '#ef4444' : !engineRunning ? '#f59e0b' : '#38bdf8';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText(
      lowAir ? 'LOW AIR!' : !engineRunning ? 'IGN OFF [I]' : 'KM/H',
      320,
      118
    );

    // Auxiliary status badges (EXH / R1-3)
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = exh ? '#38bdf8' : '#475569';
    ctx.fillText('EXH', 226, 118);
    ctx.textAlign = 'right';
    ctx.fillStyle = ret > 0 ? '#f59e0b' : '#475569';
    ctx.fillText(ret > 0 ? `R${ret}` : 'RET', 414, 118);

    // Gear & Parking brake pill
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 26px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(state.gearLabel, 226, 148);

    ctx.fillStyle = state.parkingBrake ? 'rgba(239, 68, 68, 0.22)' : 'rgba(16, 185, 129, 0.14)';
    ctx.fillRect(334, 136, 82, 22);
    ctx.fillStyle = state.parkingBrake ? '#f87171' : '#34d399';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(state.parkingBrake ? 'PARK [P]' : 'DRIVE', 375, 148);

    // Labeled RPM, Air Pressure & Fuel status bars
    const drawBar = (yPos: number, lbl: string, frac: number, fillCol: string) => {
      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(lbl, 224, yPos + 3);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(256, yPos, 160, 6);
      ctx.fillStyle = fillCol;
      ctx.fillRect(256, yPos, 160 * Math.max(0, Math.min(1, frac)), 6);
    };

    const rpmFrac = (state.rpm - 600) / 1700;
    drawBar(166, 'RPM', rpmFrac, state.rpm > 1850 ? '#ef4444' : state.rpm > 1550 ? '#fbbf24' : '#38bdf8');
    drawBar(179, 'AIR', airBar / 8.5, lowAir ? '#ef4444' : '#38bdf8');
    drawBar(192, 'FUEL', state.fuelPct / 100, state.fuelPct < 18 ? '#ef4444' : '#10b981');

    this.dashTexture.needsUpdate = true;
  }

  public getParkingBayTexture(): THREE.CanvasTexture {
    const key = 'parking_bay_pad';
    const cached = this.cache.get(key);
    if (cached) return cached;

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;

    ctx.clearRect(0, 0, 256, 512);
    ctx.fillStyle = 'rgba(16, 185, 129, 0.16)';
    ctx.fillRect(14, 14, 228, 484);

    ctx.strokeStyle = '#34d399';
    ctx.lineWidth = 10;
    ctx.setLineDash([28, 16]);
    ctx.strokeRect(16, 16, 224, 480);

    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(52, 211, 153, 0.78)';
    for (const y of [130, 256, 382]) {
      ctx.beginPath();
      ctx.moveTo(128, y + 32);
      ctx.lineTo(176, y - 16);
      ctx.lineTo(154, y - 16);
      ctx.lineTo(128, y + 10);
      ctx.lineTo(102, y - 16);
      ctx.lineTo(80, y - 16);
      ctx.closePath();
      ctx.fill();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.cache.set(key, tex);
    return tex;
  }

  public getBlobShadowTexture(): THREE.CanvasTexture {
    const key = 'blob_shadow';
    const cached = this.cache.get(key);
    if (cached) return cached;

    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    ctx.clearRect(0, 0, 128, 256);
    ctx.save();
    ctx.translate(64, 128);
    ctx.scale(1, 2);
    const grad = ctx.createRadialGradient(0, 0, 14, 0, 0, 56);
    grad.addColorStop(0, 'rgba(2, 6, 23, 0.58)');
    grad.addColorStop(0.55, 'rgba(2, 6, 23, 0.34)');
    grad.addColorStop(1, 'rgba(2, 6, 23, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, 58, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const tex = new THREE.CanvasTexture(canvas);
    this.cache.set(key, tex);
    return tex;
  }

  public getHeadlightGlowTexture(): THREE.CanvasTexture {
    const key = 'headlight_glow_flare';
    const cached = this.cache.get(key);
    if (cached) return cached;

    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;

    const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0, 'rgba(255, 252, 235, 0.95)');
    grad.addColorStop(0.35, 'rgba(254, 243, 199, 0.45)');
    grad.addColorStop(1, 'rgba(254, 243, 199, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.cache.set(key, tex);
    return tex;
  }

  public getExitCountdownTexture(meters: 300 | 200 | 100): THREE.CanvasTexture {
    const key = `exit_countdown_${meters}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, 128, 256);
    ctx.strokeStyle = '#1d4ed8';
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, 120, 248);

    ctx.fillStyle = '#1d4ed8';
    ctx.fillRect(10, 14, 108, 44);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 26px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${meters}m`, 64, 37);

    const stripes = meters === 300 ? 3 : meters === 200 ? 2 : 1;
    ctx.fillStyle = '#1d4ed8';
    for (let i = 0; i < stripes; i++) {
      const y = 84 + i * 52;
      ctx.beginPath();
      ctx.moveTo(16, y + 26);
      ctx.lineTo(112, y);
      ctx.lineTo(112, y + 24);
      ctx.lineTo(16, y + 50);
      ctx.closePath();
      ctx.fill();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.anisotropy;
    this.cache.set(key, tex);
    return tex;
  }

  public getCurveChevronTexture(): THREE.CanvasTexture {
    const key = 'alpine_curve_chevron';
    const cached = this.cache.get(key);
    if (cached) return cached;

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, 256, 128);
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 6;
    ctx.strokeRect(4, 4, 248, 120);

    ctx.fillStyle = '#facc15';
    for (const bx of [32, 104, 176]) {
      ctx.beginPath();
      ctx.moveTo(bx, 18);
      ctx.lineTo(bx + 36, 64);
      ctx.lineTo(bx, 110);
      ctx.lineTo(bx + 26, 110);
      ctx.lineTo(bx + 62, 64);
      ctx.lineTo(bx + 26, 18);
      ctx.closePath();
      ctx.fill();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.anisotropy;
    this.cache.set(key, tex);
    return tex;
  }

  public getCityWelcomeSignTexture(cityLabel: string, country: string): THREE.CanvasTexture {
    const key = `city_welcome_${cityLabel}_${country}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;

    const isAustria = country.includes('奥地利');
    ctx.fillStyle = isAustria ? '#f8fafc' : '#facc15';
    ctx.fillRect(0, 0, 256, 128);
    ctx.strokeStyle = isAustria ? '#1d4ed8' : '#0f172a';
    ctx.lineWidth = 10;
    ctx.strokeRect(7, 7, 242, 114);

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 34px Inter, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(cityLabel, 128, 54);

    ctx.fillStyle = isAustria ? '#1d4ed8' : '#334155';
    ctx.font = 'bold 16px monospace';
    ctx.fillText(isAustria ? 'ÖSTERREICH · TIROL' : 'DEUTSCHLAND', 128, 94);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.anisotropy;
    this.cache.set(key, tex);
    return tex;
  }

  public getSoftParticleTexture(): THREE.CanvasTexture {
    const key = 'soft_spray_particle';
    const cached = this.cache.get(key);
    if (cached) return cached;

    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(226, 232, 240, 0.85)');
    grad.addColorStop(0.5, 'rgba(203, 213, 225, 0.35)');
    grad.addColorStop(1, 'rgba(203, 213, 225, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.cache.set(key, tex);
    return tex;
  }

  public getWindshieldRainTexture(): THREE.CanvasTexture {
    if (this.rainTexture) return this.rainTexture;
    this.rainCanvas = document.createElement('canvas');
    this.rainCanvas.width = 512;
    this.rainCanvas.height = 256;
    this.rainCtx = this.rainCanvas.getContext('2d')!;
    this.rainTexture = new THREE.CanvasTexture(this.rainCanvas);
    this.rainTexture.colorSpace = THREE.SRGBColorSpace;
    return this.rainTexture;
  }

  public updateWindshieldRain(
    dtSec: number,
    rainIntensity: number,
    wiperAngleRad: number,
    wipersMode: WipersMode,
    speedKmh = 0
  ): void {
    if (!this.rainCtx || !this.rainTexture) return;
    const W = 512;
    const H = 256;
    if (rainIntensity < 0.16) {
      if (this.rainDrops.length > 0) {
        this.rainDrops.length = 0;
        this.rainCtx.clearRect(0, 0, W, H);
        this.rainTexture.needsUpdate = true;
      }
      this.prevWiperAngle = wiperAngleRad;
      return;
    }

    // Spawn fine realistic raindrops proportional to rain intensity
    const normRain = Math.max(0, (rainIntensity - 0.16) / 0.84);
    const maxDrops = Math.round(16 + normRain * 120);
    const spawnBudget = Math.max(0, rainIntensity - 0.12) * 165 * dtSec;
    const spawnCount = Math.floor(spawnBudget) + (Math.random() < spawnBudget % 1 ? 1 : 0);
    for (let i = 0; i < spawnCount && this.rainDrops.length < maxDrops; i++) {
      this.rainDrops.push({
        x: Math.random() * W,
        y: Math.random() * (H - 6),
        r: 0.7 + Math.random() * 0.85,
        vy: 15 + Math.random() * 28,
      });
    }

    // Advance & wipe drops in the swept wiper arc
    const minAng = Math.min(this.prevWiperAngle, wiperAngleRad) - 0.09;
    const maxAng = Math.max(this.prevWiperAngle, wiperAngleRad) + 0.09;
    const wiperSweeping = wipersMode > 0 && Math.abs(wiperAngleRad - this.prevWiperAngle) > 0.002;
    const speedFlowScale = 1 + Math.min(2.2, Math.abs(speedKmh) / 42);

    // Two wiper pivots in windshield local coordinates (2.24m x 1.18m centered at y=2.62)
    // u = (1.12 - worldX) / 2.24, v = (3.21 - worldY) / 1.18
    const pivotYs = H; // y=2.03 -> bottom edge
    const pivotXs = [((1.12 - 0.52) / 2.24) * W, ((1.12 - -0.18) / 2.24) * W];
    const bladeRadiusPx = (0.76 / 1.18) * H;
    const minPivotDist = (28 / 256) * H;

    for (let i = this.rainDrops.length - 1; i >= 0; i--) {
      const d = this.rainDrops[i]!;
      d.y += d.vy * speedFlowScale * dtSec;
      if (d.y > H) {
        this.rainDrops.splice(i, 1);
        continue;
      }

      if (wiperSweeping) {
        let wiped = false;
        for (let p = 0; p < 2; p++) {
          const dx = d.x - pivotXs[p]!; // +dx points right (-worldX)
          const dy = pivotYs - d.y; // +dy points up (+worldY)
          const dist = Math.hypot(dx, dy);
          if (dist >= minPivotDist && dist <= bladeRadiusPx) {
            const bladeTheta = -Math.atan2(dy, dx); // matches pivot.rotation.z in [-1.5..-0.02]
            if (bladeTheta >= minAng && bladeTheta <= maxAng) {
              wiped = true;
              break;
            }
          }
        }
        if (wiped) {
          this.rainDrops.splice(i, 1);
        }
      }
    }
    this.prevWiperAngle = wiperAngleRad;

    this.rainAccumSec += dtSec;
    if (this.rainAccumSec < 0.045) return;
    this.rainAccumSec = 0;

    const ctx = this.rainCtx;
    ctx.clearRect(0, 0, W, H);
    const speedStreakBase = Math.min(18, (Math.abs(speedKmh) / 85) * 14);

    // Pass 1: Faint upper water streak tails (single batched stroke)
    ctx.strokeStyle = 'rgba(215, 228, 242, 0.12)';
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    for (let i = 0; i < this.rainDrops.length; i++) {
      const d = this.rainDrops[i]!;
      const streakLen = 3 + Math.min(18, speedStreakBase + d.r * 2.2);
      ctx.moveTo(d.x, d.y - streakLen);
      ctx.lineTo(d.x, d.y - streakLen * 0.45);
    }
    ctx.stroke();

    // Pass 2: Brighter lower water streak cores (single batched stroke)
    ctx.strokeStyle = 'rgba(215, 228, 242, 0.28)';
    ctx.lineWidth = 1.15;
    ctx.beginPath();
    for (let i = 0; i < this.rainDrops.length; i++) {
      const d = this.rainDrops[i]!;
      const streakLen = 3 + Math.min(18, speedStreakBase + d.r * 2.2);
      ctx.moveTo(d.x, d.y - streakLen * 0.48);
      ctx.lineTo(d.x, d.y);
    }
    ctx.stroke();

    // Pass 3: Droplet oval bodies & lower refraction glints (2 batched fills)
    ctx.fillStyle = 'rgba(210, 225, 240, 0.30)';
    ctx.beginPath();
    for (let i = 0; i < this.rainDrops.length; i++) {
      const d = this.rainDrops[i]!;
      ctx.moveTo(d.x + d.r * 0.85, d.y);
      ctx.ellipse(d.x, d.y, d.r * 0.85, d.r * 1.45, 0, 0, Math.PI * 2);
    }
    ctx.fill();

    ctx.fillStyle = 'rgba(242, 248, 255, 0.48)';
    ctx.beginPath();
    for (let i = 0; i < this.rainDrops.length; i++) {
      const d = this.rainDrops[i]!;
      const gr = Math.max(0.4, d.r * 0.35);
      const gy = d.y + d.r * 0.45;
      ctx.moveTo(d.x + gr, gy);
      ctx.arc(d.x, gy, gr, 0, Math.PI * 2);
    }
    ctx.fill();

    this.rainTexture.needsUpdate = true;
  }

  public getTireTextures(): { map: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture } {
    const mapKey = 'tire_tread_map';
    const bumpKey = 'tire_tread_bump';
    const existingMap = this.cache.get(mapKey);
    const existingBump = this.cache.get(bumpKey);
    if (existingMap && existingBump) {
      return { map: existingMap, bumpMap: existingBump };
    }

    const w = 256;
    const h = 256;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;

    const bumpCanvas = document.createElement('canvas');
    bumpCanvas.width = w;
    bumpCanvas.height = h;
    const bCtx = bumpCanvas.getContext('2d')!;

    ctx.fillStyle = '#1b1f26';
    ctx.fillRect(0, 0, w, h);
    bCtx.fillStyle = 'rgb(155, 155, 155)';
    bCtx.fillRect(0, 0, w, h);

    // 4 deep longitudinal highway tread grooves
    for (const gy of [56, 102, 154, 200]) {
      ctx.fillStyle = '#0d1015';
      ctx.fillRect(0, gy - 5, w, 10);
      bCtx.fillStyle = 'rgb(45, 45, 45)';
      bCtx.fillRect(0, gy - 5, w, 10);
    }

    // Angled shoulder tread lugs
    ctx.fillStyle = '#101318';
    bCtx.fillStyle = 'rgb(65, 65, 65)';
    for (let x = 0; x < w; x += 16) {
      ctx.fillRect(x, 8, 6, 40);
      ctx.fillRect(x + 8, 208, 6, 40);
      bCtx.fillRect(x, 8, 6, 40);
      bCtx.fillRect(x + 8, 208, 6, 40);
    }

    const map = new THREE.CanvasTexture(canvas);
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(6, 1);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = this.anisotropy;

    const bumpMap = new THREE.CanvasTexture(bumpCanvas);
    bumpMap.wrapS = THREE.RepeatWrapping;
    bumpMap.wrapT = THREE.RepeatWrapping;
    bumpMap.repeat.set(6, 1);
    bumpMap.anisotropy = this.anisotropy;

    this.cache.set(mapKey, map);
    this.cache.set(bumpKey, bumpMap);
    return { map, bumpMap };
  }

  public getWheelRimTexture(): THREE.CanvasTexture {
    const key = 'wheel_rim_lug_albedo';
    const cached = this.cache.get(key);
    if (cached) return cached;

    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    const grad = ctx.createRadialGradient(128, 128, 18, 128, 128, 126);
    grad.addColorStop(0, '#475569');
    grad.addColorStop(0.28, '#cbd5e1');
    grad.addColorStop(0.85, '#e2e8f0');
    grad.addColorStop(1, '#94a3b8');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    // Ventilation cutouts around outer dish
    ctx.fillStyle = '#1e293b';
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(128 + Math.cos(a) * 92, 128 + Math.sin(a) * 92, 10, 0, Math.PI * 2);
      ctx.fill();
    }

    // 10 chrome lug nuts around bolt circle
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.31;
      const lx = 128 + Math.cos(a) * 56;
      const ly = 128 + Math.sin(a) * 56;
      ctx.fillStyle = '#334155';
      ctx.beginPath();
      ctx.arc(lx, ly, 7.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath();
      ctx.arc(lx - 1, ly - 1, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Center hub cap
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.arc(128, 128, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 3;
    ctx.stroke();

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.anisotropy;
    this.cache.set(key, tex);
    return tex;
  }

  public getLicensePlateTexture(plateText = 'M · EH 2026'): THREE.CanvasTexture {
    const key = `eu_plate_${plateText}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, 256, 64);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, 252, 60);

    // Blue EU strip with 'D'
    ctx.fillStyle = '#1d4ed8';
    ctx.fillRect(4, 4, 34, 56);
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.arc(21, 20, 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('D', 21, 46);

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 30px monospace';
    ctx.fillText(plateText, 146, 34);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.anisotropy;
    this.cache.set(key, tex);
    return tex;
  }

  public getBuildingFacadeTexture(kind: 'warehouse' | 'office' | 'cottage'): THREE.CanvasTexture {
    const key = `facade_${kind}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    if (kind === 'cottage') {
      ctx.fillStyle = '#ede9df';
      ctx.fillRect(0, 0, 256, 256);
      // Timber framing + warm lit windows + door
      ctx.fillStyle = '#5c4033';
      ctx.fillRect(0, 0, 256, 16);
      ctx.fillRect(0, 122, 256, 10);
      for (const wx of [34, 162]) {
        for (const wy of [40, 152]) {
          ctx.fillStyle = '#334155';
          ctx.fillRect(wx - 3, wy - 3, 62, 52);
          ctx.fillStyle = '#fef3c7';
          ctx.fillRect(wx, wy, 56, 46);
          ctx.fillStyle = '#334155';
          ctx.fillRect(wx + 26, wy, 4, 46);
          ctx.fillRect(wx, wy + 21, 56, 4);
        }
      }
      ctx.fillStyle = '#7c2d12';
      ctx.fillRect(108, 168, 40, 88);
    } else if (kind === 'office') {
      ctx.fillStyle = '#334155';
      ctx.fillRect(0, 0, 256, 256);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, 0, 256, 28);
      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 3; col++) {
          const wx = 24 + col * 76;
          const wy = 46 + row * 72;
          ctx.fillStyle = '#93c5fd';
          ctx.fillRect(wx, wy, 56, 44);
          ctx.fillStyle = 'rgba(15, 23, 42, 0.35)';
          ctx.fillRect(wx, wy, 56, 12);
        }
      }
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(98, 192, 60, 64);
    } else {
      ctx.fillStyle = '#64748b';
      ctx.fillRect(0, 0, 256, 256);
      for (let x = 0; x < 256; x += 12) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.14)';
        ctx.fillRect(x, 0, 4, 256);
      }
      ctx.fillStyle = '#334155';
      ctx.fillRect(0, 0, 256, 26);
      // Clerestory warehouse windows
      for (let x = 18; x < 230; x += 56) {
        ctx.fillStyle = '#bae6fd';
        ctx.fillRect(x, 42, 42, 28);
      }
      // Industrial roller door
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(88, 120, 80, 136);
      for (let y = 134; y < 252; y += 16) {
        ctx.fillStyle = '#475569';
        ctx.fillRect(92, y, 72, 4);
      }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.anisotropy;
    this.cache.set(key, tex);
    return tex;
  }

  public dispose(): void {
    for (const tex of this.cache.values()) {
      tex.dispose();
    }
    this.cache.clear();
    this.dashTexture?.dispose();
    this.dashTexture = null;
    this.gpsTexture?.dispose();
    this.gpsTexture = null;
    this.rainTexture?.dispose();
    this.rainTexture = null;
  }
}
