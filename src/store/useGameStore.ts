import { create } from 'zustand';
import { createJSONStorage, persist, StateStorage } from 'zustand/middleware';
import { A2ExamLevelId, A2ExamStateSnapshot, A2LevelBestRecord } from '../exam/types';

// Debounced localStorage wrapper so 60Hz driving progress never causes synchronous JSON serialization/disk stalls
const debouncedLocalStorage: StateStorage = (() => {
  let pendingKey: string | null = null;
  let pendingVal: string | null = null;
  let timerId: number | null = null;

  const flush = () => {
    if (timerId !== null) {
      window.clearTimeout(timerId);
      timerId = null;
    }
    if (pendingKey !== null && pendingVal !== null) {
      try {
        window.localStorage.setItem(pendingKey, pendingVal);
      } catch {
        // Ignore quota/private-browsing errors
      }
      pendingKey = null;
      pendingVal = null;
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) flush();
    });
  }

  return {
    getItem: (name: string): string | null => {
      try {
        return window.localStorage.getItem(name);
      } catch {
        return null;
      }
    },
    setItem: (name: string, value: string): void => {
      pendingKey = name;
      pendingVal = value;
      if (timerId !== null) return;
      timerId = window.setTimeout(flush, 2500);
    },
    removeItem: (name: string): void => {
      if (pendingKey === name) {
        pendingKey = null;
        pendingVal = null;
      }
      if (timerId !== null) {
        window.clearTimeout(timerId);
        timerId = null;
      }
      try {
        window.localStorage.removeItem(name);
      } catch {
        // Ignore errors
      }
    },
  };
})();

export type QualityPreset = 'mobile_fast' | 'mobile_balanced' | 'pc_igpu' | 'high' | 'ultra';
export type MobileSteeringStyle = 'wheel' | 'buttons';
export type GamePhase = 'menu' | 'playing';
export type GameMode = 'career' | 'a2_exam';
export type ActiveModal = 'none' | 'jobs' | 'garage' | 'map' | 'settings' | 'delivery_summary' | 'exam_select' | 'rescue';
export type TransmissionMode = 'auto' | 'real_auto' | 'sequential';
export type HeadlightMode = 0 | 1 | 2; // 0: Off, 1: Low/DRL, 2: High Beam
export type CameraMode = 1 | 2 | 3 | 4 | 5;
export type AdvisorTab = 'nav' | 'cargo' | 'truck' | 'controls';
export type MirrorDisplayMode = 'both' | 'right_only' | 'off';
export type AdvisorDisplayMode = 'full' | 'mini' | 'hidden';
export type WeatherSetting = 'auto' | 'clear' | 'rain';
export type WipersMode = 0 | 1 | 2;
export type SignalState = 'green' | 'amber' | 'red';
export type TrailerCargoType = 'reefer' | 'container' | 'logs' | 'machinery';

export interface QualitySpec {
  id: QualityPreset;
  label: string;
  shortDesc: string;
  maxDpr: number;
  shadowsEnabled: boolean;
  shadowMapSize: number;
  cameraFar: number;
  fogScale: number;
  foliageDensity: number;
  maxTraffic: number;
  mirrorUpdateInterval: number; // 0 = disabled by default, 1 = every frame, 2/4 = frame-skip
  defaultMirrors: boolean;
}

export const QUALITY_SPECS: Record<QualityPreset, QualitySpec> = {
  mobile_fast: {
    id: 'mobile_fast',
    label: '极速 / 入门手机',
    shortDesc: '1.0x DPR · 贴片假阴影 · 25%植被 · 6辆AI',
    maxDpr: 1.0,
    shadowsEnabled: false,
    shadowMapSize: 512,
    cameraFar: 720,
    fogScale: 1.55,
    foliageDensity: 0.25,
    maxTraffic: 6,
    mirrorUpdateInterval: 4,
    defaultMirrors: false,
  },
  mobile_balanced: {
    id: 'mobile_balanced',
    label: '均衡 / 旗舰手机',
    shortDesc: '1.5x DPR · 1024px阴影 · 55%植被 · 12辆AI',
    maxDpr: 1.5,
    shadowsEnabled: true,
    shadowMapSize: 1024,
    cameraFar: 1100,
    fogScale: 1.15,
    foliageDensity: 0.55,
    maxTraffic: 12,
    mirrorUpdateInterval: 4,
    defaultMirrors: false,
  },
  pc_igpu: {
    id: 'pc_igpu',
    label: '核显高帧流畅',
    shortDesc: '1.2x DPR · 1024px阴影 · 75%植被 · 14辆AI',
    maxDpr: 1.2,
    shadowsEnabled: true,
    shadowMapSize: 1024,
    cameraFar: 1150,
    fogScale: 1.0,
    foliageDensity: 0.75,
    maxTraffic: 14,
    mirrorUpdateInterval: 3,
    defaultMirrors: true,
  },
  high: {
    id: 'high',
    label: '高画质 (独显推荐)',
    shortDesc: '1.75x DPR · 2048px阴影 · 100%植被 · 20辆AI',
    maxDpr: 1.75,
    shadowsEnabled: true,
    shadowMapSize: 2048,
    cameraFar: 1600,
    fogScale: 0.9,
    foliageDensity: 1.0,
    maxTraffic: 20,
    mirrorUpdateInterval: 2,
    defaultMirrors: true,
  },
  ultra: {
    id: 'ultra',
    label: '极致画质 (独显满血)',
    shortDesc: '2.0x DPR · 2048px阴影 · 实时双镜 · 28辆AI',
    maxDpr: 2.0,
    shadowsEnabled: true,
    shadowMapSize: 2048,
    cameraFar: 2100,
    fogScale: 0.75,
    foliageDensity: 1.0,
    maxTraffic: 28,
    mirrorUpdateInterval: 1,
    defaultMirrors: true,
  },
};

export interface DetectedHardwareProfile {
  isTouchDevice: boolean;
  recommendedPreset: QualityPreset;
  deviceLabel: string;
}

