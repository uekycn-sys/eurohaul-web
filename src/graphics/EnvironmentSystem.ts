import * as THREE from 'three';

interface TimeKeyframe {
  hour: number;
  sky: THREE.Color;
  fog: THREE.Color;
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
    sky: new THREE.Color('#091022'),
    fog: new THREE.Color('#0c152b'),
    sunColor: new THREE.Color('#6b88c9'),
    sunIntensity: 0.25,
    hemiSky: new THREE.Color('#1d2d50'),
    hemiGround: new THREE.Color('#0f1722'),
    hemiIntensity: 0.42,
    fogDensity: 0.0019,
  },
  {
    hour: 5.5,
    sky: new THREE.Color('#27355e'),
    fog: new THREE.Color('#4a4a6e'),
    sunColor: new THREE.Color('#ff9a62'),
    sunIntensity: 0.65,
    hemiSky: new THREE.Color('#6476a8'),
    hemiGround: new THREE.Color('#252a30'),
    hemiIntensity: 0.55,
    fogDensity: 0.0017,
  },
  {
    hour: 7.5,
    sky: new THREE.Color('#86b0d6'),
    fog: new THREE.Color('#c8bfae'),
    sunColor: new THREE.Color('#ffd39b'),
    sunIntensity: 1.55,
    hemiSky: new THREE.Color('#cde2ff'),
    hemiGround: new THREE.Color('#454a3c'),
    hemiIntensity: 0.85,
    fogDensity: 0.0013,
  },
  {
    hour: 12.5,
    sky: new THREE.Color('#7db4e0'),
    fog: new THREE.Color('#9ec4e2'),
    sunColor: new THREE.Color('#fff7e8'),
    sunIntensity: 2.0,
    hemiSky: new THREE.Color('#dcf0ff'),
    hemiGround: new THREE.Color('#485442'),
    hemiIntensity: 0.95,
    fogDensity: 0.00095,
  },
  {
    hour: 18.0,
    sky: new THREE.Color('#d4845a'),
    fog: new THREE.Color('#cc8c6c'),
    sunColor: new THREE.Color('#ff984f'),
    sunIntensity: 1.45,
    hemiSky: new THREE.Color('#ffd0a6'),
    hemiGround: new THREE.Color('#3b322b'),
    hemiIntensity: 0.78,
    fogDensity: 0.00135,
  },
  {
    hour: 20.0,
    sky: new THREE.Color('#1a2342'),
    fog: new THREE.Color('#1b243f'),
    sunColor: new THREE.Color('#7792d1'),
    sunIntensity: 0.32,
    hemiSky: new THREE.Color('#2a3b68'),
    hemiGround: new THREE.Color('#121822'),
    hemiIntensity: 0.48,
    fogDensity: 0.0018,
  },
  {
    hour: 24.0,
    sky: new THREE.Color('#091022'),
    fog: new THREE.Color('#0c152b'),
    sunColor: new THREE.Color('#6b88c9'),
    sunIntensity: 0.25,
    hemiSky: new THREE.Color('#1d2d50'),
    hemiGround: new THREE.Color('#0f1722'),
    hemiIntensity: 0.42,
    fogDensity: 0.0019,
  },
];

/**
 * Manages the dynamic day-night cycle, atmospheric exponential fog,
 * directional sun/moon shadow casting around the player truck, and street-lamp glow.
 */
export class EnvironmentSystem {
  public timeOfDayHours = 8.5;
  /** 1 real second = 0.015 in-game hours (~54 game-seconds per real second -> 1 full day in ~26 mins) */
  public timeScaleHoursPerSec = 0.015;
  public nightFactor = 0;

  private readonly scene: THREE.Scene;
  private readonly sunLight: THREE.DirectionalLight;
  private readonly hemiLight: THREE.HemisphereLight;
  private readonly fog: THREE.FogExp2;
  private readonly skyColor = new THREE.Color();
  private readonly fogColor = new THREE.Color();
  private readonly sunOffset = new THREE.Vector3();

