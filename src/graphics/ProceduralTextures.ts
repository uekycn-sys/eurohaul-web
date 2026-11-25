import * as THREE from 'three';

export interface RoadTexturePair {
  map: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
}

/**
 * Procedural CanvasTexture factory producing zero-external-asset PBR textures
 * for roads, shipping containers, traffic signs, yard markings, and cockpit gauges.
 */
export class ProceduralTextures {
  private readonly cache = new Map<string, THREE.CanvasTexture>();

  public getRoadTextures(lanes: number, roadClass: 'motorway' | 'national' | 'urban'): RoadTexturePair {
    const key = `road_${lanes}_${roadClass}`;
    const mapKey = `${key}_albedo`;
    const roughKey = `${key}_rough`;

    const existingMap = this.cache.get(mapKey);
    const existingRough = this.cache.get(roughKey);
    if (existingMap && existingRough) {
      return { map: existingMap, roughnessMap: existingRough };
    }

    const width = 512;
    const height = 512;

    // Albedo canvas
    const albedoCanvas = document.createElement('canvas');
    albedoCanvas.width = width;
    albedoCanvas.height = height;
    const ctx = albedoCanvas.getContext('2d')!;

    // Roughness canvas
    const roughCanvas = document.createElement('canvas');
    roughCanvas.width = width;
    roughCanvas.height = height;
    const rCtx = roughCanvas.getContext('2d')!;

    const baseShade = roadClass === 'motorway' ? 54 : roadClass === 'national' ? 62 : 68;
    ctx.fillStyle = `rgb(${baseShade}, ${baseShade + 2}, ${baseShade + 6})`;
    ctx.fillRect(0, 0, width, height);

    rCtx.fillStyle = 'rgb(218, 218, 218)';
    rCtx.fillRect(0, 0, width, height);

    // Deterministic subtle asphalt aggregate grain
    let seed = lanes * 131 + (roadClass === 'motorway' ? 17 : 53);
    const nextRand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    for (let i = 0; i < 4200; i++) {
      const x = nextRand() * width;
      const y = nextRand() * height;
      const sz = 1 + nextRand() * 2.2;
      const delta = Math.floor((nextRand() - 0.5) * 24);
      const c = Math.max(25, Math.min(110, baseShade + delta));
      ctx.fillStyle = `rgb(${c}, ${c + 1}, ${c + 3})`;
      ctx.fillRect(x, y, sz, sz);

      const rc = Math.max(150, Math.min(245, 212 + delta));
      rCtx.fillStyle = `rgb(${rc}, ${rc}, ${rc})`;
      rCtx.fillRect(x, y, sz, sz);
    }

    // Subtle tire wear tracks per lane
    const laneCount = Math.max(2, lanes);
    const usableStart = 32;
    const usableWidth = width - usableStart * 2;
    const laneW = usableWidth / laneCount;

    for (let l = 0; l < laneCount; l++) {
      const cx = usableStart + laneW * (l + 0.5);
      const trackOffset = laneW * 0.22;
      for (const offset of [-trackOffset, trackOffset]) {
        const grad = ctx.createLinearGradient(cx + offset - 16, 0, cx + offset + 16, 0);
        grad.addColorStop(0, 'rgba(22, 24, 28, 0)');
        grad.addColorStop(0.5, 'rgba(22, 24, 28, 0.24)');
        grad.addColorStop(1, 'rgba(22, 24, 28, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(cx + offset - 16, 0, 32, height);

        const rGrad = rCtx.createLinearGradient(cx + offset - 16, 0, cx + offset + 16, 0);
        rGrad.addColorStop(0, 'rgba(145, 145, 145, 0)');
        rGrad.addColorStop(0.5, 'rgba(145, 145, 145, 0.35)');
        rGrad.addColorStop(1, 'rgba(145, 145, 145, 0)');
        rCtx.fillStyle = rGrad;
        rCtx.fillRect(cx + offset - 16, 0, 32, height);
      }
    }

    // Shoulder solid white edge lines
    ctx.fillStyle = '#e5e7eb';
    ctx.fillRect(22, 0, 7, height);
    ctx.fillRect(width - 29, 0, 7, height);

    // Center divider
    if (roadClass === 'motorway' && laneCount >= 4) {
      // Double yellow/white central median strips
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(width / 2 - 10, 0, 6, height);
      ctx.fillRect(width / 2 + 4, 0, 6, height);
    } else {
      // Dashed center line
      ctx.fillStyle = '#f1f5f9';
      for (let y = 16; y < height; y += 96) {
        ctx.fillRect(width / 2 - 3, y, 6, 48);
      }
    }

    // Intermediate lane dividers for multi-lane roads
    if (laneCount >= 4) {
      ctx.fillStyle = 'rgba(241, 245, 249, 0.85)';
      for (let l = 1; l < laneCount; l++) {
        if (l === laneCount / 2) continue;
        const x = usableStart + laneW * l - 2.5;
        for (let y = 24; y < height; y += 96) {
          ctx.fillRect(x, y, 5, 44);
        }
      }
    }

    const map = new THREE.CanvasTexture(albedoCanvas);
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;

    const roughnessMap = new THREE.CanvasTexture(roughCanvas);
    roughnessMap.wrapS = THREE.RepeatWrapping;
    roughnessMap.wrapT = THREE.RepeatWrapping;
    roughnessMap.anisotropy = 4;

    this.cache.set(mapKey, map);
    this.cache.set(roughKey, roughnessMap);
    return { map, roughnessMap };
  }

  public getTerrainTexture(): THREE.CanvasTexture {
    const key = 'terrain_grass';
    const cached = this.cache.get(key);
    if (cached) return cached;

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#475b3f';
    ctx.fillRect(0, 0, 512, 512);

    let seed = 9001;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    for (let i = 0; i < 6500; i++) {
      const x = rand() * 512;
      const y = rand() * 512;
      const r = 2 + rand() * 6;
      const g = Math.floor(74 + rand() * 34);
      const red = Math.floor(58 + rand() * 26);
      const b = Math.floor(48 + rand() * 20);
      ctx.fillStyle = `rgba(${red}, ${g}, ${b}, 0.28)`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(90, 90);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.cache.set(key, tex);
    return tex;
  }

  public getContainerTexture(baseHex: string, label = 'EUROHAUL'): THREE.CanvasTexture {
    const key = `container_${baseHex}_${label}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = baseHex;
    ctx.fillRect(0, 0, 512, 256);

    // Corrugated steel vertical ribs
    for (let x = 0; x < 512; x += 16) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.14)';
      ctx.fillRect(x, 0, 5, 256);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.fillRect(x + 5, 0, 4, 256);
    }

    // Top and bottom structural rails
    ctx.fillStyle = 'rgba(15, 23, 42, 0.45)';
    ctx.fillRect(0, 0, 512, 16);
    ctx.fillRect(0, 240, 512, 16);

    // Branding band
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.fillRect(46, 86, 420, 74);
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 38px Inter, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 256, 124);

    // Subtle reflective safety stripes
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(18, 224, 54, 10);
    ctx.fillRect(440, 224, 54, 10);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
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

  public getDashboardTexture(): THREE.CanvasTexture {
    const key = 'truck_dash_cluster';
    const cached = this.cache.get(key);
    if (cached) return cached;

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 192;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#0b1120';
    ctx.fillRect(0, 0, 512, 192);

    const drawDial = (cx: number, cy: number, radius: number, title: string, maxLabel: string) => {
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, Math.PI * 0.75, Math.PI * 2.25);
      ctx.stroke();

      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 3;
      for (let i = 0; i <= 8; i++) {
        const a = Math.PI * 0.75 + (i / 8) * Math.PI * 1.5;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * (radius - 10), cy + Math.sin(a) * (radius - 10));
        ctx.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
        ctx.stroke();
      }
      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(title, cx, cy + 28);
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '12px monospace';
      ctx.fillText(maxLabel, cx, cy - 18);
    };

    drawDial(110, 100, 66, 'KM/H', '120');
    drawDial(402, 100, 66, 'RPM x100', '25');

    // Center digital display
    ctx.fillStyle = '#111c33';
    ctx.fillRect(198, 36, 116, 120);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2;
    ctx.strokeRect(198, 36, 116, 120);
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 15px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('EUROHAUL', 256, 62);
    ctx.fillStyle = '#10b981';
    ctx.font = 'bold 13px monospace';
    ctx.fillText('SYSTEM OK', 256, 92);
    ctx.fillStyle = '#f59e0b';
    ctx.fillText('ADBLUE 98%', 256, 126);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.cache.set(key, tex);
    return tex;
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

    ctx.fillStyle = 'rgba(16, 185, 129, 0.14)';
    ctx.fillRect(14, 14, 228, 484);

    ctx.strokeStyle = '#34d399';
    ctx.lineWidth = 10;
    ctx.setLineDash([28, 16]);
    ctx.strokeRect(16, 16, 224, 480);

    // Directional chevron arrows pointing into the bay (+Z)
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(52, 211, 153, 0.72)';
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

  public dispose(): void {
    for (const tex of this.cache.values()) {
      tex.dispose();
    }
    this.cache.clear();
  }
}