function formatShortGpuName(raw: string): string {
  if (!raw) return '';
  const angleMatch = raw.match(/ANGLE \([^,]+,\s*([^,(]+)/i);
  const cleaned = (angleMatch ? angleMatch[1]! : raw)
    .replace(/Direct3D.*|OpenGL.*|\(R\)|\(TM\)|Graphics/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > 26 ? `${cleaned.slice(0, 24).trim()}…` : cleaned;
}

export function detectHardwareProfile(): DetectedHardwareProfile {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      isTouchDevice: false,
      recommendedPreset: 'high',
      deviceLabel: 'PC 桌面端',
    };
  }

  const ua = navigator.userAgent || '';
  const isIOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);
  const isTouch = isIOS || isAndroid || navigator.maxTouchPoints > 1 || 'ontouchstart' in window;
  const isMobileScreen = Math.min(window.screen.width, window.screen.height) <= 900;

  let gpuRenderer = '';
  try {
    const canvas = document.createElement('canvas');
    const gl =
      canvas.getContext('webgl2', { powerPreference: 'high-performance' }) ||
      canvas.getContext('webgl', { powerPreference: 'high-performance' });
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) {
        gpuRenderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '');
      }
    }
  } catch {
    gpuRenderer = '';
  }

  const shortGpu = formatShortGpuName(gpuRenderer);

  if (isIOS) {
    return {
      isTouchDevice: true,
      recommendedPreset: 'mobile_balanced',
      deviceLabel: `iOS 移动设备${shortGpu ? ` (${shortGpu})` : ''}`,
    };
  }

  if (isAndroid || (isTouch && isMobileScreen)) {
    const isFlagshipGpu = /Adreno \(TM\) 7[345]\d|Immortalis|Xclipse 94/i.test(gpuRenderer);
    return {
      isTouchDevice: true,
      recommendedPreset: isFlagshipGpu ? 'mobile_balanced' : 'mobile_fast',
      deviceLabel: isFlagshipGpu ? '旗舰安卓移动端' : '安卓移动端 (省电极速)',
    };
  }

  const isDiscreteGpu = /RTX|GTX|Radeon RX|Apple M[1-9]/i.test(gpuRenderer);
  const isIntegratedHint = /Intel|UHD|Iris|HD Graphics|Vega|Radeon\(TM\) Graphics|SwiftShader/i.test(
    gpuRenderer
  );
  return {
    isTouchDevice: false,
    recommendedPreset: isDiscreteGpu ? 'high' : 'pc_igpu',
    deviceLabel: isDiscreteGpu
      ? `高性能独显${shortGpu ? ` (${shortGpu})` : ''}`
      : `${isIntegratedHint ? 'PC 核显' : 'PC 桌面端'}${shortGpu ? ` (${shortGpu})` : ''}`,
  };
}

export interface EngineUpgradeTier {
  tier: number;
  name: string;
  hp: number;
  maxTorqueNm: number;
  priceEur: number;
}

export interface TankUpgradeTier {
  tier: number;
  name: string;
  capacityLiters: number;
  priceEur: number;
}

export const ENGINE_TIERS: EngineUpgradeTier[] = [
  { tier: 0, name: 'D13 480 Euro 6', hp: 480, maxTorqueNm: 2500, priceEur: 0 },
  { tier: 1, name: 'D13 540 Turbo-Compound', hp: 540, maxTorqueNm: 2800, priceEur: 18500 },
  { tier: 2, name: 'V8 750 Performance', hp: 750, maxTorqueNm: 3550, priceEur: 42000 },
];

export const TANK_TIERS: TankUpgradeTier[] = [
  { tier: 0, name: '标准 450L 铝制油箱', capacityLiters: 450, priceEur: 0 },
  { tier: 1, name: '长途 750L 双腔油箱', capacityLiters: 750, priceEur: 6200 },
  { tier: 2, name: '旗舰 1100L 洲际油箱', capacityLiters: 1100, priceEur: 14500 },
];

export const TRUCK_PAINT_PRESETS = [
  { name: '北欧烈焰橙', hex: '#d97706' },
  { name: '波罗的海深蓝', hex: '#1d4ed8' },
  { name: '阿尔卑斯冰川白', hex: '#e2e8f0' },
  { name: '慕尼黑曜石黑', hex: '#1e293b' },
  { name: '斯堪尼亚宝石红', hex: '#b91c1c' },
  { name: '黑森林翡翠绿', hex: '#047857' },
] as const;

export interface FreightJob {
  id: string;
  cargoName: string;
  cargoCategory: string;
  weightTons: number;
  fragile: boolean;
  urgent: boolean;
  originCityId: string;
  originCityName: string;
  originDepotId: string;
  originDepotName: string;
  destinationCityId: string;
  destinationCityName: string;
  destinationDepotId: string;
  destinationDepotName: string;
  distanceKm: number;
  basePayEur: number;
  xpReward: number;
  timeLimitMin: number;
  trailerColor: string;
  trailerType?: TrailerCargoType;
}

export interface ActiveJobState {
  job: FreightJob;
  acceptedAtMs: number;
  remainingSeconds: number;
  cargoHealth: number;
  pickedUp: boolean;
  tripFuelUsedLiters: number;
  tripDistanceKm: number;
  tripViolations: number;
}

export interface DeliveryResult {
  job: FreightJob;
  basePayEur: number;
  parkingBonusEur: number;
  onTimeBonusEur: number;
  damagePenaltyEur: number;
  totalEarnedEur: number;
  xpEarned: number;
  manualParking: boolean;
  onTime: boolean;
  cargoHealth: number;
  avgFuelLPer100Km: number;
  safetyGrade: 'S' | 'A' | 'B';
}

export interface NearbyInteraction {
  kind: 'depot_job' | 'fuel' | 'repair' | 'service_hub' | 'delivery_bay';
  label: string;
  sublabel: string;
  depotId?: string;
  cityId?: string;
}

export interface ParkingGuideState {
  active: boolean;
  aligned: boolean;
  distanceMeters: number;
  angleErrorDeg: number;
  speedKmh: number;
  readyToDeliver: boolean;
  bayX?: number;
  bayZ?: number;
  bayHeadingRad?: number;
}

export interface HudNotification {
  id: number;
  type: 'info' | 'warning' | 'fine' | 'success';
  title: string;
  detail: string;
  createdAt: number;
}

