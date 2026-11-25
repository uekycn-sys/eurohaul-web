import * as THREE from 'three';
import { QualityPreset } from '../store/useGameStore';

interface TimeKeyframe {
  hour: number;
  zenith: THREE.Color;
  horizon: THREE.Color;
  sunColor: THREE.Color;
  sunIntensity: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  fogDensity: number;
}

const KEYFRAMES: TimeKeyframe[] = [
  {
    hour: 0,
    zenith: new THREE.Color('#040814'),
    horizon: new THREE.Color('#0e172c'),
    sunColor: new THREE.Color('#7594d4'),
    sunIntensity: 0.28,
    hemiSky: new THREE.Color('#1d2e54'),
    hemiGround: new THREE.Color('#111824'),
    hemiIntensity: 0.45,
    fogDensity: 0.00175,
  },
  {
    hour: 5.5,
    zenith: new THREE.Color('#1d2b53'),
    horizon: new THREE.Color('#d17f5a'),
    sunColor: new THREE.Color('#ff9d66'),
    sunIntensity: 0.85,
    hemiSky: new THREE.Color('#7b8ec4'),
    hemiGround: new THREE.Color('#2c2824'),
    hemiIntensity: 0.62,
    fogDensity: 0.00145,
  },
  {
    hour: 7.5,
    zenith: new THREE.Color('#3b73b8'),
    horizon: new THREE.Color('#d7cbb8'),
    sunColor: new THREE.Color('#ffdca8'),
    sunIntensity: 1.75,
    hemiSky: new THREE.Color('#cde3ff'),
    hemiGround: new THREE.Color('#534f41'),
    hemiIntensity: 0.88,
    fogDensity: 0.0011,
  },
  {
    hour: 12.5,
    zenith: new THREE.Color('#2563af'),
    horizon: new THREE.Color('#b6d6ee'),
    sunColor: new THREE.Color('#fff7e8'),
    sunIntensity: 2.15,
    hemiSky: new THREE.Color('#dff1ff'),
    hemiGround: new THREE.Color('#575d4a'),
    hemiIntensity: 0.96,
    fogDensity: 0.00085,
  },
  {
    hour: 18.0,
    zenith: new THREE.Color('#2d487a'),
    horizon: new THREE.Color('#e38d58'),
    sunColor: new THREE.Color('#ff9a4f'),
    sunIntensity: 1.55,
    hemiSky: new THREE.Color('#ffd3ad'),
    hemiGround: new THREE.Color('#42362c'),
    hemiIntensity: 0.8,
    fogDensity: 0.0012,
  },
  {
    hour: 20.0,
    zenith: new THREE.Color('#0d1630'),
    horizon: new THREE.Color('#263253'),
    sunColor: new THREE.Color('#7792d1'),
    sunIntensity: 0.35,
    hemiSky: new THREE.Color('#2e4273'),
    hemiGround: new THREE.Color('#141922'),
    hemiIntensity: 0.5,
    fogDensity: 0.00165,
  },
  {
    hour: 24.0,
    zenith: new THREE.Color('#040814'),
    horizon: new THREE.Color('#0e172c'),
    sunColor: new THREE.Color('#7594d4'),
    sunIntensity: 0.28,
    hemiSky: new THREE.Color('#1d2e54'),
    hemiGround: new THREE.Color('#111824'),
    hemiIntensity: 0.45,
    fogDensity: 0.00175,
  },
];

const SKY_VERTEX_SHADER = /* glsl */ `
  varying vec3 vWorldDir;
  void main() {
    vWorldDir = normalize(position);
    mat4 rotView = viewMatrix;
    rotView[3] = vec4(0.0, 0.0, 0.0, 1.0);
    vec4 clipPos = projectionMatrix * rotView * vec4(position, 1.0);
    gl_Position = clipPos.xyww;
  }
`;

