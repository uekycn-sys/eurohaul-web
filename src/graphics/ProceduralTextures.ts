import * as THREE from 'three';
import { QualityPreset } from '../store/useGameStore';

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

export interface CabGpsDrawState {
  speedKmh: number;
  speedLimitKmh: number;
  distanceMeters: number;
  hasActiveJob: boolean;
  instruction: string;
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

    // Subtle yellow diagonal hazard stripe along one slab edge
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, size, 18 * s);
    ctx.clip();
    ctx.fillStyle = 'rgba(245, 158, 11, 0.52)';
    for (let x = -size; x < size * 2; x += 28 * s) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 14 * s, 0);
      ctx.lineTo(x + 2 * s, 18 * s);
      ctx.lineTo(x - 12 * s, 18 * s);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

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
    this.gpsCanvas.width = 256;
    this.gpsCanvas.height = 160;
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
    const distBucket = Math.round(state.distanceMeters / 50);
    const key = `${state.speedKmh}_${state.speedLimitKmh}_${distBucket}_${state.hasActiveJob}_${state.instruction}`;
    if (key === this.lastGpsKey) return;
    this.lastGpsKey = key;

    const ctx = this.gpsCtx;
    ctx.fillStyle = '#09111f';
    ctx.fillRect(0, 0, 256, 160);

    // Stylized GPS road ribbon
    ctx.strokeStyle = state.hasActiveJob ? '#a855f7' : '#38bdf8';
    ctx.lineWidth = 14;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(128, 152);
    ctx.quadraticCurveTo(128, 92, state.instruction.includes('左') ? 82 : state.instruction.includes('右') ? 174 : 128, 28);
    ctx.stroke();

    // Player chevron
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.moveTo(128, 112);
    ctx.lineTo(140, 136);
    ctx.lineTo(128, 130);
    ctx.lineTo(116, 136);
    ctx.closePath();
    ctx.fill();

    // Speed limit circle (inset safely from right edge)
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(216, 36, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#dc2626';
    ctx.lineWidth = 4.5;
    ctx.stroke();
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 15px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(state.speedLimitKmh), 216, 37);

    // Bottom bar distance + guidance (generous margins & strict ellipsis so text never clips right edge)
    ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
    ctx.fillRect(0, 120, 256, 40);

    const distText = state.hasActiveJob
      ? `${(state.distanceMeters / 1000).toFixed(1)}km`
      : 'SATNAV';
    ctx.font = 'bold 11px monospace';
    const distWidth = ctx.measureText(distText).width;
    const badgeW = Math.ceil(distWidth) + 12;
    const badgeX = 256 - badgeW - 10;

    ctx.fillStyle = state.hasActiveJob ? 'rgba(16, 185, 129, 0.16)' : 'rgba(148, 163, 184, 0.14)';
    ctx.fillRect(badgeX, 128, badgeW, 24);
    ctx.fillStyle = state.hasActiveJob ? '#34d399' : '#94a3b8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(distText, badgeX + badgeW / 2, 140);

    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'left';
    const maxInstrWidth = Math.max(40, badgeX - 16);
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
    ctx.fillText(instr, 10, 139);

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
    this.dashCanvas.width = 512;
    this.dashCanvas.height = 192;
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

    const ctx = this.dashCtx;
    ctx.fillStyle = '#0a101d';
    ctx.fillRect(0, 0, 512, 192);

    // Soft backlit console bezel
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, 504, 184);

    const drawDial = (
      cx: number,
      cy: number,
      radius: number,
      ratio: number,
      title: string,
      valueText: string,
      redStartRatio = 0.88
    ) => {
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, Math.PI * 0.75, Math.PI * 2.25);
      ctx.stroke();

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

      for (let i = 0; i <= 10; i++) {
        const a = Math.PI * 0.75 + (i / 10) * Math.PI * 1.5;
        ctx.strokeStyle = i / 10 >= redStartRatio ? '#f87171' : '#e2e8f0';
        ctx.lineWidth = i % 2 === 0 ? 3 : 1.5;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * (radius - 11), cy + Math.sin(a) * (radius - 11));
        ctx.lineTo(cx + Math.cos(a) * (radius - 2), cy + Math.sin(a) * (radius - 2));
        ctx.stroke();
      }

      const needleAngle = Math.PI * 0.75 + Math.max(0, Math.min(1, ratio)) * Math.PI * 1.5;
      ctx.strokeStyle = '#f97316';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(needleAngle) * (radius - 14), cy + Math.sin(needleAngle) * (radius - 14));
      ctx.stroke();

      ctx.fillStyle = '#f8fafc';
      ctx.beginPath();
      ctx.arc(cx, cy, 7, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(title, cx, cy + 34);

      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 16px monospace';
      ctx.fillText(valueText, cx, cy + 54);
    };

    drawDial(92, 96, 62, state.speedKmh / 120, 'KM/H', String(state.speedKmh), 0.78);
    drawDial(420, 96, 62, state.rpm / 2500, 'RPM', String(Math.round(state.rpm)), 0.88);

    // Center High-Contrast Digital MFD positioned inside the unobstructed upper steering wheel opening
    ctx.fillStyle = '#0f1b33';
    ctx.fillRect(172, 16, 168, 160);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.strokeRect(172, 16, 168, 160);

    // Top row: Blinker arrows + Cruise indicator
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = state.leftBlinker ? '#34d399' : '#1e293b';
    ctx.fillText('◄', 192, 34);
    ctx.fillStyle = state.rightBlinker ? '#34d399' : '#1e293b';
    ctx.fillText('►', 320, 34);

    ctx.font = 'bold 12px monospace';
    ctx.fillStyle = state.cruiseControlKmh != null ? '#34d399' : '#475569';
    ctx.fillText(
      state.cruiseControlKmh != null ? `CC ${state.cruiseControlKmh}` : 'CC --',
      256,
      34
    );

    // Core high-contrast digital speedometer (clearly visible through upper wheel rim)
    ctx.fillStyle = engineRunning ? '#ffffff' : '#64748b';
    ctx.font = 'bold 44px monospace';
    ctx.fillText(String(state.speedKmh), 256, 76);

    ctx.fillStyle = lowAir ? '#ef4444' : !engineRunning ? '#f59e0b' : '#38bdf8';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText(
      lowAir ? 'LOW AIR!' : !engineRunning ? 'IGN OFF [I]' : 'KM/H',
      256,
      104
    );

    // Auxiliary status badges (EXH / R1-3)
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = exh ? '#38bdf8' : '#334155';
    ctx.fillText('EXH', 184, 104);
    ctx.textAlign = 'right';
    ctx.fillStyle = ret > 0 ? '#f59e0b' : '#334155';
    ctx.fillText(ret > 0 ? `R${ret}` : 'RET', 328, 104);

    // Gear & Parking brake row
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 24px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(state.gearLabel, 186, 130);

    ctx.fillStyle = state.parkingBrake ? '#ef4444' : '#64748b';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(state.parkingBrake ? 'PARK [P]' : 'DRIVE', 326, 130);

    // Compact RPM, Air Pressure (MPa) & Fuel status bars
    const rpmFrac = Math.max(0, Math.min(1, (state.rpm - 600) / 1700));
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(186, 145, 140, 5);
    ctx.fillStyle = state.rpm > 1850 ? '#ef4444' : state.rpm > 1550 ? '#fbbf24' : '#38bdf8';
    ctx.fillRect(186, 145, 140 * rpmFrac, 5);

    const airFrac = Math.max(0, Math.min(1, airBar / 8.5));
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(186, 154, 140, 5);
    ctx.fillStyle = lowAir ? '#ef4444' : '#38bdf8';
    ctx.fillRect(186, 154, 140 * airFrac, 5);

    ctx.fillStyle = '#1e293b';
    ctx.fillRect(186, 163, 140, 5);
    ctx.fillStyle = state.fuelPct < 18 ? '#ef4444' : '#10b981';
    ctx.fillRect(186, 163, 140 * Math.max(0, Math.min(1, state.fuelPct / 100)), 5);

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

  public dispose(): void {
    for (const tex of this.cache.values()) {
      tex.dispose();
    }
    this.cache.clear();
    this.dashTexture?.dispose();
    this.dashTexture = null;
    this.gpsTexture?.dispose();
    this.gpsTexture = null;
  }
}