export interface TelemetrySnapshot {
  speedKmh: number;
  rpm: number;
  gear: number;
  gearLabel: string;
  throttle: number;
  brake: number;
  steerAngleNorm: number;
  cruiseControlKmh: number | null;
  retarderLevel: number;
  parkingBrake: boolean;
  headlightMode: HeadlightMode;
  leftBlinker: boolean;
  rightBlinker: boolean;
  hazardLights: boolean;
  blinkerLit: boolean;
  trailerAttached: boolean;
  hitchAngleDeg: number;
  jackknifeWarning: boolean;
  speedLimitKmh: number;
  isSpeeding: boolean;
  odometerKm: number;
  fps: number;
  drawCalls: number;
  drsPixelRatio: number;
  timeOfDayHours: number;
  rainIntensity: number;
  wipersMode: WipersMode;
  upcomingSignal: SignalState | null;
  upcomingSignalDistMeters: number | null;
  currentCityName: string;
  navDistanceMeters: number;
  navEtaSeconds: number;
  navInstruction: string;
  truckX: number;
  truckZ: number;
  truckHeadingRad: number;
  trailerX: number;
  trailerZ: number;
  trailerHeadingRad: number;
  // Realistic heavy-truck telemetry
  airPressureBar: number;
  lowAirWarning: boolean;
  emergencyBrakeLock: boolean;
  brakeTempC: number;
  brakeFadePct: number;
  engineRunning: boolean;
  engineStalled: boolean;
  exhaustBrakeActive: boolean;
  diffLockActive: boolean;
  trailerBrakeActive: boolean;
  clutchPedal: number;
  frontWheelAngleDeg: number;
  totalWeightTons: number;
  instantFuelLPer100Km: number;
  turboBoostNorm: number;
  escActive: boolean;
  cabLightOn: boolean;
  navTurnDir: 'straight' | 'left' | 'right' | 'arrive';
  navTurnDistMeters: number | null;
  estFuelRangeKm: number;
  upcomingTollLabel: string | null;
  upcomingTollDistMeters: number | null;
}

interface PersistedCareerState {
  selectedMapId: string;
  moneyEur: number;
  xp: number;
  level: number;
  completedJobs: number;
  totalDistanceKm: number;
  engineTier: number;
  tankTier: number;
  paintHex: string;
  truckHealth: number;
  fuelLiters: number;
  qualityPreset: QualityPreset;
  drsEnabled: boolean;
  showFps: boolean;
  showDrawCalls: boolean;
  cabMotionEnabled: boolean;
  mirrorsEnabled: boolean;
  mirrorDisplayMode: MirrorDisplayMode;
  advisorDisplayMode: AdvisorDisplayMode;
  cabFovDeg: number;
  seatOffsetZ: number;
  seatOffsetY: number;
  steeringCameraEnabled: boolean;
  showCabPendant: boolean;
  audioEnabled: boolean;
  masterVolume: number;
  mobileControlsEnabled: boolean;
  mobileSteeringStyle: MobileSteeringStyle;
  speedLimiterEnabled: boolean;
  weatherSetting: WeatherSetting;
  realisticSteeringReturn: boolean;
  examVoiceEnabled: boolean;
  examStrictCamera: boolean;
  fatigueEnabled: boolean;
  driverFatiguePct: number;
  a2ExamProgress: Partial<Record<A2ExamLevelId, A2LevelBestRecord>>;
}

interface GameStoreState extends PersistedCareerState {
  detectedDeviceLabel: string;
  isTouchDevice: boolean;
  gamePhase: GamePhase;
  gameMode: GameMode;
  activeExamLevelId: A2ExamLevelId | null;
  a2ExamState: A2ExamStateSnapshot | null;
  activeModal: ActiveModal;
  seatAdjustOpen: boolean;
  cameraMode: CameraMode;
  advisorTab: AdvisorTab;
  transmissionMode: TransmissionMode;
  availableJobs: FreightJob[];
  activeJob: ActiveJobState | null;
  lastDeliveryResult: DeliveryResult | null;
  nearbyInteraction: NearbyInteraction | null;
  parkingGuide: ParkingGuideState;
  notifications: HudNotification[];
  speedCameraFlashAt: number;
  telemetry: TelemetrySnapshot;

  // Actions
  setGamePhase: (phase: GamePhase) => void;
  setGameMode: (mode: GameMode) => void;
  setActiveExamLevelId: (levelId: A2ExamLevelId | null) => void;
  setA2ExamState: (state: A2ExamStateSnapshot | null) => void;
  recordA2ExamResult: (levelId: A2ExamLevelId, passed: boolean, score: number, elapsedSec: number) => void;
  setSelectedMapId: (mapId: string) => void;
  setActiveModal: (modal: ActiveModal) => void;
  setCameraMode: (mode: CameraMode) => void;
  setAdvisorTab: (tab: AdvisorTab) => void;
  toggleTransmissionMode: () => void;
  setQualityPreset: (preset: QualityPreset, syncDefaults?: boolean) => void;
  setDrsEnabled: (enabled: boolean) => void;
  setShowFps: (show: boolean) => void;
  setShowDrawCalls: (show: boolean) => void;
  setCabMotionEnabled: (enabled: boolean) => void;
  setMirrorsEnabled: (enabled: boolean) => void;
  setMirrorDisplayMode: (mode: MirrorDisplayMode) => void;
  cycleMirrorDisplayMode: () => void;
  cycleAdvisorDisplayMode: () => void;
  setSeatAdjustOpen: (open: boolean) => void;
  toggleSeatAdjustOpen: () => void;
  setCabFovDeg: (fov: number) => void;
  setSeatOffsetZ: (z: number) => void;
  setSeatOffsetY: (y: number) => void;
  resetSeatAdjust: () => void;
  setSteeringCameraEnabled: (enabled: boolean) => void;
  setShowCabPendant: (show: boolean) => void;
  setAudioEnabled: (enabled: boolean) => void;
  setMasterVolume: (vol: number) => void;
  setMobileControlsEnabled: (enabled: boolean) => void;
  setMobileSteeringStyle: (style: MobileSteeringStyle) => void;
  setSpeedLimiterEnabled: (enabled: boolean) => void;
  setWeatherSetting: (weather: WeatherSetting) => void;
  setRealisticSteeringReturn: (enabled: boolean) => void;
  setExamVoiceEnabled: (enabled: boolean) => void;
  setExamStrictCamera: (enabled: boolean) => void;
  setFatigueEnabled: (enabled: boolean) => void;
  addDriverFatigue: (deltaPct: number) => void;
  resetDriverFatigue: () => void;