const SKY_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uZenithColor;
  uniform vec3 uHorizonColor;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform float uTime;
  uniform float uNightFactor;
  uniform float uEnableClouds;

  varying vec3 vWorldDir;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 3; i++) {
      v += a * noise(p);
      p *= 2.04;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 dir = normalize(vWorldDir);
    float up = clamp(dir.y, 0.0, 1.0);

    // Rayleigh-like horizon-to-zenith curve
    float horizonFactor = pow(1.0 - up, 2.75);
    vec3 sky = mix(uZenithColor, uHorizonColor, horizonFactor);

    // Sun Mie scattering glow & disc
    float sunDot = max(dot(dir, normalize(uSunDir)), 0.0);
    float mieGlow = pow(sunDot, 10.0) * 0.32 + pow(sunDot, 72.0) * 0.45;
    float sunDisc = smoothstep(0.9992, 0.99975, sunDot) * 2.2;
    sky += uSunColor * (mieGlow + sunDisc) * (1.0 - uNightFactor * 0.72);

    // Lightweight procedural cirrus clouds above horizon
    if (uEnableClouds > 0.5 && dir.y > 0.025) {
      vec2 cloudUv = dir.xz / (dir.y + 0.16) * 0.65 + vec2(uTime * 0.008, uTime * 0.003);
      float c = fbm(cloudUv * 2.1);
      float cloudMask = smoothstep(0.48, 0.80, c) * smoothstep(0.025, 0.22, dir.y);
      vec3 cloudCol = mix(uHorizonColor * 1.15, vec3(0.98, 0.96, 0.94), 0.55 - uNightFactor * 0.4);
      cloudCol += uSunColor * pow(sunDot, 6.0) * 0.35;
      sky = mix(sky, cloudCol, cloudMask * 0.52 * (1.0 - uNightFactor * 0.55));
    }

    // Subtle stars at night
    if (uNightFactor > 0.15 && dir.y > 0.08) {
      vec2 starUv = floor(dir.xz / (dir.y + 0.35) * 140.0);
      float s = hash21(starUv);
      if (s > 0.994) {
        float twinkle = 0.65 + 0.35 * sin(uTime * 2.5 + s * 100.0);
        sky += vec3(0.85, 0.92, 1.0) * twinkle * uNightFactor * smoothstep(0.08, 0.35, dir.y);
      }
    }

    gl_FragColor = vec4(sky, 1.0);
  }