  private streetLampMaterial: THREE.MeshStandardMaterial | null = null;
  private shadowRangeScale = 1.0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.fog = new THREE.FogExp2('#9ec4e2', 0.0011);
    this.scene.fog = this.fog;
    this.scene.background = this.skyColor;

    this.hemiLight = new THREE.HemisphereLight('#cde2ff', '#454a3c', 0.9);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight('#fff2dc', 1.85);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(1024, 1024);
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 320;
    this.sunLight.shadow.bias = -0.0005;
    const d = 90;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    this.applyAtmosphere(0, 0);
  }

  public setStreetLampMaterial(mat: THREE.MeshStandardMaterial | null): void {
    this.streetLampMaterial = mat;
  }

  public configureQuality(shadowsEnabled: boolean, shadowMapSize: number, fogScale: number): void {
    this.sunLight.castShadow = shadowsEnabled;
    if (this.sunLight.shadow.mapSize.width !== shadowMapSize) {
      this.sunLight.shadow.mapSize.set(shadowMapSize, shadowMapSize);
      this.sunLight.shadow.map?.dispose();
      this.sunLight.shadow.map = null;
    }
    this.shadowRangeScale = fogScale;
  }

  public update(dtSec: number, focusX: number, focusZ: number): void {
    this.timeOfDayHours = (this.timeOfDayHours + dtSec * this.timeScaleHoursPerSec) % 24;
    this.applyAtmosphere(focusX, focusZ);
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

    this.skyColor.copy(kfA.sky).lerp(kfB.sky, t);
    this.fogColor.copy(kfA.fog).lerp(kfB.fog, t);
    (this.scene.background as THREE.Color).copy(this.skyColor);
    this.fog.color.copy(this.fogColor);
    this.fog.density = THREE.MathUtils.lerp(kfA.fogDensity, kfB.fogDensity, t) * this.shadowRangeScale;

    this.sunLight.color.copy(kfA.sunColor).lerp(kfB.sunColor, t);
    this.sunLight.intensity = THREE.MathUtils.lerp(kfA.sunIntensity, kfB.sunIntensity, t);

    this.hemiLight.color.copy(kfA.hemiSky).lerp(kfB.hemiSky, t);
    this.hemiLight.groundColor.copy(kfA.hemiGround).lerp(kfB.hemiGround, t);
    this.hemiLight.intensity = THREE.MathUtils.lerp(kfA.hemiIntensity, kfB.hemiIntensity, t);

    // Sun orbital arc (peaks at 12:30, moon takes over at night)
    const sunAngle = ((h - 6) / 24) * Math.PI * 2;
    const isDay = h >= 5.5 && h <= 19.5;
    const elevAngle = isDay ? Math.max(0.18, Math.sin(sunAngle)) : 0.48;
    const azimuth = isDay ? Math.cos(sunAngle) : -0.6;

    this.sunOffset.set(azimuth * 110, elevAngle * 140, 75);
    this.sunLight.position.set(
      focusX + this.sunOffset.x,
      this.sunOffset.y,
      focusZ + this.sunOffset.z
    );
    this.sunLight.target.position.set(focusX, 0, focusZ);
    this.sunLight.target.updateMatrixWorld();

    // Compute smooth night factor [0..1]
    if (h >= 20 || h <= 5.2) {
      this.nightFactor = 1;
    } else if (h > 17.5 && h < 20) {
      this.nightFactor = (h - 17.5) / 2.5;
    } else if (h > 5.2 && h < 7.2) {
      this.nightFactor = 1 - (h - 5.2) / 2.0;
    } else {
      this.nightFactor = 0;
    }

    if (this.streetLampMaterial) {
      this.streetLampMaterial.emissiveIntensity = 0.15 + this.nightFactor * 2.6;
    }
  }
}