  // Gameplay & economy actions
  setAvailableJobs: (jobs: FreightJob[]) => void;
  acceptJob: (job: FreightJob) => void;
  cancelActiveJob: () => void;
  damageCargo: (deltaPct: number) => void;
  damageTruck: (deltaPct: number) => void;
  consumeFuel: (liters: number) => void;
  refuelFull: () => number;
  repairTruckFull: () => number;
  applyFine: (amountEur: number, reason: string) => void;
  payToll: (amountEur: number, label: string) => void;
  applyRoadsideRescue: (costEur: number, stationName: string) => void;
  upgradeEngine: (tier: number) => boolean;
  upgradeTank: (tier: number) => boolean;
  setPaintHex: (hex: string) => void;
  completeDelivery: (manualParking: boolean) => DeliveryResult | null;

  // Runtime updates from GameEngine
  updateTelemetry: (partial: Partial<TelemetrySnapshot>) => void;
  setNearbyInteraction: (interaction: NearbyInteraction | null) => void;
  setParkingGuide: (guide: ParkingGuideState) => void;
  pushNotification: (type: HudNotification['type'], title: string, detail: string) => void;
  triggerSpeedCameraFlash: () => void;
  tickJobTimer: (dtSec: number) => void;
  addCareerDistance: (deltaKm: number) => void;
  applyDrivingProgress: (opts: {
    fuelBurned?: number;
    distanceKm?: number;
    fatigueDelta?: number;
    jobTimerSec?: number;
  }) => void;
  resetCareer: () => void;
}

const DEFAULT_TELEMETRY: TelemetrySnapshot = {
  speedKmh: 0,
  rpm: 650,
  gear: 0,
  gearLabel: 'N',
  throttle: 0,
  brake: 0,
  steerAngleNorm: 0,
  cruiseControlKmh: null,
  retarderLevel: 0,
  parkingBrake: true,
  headlightMode: 1,
  leftBlinker: false,
  rightBlinker: false,
  hazardLights: false,
  blinkerLit: false,
  trailerAttached: true,
  hitchAngleDeg: 0,
  jackknifeWarning: false,
  speedLimitKmh: 80,
  isSpeeding: false,
  odometerKm: 0,
  fps: 60,
  drawCalls: 0,
  drsPixelRatio: 1,
  timeOfDayHours: 8.5,
  rainIntensity: 0,
  wipersMode: 0,
  upcomingSignal: null,
  upcomingSignalDistMeters: null,
  currentCityName: '慕尼黑物流枢纽',
  navDistanceMeters: 0,
  navEtaSeconds: 0,
  navInstruction: '等待接取货运任务',
  truckX: 0,
  truckZ: 0,
  truckHeadingRad: 0,
  trailerX: 0,
  trailerZ: 0,
  trailerHeadingRad: 0,
  airPressureBar: 8.0,
  lowAirWarning: false,
  emergencyBrakeLock: false,
  brakeTempC: 65,
  brakeFadePct: 0,
  engineRunning: true,
  engineStalled: false,
  exhaustBrakeActive: false,
  diffLockActive: false,
  trailerBrakeActive: false,
  clutchPedal: 0,
  frontWheelAngleDeg: 0,
  totalWeightTons: 15,
  instantFuelLPer100Km: 0,
  turboBoostNorm: 0,
  escActive: false,
  cabLightOn: false,
  navTurnDir: 'straight',
  navTurnDistMeters: null,
  estFuelRangeKm: 1200,
  upcomingTollLabel: null,
  upcomingTollDistMeters: null,
};

const DEFAULT_PARKING_GUIDE: ParkingGuideState = {
  active: false,
  aligned: false,
  distanceMeters: 999,
  angleErrorDeg: 0,
  speedKmh: 0,
  readyToDeliver: false,
};

const INITIAL_HARDWARE = detectHardwareProfile();
const INITIAL_SPEC = QUALITY_SPECS[INITIAL_HARDWARE.recommendedPreset];

const INITIAL_PERSISTED: PersistedCareerState = {
  selectedMapId: 'central-europe',
  moneyEur: 12500,
  xp: 0,
  level: 1,
  completedJobs: 0,
  totalDistanceKm: 0,
  engineTier: 0,
  tankTier: 0,
  paintHex: '#d97706',
  truckHealth: 100,
  fuelLiters: 450,
  qualityPreset: INITIAL_HARDWARE.recommendedPreset,
  drsEnabled: true,
  showFps: true,
  showDrawCalls: true,
  cabMotionEnabled: true,
  mirrorsEnabled: INITIAL_SPEC.defaultMirrors,
  mirrorDisplayMode: INITIAL_SPEC.defaultMirrors ? 'right_only' : 'off',
  advisorDisplayMode: 'full',
  cabFovDeg: 68,
  seatOffsetZ: 0,
  seatOffsetY: 0,
  steeringCameraEnabled: true,
  showCabPendant: true,
  audioEnabled: true,
  masterVolume: 0.6,
  mobileControlsEnabled: INITIAL_HARDWARE.isTouchDevice,
  mobileSteeringStyle: 'wheel',
  speedLimiterEnabled: true,
  weatherSetting: 'auto',
  realisticSteeringReturn: true,
  examVoiceEnabled: true,
  examStrictCamera: false,
  fatigueEnabled: true,
  driverFatiguePct: 0,
  a2ExamProgress: {},
};

let notificationSeq = 1;

export function getMaxFuelLiters(tankTier: number): number {
  return (TANK_TIERS[tankTier] ?? TANK_TIERS[0]!).capacityLiters;
}