`;

type IblPeriodBucket = 'night' | 'dawn' | 'day' | 'golden';

/**
 * Manages the dynamic day-night cycle, procedural sky-dome ShaderMaterial,
 * horizon-synced exponential fog, one-shot PMREM procedural IBL,
 * and texel-snapped directional shadows.
 */
export class EnvironmentSystem {
  public timeOfDayHours = 8.5;
  public timeScaleHoursPerSec = 0.015;
  public nightFactor = 0;

  private readonly scene: THREE.Scene;
  private readonly sunLight: THREE.DirectionalLight;
  private readonly hemiLight: THREE.HemisphereLight;
  private readonly fog: THREE.FogExp2;

  private readonly skyMesh: THREE.Mesh;
  private readonly skyGeo: THREE.SphereGeometry;
  private readonly skyMat: THREE.ShaderMaterial;

  private readonly zenithColor = new THREE.Color();
  private readonly horizonColor = new THREE.Color();
  private readonly sunDir = new THREE.Vector3(0.5, 0.6, 0.4).normalize();
  private readonly sunOffset = new THREE.Vector3();

  // Pre-allocated vectors for texel-snapped shadow alignment (zero GC)
  private readonly shadowRight = new THREE.Vector3();
  private readonly shadowUp = new THREE.Vector3();
  private readonly shadowForward = new THREE.Vector3();
  private readonly worldUp = new THREE.Vector3(0, 1, 0);

  private streetLampMaterial: THREE.MeshStandardMaterial | null = null;
  private fogScale = 1.0;
  private shadowFrustumHalf = 85;
  private shadowMapSize = 1024;

  // IBL state
  private rendererRef: THREE.WebGLRenderer | null = null;
  private iblEnabled = true;
  private iblIntensity = 0.75;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private lastIblBucket: IblPeriodBucket | null = null;
  private elapsedSec = 0;

  constructor(scene: THREE.Scene, renderer?: THREE.WebGLRenderer) {
    this.scene = scene;
    this.rendererRef = renderer ?? null;

    this.fog = new THREE.FogExp2('#c8bfae', 0.001);
    this.scene.fog = this.fog;
    this.scene.background = this.horizonColor;

    this.hemiLight = new THREE.HemisphereLight('#cde3ff', '#534f41', 0.9);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight('#fff2dc', 1.85);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(1024, 1024);
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 340;
    this.sunLight.shadow.bias = -0.00045;
    this.sunLight.shadow.normalBias = 0.03;
    const d = this.shadowFrustumHalf;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // Procedural Infinite Sky Dome (pinned to NDC far plane z=w so it never clips)
    this.skyGeo = new THREE.SphereGeometry(500, 32, 18);
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERTEX_SHADER,
      fragmentShader: SKY_FRAGMENT_SHADER,
      side: THREE.BackSide,
      depthTest: true,
      depthWrite: false,
      depthFunc: THREE.LessEqualDepth,
      fog: false,
      uniforms: {
        uZenithColor: { value: this.zenithColor },
        uHorizonColor: { value: this.horizonColor },
        uSunColor: { value: new THREE.Color('#fff2dc') },
        uSunDir: { value: this.sunDir },
        uTime: { value: 0 },
        uNightFactor: { value: 0 },
        uEnableClouds: { value: 1.0 },
      },
    });
    this.skyMesh = new THREE.Mesh(this.skyGeo, this.skyMat);
    this.skyMesh.frustumCulled = false;
    this.skyMesh.renderOrder = -10;
    this.scene.add(this.skyMesh);

    this.applyAtmosphere(0, 0);
  }

  public setRenderer(renderer: THREE.WebGLRenderer): void {
    this.rendererRef = renderer;
    this.refreshIblIfNeeded(true);
  }

  public setStreetLampMaterial(mat: THREE.MeshStandardMaterial | null): void {
    this.streetLampMaterial = mat;
  }

  public configureForPreset(
    preset: QualityPreset,
    shadowsEnabled: boolean,
    shadowMapSize: number,
    fogScale: number
  ): void {
    this.sunLight.castShadow = shadowsEnabled;
    this.shadowMapSize = Math.max(256, shadowMapSize);
    if (shadowsEnabled && this.sunLight.shadow.mapSize.width !== this.shadowMapSize) {
      this.sunLight.shadow.mapSize.set(this.shadowMapSize, this.shadowMapSize);
      this.sunLight.shadow.map?.dispose();
      this.sunLight.shadow.map = null;
    }

    this.fogScale = fogScale;

    if (preset === 'mobile_fast') {
      this.iblEnabled = false;
      this.iblIntensity = 0;
      this.skyMat.uniforms.uEnableClouds!.value = 0.0;
      this.scene.environment = null;
    } else if (preset === 'mobile_balanced') {
      this.iblEnabled = true;
      this.iblIntensity = 0.48;
      this.skyMat.uniforms.uEnableClouds!.value = 1.0;
    } else {
      this.iblEnabled = true;
      this.iblIntensity = 0.78;
      this.skyMat.uniforms.uEnableClouds!.value = 1.0;
    }

    this.scene.environmentIntensity = this.iblIntensity;
    this.refreshIblIfNeeded(true);
  }

  public configureQuality(shadowsEnabled: boolean, shadowMapSize: number, fogScale: number): void {
    this.configureForPreset(shadowsEnabled ? 'high' : 'mobile_fast', shadowsEnabled, shadowMapSize, fogScale);
  }

  public update(dtSec: number, focusX: number, focusZ: number): void {
    this.elapsedSec += dtSec;
    this.timeOfDayHours = (this.timeOfDayHours + dtSec * this.timeScaleHoursPerSec) % 24;
    this.skyMat.uniforms.uTime!.value = this.elapsedSec;
    this.applyAtmosphere(focusX, focusZ);
    this.refreshIblIfNeeded(false);
  }

  private getCurrentIblBucket(): IblPeriodBucket {
    const h = this.timeOfDayHours;
    if (h >= 19.5 || h < 5.2) return 'night';
    if (h >= 5.2 && h < 7.5) return 'dawn';
    if (h >= 16.8 && h < 19.5) return 'golden';
    return 'day';
  }

  private refreshIblIfNeeded(force: boolean): void {
    if (!this.iblEnabled || !this.rendererRef) {
      this.scene.environment = null;
      return;
    }

    const bucket = this.getCurrentIblBucket();
    if (!force && bucket === this.lastIblBucket && this.envTarget) {
      return;
    }
    this.lastIblBucket = bucket;

    // Bake lightweight procedural sky+ground sphere into PMREM envMap, then dispose temp GPU objects immediately
    const pmrem = new THREE.PMREMGenerator(this.rendererRef);
    pmrem.compileEquirectangularShader();

    const tempScene = new THREE.Scene();
    const tempGeo = new THREE.SphereGeometry(12, 20, 12);
    const posAttr = tempGeo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(posAttr.count * 3);
    const tmpCol = new THREE.Color();
    const groundTint = this.hemiLight.groundColor;

    for (let i = 0; i < posAttr.count; i++) {
      const y = posAttr.getY(i) / 12;
      if (y >= 0) {
        tmpCol.copy(this.horizonColor).lerp(this.zenithColor, Math.pow(y, 0.7));
        // Subtle warm directional lobe for crisp vehicle reflections
        const dx = posAttr.getX(i) / 12;
        const dz = posAttr.getZ(i) / 12;
        const sunAlign = Math.max(0, dx * this.sunDir.x + y * this.sunDir.y + dz * this.sunDir.z);
        tmpCol.lerp(this.sunLight.color, Math.pow(sunAlign, 8) * 0.55);
      } else {
        tmpCol.copy(this.horizonColor).lerp(groundTint, Math.min(1, -y * 1.4));
      }
      colors[i * 3] = tmpCol.r;
      colors[i * 3 + 1] = tmpCol.g;
      colors[i * 3 + 2] = tmpCol.b;
    }

    tempGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const tempMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
    });
    const tempDome = new THREE.Mesh(tempGeo, tempMat);
    tempScene.add(tempDome);

    const nextTarget = pmrem.fromScene(tempScene, 0.04);

    // Clean up temporary resources and previous envTarget
    tempGeo.dispose();
    tempMat.dispose();
    pmrem.dispose();

    this.envTarget?.dispose();
    this.envTarget = nextTarget;
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = this.iblIntensity;
  }

  private applyAtmosphere(focusX: number, focusZ: number): void {
    const h = this.timeOfDayHours;
    let kfA = KEYFRAMES[0]!;
    let kfB = KEYFRAMES[1]!;

    for (let i = 0; i < KEYFRAMES.length - 1; i++) {
      const a = KEYFRAMES[i]!;
      const b = KEYFRAMES[i + 1]!;
      if (h >= a.hour && h <= b.hour) {
        kfA = a;
        kfB = b;
        break;
      }
    }

    const span = Math.max(0.001, kfB.hour - kfA.hour);
    const t = (h - kfA.hour) / span;

    this.zenithColor.copy(kfA.zenith).lerp(kfB.zenith, t);
    this.horizonColor.copy(kfA.horizon).lerp(kfB.horizon, t);
    (this.scene.background as THREE.Color).copy(this.horizonColor);

    // Sync exponential fog color directly with sky horizon
    this.fog.color.copy(this.horizonColor);
    this.fog.density = THREE.MathUtils.lerp(kfA.fogDensity, kfB.fogDensity, t) * this.fogScale;

    this.sunLight.color.copy(kfA.sunColor).lerp(kfB.sunColor, t);
    this.sunLight.intensity = THREE.MathUtils.lerp(kfA.sunIntensity, kfB.sunIntensity, t);
    (this.skyMat.uniforms.uSunColor!.value as THREE.Color).copy(this.sunLight.color);

    this.hemiLight.color.copy(kfA.hemiSky).lerp(kfB.hemiSky, t);
    this.hemiLight.groundColor.copy(kfA.hemiGround).lerp(kfB.hemiGround, t);
    // Boost hemisphere light when IBL is disabled (mobile_fast)
    const baseHemi = THREE.MathUtils.lerp(kfA.hemiIntensity, kfB.hemiIntensity, t);
    this.hemiLight.intensity = this.iblEnabled ? baseHemi : Math.max(baseHemi, 1.1);

    // Sun orbital arc
    const sunAngle = ((h - 6) / 24) * Math.PI * 2;
    const isDay = h >= 5.5 && h <= 19.5;
    const elevAngle = isDay ? Math.max(0.18, Math.sin(sunAngle)) : 0.48;
    const azimuth = isDay ? Math.cos(sunAngle) : -0.6;

    this.sunOffset.set(azimuth * 110, elevAngle * 140, 75);
    this.sunDir.copy(this.sunOffset).normalize();

    // Keep sky dome centered on player focus
    this.skyMesh.position.set(focusX, 0, focusZ);

    // Texel-snapped directional shadow camera positioning (eliminates shadow edge shimmering)
    if (this.sunLight.castShadow) {
      this.shadowForward.copy(this.sunDir).negate();
      this.shadowRight.crossVectors(this.worldUp, this.shadowForward).normalize();
      this.shadowUp.crossVectors(this.shadowForward, this.shadowRight).normalize();

      const worldUnitsPerTexel = (this.shadowFrustumHalf * 2) / this.shadowMapSize;
      const projR =
        Math.round((focusX * this.shadowRight.x + focusZ * this.shadowRight.z) / worldUnitsPerTexel) *
        worldUnitsPerTexel;
      const projU =
        Math.round((focusX * this.shadowUp.x + focusZ * this.shadowUp.z) / worldUnitsPerTexel) *
        worldUnitsPerTexel;
      const projF = focusX * this.shadowForward.x + focusZ * this.shadowForward.z;

      const snappedX =
        projR * this.shadowRight.x + projU * this.shadowUp.x + projF * this.shadowForward.x;
      const snappedY =
        projR * this.shadowRight.y + projU * this.shadowUp.y + projF * this.shadowForward.y;
      const snappedZ =
        projR * this.shadowRight.z + projU * this.shadowUp.z + projF * this.shadowForward.z;

      this.sunLight.target.position.set(snappedX, snappedY, snappedZ);
      this.sunLight.position.set(
        snappedX + this.sunOffset.x,
        snappedY + this.sunOffset.y,
        snappedZ + this.sunOffset.z
      );
    } else {
      this.sunLight.target.position.set(focusX, 0, focusZ);
      this.sunLight.position.set(
        focusX + this.sunOffset.x,
        this.sunOffset.y,
        focusZ + this.sunOffset.z
      );
    }
    this.sunLight.target.updateMatrixWorld();

    if (h >= 20 || h <= 5.2) {
      this.nightFactor = 1;
    } else if (h > 17.5 && h < 20) {
      this.nightFactor = (h - 17.5) / 2.5;
    } else if (h > 5.2 && h < 7.2) {
      this.nightFactor = 1 - (h - 5.2) / 2.0;
    } else {
      this.nightFactor = 0;
    }
    this.skyMat.uniforms.uNightFactor!.value = this.nightFactor;

    if (this.streetLampMaterial) {
      this.streetLampMaterial.emissiveIntensity = 0.15 + this.nightFactor * 2.6;
    }
  }

  public dispose(): void {
    this.skyGeo.dispose();
    this.skyMat.dispose();
    this.envTarget?.dispose();
    this.envTarget = null;
  }
}
