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

    // Reflective European road markings (crisp solid edges + center divider)
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
      paintPaint(size / 2 - 10 * sScale, 0, 6 * sScale, size, '#f59e0b');
      paintPaint(size / 2 + 4 * sScale, 0, 6 * sScale, size, '#f59e0b');
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
    const key = `${state.speedKmh}_${Math.round(state.rpm / 25)}_${state.gearLabel}_${Math.round(state.fuelPct)}_${state.parkingBrake}_${state.leftBlinker}_${state.rightBlinker}`;
    if (key === this.lastDashKey) return;
    this.lastDashKey = key;

    const ctx = this.dashCtx;
    ctx.fillStyle = '#0c1322';
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

      // Eco or redline arc
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

      // Tick marks
      for (let i = 0; i <= 10; i++) {
        const a = Math.PI * 0.75 + (i / 10) * Math.PI * 1.5;
        ctx.strokeStyle = i / 10 >= redStartRatio ? '#f87171' : '#e2e8f0';
        ctx.lineWidth = i % 2 === 0 ? 3 : 1.5;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * (radius - 11), cy + Math.sin(a) * (radius - 11));
        ctx.lineTo(cx + Math.cos(a) * (radius - 2), cy + Math.sin(a) * (radius - 2));
        ctx.stroke();
      }

      // Rotating orange needle
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
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(title, cx, cy + 36);

      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 18px monospace';
      ctx.fillText(valueText, cx, cy + 56);
    };

    drawDial(104, 92, 66, state.speedKmh / 120, 'KM/H', String(state.speedKmh), 0.78);
    drawDial(408, 92, 66, state.rpm / 2500, 'RPM', String(Math.round(state.rpm)), 0.88);

    // Center MFD trip screen
    ctx.fillStyle = '#111c33';
    ctx.fillRect(194, 24, 124, 144);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.strokeRect(194, 24, 124, 144);

    // Blinker arrows
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = state.leftBlinker ? '#34d399' : '#1e293b';
    ctx.fillText('◄', 216, 46);
    ctx.fillStyle = state.rightBlinker ? '#34d399' : '#1e293b';
    ctx.fillText('►', 296, 46);

    // Gear & Parking brake
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 34px monospace';
    ctx.fillText(state.gearLabel, 256, 94);

    ctx.fillStyle = state.parkingBrake ? '#ef4444' : '#334155';
    ctx.font = 'bold 14px monospace';
    ctx.fillText(state.parkingBrake ? 'PARK [P]' : 'DRIVE', 256, 122);

    // Fuel bar
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(210, 138, 92, 10);
    ctx.fillStyle = state.fuelPct < 18 ? '#ef4444' : '#10b981';
    ctx.fillRect(210, 138, 92 * Math.max(0, Math.min(1, state.fuelPct / 100)), 10);

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
  }
}