export function computeLevelFromXp(xp: number): number {
  return Math.max(1, Math.floor(Math.sqrt(xp / 250)) + 1);
}

export function getDriverRankTitle(level: number): string {
  if (level >= 8) return '欧陆传奇车队长';
  if (level >= 5) return '阿尔卑斯重卡王牌';
  if (level >= 3) return '欧陆干线专员';
  if (level >= 2) return '认证半挂驾驶员';
  return '见习货运司机';
}

function migrateQualityPreset(val: unknown): QualityPreset {
  if (
    val === 'mobile_fast' ||
    val === 'mobile_balanced' ||
    val === 'pc_igpu' ||
    val === 'high' ||
    val === 'ultra'
  ) {
    return val;
  }
  if (val === 'low') return 'mobile_fast';
  if (val === 'medium') return 'mobile_balanced';
  return INITIAL_HARDWARE.recommendedPreset;
}

export const useGameStore = create<GameStoreState>()(
  persist(
    (set, get) => ({
      ...INITIAL_PERSISTED,
      detectedDeviceLabel: INITIAL_HARDWARE.deviceLabel,
      isTouchDevice: INITIAL_HARDWARE.isTouchDevice,
      gamePhase: 'menu',
      gameMode: 'career',
      activeExamLevelId: null,
      a2ExamState: null,
      activeModal: 'none',
      seatAdjustOpen: false,
      cameraMode: 1,
      advisorTab: 'nav',
      transmissionMode: 'auto',
      availableJobs: [],
      activeJob: null,
      lastDeliveryResult: null,
      nearbyInteraction: null,
      parkingGuide: DEFAULT_PARKING_GUIDE,
      notifications: [],
      speedCameraFlashAt: 0,
      telemetry: DEFAULT_TELEMETRY,

      setGamePhase: (gamePhase) => set({ gamePhase }),
      setGameMode: (gameMode) => set({ gameMode }),
      setActiveExamLevelId: (activeExamLevelId) => set({ activeExamLevelId }),
      setA2ExamState: (a2ExamState) => set({ a2ExamState }),
      recordA2ExamResult: (levelId, passed, score, elapsedSec) =>
        set((s) => {
          const prev = s.a2ExamProgress[levelId] ?? {
            passed: false,
            bestScore: 0,
            bestTimeSec: null,
            attempts: 0,
          };
          const nextBestTime =
            passed && (prev.bestTimeSec === null || elapsedSec < prev.bestTimeSec)
              ? Number(elapsedSec.toFixed(1))
              : prev.bestTimeSec;
          return {
            a2ExamProgress: {
              ...s.a2ExamProgress,
              [levelId]: {
                passed: prev.passed || passed,
                bestScore: Math.max(prev.bestScore, score),
                bestTimeSec: nextBestTime,
                attempts: prev.attempts + 1,
              },
            },
          };
        }),
      setSelectedMapId: (selectedMapId) => set({ selectedMapId }),
      setActiveModal: (activeModal) => set({ activeModal }),
      setCameraMode: (cameraMode) => set({ cameraMode }),
      setAdvisorTab: (advisorTab) => set({ advisorTab }),
      toggleTransmissionMode: () =>
        set((s) => ({
          transmissionMode:
            s.transmissionMode === 'auto'
              ? 'real_auto'
              : s.transmissionMode === 'real_auto'
              ? 'sequential'
              : 'auto',
        })),
      setQualityPreset: (qualityPreset, syncDefaults = true) =>
        set((s) => {
          const nextMirrors = syncDefaults ? QUALITY_SPECS[qualityPreset].defaultMirrors : s.mirrorsEnabled;
          const nextMode: MirrorDisplayMode = syncDefaults
            ? nextMirrors
              ? 'both'
              : 'off'
            : s.mirrorDisplayMode;
          return {
            qualityPreset,
            mirrorsEnabled: nextMirrors,
            mirrorDisplayMode: nextMode,
          };
        }),
      setDrsEnabled: (drsEnabled) => set({ drsEnabled }),
      setShowFps: (showFps) => set({ showFps }),
      setShowDrawCalls: (showDrawCalls) => set({ showDrawCalls }),
      setCabMotionEnabled: (cabMotionEnabled) => set({ cabMotionEnabled }),
      setMirrorsEnabled: (mirrorsEnabled) =>
        set({
          mirrorsEnabled,
          mirrorDisplayMode: mirrorsEnabled ? 'both' : 'off',
        }),
      setMirrorDisplayMode: (mirrorDisplayMode) =>
        set({
          mirrorDisplayMode,
          mirrorsEnabled: mirrorDisplayMode !== 'off',
        }),
      cycleMirrorDisplayMode: () =>
        set((s) => {
          const next: MirrorDisplayMode =
            s.mirrorDisplayMode === 'both'
              ? 'right_only'
              : s.mirrorDisplayMode === 'right_only'
              ? 'off'
              : 'both';
          return {
            mirrorDisplayMode: next,
            mirrorsEnabled: next !== 'off',
          };
        }),
      cycleAdvisorDisplayMode: () =>
        set((s) => ({
          advisorDisplayMode:
            s.advisorDisplayMode === 'full'
              ? 'mini'
              : s.advisorDisplayMode === 'mini'
              ? 'hidden'
              : 'full',
        })),
      setSeatAdjustOpen: (seatAdjustOpen) => set({ seatAdjustOpen }),
      toggleSeatAdjustOpen: () => set((s) => ({ seatAdjustOpen: !s.seatAdjustOpen })),
      setCabFovDeg: (cabFovDeg) =>
        set({ cabFovDeg: Math.round(Math.max(58, Math.min(82, cabFovDeg))) }),
      setSeatOffsetZ: (seatOffsetZ) =>
        set({ seatOffsetZ: Number(Math.max(-0.2, Math.min(0.15, seatOffsetZ)).toFixed(2)) }),
      setSeatOffsetY: (seatOffsetY) =>
        set({ seatOffsetY: Number(Math.max(-0.12, Math.min(0.12, seatOffsetY)).toFixed(2)) }),
      resetSeatAdjust: () => set({ cabFovDeg: 68, seatOffsetZ: 0, seatOffsetY: 0 }),
      setSteeringCameraEnabled: (steeringCameraEnabled) => set({ steeringCameraEnabled }),
      setShowCabPendant: (showCabPendant) => set({ showCabPendant }),
      setAudioEnabled: (audioEnabled) => set({ audioEnabled }),
      setMasterVolume: (masterVolume) => set({ masterVolume: Math.max(0, Math.min(1, masterVolume)) }),
      setMobileControlsEnabled: (mobileControlsEnabled) => set({ mobileControlsEnabled }),
      setMobileSteeringStyle: (mobileSteeringStyle) => set({ mobileSteeringStyle }),
      setSpeedLimiterEnabled: (speedLimiterEnabled) => set({ speedLimiterEnabled }),
      setWeatherSetting: (weatherSetting) => set({ weatherSetting }),
      setRealisticSteeringReturn: (realisticSteeringReturn) => set({ realisticSteeringReturn }),
      setExamVoiceEnabled: (examVoiceEnabled) => set({ examVoiceEnabled }),
      setExamStrictCamera: (examStrictCamera) => set({ examStrictCamera }),
      setFatigueEnabled: (fatigueEnabled) => set({ fatigueEnabled }),
      addDriverFatigue: (deltaPct) =>
        set((s) => ({
          driverFatiguePct: Math.min(100, Math.max(0, s.driverFatiguePct + deltaPct)),
        })),
      resetDriverFatigue: () => set({ driverFatiguePct: 0 }),

      setAvailableJobs: (availableJobs) => set({ availableJobs }),

      acceptJob: (job) => {
        set({
          activeJob: {
            job,
            acceptedAtMs: Date.now(),
            remainingSeconds: job.timeLimitMin * 60,
            cargoHealth: 100,
            pickedUp: true,
            tripFuelUsedLiters: 0,
            tripDistanceKm: 0,
            tripViolations: 0,
          },
          activeModal: 'none',
        });
        get().pushNotification(
          'info',
          `已承接货运: ${job.cargoName}`,
          `${job.originCityName} → ${job.destinationCityName} (${job.weightTons}t · €${job.basePayEur.toLocaleString()})`
        );
      },

      cancelActiveJob: () => {
        const current = get().activeJob;
        if (!current) return;
        const penalty = Math.min(get().moneyEur, 800);
        set((s) => ({
          activeJob: null,
          moneyEur: Math.max(0, s.moneyEur - penalty),
        }));
        get().pushNotification('warning', '已放弃当前订单', `扣除违约金 €${penalty}`);
      },

      damageCargo: (deltaPct) =>
        set((s) => {
          if (!s.activeJob) return s;
          const nextHealth = Math.max(0, s.activeJob.cargoHealth - deltaPct);
          return {
            activeJob: { ...s.activeJob, cargoHealth: nextHealth },
          };
        }),

      damageTruck: (deltaPct) =>
        set((s) => ({
          truckHealth: Math.max(10, s.truckHealth - deltaPct),
        })),

      consumeFuel: (liters) =>
        set((s) => ({
          fuelLiters: Math.max(0, s.fuelLiters - liters),
          activeJob: s.activeJob
            ? {
                ...s.activeJob,
                tripFuelUsedLiters: s.activeJob.tripFuelUsedLiters + liters,
              }
            : null,
        })),

      refuelFull: () => {
        const s = get();
        const maxFuel = getMaxFuelLiters(s.tankTier);
        const needed = Math.max(0, maxFuel - s.fuelLiters);
        if (needed < 1) {
          s.pushNotification('info', '油箱已满', '无需加油');
          return 0;
        }
        const cost = Math.round(needed * 1.65);
        if (s.moneyEur < cost) {
          const affordableLiters = Math.floor(s.moneyEur / 1.65);
          if (affordableLiters <= 0) {
            s.pushNotification('warning', '余额不足', '无法支付柴油费用');
            return 0;
          }
          const actualCost = Math.round(affordableLiters * 1.65);
          set({
            fuelLiters: Math.min(maxFuel, s.fuelLiters + affordableLiters),
            moneyEur: s.moneyEur - actualCost,
          });
          s.pushNotification('success', '部分加油完成', `加注 ${affordableLiters}L · 花费 €${actualCost}`);
          return actualCost;
        }
        set({
          fuelLiters: maxFuel,
          moneyEur: s.moneyEur - cost,
        });
        s.pushNotification('success', '油箱已加满', `加注 ${Math.round(needed)}L 柴油 · 花费 €${cost}`);
        return cost;
      },

      repairTruckFull: () => {
        const s = get();
        const missing = Math.max(0, 100 - s.truckHealth);
        if (missing < 0.5) {
          s.pushNotification('info', '车况良好', '当前牵引车无需维修');
          return 0;
        }
        const cost = Math.round(missing * 45);
        if (s.moneyEur < cost) {
          s.pushNotification('warning', '资金不足', `全面整修需要 €${cost.toLocaleString()}`);
          return 0;
        }
        set({
          truckHealth: 100,
          moneyEur: s.moneyEur - cost,
        });
        s.pushNotification('success', '车辆维修完成', `车况恢复 100% · 花费 €${cost.toLocaleString()}`);
        return cost;
      },

      applyFine: (amountEur, reason) => {
        set((s) => ({
          moneyEur: Math.max(0, s.moneyEur - amountEur),
          activeJob: s.activeJob
            ? { ...s.activeJob, tripViolations: s.activeJob.tripViolations + 1 }
            : null,
        }));
        get().pushNotification('fine', `交通违章罚款 -€${amountEur}`, reason);
      },

      payToll: (amountEur, label) => {
        set((s) => ({
          moneyEur: Math.max(0, s.moneyEur - amountEur),
        }));
        get().pushNotification('info', `E-Toll 收费站自动扣费 -€${amountEur}`, label);
      },

      applyRoadsideRescue: (costEur, stationName) => {
        const s = get();
        const actualCost = Math.min(s.moneyEur, costEur);
        const maxFuel = getMaxFuelLiters(s.tankTier);
        const fuelBonus = s.fuelLiters < 40 ? Math.min(80, maxFuel - s.fuelLiters) : 0;
        set({
          moneyEur: Math.max(0, s.moneyEur - actualCost),
          fuelLiters: Math.min(maxFuel, s.fuelLiters + fuelBonus),
          activeModal: 'none',
        });
        s.pushNotification(
          'info',
          `道路救援拖车完成 (-€${actualCost})`,
          `已拖至 ${stationName}${fuelBonus > 0 ? ` · 附赠 ${Math.round(fuelBonus)}L 应急柴油` : ''}`
        );
      },

      upgradeEngine: (tier) => {
        const spec = ENGINE_TIERS[tier];
        const s = get();
        if (!spec || tier <= s.engineTier) return false;
        if (s.moneyEur < spec.priceEur) {
          s.pushNotification('warning', '余额不足', `升级 ${spec.name} 需要 €${spec.priceEur.toLocaleString()}`);
          return false;
        }
        set({
          engineTier: tier,
          moneyEur: s.moneyEur - spec.priceEur,
        });
        s.pushNotification('success', '引擎改装完成', `已装配 ${spec.name} (${spec.hp} HP)`);
        return true;
      },

      upgradeTank: (tier) => {
        const spec = TANK_TIERS[tier];
        const s = get();
        if (!spec || tier <= s.tankTier) return false;
        if (s.moneyEur < spec.priceEur) {
          s.pushNotification('warning', '余额不足', `升级 ${spec.name} 需要 €${spec.priceEur.toLocaleString()}`);
          return false;
        }
        set({
          tankTier: tier,
          fuelLiters: spec.capacityLiters,
          moneyEur: s.moneyEur - spec.priceEur,
        });
        s.pushNotification('success', '油箱改装完成', `容量提升至 ${spec.capacityLiters}L`);
        return true;
      },

      setPaintHex: (paintHex) => {
        const s = get();
        const cost = 1200;
        if (s.paintHex === paintHex) return;
        if (s.moneyEur < cost) {
          s.pushNotification('warning', '余额不足', `定制金属车漆需要 €${cost}`);
          return;
        }
        set({ paintHex, moneyEur: s.moneyEur - cost });
        s.pushNotification('success', '车漆喷涂完成', `花费 €${cost}`);
      },

      completeDelivery: (manualParking) => {
        const s = get();
        if (!s.activeJob) return null;
        const {
          job,
          cargoHealth,
          remainingSeconds,
          tripFuelUsedLiters,
          tripDistanceKm,
          tripViolations,
        } = s.activeJob;
        const basePayEur = job.basePayEur;
        const parkingBonusEur = manualParking ? Math.round(basePayEur * 0.3) : 0;
        const onTime = remainingSeconds > 0;
        const onTimeBonusEur = onTime ? Math.round(basePayEur * 0.12) : 0;
        const damageRatio = Math.max(0, (100 - cargoHealth) / 100);
        const damagePenaltyEur = Math.round(basePayEur * damageRatio * 0.65);
        const totalEarnedEur = Math.max(
          250,
          basePayEur + parkingBonusEur + onTimeBonusEur - damagePenaltyEur
        );
        const xpEarned =
          job.xpReward +
          (manualParking ? Math.round(job.xpReward * 0.35) : 0) +
          (onTime ? Math.round(job.xpReward * 0.15) : 0);
        const nextXp = s.xp + xpEarned;
        const nextLevel = computeLevelFromXp(nextXp);
        const leveledUp = nextLevel > s.level;
        const levelUpBonusEur = leveledUp ? 2500 : 0;
        const avgFuelLPer100Km =
          tripDistanceKm > 0.15
            ? Number(((tripFuelUsedLiters / tripDistanceKm) * 100).toFixed(1))
            : 31.5;
        const safetyGrade: 'S' | 'A' | 'B' =
          cargoHealth >= 98 && tripViolations === 0 && onTime
            ? 'S'
            : cargoHealth >= 88 && tripViolations <= 1
            ? 'A'
            : 'B';

        const result: DeliveryResult = {
          job,
          basePayEur,
          parkingBonusEur,
          onTimeBonusEur,
          damagePenaltyEur,
          totalEarnedEur: totalEarnedEur + levelUpBonusEur,
          xpEarned,
          manualParking,
          onTime,
          cargoHealth,
          avgFuelLPer100Km,
          safetyGrade,
        };

        set({
          moneyEur: s.moneyEur + totalEarnedEur + levelUpBonusEur,
          xp: nextXp,
          level: nextLevel,
          completedJobs: s.completedJobs + 1,
          activeJob: null,
          lastDeliveryResult: result,
          activeModal: 'delivery_summary',
          parkingGuide: DEFAULT_PARKING_GUIDE,
        });
        if (leveledUp) {
          get().pushNotification(
            'success',
            `驾驶等级提升至 Lv.${nextLevel} (${getDriverRankTitle(nextLevel)})！`,
            `获得晋升奖金 +€${levelUpBonusEur.toLocaleString()}`
          );
        }
        return result;
      },

      updateTelemetry: (partial) =>
        set((s) => ({
          telemetry: { ...s.telemetry, ...partial },
        })),

      setNearbyInteraction: (nearbyInteraction) =>
        set((s) => {
          const prev = s.nearbyInteraction;
          if (prev === nearbyInteraction) return s;
          if (
            prev &&
            nearbyInteraction &&
            prev.kind === nearbyInteraction.kind &&
            prev.label === nearbyInteraction.label &&
            prev.sublabel === nearbyInteraction.sublabel &&
            prev.depotId === nearbyInteraction.depotId &&
            prev.cityId === nearbyInteraction.cityId
          ) {
            return s;
          }
          return { nearbyInteraction };
        }),
      setParkingGuide: (parkingGuide) =>
        set((s) => {
          const prev = s.parkingGuide;
          if (
            prev.active === parkingGuide.active &&
            prev.aligned === parkingGuide.aligned &&
            prev.readyToDeliver === parkingGuide.readyToDeliver &&
            prev.distanceMeters === parkingGuide.distanceMeters &&
            prev.angleErrorDeg === parkingGuide.angleErrorDeg &&
            prev.speedKmh === parkingGuide.speedKmh &&
            prev.bayX === parkingGuide.bayX &&
            prev.bayZ === parkingGuide.bayZ &&
            prev.bayHeadingRad === parkingGuide.bayHeadingRad
          ) {
            return s;
          }
          return { parkingGuide };
        }),

      pushNotification: (type, title, detail) =>
        set((s) => {
          const item: HudNotification = {
            id: notificationSeq++,
            type,
            title,
            detail,
            createdAt: Date.now(),
          };
          return {
            notifications: [item, ...s.notifications].slice(0, 4),
          };
        }),

      triggerSpeedCameraFlash: () => set({ speedCameraFlashAt: Date.now() }),

      tickJobTimer: (dtSec) =>
        set((s) => {
          if (!s.activeJob) return s;
          return {
            activeJob: {
              ...s.activeJob,
              remainingSeconds: Math.max(0, s.activeJob.remainingSeconds - dtSec),
            },
          };
        }),

      addCareerDistance: (deltaKm) =>
        set((s) => ({
          totalDistanceKm: s.totalDistanceKm + deltaKm,
          activeJob: s.activeJob
            ? {
                ...s.activeJob,
                tripDistanceKm: s.activeJob.tripDistanceKm + deltaKm,
              }
            : null,
        })),

      applyDrivingProgress: ({ fuelBurned = 0, distanceKm = 0, fatigueDelta = 0, jobTimerSec = 0 }) =>
        set((s) => {
          if (fuelBurned <= 0 && distanceKm <= 0 && fatigueDelta <= 0 && jobTimerSec <= 0) {
            return s;
          }
          const nextFuel = fuelBurned > 0 ? Math.max(0, s.fuelLiters - fuelBurned) : s.fuelLiters;
          const nextDist = distanceKm > 0 ? s.totalDistanceKm + distanceKm : s.totalDistanceKm;
          const nextFatigue =
            fatigueDelta > 0
              ? Math.min(100, Math.max(0, s.driverFatiguePct + fatigueDelta))
              : s.driverFatiguePct;
          const nextJob = s.activeJob
            ? {
                ...s.activeJob,
                tripFuelUsedLiters: s.activeJob.tripFuelUsedLiters + fuelBurned,
                tripDistanceKm: s.activeJob.tripDistanceKm + distanceKm,
                remainingSeconds: Math.max(0, s.activeJob.remainingSeconds - jobTimerSec),
              }
            : null;
          return {
            fuelLiters: nextFuel,
            totalDistanceKm: nextDist,
            driverFatiguePct: nextFatigue,
            activeJob: nextJob,
          };
        }),

      resetCareer: () =>
        set({
          ...INITIAL_PERSISTED,
          activeJob: null,
          lastDeliveryResult: null,
          notifications: [],
          telemetry: DEFAULT_TELEMETRY,
        }),
    }),
    {
      name: 'eurohaul_save_v1',
      version: 6,
      storage: createJSONStorage(() => debouncedLocalStorage),
      migrate: (persistedState) => {
        const st = (persistedState ?? {}) as Partial<PersistedCareerState>;
        const mirrorsEnabled = st.mirrorsEnabled ?? INITIAL_SPEC.defaultMirrors;
        const mirrorDisplayMode: MirrorDisplayMode =
          st.mirrorDisplayMode === 'both' ||
          st.mirrorDisplayMode === 'right_only' ||
          st.mirrorDisplayMode === 'off'
            ? st.mirrorDisplayMode
            : mirrorsEnabled
            ? 'both'
            : 'off';
        return {
          ...INITIAL_PERSISTED,
          ...st,
          mirrorsEnabled: mirrorDisplayMode !== 'off',
          mirrorDisplayMode,
          advisorDisplayMode: st.advisorDisplayMode ?? 'full',
          cabFovDeg: st.cabFovDeg ?? 68,
          seatOffsetZ: st.seatOffsetZ ?? 0,
          seatOffsetY: st.seatOffsetY ?? 0,
          steeringCameraEnabled: st.steeringCameraEnabled ?? true,
          showCabPendant: st.showCabPendant ?? true,
          a2ExamProgress: st.a2ExamProgress ?? {},
          qualityPreset:
            !INITIAL_HARDWARE.isTouchDevice && st.qualityPreset === 'high'
              ? INITIAL_HARDWARE.recommendedPreset
              : migrateQualityPreset(st.qualityPreset),
        };
      },
      partialize: (state) => ({
        selectedMapId: state.selectedMapId,
        moneyEur: state.moneyEur,
        xp: state.xp,
        level: state.level,
        completedJobs: state.completedJobs,
        totalDistanceKm: state.totalDistanceKm,
        engineTier: state.engineTier,
        tankTier: state.tankTier,
        paintHex: state.paintHex,
        truckHealth: state.truckHealth,
        fuelLiters: state.fuelLiters,
        qualityPreset: state.qualityPreset,
        drsEnabled: state.drsEnabled,
        showFps: state.showFps,
        showDrawCalls: state.showDrawCalls,
        cabMotionEnabled: state.cabMotionEnabled,
        mirrorsEnabled: state.mirrorsEnabled,
        mirrorDisplayMode: state.mirrorDisplayMode,
        advisorDisplayMode: state.advisorDisplayMode,
        cabFovDeg: state.cabFovDeg,
        seatOffsetZ: state.seatOffsetZ,
        seatOffsetY: state.seatOffsetY,
        steeringCameraEnabled: state.steeringCameraEnabled,
        showCabPendant: state.showCabPendant,
        audioEnabled: state.audioEnabled,
        masterVolume: state.masterVolume,
        mobileControlsEnabled: state.mobileControlsEnabled,
        mobileSteeringStyle: state.mobileSteeringStyle,
        speedLimiterEnabled: state.speedLimiterEnabled,
        weatherSetting: state.weatherSetting,
        realisticSteeringReturn: state.realisticSteeringReturn,
        examVoiceEnabled: state.examVoiceEnabled,
        examStrictCamera: state.examStrictCamera,
        fatigueEnabled: state.fatigueEnabled,
        driverFatiguePct: state.driverFatiguePct,
        a2ExamProgress: state.a2ExamProgress,
      }),
    }
  )
);
