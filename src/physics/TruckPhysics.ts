import * as THREE from 'three';
import { BuiltMap, SurfaceQueryResult } from '../map/MapBuilder';
import { ENGINE_TIERS, HeadlightMode, TransmissionMode } from '../store/useGameStore';
import { TruckVisualRefs } from '../graphics/TruckMeshBuilder';
import { InputManager } from '../core/InputManager';

// Realistic 12-speed European heavy-truck gearbox ratios (12th is 0.78 overdrive)
const GEAR_RATIOS = [10.40, 8.05, 6.20, 4.80, 3.76, 2.96, 2.36, 1.88, 1.51, 1.22, 0.98, 0.78] as const;
// 2 reverse gears: R1 (-10.78) and R2 (-3.50)
const REVERSE_RATIOS = [-10.78, -3.50] as const;

const FINAL_DRIVE = 3.48;
const WHEEL_RADIUS = 0.50;
const DRIVETRAIN_EFFICIENCY = 0.88;

const IDLE_RPM = 650;
const REDLINE_RPM = 2200;
const CUTOFF_RPM = 2300;

const TRACTOR_MASS_KG = 8000;
const EMPTY_TRAILER_MASS_KG = 7000;
const CRR_PAVED = 0.007;
const CRR_OFFROAD = 0.06;
// 0.5 * rho(1.225) * Cd(0.65) * A(9.5 m^2)
const AERO_DRAG_COEFF = 0.5 * 1.225 * 0.65 * 9.5;

const TRACTOR_WHEELBASE = 3.65;
const REAR_AXLE_LOCAL_Z = -1.75;
const HITCH_LOCAL_Z = -1.65;
const HITCH_FROM_REAR_AXLE = 0.10;
const KINGPIN_LOCAL_Z = 5.2;
const TRAILER_WHEELBASE = 9.7;
const MAX_HITCH_ANGLE_RAD = (72 * Math.PI) / 180;

function wrapAngle(a: number): number {
  let r = a;
  while (r > Math.PI) r -= Math.PI * 2;
  while (r < -Math.PI) r += Math.PI * 2;
  return r;
}

/**
 * Diesel torque curve normalized [0..1] around peak plateau (1000..1450 RPM).
 */
function evaluateTorqueFactor(rpm: number): number {
  if (rpm >= CUTOFF_RPM) return 0;
  if (rpm <= IDLE_RPM) return 0.68;
  if (rpm < 1000) {
    return THREE.MathUtils.lerp(0.68, 1.0, (rpm - IDLE_RPM) / (1000 - IDLE_RPM));
  }
  if (rpm <= 1450) {
    return 1.0;
  }
  if (rpm <= REDLINE_RPM) {
    return THREE.MathUtils.lerp(1.0, 0.58, (rpm - 1450) / (REDLINE_RPM - 1450));
  }
  return THREE.MathUtils.lerp(0.58, 0.0, (rpm - REDLINE_RPM) / (CUTOFF_RPM - REDLINE_RPM));
}

export interface CollisionEvent {
  impactSpeedKmh: number;
  label: string;
}

export interface Point2D {
  x: number;
  z: number;
}

export interface VehicleFootprint {
  tractorCorners: [Point2D, Point2D, Point2D, Point2D];
  tractorWheels: {
    fl: Point2D;
    fr: Point2D;
    rl: Point2D;
    rr: Point2D;
  };
  trailerCorners: [Point2D, Point2D, Point2D, Point2D];
  trailerAxleWheels: Point2D[];
  frontBumperCenter: Point2D;
  trailerRearCenter: Point2D;
  tractorRightEdgeFront: Point2D;
  tractorRightEdgeRear: Point2D;
  trailerRightEdgeRear: Point2D;
}

export type ExamSurfaceOverride = (x: number, z: number, out: SurfaceQueryResult) => boolean;

/**
 * Articulated tractor + semi-trailer physics model with 12-speed + 2-reverse transmission,
 * dual-circuit pneumatic air brakes, thermal brake fade, clutch/stall dynamics, exhaust brake,
 * SI-consistent dynamics, flat torque plateau, kickdown shifting, and electronic speed limiter.
 */
export class TruckPhysics {
  // Tractor state
  public x = 0;
  public y = 0;
  public z = 0;
  public yaw = 0; // 0 = +Z, +PI/2 = +X
  public pitch = 0;
  public speedMs = 0; // signed forward velocity (m/s)
  public steerAngleRad = 0;

  // Trailer state
  public trailerAttached = true;
  public trailerX = 0;
  public trailerY = 0;
  public trailerZ = 0;
  public trailerYaw = 0;
  public trailerPitch = 0;
  public trailerRoll = 0;
  public hitchAngleRad = 0;

  // Powertrain & controls
  public gear = 1; // -2=R2, -1=R1, 0=N, 1..12=Forward
  public rpm = IDLE_RPM;
  public parkingBrake = true;
  public cruiseControlKmh: number | null = null;
  public lastCruiseControlKmh: number | null = null;
  public ccAutoRetarderLevel = 0; // 0..3
  public ccAutoExhaustBrake = false;
  public retarderLevel = 0; // 0..3
  public headlightMode: HeadlightMode = 1;
  public cabLightOn = false;
  public leftBlinker = false;
  public rightBlinker = false;
  public hazardLights = false;
  public blinkerLit = false;

  // Heavy-truck realistic systems
  public engineRunning = true;
  public engineStalled = false;
  public exhaustBrakeActive = false;
  public diffLockActive = false;
  public trailerBrakeActive = false;
  public airPressureBar = 8.0;
  public lowAirWarning = false;
  public emergencyBrakeLock = false;
  public appliedBrakePressure = 0;
  public brakeTempC = 65;
  public brakeFadePct = 0;
  public frontWheelAngleDeg = 0;
  public totalWeightTons = 15;
  public instantFuelLPer100Km = 0;
  public turboBoost = 0.48; // 0.48..1.0 spool multiplier
  public escActive = false;

  // One-shot audio/UI event flags (reset each physics step)
  public airBrakeReleaseEvent = 0;
  public airDryerPurgeEvent = false;
  public engineJustStarted = false;
  public engineJustStalled = false;
  public turboBlowoffEvent = 0;
  public rangeShiftEvent = false;
  public roadJointEvent = 0;

  // Cab suspension visual dynamics (2nd-order underdamped spring-damper, prev/curr interpolated)
  public cabPitch = 0;
  public cabRoll = 0;
  private cabPitchVel = 0;
  private cabRollVel = 0;
  private cabLongAccel = 0;
  private filteredLatAccelMs2 = 0;
  private effectiveYawRate = 0;
  private prevDriveBoostReady = false;

  // Previous-step pose snapshot for smooth render-rate interpolation
  private prevX = 0;
  private prevY = 0;
  private prevZ = 0;
  private prevYaw = 0;
  private prevPitch = 0;
  private prevTrailerX = 0;
  private prevTrailerY = 0;
  private prevTrailerZ = 0;
  private prevTrailerYaw = 0;
  private prevTrailerPitch = 0;
  private prevTrailerRoll = 0;
  private prevCabPitch = 0;
  private prevCabRoll = 0;
  private prevWheelSpinAngle = 0;
  private prevSteerAngleRad = 0;

  // Telemetry & stats
  public odometerKm = 0;
  public speedLimitKmh = 80;
  public onRoad = true;
  public onRumbleStrip = false;
  public nearestSegmentId: string | null = null;
  public isReversingThrottle = false;
  public wheelSpinAngle = 0;
  public lastCollision: CollisionEvent | null = null;

  private shiftTimerSec = 0;
  private shiftCooldownSec = 0;
  private shiftTorqueRampSec = 0.14;
  private hillHoldTimerSec = 0;
  private roadJointAccumM = 0;
  private idleVibClockSec = 0;
  private autoReverseHoldSec = 0;
  private blinkerClockSec = 0;
  private leftTurnPeakReached = false;
  private rightTurnPeakReached = false;
  public filteredAccelMs2 = 0;
  private collisionCooldownSec = 0;
  private starterCooldownSec = 0;
  private stallAccumSec = 0;
  private prevBrakeApplied = false;
  private peakBrakePressure = 0;
  private dryerPurgedAtTop = true;

  private readonly surfaceMain: SurfaceQueryResult = {
    groundY: 0,
    onRoad: true,
    speedLimitKmh: 80,
    nearestSegmentId: null,
    roadDist: 0,
    guardrailPushX: 0,
    guardrailPushZ: 0,
    guardrailHit: false,
  };
  private readonly surfaceProbe: SurfaceQueryResult = {
    groundY: 0,
    onRoad: true,
    speedLimitKmh: 80,
    nearestSegmentId: null,
    roadDist: 0,
    guardrailPushX: 0,
    guardrailPushZ: 0,
    guardrailHit: false,
  };

  public savePreviousPose(): void {
    this.prevX = this.x;
    this.prevY = this.y;
    this.prevZ = this.z;
    this.prevYaw = this.yaw;
    this.prevPitch = this.pitch;
    this.prevTrailerX = this.trailerX;
    this.prevTrailerY = this.trailerY;
    this.prevTrailerZ = this.trailerZ;
    this.prevTrailerYaw = this.trailerYaw;
    this.prevTrailerPitch = this.trailerPitch;
    this.prevTrailerRoll = this.trailerRoll;
    this.prevCabPitch = this.cabPitch;
    this.prevCabRoll = this.cabRoll;
    this.prevWheelSpinAngle = this.wheelSpinAngle;
    this.prevSteerAngleRad = this.steerAngleRad;
  }

  public resetToSpawn(spawnPos: readonly [number, number, number], headingRad: number): void {
    this.x = spawnPos[0];
    this.y = spawnPos[1];
    this.z = spawnPos[2];
    this.yaw = headingRad;
    this.pitch = 0;
    this.speedMs = 0;
    this.filteredAccelMs2 = 0;
    this.filteredLatAccelMs2 = 0;
    this.cabLongAccel = 0;
    this.effectiveYawRate = 0;
    this.steerAngleRad = 0;
    this.frontWheelAngleDeg = 0;
    this.gear = 1;
    this.rpm = IDLE_RPM;
    this.shiftTimerSec = 0;
    this.shiftCooldownSec = 0;
    this.shiftTorqueRampSec = 0.14;
    this.hillHoldTimerSec = 0;
    this.roadJointAccumM = 0;
    this.idleVibClockSec = 0;
    this.parkingBrake = true;
    this.cruiseControlKmh = null;
    this.ccAutoRetarderLevel = 0;
    this.ccAutoExhaustBrake = false;
    this.retarderLevel = 0;
    this.exhaustBrakeActive = false;
    this.diffLockActive = false;
    this.trailerBrakeActive = false;
    this.engineRunning = true;
    this.engineStalled = false;
    this.stallAccumSec = 0;
    this.airPressureBar = 8.0;
    this.lowAirWarning = false;
    this.emergencyBrakeLock = false;
    this.appliedBrakePressure = 0;
    this.brakeTempC = 65;
    this.brakeFadePct = 0;
    this.turboBoost = 0.48;
    this.turboBlowoffEvent = 0;
    this.prevDriveBoostReady = false;
    this.escActive = false;
    this.trailerAttached = true;
    this.trailerYaw = headingRad;
    this.trailerPitch = 0;
    this.trailerRoll = 0;
    this.hitchAngleRad = 0;
    this.cabPitch = 0;
    this.cabRoll = 0;
    this.cabPitchVel = 0;
    this.cabRollVel = 0;
    this.onRumbleStrip = false;
    this.syncAttachedTrailerPosition();
    this.savePreviousPose();
  }

  public forcePose(
    x: number,
    y: number,
    z: number,
    yaw: number,
    trailerYaw = yaw,
    trailerAttached = true,
    parkingBrake = true
  ): void {
    this.resetToSpawn([x, y, z], yaw);
    this.trailerAttached = trailerAttached;
    this.trailerYaw = trailerYaw;
    this.hitchAngleRad = wrapAngle(yaw - trailerYaw);
    this.parkingBrake = parkingBrake;
    this.leftBlinker = false;
    this.rightBlinker = false;
    this.hazardLights = false;
    this.syncAttachedTrailerPosition();
    this.trailerY = y;
    this.savePreviousPose();
  }

  public toggleIgnition(): { running: boolean; started: boolean } {
    if (this.engineRunning) {
      this.engineRunning = false;
      this.engineStalled = false;
      this.cruiseControlKmh = null;
      return { running: false, started: false };
    }
    if (this.starterCooldownSec > 0) {
      return { running: false, started: false };
    }
    this.engineRunning = true;
    this.engineStalled = false;
    this.stallAccumSec = 0;
    this.rpm = Math.max(this.rpm, IDLE_RPM);
    this.starterCooldownSec = 0.7;
    this.engineJustStarted = true;
    this.cabRollVel += 0.32;
    return { running: true, started: true };
  }

  public toggleExhaustBrake(): boolean {
    this.exhaustBrakeActive = !this.exhaustBrakeActive;
    return this.exhaustBrakeActive;
  }

  public toggleDiffLock(): boolean {
    this.diffLockActive = !this.diffLockActive;
    return this.diffLockActive;
  }

  public getVehicleFootprint(): VehicleFootprint {
    const tSin = Math.sin(this.yaw);
    const tCos = Math.cos(this.yaw);
    const trSin = Math.sin(this.trailerYaw);
    const trCos = Math.cos(this.trailerYaw);

    // Local +X is Left, +Z is Forward
    const toWorldTractor = (lx: number, lz: number): Point2D => ({
      x: this.x + tCos * lx + tSin * lz,
      z: this.z - tSin * lx + tCos * lz,
    });
    const toWorldTrailer = (lx: number, lz: number): Point2D => ({
      x: this.trailerX + trCos * lx + trSin * lz,
      z: this.trailerZ - trSin * lx + trCos * lz,
    });

    return {
      tractorCorners: [
        toWorldTractor(1.24, 3.12),
        toWorldTractor(-1.24, 3.12),
        toWorldTractor(-1.24, -3.20),
        toWorldTractor(1.24, -3.20),
      ],
      tractorWheels: {
        fl: toWorldTractor(1.12, 1.95),
        fr: toWorldTractor(-1.12, 1.95),
        rl: toWorldTractor(1.12, -2.25),
        rr: toWorldTractor(-1.12, -2.25),
      },
      trailerCorners: [
        toWorldTrailer(1.24, 6.60),
        toWorldTrailer(-1.24, 6.60),
        toWorldTrailer(-1.24, -6.70),
        toWorldTrailer(1.24, -6.70),
      ],
      trailerAxleWheels: [
        toWorldTrailer(1.12, -3.3),
        toWorldTrailer(-1.12, -3.3),
        toWorldTrailer(1.12, -4.5),
        toWorldTrailer(-1.12, -4.5),
        toWorldTrailer(1.12, -5.7),
        toWorldTrailer(-1.12, -5.7),
      ],
      frontBumperCenter: toWorldTractor(0, 3.12),
      trailerRearCenter: toWorldTrailer(0, -6.70),
      tractorRightEdgeFront: toWorldTractor(-1.24, 2.2),
      tractorRightEdgeRear: toWorldTractor(-1.24, -2.4),
      trailerRightEdgeRear: toWorldTrailer(-1.24, -5.6),
    };
  }

  public toggleLeftBlinker(): void {
    this.leftBlinker = !this.leftBlinker;
    if (this.leftBlinker) this.rightBlinker = false;
    this.leftTurnPeakReached = false;
    this.blinkerClockSec = 0;
  }

  public toggleRightBlinker(): void {
    this.rightBlinker = !this.rightBlinker;
    if (this.rightBlinker) this.leftBlinker = false;
    this.rightTurnPeakReached = false;
    this.blinkerClockSec = 0;
  }

  public toggleHazards(): void {
    this.hazardLights = !this.hazardLights;
    this.blinkerClockSec = 0;
  }

  public cycleHeadlights(): void {
    this.headlightMode = ((this.headlightMode + 1) % 3) as HeadlightMode;
  }

  public toggleParkingBrake(): void {
    if (this.emergencyBrakeLock && this.parkingBrake) {
      return;
    }
    this.parkingBrake = !this.parkingBrake;
    this.airPressureBar = Math.max(0, this.airPressureBar - 0.16);
    if (this.parkingBrake) {
      this.cruiseControlKmh = null;
    }
  }

  public toggleCruiseControl(speedLimiterEnabled = true): void {
    if (this.cruiseControlKmh !== null) {
      this.lastCruiseControlKmh = this.cruiseControlKmh;
      this.cruiseControlKmh = null;
      return;
    }
    const kmh = this.speedMs * 3.6;
    const maxCruise = speedLimiterEnabled ? 90 : 110;
    if (kmh >= 25 && !this.parkingBrake && this.gear >= 1) {
      this.cruiseControlKmh = Math.min(maxCruise, Math.round(kmh));
      this.lastCruiseControlKmh = this.cruiseControlKmh;
    }
  }

  public adjustCruiseControl(deltaKmh: number, speedLimiterEnabled = true): void {
    const maxCruise = speedLimiterEnabled ? 90 : 110;
    if (this.cruiseControlKmh !== null) {
      this.cruiseControlKmh = THREE.MathUtils.clamp(this.cruiseControlKmh + deltaKmh, 30, maxCruise);
      this.lastCruiseControlKmh = this.cruiseControlKmh;
      return;
    }
    if (
      deltaKmh > 0 &&
      this.lastCruiseControlKmh !== null &&
      this.speedMs * 3.6 >= 25 &&
      !this.parkingBrake &&
      this.gear >= 1
    ) {
      this.cruiseControlKmh = THREE.MathUtils.clamp(this.lastCruiseControlKmh, 30, maxCruise);
    }
  }

  public cycleRetarder(): void {
    this.retarderLevel = (this.retarderLevel + 1) % 4;
  }

  private chooseLaunchGear(totalMassKg: number): number {
    if (this.pitch < -0.025) {
      return totalMassKg > 28000 ? 1 : 2;
    }
    if (totalMassKg <= 10500) return 4;
    if (totalMassKg <= 22000) return 3;
    if (totalMassKg <= 32000) return 2;
    return 1;
  }

  private applyGearChange(nextGear: number, shiftDur: number, cooldownDur: number): void {
    const prev = this.gear;
    if ((prev >= 1 && prev <= 6 && nextGear >= 7) || (prev >= 7 && nextGear >= 1 && nextGear <= 6)) {
      this.rangeShiftEvent = true;
    }
    this.gear = nextGear;
    this.shiftTimerSec = shiftDur;
    this.shiftCooldownSec = cooldownDur;
    this.shiftTorqueRampSec = 0;
  }

  public shiftUp(mode: TransmissionMode): void {
    if (mode === 'real_auto') {
      if (this.gear < 0) {
        this.applyGearChange(0, 0.16, 0.35);
      } else if (this.gear === 0) {
        this.applyGearChange(this.chooseLaunchGear(this.totalWeightTons * 1000), 0.18, 0.45);
      } else if (this.gear < 12) {
        this.applyGearChange(this.gear + 1, 0.22, 0.65);
      }
      return;
    }
    if (mode === 'auto' && this.gear >= 1) {
      if (this.gear < 12) {
        this.applyGearChange(this.gear + 1, 0.24, 0.65);
      }
      return;
    }
    if (this.gear < 12) {
      this.applyGearChange(this.gear + 1, 0.20, 0.40);
    }
  }

  public shiftDown(mode: TransmissionMode): void {
    if (mode === 'real_auto') {
      if (this.gear > 0) {
        if (Math.abs(this.speedMs) < 2.5) {
          this.applyGearChange(0, 0.16, 0.35);
        } else if (this.gear > 1) {
          this.applyGearChange(this.gear - 1, 0.22, 0.55);
        }
      } else if (this.gear === 0 && Math.abs(this.speedMs) < 2.5) {
        this.applyGearChange(-1, 0.18, 0.45);
      }
      return;
    }
    if (mode === 'auto' && this.gear <= 1 && Math.abs(this.speedMs) > 1.5) return;
    if (this.gear > -2) {
      this.applyGearChange(this.gear - 1, 0.20, 0.40);
    }
  }

  public tryToggleTrailer(): { attached: boolean; changed: boolean; reason?: string } {
    if (this.trailerAttached) {
      if (Math.abs(this.speedMs) > 1.0) {
        return { attached: true, changed: false, reason: '请先将车速降至 3 km/h 以下再摘挂' };
      }
      this.trailerAttached = false;
      this.syncAttachedTrailerPosition();
      return { attached: false, changed: true };
    }

    const hitchX = this.x + Math.sin(this.yaw) * HITCH_LOCAL_Z;
    const hitchZ = this.z + Math.cos(this.yaw) * HITCH_LOCAL_Z;
    const kingpinX = this.trailerX + Math.sin(this.trailerYaw) * KINGPIN_LOCAL_Z;
    const kingpinZ = this.trailerZ + Math.cos(this.trailerYaw) * KINGPIN_LOCAL_Z;
    const dist = Math.hypot(hitchX - kingpinX, hitchZ - kingpinZ);
    const angleDiff = Math.abs(wrapAngle(this.yaw - this.trailerYaw));

    if (dist <= 3.6 && angleDiff <= 0.95) {
      this.trailerAttached = true;
      this.syncAttachedTrailerPosition();
      return { attached: true, changed: true };
    }
    return {
      attached: false,
      changed: false,
      reason: `牵引鞍座距挂车销过远 (${dist.toFixed(1)}m)，请倒车对准后按 T 挂接`,
    };
  }

  private getGearRatio(gear: number): number {
    if (gear === 0) return 0;
    if (gear === -1) return REVERSE_RATIOS[0];
    if (gear <= -2) return REVERSE_RATIOS[1];
    return GEAR_RATIOS[Math.max(0, Math.min(11, gear - 1))]!;
  }

  private queryGround(
    x: number,
    z: number,
    map: BuiltMap,
    out: SurfaceQueryResult,
    override?: ExamSurfaceOverride
  ): void {
    if (override && override(x, z, out)) {
      return;
    }
    map.querySurface(x, z, out);
  }

  public step(
    dtSec: number,
    input: InputManager,
    map: BuiltMap,
    opts: {
      engineTier: number;
      cargoWeightTons: number;
      fuelLiters: number;
      transmissionMode: TransmissionMode;
      speedLimiterEnabled: boolean;
      truckHealth: number;
      rainIntensity?: number;
      cabMotionEnabled?: boolean;
      surfaceOverride?: ExamSurfaceOverride;
      surfaceGripOverride?: number;
      skipMapCollisions?: boolean;
      onFuelBurned: (liters: number) => void;
      onDistanceKm: (km: number) => void;
    }
  ): void {
    this.lastCollision = null;
    this.airBrakeReleaseEvent = 0;
    this.airDryerPurgeEvent = false;
    this.engineJustStarted = false;
    this.engineJustStalled = false;
    this.turboBlowoffEvent = 0;
    this.rangeShiftEvent = false;
    this.roadJointEvent = 0;
    this.ccAutoRetarderLevel = 0;
    this.ccAutoExhaustBrake = false;
    if (this.collisionCooldownSec > 0) {
      this.collisionCooldownSec = Math.max(0, this.collisionCooldownSec - dtSec);
    }
    if (this.starterCooldownSec > 0) {
      this.starterCooldownSec = Math.max(0, this.starterCooldownSec - dtSec);
    }

    // Blinker oscillator + auto-cancel on steer straightening
    this.blinkerClockSec += dtSec;
    this.blinkerLit =
      Math.floor(this.blinkerClockSec * 2.3) % 2 === 0 &&
      (this.leftBlinker || this.rightBlinker || this.hazardLights);

    if (this.leftBlinker) {
      if (input.steer > 0.35) this.leftTurnPeakReached = true;
      else if (this.leftTurnPeakReached && Math.abs(input.steer) < 0.08) {
        this.leftBlinker = false;
        this.leftTurnPeakReached = false;
      }
    }
    if (this.rightBlinker) {
      if (input.steer < -0.35) this.rightTurnPeakReached = true;
      else if (this.rightTurnPeakReached && Math.abs(input.steer) < 0.08) {
        this.rightBlinker = false;
        this.rightTurnPeakReached = false;
      }
    }

    // Query road surface under tractor & continuous slope
    this.surfaceMain.roadHalfWidth = 0;
    this.surfaceMain.medianBarrierHit = false;
    this.surfaceMain.medianPushX = 0;
    this.surfaceMain.medianPushZ = 0;
    this.surfaceMain.medianPenetration = 0;
    this.queryGround(this.x, this.z, map, this.surfaceMain, opts.surfaceOverride);
    this.speedLimitKmh = this.surfaceMain.speedLimitKmh;
    this.onRoad = this.surfaceMain.onRoad;
    this.nearestSegmentId = this.surfaceMain.nearestSegmentId;

    const fwdX = Math.sin(this.yaw);
    const fwdZ = Math.cos(this.yaw);
    this.queryGround(this.x + fwdX * 3.0, this.z + fwdZ * 3.0, map, this.surfaceProbe, opts.surfaceOverride);
    const frontY = this.surfaceProbe.groundY;
    this.queryGround(this.x - fwdX * 2.5, this.z - fwdZ * 2.5, map, this.surfaceProbe, opts.surfaceOverride);
    const backY = this.surfaceProbe.groundY;
    const targetPitch = THREE.MathUtils.clamp(-Math.atan2(frontY - backY, 5.5), -0.24, 0.24);
    this.pitch += (targetPitch - this.pitch) * Math.min(1, dtSec * 10);
    this.y += (this.surfaceMain.groundY - this.y) * Math.min(1, dtSec * 18);

    // ETS2 speed-sensitive steering curve: 0.72 rad (~41 deg) tight low-speed lock -> 0.105 rad (~6 deg) calm highway authority
    const absSpeedKmh = Math.abs(this.speedMs) * 3.6;
    const steerSpeedT = THREE.MathUtils.clamp((absSpeedKmh - 12) / 78, 0, 1);
    const maxSteer = 0.105 + 0.615 * Math.pow(1 - steerSpeedT, 2.35);
    this.steerAngleRad = input.steer * maxSteer * (this.diffLockActive ? 0.92 : 1.0);
    this.frontWheelAngleDeg = Math.round((this.steerAngleRad * 180) / Math.PI);

    // Auto transmission direction & reverse selector
    let throttleCmd = input.throttle;
    let brakeCmd = input.brake;
    this.isReversingThrottle = false;
    this.trailerBrakeActive = input.trailerBrake;

    if (input.brake > 0.08 || this.parkingBrake || !this.engineRunning) {
      if (this.cruiseControlKmh !== null) {
        this.lastCruiseControlKmh = this.cruiseControlKmh;
      }
      this.cruiseControlKmh = null;
    }

    if (opts.transmissionMode === 'auto') {
      if (this.gear === 0) this.gear = 1;
      if (Math.abs(this.speedMs) < 0.25 && input.brake > 0.25 && input.throttle < 0.05) {
        this.autoReverseHoldSec += dtSec;
        if (this.autoReverseHoldSec > 0.55) {
          if (this.gear >= 0) {
            this.gear = -1;
            this.shiftCooldownSec = 0.4;
          }
        }
      } else {
        this.autoReverseHoldSec = 0;
      }

      if (this.gear < 0) {
        if (input.throttle > 0.12 && this.speedMs > -1.2) {
          this.gear = 1;
          this.shiftTimerSec = 0.18;
          this.shiftCooldownSec = 0.65;
        } else {
          throttleCmd = input.brake;
          brakeCmd = input.throttle;
          this.isReversingThrottle = throttleCmd > 0.05;
        }
      }
    } else if (this.gear < 0) {
      // real_auto & sequential: W is always throttle, S is always brake
      this.isReversingThrottle = throttleCmd > 0.05;
    }

    // Cruise control governor (prioritizes retarder & exhaust brake on downhill overspeed)
    const maxAllowedKmh = opts.speedLimiterEnabled ? 90 : 110;
    if (
      this.engineRunning &&
      this.cruiseControlKmh !== null &&
      this.gear >= 1 &&
      throttleCmd < 0.05 &&
      brakeCmd < 0.05
    ) {
      const targetKmh = Math.min(this.cruiseControlKmh, maxAllowedKmh);
      const targetMs = targetKmh / 3.6;
      const err = targetMs - this.speedMs;
      const overspeedKmh = this.speedMs * 3.6 - targetKmh;
      if (err > 0) {
        throttleCmd = THREE.MathUtils.clamp(err * 0.5, 0, 0.9);
      } else if (overspeedKmh > 3) {
        this.ccAutoRetarderLevel = overspeedKmh > 9 ? 3 : overspeedKmh > 6 ? 2 : 1;
        this.ccAutoExhaustBrake = true;
        if (overspeedKmh > 12) {
          brakeCmd = THREE.MathUtils.clamp((overspeedKmh - 12) * 0.06, 0, 0.35);
        }
      }
    }

    if (this.shiftTimerSec > 0) {
      this.shiftTimerSec = Math.max(0, this.shiftTimerSec - dtSec);
    } else if (this.shiftTorqueRampSec < 0.14) {
      this.shiftTorqueRampSec = Math.min(0.14, this.shiftTorqueRampSec + dtSec);
    }
    if (this.shiftCooldownSec > 0) {
      this.shiftCooldownSec = Math.max(0, this.shiftCooldownSec - dtSec);
    }

    // Mass calculation (8,000 kg tractor + optional 7,000 kg empty trailer + 0..25,000 kg cargo)
    const trailerMassKg = this.trailerAttached ? EMPTY_TRAILER_MASS_KG + opts.cargoWeightTons * 1000 : 0;
    const totalMassKg = TRACTOR_MASS_KG + trailerMassKg;
    this.totalWeightTons = Number((totalMassKg / 1000).toFixed(1));

    // In 'auto' mode, select an appropriate launch gear from standstill for light/bobtail loads
    if (
      opts.transmissionMode === 'auto' &&
      this.gear === 1 &&
      Math.abs(this.speedMs) < 0.8 &&
      throttleCmd > 0.18 &&
      this.pitch >= -0.025 &&
      totalMassKg <= 22000 &&
      this.shiftCooldownSec <= 0
    ) {
      const launchG = this.chooseLaunchGear(totalMassKg);
      if (launchG > 1) {
        this.gear = launchG;
        this.shiftCooldownSec = 0.45;
      }
    }

    // Clutch engagement (0 = pedal down / open, 1 = engaged)
    const clutchEngage =
      opts.transmissionMode === 'sequential'
        ? THREE.MathUtils.clamp(1 - input.clutch * 1.15, 0, 1)
        : 1;

    // Speed-RPM coupling (SI m/s -> wheelRPM -> engineRPM)
    const gearRatio = this.getGearRatio(this.gear);
    const absRatio = Math.abs(gearRatio);
    const wheelRpm = (Math.abs(this.speedMs) / (2 * Math.PI * WHEEL_RADIUS)) * 60;
    const mechanicalRpm = this.gear === 0 ? IDLE_RPM : wheelRpm * absRatio * FINAL_DRIVE;

    let targetRpm: number;
    if (!this.engineRunning) {
      targetRpm = 0;
    } else if (this.gear === 0 || clutchEngage < 0.15) {
      targetRpm = IDLE_RPM + throttleCmd * 1450;
    } else if (this.shiftTimerSec > 0) {
      // Clutch momentarily open during shift: RPM settles smoothly toward target gear speed (no spike!)
      targetRpm = THREE.MathUtils.clamp(Math.max(IDLE_RPM, mechanicalRpm), IDLE_RPM, CUTOFF_RPM);
    } else {
      // Smooth launch clutch slip below ~1050 RPM so standing starts build peak torque smoothly
      const clutchLock = THREE.MathUtils.clamp((mechanicalRpm - 550) / 500, 0, 1) * clutchEngage;
      const launchSlipRpm = IDLE_RPM + throttleCmd * 580;
      const coupledRpm = THREE.MathUtils.lerp(launchSlipRpm, mechanicalRpm, clutchLock);
      targetRpm = THREE.MathUtils.clamp(coupledRpm, IDLE_RPM, CUTOFF_RPM);
    }

    this.rpm += (targetRpm - this.rpm) * Math.min(1, dtSec * (this.engineRunning ? 10 : 5));
    if (!this.engineRunning && this.rpm < 25) this.rpm = 0;

    // MT Stall simulation when clutch engaged at too low speed / wrong launch gear
    if (
      this.engineRunning &&
      opts.transmissionMode === 'sequential' &&
      this.gear !== 0 &&
      clutchEngage > 0.65 &&
      !this.parkingBrake
    ) {
      const tooLowSpeed = mechanicalRpm < 430 && throttleCmd < 0.12 && Math.abs(this.speedMs) < 0.35;
      const highGearLaunch = this.gear >= 4 && Math.abs(this.speedMs) < 1.2 && clutchEngage > 0.78;
      if (tooLowSpeed || highGearLaunch) {
        this.stallAccumSec += dtSec;
        if (this.stallAccumSec > 0.48) {
          this.engineRunning = false;
          this.engineStalled = true;
          this.engineJustStalled = true;
          this.stallAccumSec = 0;
          this.cruiseControlKmh = null;
        }
      } else {
        this.stallAccumSec = Math.max(0, this.stallAccumSec - dtSec * 2);
      }
    } else {
      this.stallAccumSec = 0;
    }

    // Electronic speed limiter (90 km/h default, 110 km/h when off)
    const maxForwardSpeedMs = maxAllowedKmh / 3.6;
    let effectiveThrottle = throttleCmd;
    if (this.gear >= 1) {
      const limiterMarginMs = 1.2 / 3.6;
      const limiterScale = THREE.MathUtils.clamp(
        (maxForwardSpeedMs - this.speedMs) / limiterMarginMs,
        0,
        1
      );
      effectiveThrottle *= limiterScale;
    }

    // Smart OptiCruise / I-Shift AT shifting (applies to both 'auto' and 'real_auto' D-mode)
    const isAutoShifting = opts.transmissionMode === 'auto' || opts.transmissionMode === 'real_auto';
    if (
      this.engineRunning &&
      isAutoShifting &&
      this.shiftTimerSec <= 0 &&
      this.shiftCooldownSec <= 0 &&
      !this.parkingBrake
    ) {
      if (this.gear >= 1) {
        const isClimbing = this.pitch < -0.015;
        const uphillBias = isClimbing ? Math.min(140, -this.pitch * 2200) : 0;
        const baseUpshiftRpm =
          effectiveThrottle <= 0.45
            ? THREE.MathUtils.lerp(1440, 1580, effectiveThrottle / 0.45)
            : THREE.MathUtils.lerp(1580, 1900, (effectiveThrottle - 0.45) / 0.55);
        const upshiftRpm = Math.min(1980, baseUpshiftRpm + uphillBias);
        const minPostShiftRpm =
          THREE.MathUtils.lerp(1080, 1300, effectiveThrottle) + (isClimbing ? 100 : 0);
        const nearSpeedLimiter = this.speedMs >= maxForwardSpeedMs - 3.5 / 3.6;
        const autoShiftDur = totalMassKg > 22000 ? 0.34 : 0.30;

        if (this.gear < 12 && throttleCmd > 0.12 && brakeCmd < 0.05) {
          const nextRatio = GEAR_RATIOS[this.gear]!;
          const predictedNextRpm = wheelRpm * nextRatio * FINAL_DRIVE;
          const canCruiseOverdrive =
            this.gear === 11 &&
            this.speedMs >= 78 / 3.6 &&
            effectiveThrottle < 0.45 &&
            !isClimbing &&
            predictedNextRpm >= 1120 &&
            (nearSpeedLimiter || mechanicalRpm >= 1480);
          const normalUpshift =
            mechanicalRpm >= upshiftRpm &&
            predictedNextRpm >= minPostShiftRpm &&
            this.filteredAccelMs2 > 0.02;

          if (normalUpshift || canCruiseOverdrive) {
            let gearStep = 1;
            if (
              normalUpshift &&
              this.gear <= 8 &&
              !isClimbing &&
              effectiveThrottle < 0.68 &&
              this.filteredAccelMs2 > 0.22
            ) {
              const skipRatio = GEAR_RATIOS[this.gear + 1]!;
              const predictedSkipRpm = wheelRpm * skipRatio * FINAL_DRIVE;
              if (predictedSkipRpm >= minPostShiftRpm - 80) {
                gearStep = 2;
              }
            }
            this.applyGearChange(Math.min(12, this.gear + gearStep), autoShiftDur, 0.72);
          }
        }

        if (this.shiftCooldownSec <= 0 && this.gear > 1) {
          const downshiftFloor = isClimbing ? 1140 : 1010;
          const lowRpmDownshift = mechanicalRpm < downshiftFloor;
          const kickdownTrigger =
            effectiveThrottle > 0.72 && this.filteredAccelMs2 < 0.25 && mechanicalRpm < 1420;

          if (lowRpmDownshift || kickdownTrigger) {
            const dropTwo =
              this.gear > 4 && effectiveThrottle > 0.8 && mechanicalRpm < 1100;
            this.applyGearChange(Math.max(1, this.gear - (dropTwo ? 2 : 1)), autoShiftDur, 0.68);
          }
        }
      } else if (this.gear < 0 && opts.transmissionMode === 'auto') {
        if (this.gear === -1 && mechanicalRpm > 1750 && throttleCmd > 0.2) {
          this.applyGearChange(-2, 0.24, 0.65);
        } else if (this.gear === -2 && mechanicalRpm < 950) {
          this.applyGearChange(-1, 0.24, 0.65);
        }
      }
    }

    // Turbocharger boost lag (0.48 -> 1.0 over ~0.55s spool, rapid wastegate blowoff on lift/shift)
    const rpmSpool = THREE.MathUtils.clamp((this.rpm - 850) / 680, 0, 1);
    const targetBoost =
      this.engineRunning && this.shiftTimerSec <= 0
        ? 0.48 + 0.52 * effectiveThrottle * rpmSpool
        : 0.48;
    const boostRate = targetBoost > this.turboBoost ? dtSec / 0.55 : dtSec / 0.18;
    const boostDiff = targetBoost - this.turboBoost;
    this.turboBoost += Math.sign(boostDiff) * Math.min(Math.abs(boostDiff), boostRate);
    if (this.turboBoost > 0.74) {
      this.prevDriveBoostReady = true;
    } else if (
      this.prevDriveBoostReady &&
      (effectiveThrottle < 0.12 || this.shiftTimerSec > 0) &&
      this.turboBoost > 0.62
    ) {
      this.turboBlowoffEvent = THREE.MathUtils.clamp((this.turboBoost - 0.55) / 0.45, 0.25, 1.0);
      this.prevDriveBoostReady = false;
    }

    // Wet/surface grip calculation (shared by drive traction, EBS braking, and lateral compliance)
    const baseWetGrip = THREE.MathUtils.lerp(1.0, 0.84, opts.rainIntensity ?? 0);
    const roadGrip = opts.surfaceGripOverride !== undefined ? opts.surfaceGripOverride : baseWetGrip;
    const diffBoost = this.diffLockActive && absSpeedKmh < 35 ? 0.18 : 0;
    const wetGrip = Math.min(1.0, roadGrip + diffBoost);

    // Torque curve & drivetrain force (100% SI units, including idle creep for precision maneuvering)
    const engineSpec = ENGINE_TIERS[opts.engineTier] ?? ENGINE_TIERS[0]!;
    const hasFuel = opts.fuelLiters > 0.01 && this.engineRunning;
    const torqueFactor = evaluateTorqueFactor(this.rpm);
    const healthScale = THREE.MathUtils.clamp(0.75 + (opts.truckHealth / 100) * 0.25, 0.75, 1);

    let creepThrottle = 0;
    if (
      hasFuel &&
      !this.parkingBrake &&
      this.gear !== 0 &&
      clutchEngage > 0.3 &&
      effectiveThrottle < 0.08 &&
      brakeCmd < 0.05 &&
      !this.trailerBrakeActive
    ) {
      const targetCreepMs = 1.65;
      if (this.gear > 0 && this.speedMs < targetCreepMs) {
        creepThrottle = (this.gear <= 2 ? 0.16 : 0.11) * THREE.MathUtils.clamp((targetCreepMs - this.speedMs) / 0.8, 0, 1);
      } else if (this.gear < 0 && this.speedMs > -targetCreepMs) {
        creepThrottle = (this.gear === -1 ? 0.16 : 0.11) * THREE.MathUtils.clamp((targetCreepMs + this.speedMs) / 0.8, 0, 1);
      }
    }

    let driveForceN = 0;
    const driveCmd = Math.max(effectiveThrottle, creepThrottle);
    if (hasFuel && !this.parkingBrake && this.gear !== 0 && this.shiftTimerSec <= 0) {
      const activeRatio = this.getGearRatio(this.gear);
      const boostScale = creepThrottle > effectiveThrottle ? 1.0 : this.turboBoost;
      const shiftRampScale = THREE.MathUtils.clamp(this.shiftTorqueRampSec / 0.14, 0, 1);
      const engineTorqueNm =
        engineSpec.maxTorqueNm * torqueFactor * boostScale * driveCmd * healthScale * clutchEngage * shiftRampScale;
      const wheelTorqueNm = engineTorqueNm * activeRatio * FINAL_DRIVE * DRIVETRAIN_EFFICIENCY;
      driveForceN = wheelTorqueNm / WHEEL_RADIUS;

      // Drive-axle vertical load traction limit (prevents 39t supercar launches in gear 1)
      const driveAxleLoadKg = Math.min(
        13500,
        TRACTOR_MASS_KG * 0.44 + (this.trailerAttached ? trailerMassKg * 0.28 : 0)
      );
      const tractionMu = Math.min(0.78, 0.64 * wetGrip * (this.diffLockActive ? 1.15 : 1.0));
      const maxDriveTractionN = driveAxleLoadKg * 9.81 * tractionMu;
      driveForceN = THREE.MathUtils.clamp(driveForceN, -maxDriveTractionN, maxDriveTractionN);
    }

    // Fuel consumption & instantaneous L/100km
    if (hasFuel) {
      const burnRateLitersPerSec =
        (0.0005 + effectiveThrottle * 0.0085 * (engineSpec.hp / 480)) *
        (this.trailerAttached ? 1.25 : 0.85);
      opts.onFuelBurned(burnRateLitersPerSec * dtSec);
      this.instantFuelLPer100Km =
        absSpeedKmh > 4 ? Number(Math.min(120, (burnRateLitersPerSec * 3600 * 100) / absSpeedKmh).toFixed(1)) : 0;
    } else {
      this.instantFuelLPer100Km = 0;
    }

    // Dual-circuit pneumatic air pressure dynamics
    if (this.engineRunning) {
      const rpmNorm = THREE.MathUtils.clamp((this.rpm - IDLE_RPM) / (REDLINE_RPM - IDLE_RPM), 0, 1);
      const prevAir = this.airPressureBar;
      this.airPressureBar = Math.min(8.5, this.airPressureBar + (0.09 + rpmNorm * 0.24) * dtSec);
      if (prevAir < 8.45 && this.airPressureBar >= 8.48 && !this.dryerPurgedAtTop) {
        this.airDryerPurgeEvent = true;
        this.dryerPurgedAtTop = true;
      } else if (this.airPressureBar < 8.1) {
        this.dryerPurgedAtTop = false;
      }
    }

    const brakeBuildRate = brakeCmd > this.appliedBrakePressure ? dtSec / 0.16 : dtSec / 0.22;
    const diffP = brakeCmd - this.appliedBrakePressure;
    this.appliedBrakePressure += Math.sign(diffP) * Math.min(Math.abs(diffP), brakeBuildRate);

    const isBrakeApplied = brakeCmd > 0.12;
    if (isBrakeApplied) {
      if (!this.prevBrakeApplied) {
        this.airPressureBar = Math.max(0, this.airPressureBar - 0.1);
      }
      this.airPressureBar = Math.max(0, this.airPressureBar - 0.03 * brakeCmd * dtSec);
      this.peakBrakePressure = Math.max(this.peakBrakePressure, this.appliedBrakePressure);
    } else if (this.prevBrakeApplied && this.peakBrakePressure > 0.25) {
      this.airBrakeReleaseEvent = this.peakBrakePressure;
      this.peakBrakePressure = 0;
    }
    this.prevBrakeApplied = isBrakeApplied;

    if (this.trailerBrakeActive) {
      this.airPressureBar = Math.max(0, this.airPressureBar - 0.04 * dtSec);
    }

    this.lowAirWarning = this.airPressureBar < 5.5;
    if (this.airPressureBar < 4.0) {
      this.emergencyBrakeLock = true;
      this.parkingBrake = true;
    } else if (this.emergencyBrakeLock && this.airPressureBar >= 5.5) {
      this.emergencyBrakeLock = false;
    }

    // Resistive forces in SI (m/s, kg, N)
    const aeroDragN = AERO_DRAG_COEFF * this.speedMs * Math.abs(this.speedMs);
    const rollingCoeff = this.onRoad ? CRR_PAVED : CRR_OFFROAD;
    const rollingDragN = Math.sign(this.speedMs) * totalMassKg * 9.81 * rollingCoeff;
    const slopeGravityN = totalMassKg * 9.81 * Math.sin(this.pitch); // pitch < 0 when climbing uphill

    // Load-scaled EBS braking forces (0.50G loaded .. 0.62G bobtail)
    const airBrakeScale = THREE.MathUtils.clamp((this.airPressureBar - 1.5) / 4.5, 0.2, 1.0);
    const fadeScale = 1 - this.brakeFadePct / 100;
    const baseBrakeG = THREE.MathUtils.lerp(
      0.62,
      0.50,
      THREE.MathUtils.clamp((totalMassKg - 8000) / 32000, 0, 1)
    );
    const maxServiceBrakeN = totalMassKg * 9.81 * baseBrakeG * wetGrip * airBrakeScale * fadeScale;
    const maxParkingBrakeN = Math.max(48000, totalMassKg * 9.81 * 0.44);

    const brakeBlendRetarder =
      !opts.skipMapCollisions &&
      absSpeedKmh > 30 &&
      brakeCmd > 0.08 &&
      effectiveThrottle < 0.05 &&
      this.gear >= 1
        ? brakeCmd > 0.45
          ? 2
          : 1
        : 0;
    const effectiveRetarderLevel = Math.max(
      this.retarderLevel,
      this.ccAutoRetarderLevel,
      brakeBlendRetarder
    );
    const effectiveExhaustBrake = this.exhaustBrakeActive || this.ccAutoExhaustBrake;
    const retarderForceN =
      effectiveRetarderLevel > 0 && Math.abs(this.speedMs) > 2 && effectiveThrottle < 0.05
        ? Math.sign(this.speedMs) * effectiveRetarderLevel * 14500
        : 0;
    const exhaustBrakeForceN =
      effectiveExhaustBrake &&
      this.engineRunning &&
      this.gear >= 1 &&
      effectiveThrottle < 0.05 &&
      this.rpm > 1050 &&
      Math.abs(this.speedMs) > 1.5
        ? Math.sign(this.speedMs) * 24000 * THREE.MathUtils.clamp((this.rpm - 1050) / 600, 0.35, 1.0)
        : 0;
    const trailerBrakeForceN =
      this.trailerAttached && this.trailerBrakeActive && Math.abs(this.speedMs) > 0.08
        ? Math.sign(this.speedMs) * 38000
        : 0;
    const engineBrakingForceN =
      this.engineRunning &&
      this.gear !== 0 &&
      clutchEngage > 0.3 &&
      effectiveThrottle < 0.04 &&
      this.shiftTimerSec <= 0 &&
      Math.abs(this.speedMs) > 0.8
        ? Math.sign(this.speedMs) *
          THREE.MathUtils.clamp(
            (1400 + Math.abs(this.rpm) * 3.8) * Math.min(2.6, Math.max(0.6, absRatio * 0.25)),
            1500,
            14500
          )
        : 0;

    const serviceBrakeForceN = this.appliedBrakePressure * maxServiceBrakeN;
    // Brake thermal heating & cooling
    const heatPower =
      serviceBrakeForceN * Math.abs(this.speedMs) * 0.0000038 * Math.max(0.65, 28000 / totalMassKg);
    const coolRate = (0.012 + absSpeedKmh * 0.0006) * (this.brakeTempC - 60);
    this.brakeTempC = THREE.MathUtils.clamp(this.brakeTempC + (heatPower - coolRate) * dtSec, 60, 480);
    this.brakeFadePct =
      this.brakeTempC > 280
        ? Math.round(THREE.MathUtils.clamp(((this.brakeTempC - 280) / 180) * 40, 0, 40))
        : 0;

    // Hill-Start Assist (Career mode only; disabled during A2 Exam so slope rollback exams remain authentic)
    let hillHoldActive = false;
    if (
      !opts.skipMapCollisions &&
      !this.parkingBrake &&
      Math.abs(this.speedMs) < 0.18 &&
      Math.abs(this.pitch) > 0.012
    ) {
      if (brakeCmd > 0.1) {
        this.hillHoldTimerSec = 1.8;
      } else if (this.hillHoldTimerSec > 0) {
        const drivingOutOfSlope =
          effectiveThrottle > 0.22 ||
          (driveForceN !== 0 && Math.sign(driveForceN) * (driveForceN + slopeGravityN) > 1500);
        if (drivingOutOfSlope) {
          this.hillHoldTimerSec = 0;
        } else {
          this.hillHoldTimerSec = Math.max(0, this.hillHoldTimerSec - dtSec);
          hillHoldActive = true;
        }
      }
    } else {
      this.hillHoldTimerSec = 0;
    }

    let netForceN =
      driveForceN -
      aeroDragN -
      rollingDragN +
      slopeGravityN -
      retarderForceN -
      exhaustBrakeForceN -
      trailerBrakeForceN -
      engineBrakingForceN;
    const totalBrakeN = (this.parkingBrake ? maxParkingBrakeN : 0) + serviceBrakeForceN;

    if (hillHoldActive) {
      this.speedMs = 0;
      netForceN = 0;
    } else if (Math.abs(this.speedMs) > 0.08) {
      netForceN -= Math.sign(this.speedMs) * totalBrakeN;
    } else if (totalBrakeN > 0 && Math.abs(driveForceN + slopeGravityN) <= totalBrakeN) {
      // Hold truck stationary when brakes are holding against slope/throttle
      this.speedMs = 0;
      netForceN = 0;
    }

    const prevSpeedMs = this.speedMs;
    const accelMs2 = netForceN / totalMassKg;
    this.filteredAccelMs2 += (accelMs2 - this.filteredAccelMs2) * Math.min(1, dtSec * 4);
    const nextSpeed = this.speedMs + accelMs2 * dtSec;

    // Prevent brake overshoot reversal
    if (
      (this.speedMs > 0 && nextSpeed < 0 && driveForceN >= 0 && totalBrakeN > 0) ||
      (this.speedMs < 0 && nextSpeed > 0 && driveForceN <= 0 && totalBrakeN > 0)
    ) {
      this.speedMs = 0;
    } else {
      const maxReverseMs = -32 / 3.6;
      const maxCoastMs = maxForwardSpeedMs + 2 / 3.6;
      this.speedMs = THREE.MathUtils.clamp(nextSpeed, maxReverseMs, maxCoastMs);
    }

    const actualLongAccel = (this.speedMs - prevSpeedMs) / Math.max(0.001, dtSec);
    this.cabLongAccel += (actualLongAccel - this.cabLongAccel) * Math.min(1, dtSec * 16);

    // Tractor Ackermann yaw integration with high-speed lateral compliance & gentle ESC
    const safeDt = Math.min(dtSec, 0.033);
    const understeerFactor =
      1 -
      THREE.MathUtils.clamp((absSpeedKmh - 45) / 80, 0, 1) * (0.14 + (1 - wetGrip) * 0.45);
    const targetYawRate =
      (this.speedMs / TRACTOR_WHEELBASE) * Math.tan(this.steerAngleRad * understeerFactor);
    const yawTau = THREE.MathUtils.lerp(
      0.015,
      0.14,
      THREE.MathUtils.clamp((absSpeedKmh - 20) / 70, 0, 1)
    );
    this.effectiveYawRate += (targetYawRate - this.effectiveYawRate) * Math.min(1, safeDt / yawTau);

    const escLatLimit = 3.55 * wetGrip;
    const rawLatAccelCheck = Math.abs(this.speedMs * this.effectiveYawRate);
    if (absSpeedKmh > 35 && rawLatAccelCheck > escLatLimit) {
      this.escActive = true;
      this.effectiveYawRate =
        Math.sign(this.effectiveYawRate) * (escLatLimit / Math.max(1, Math.abs(this.speedMs)));
      this.speedMs *= Math.max(0.95, 1 - safeDt * 0.35);
    } else {
      this.escActive = false;
    }

    const yawRate = this.effectiveYawRate;
    this.yaw = wrapAngle(this.yaw + yawRate * dtSec);

    // Dual-rear-axle (z = -1.75m) no-slip pivot kinematics: origin translates with axle lever arm
    const vx = Math.sin(this.yaw) * this.speedMs + Math.cos(this.yaw) * (yawRate * -REAR_AXLE_LOCAL_Z);
    const vz = Math.cos(this.yaw) * this.speedMs - Math.sin(this.yaw) * (yawRate * -REAR_AXLE_LOCAL_Z);
    const dx = vx * dtSec;
    const dz = vz * dtSec;
    this.x += dx;
    this.z += dz;

    const stepDistKm = Math.hypot(dx, dz) / 1000;
    this.odometerKm += stepDistKm;
    if (stepDistKm > 0) opts.onDistanceKm(stepDistKm);

    this.wheelSpinAngle += (this.speedMs * dtSec) / WHEEL_RADIUS;

    // Articulated trailer kinematics using fifth-wheel offset relative to rear drive-axle pivot (+0.10m)
    let trailerYawRate = 0;
    if (this.trailerAttached) {
      const angleDiff = wrapAngle(this.yaw - this.trailerYaw);
      const hitchVelPerp =
        this.speedMs * Math.sin(angleDiff) + yawRate * HITCH_FROM_REAR_AXLE * Math.cos(angleDiff);
      trailerYawRate = hitchVelPerp / TRAILER_WHEELBASE;
      this.trailerYaw = wrapAngle(this.trailerYaw + trailerYawRate * dtSec);

      let clampedDiff = wrapAngle(this.yaw - this.trailerYaw);
      if (this.trailerBrakeActive && this.speedMs > 0.5) {
        // Trailer hand-valve stabilizes trailer sway and dampens jackknife
        clampedDiff *= Math.max(0.85, 1 - dtSec * 1.4);
        this.trailerYaw = wrapAngle(this.yaw - clampedDiff);
      }
      if (Math.abs(clampedDiff) > MAX_HITCH_ANGLE_RAD) {
        const sign = Math.sign(clampedDiff);
        this.trailerYaw = wrapAngle(this.yaw - sign * MAX_HITCH_ANGLE_RAD);
        clampedDiff = sign * MAX_HITCH_ANGLE_RAD;
        if (this.speedMs < 0) {
          this.speedMs *= 0.85;
        }
      }
      this.hitchAngleRad = clampedDiff;
      this.syncAttachedTrailerPosition();
    }

    const isMoving = Math.abs(this.speedMs) >= 0.005 || Math.abs(yawRate) >= 0.0005;

    // Trailer air-suspension outward body roll
    const targetTrailerRoll = this.trailerAttached
      ? THREE.MathUtils.clamp(this.speedMs * trailerYawRate * 0.013, -0.055, 0.055)
      : 0;
    this.trailerRoll += (targetTrailerRoll - this.trailerRoll) * (1 - Math.exp(-5.5 * safeDt));

    // Update trailer ground Y & pitch (skipped when completely stationary)
    if (isMoving) {
      this.queryGround(this.trailerX, this.trailerZ, map, this.surfaceProbe, opts.surfaceOverride);
      this.trailerY += (this.surfaceProbe.groundY - this.trailerY) * Math.min(1, dtSec * 18);
      const trFwdX = Math.sin(this.trailerYaw);
      const trFwdZ = Math.cos(this.trailerYaw);
      this.queryGround(this.trailerX + trFwdX * 4.5, this.trailerZ + trFwdZ * 4.5, map, this.surfaceProbe, opts.surfaceOverride);
      const trFrontY = this.surfaceProbe.groundY;
      this.queryGround(this.trailerX - trFwdX * 4.5, this.trailerZ - trFwdZ * 4.5, map, this.surfaceProbe, opts.surfaceOverride);
      const trBackY = this.surfaceProbe.groundY;
      const trTargetPitch = THREE.MathUtils.clamp(-Math.atan2(trFrontY - trBackY, 9.0), -0.24, 0.24);
      this.trailerPitch += (trTargetPitch - this.trailerPitch) * Math.min(1, dtSec * 10);
    }

    // Collisions with guardrails, motorway central median & static building colliders (skipped inside custom A2 exam arenas or when stationary)
    if (!opts.skipMapCollisions && isMoving) {
      this.resolveCollisions(map);

      // Keep inside world bounds
      const b = map.manifest.worldBounds;
      this.x = THREE.MathUtils.clamp(this.x, b.minX + 35, b.maxX - 35);
      this.z = THREE.MathUtils.clamp(this.z, b.minZ + 35, b.maxZ - 35);
      if (this.trailerAttached) this.syncAttachedTrailerPosition();
    }

    // Highway edge white-line rumble strip detection
    const roadHalfW = this.surfaceMain.roadHalfWidth ?? 0;
    this.onRumbleStrip =
      !opts.skipMapCollisions &&
      this.surfaceMain.onRoad &&
      roadHalfW >= 6 &&
      absSpeedKmh > 30 &&
      this.surfaceMain.roadDist >= roadHalfW - 0.85 &&
      this.surfaceMain.roadDist <= roadHalfW + 0.35;

    // 2nd-order underdamped cab air suspension (~1.5Hz, zeta ~0.42) with shift dip, idle tremor & expansion joints
    const latAccelRaw = this.speedMs * yawRate;
    const latAlpha = 1 - Math.exp(-6.5 * safeDt);
    this.filteredLatAccelMs2 += (latAccelRaw - this.filteredLatAccelMs2) * latAlpha;

    let targetCabPitch = 0;
    let targetCabRoll = 0;
    const cabEnabled = opts.cabMotionEnabled ?? true;
    if (cabEnabled) {
      this.idleVibClockSec += safeDt;
      const longAccel = Math.abs(this.cabLongAccel) < 0.08 ? 0 : this.cabLongAccel;
      const latAccel = Math.abs(this.filteredLatAccelMs2) < 0.12 ? 0 : this.filteredLatAccelMs2;
      const shiftDip = this.shiftTimerSec > 0 && throttleCmd > 0.15 ? 0.008 : 0;
      const torqueTwist = absSpeedKmh < 12 && this.engineRunning ? effectiveThrottle * 0.012 : 0;
      const idleTremor =
        this.engineRunning && absSpeedKmh < 12
          ? Math.sin(this.idleVibClockSec * 29) * 0.00055
          : 0;
      if (
        Math.abs(this.speedMs) > 0.04 ||
        Math.abs(longAccel) > 0.05 ||
        shiftDip > 0 ||
        torqueTwist > 0 ||
        idleTremor !== 0
      ) {
        targetCabPitch = THREE.MathUtils.clamp(-longAccel * 0.0082 + shiftDip, -0.032, 0.049);
        // Positive latAccel (left turn) -> positive rotation.z -> cab rolls outward to the RIGHT
        targetCabRoll = THREE.MathUtils.clamp(latAccel * 0.0112 + torqueTwist + idleTremor, -0.056, 0.056);
      }

      if (this.onRoad && absSpeedKmh > 25 && !opts.skipMapCollisions) {
        this.roadJointAccumM += Math.abs(this.speedMs) * dtSec;
        if (this.roadJointAccumM >= 48) {
          this.roadJointAccumM -= 48;
          const speedFactor = THREE.MathUtils.clamp(absSpeedKmh / 90, 0.25, 1.0);
          this.cabPitchVel += 0.035 * speedFactor;
          this.cabRollVel += (Math.random() - 0.5) * 0.025 * speedFactor;
          this.roadJointEvent = speedFactor;
        }
      }
    }

    const omegaPitch = 9.42;
    const omegaRoll = 8.95;
    const zetaPitch = cabEnabled ? 0.42 : 1.0;
    const zetaRoll = cabEnabled ? 0.44 : 1.0;

    const accelPitch =
      omegaPitch * omegaPitch * (targetCabPitch - this.cabPitch) -
      2 * zetaPitch * omegaPitch * this.cabPitchVel;
    this.cabPitchVel += accelPitch * safeDt;
    this.cabPitch = THREE.MathUtils.clamp(this.cabPitch + this.cabPitchVel * safeDt, -0.044, 0.056);

    const accelRoll =
      omegaRoll * omegaRoll * (targetCabRoll - this.cabRoll) -
      2 * zetaRoll * omegaRoll * this.cabRollVel;
    this.cabRollVel += accelRoll * safeDt;
    this.cabRoll = THREE.MathUtils.clamp(this.cabRoll + this.cabRollVel * safeDt, -0.064, 0.064);

    if (!cabEnabled && Math.abs(this.cabPitch) < 0.0001 && Math.abs(this.cabPitchVel) < 0.0005) {
      this.cabPitch = 0;
      this.cabPitchVel = 0;
    }
    if (!cabEnabled && Math.abs(this.cabRoll) < 0.0001 && Math.abs(this.cabRollVel) < 0.0005) {
      this.cabRoll = 0;
      this.cabRollVel = 0;
    }
  }

  private syncAttachedTrailerPosition(): void {
    const hitchX = this.x + Math.sin(this.yaw) * HITCH_LOCAL_Z;
    const hitchZ = this.z + Math.cos(this.yaw) * HITCH_LOCAL_Z;
    this.trailerX = hitchX - Math.sin(this.trailerYaw) * KINGPIN_LOCAL_Z;
    this.trailerZ = hitchZ - Math.cos(this.trailerYaw) * KINGPIN_LOCAL_Z;
  }

  private resolveCollisions(map: BuiltMap): void {
    // Guardrail & 4-lane motorway central median barrier deflection
    this.surfaceMain.medianBarrierHit = false;
    this.surfaceMain.medianPushX = 0;
    this.surfaceMain.medianPushZ = 0;
    this.surfaceMain.medianPenetration = 0;
    map.querySurface(this.x, this.z, this.surfaceMain);
    if (this.surfaceMain.guardrailHit && this.surfaceMain.nearestSegmentId) {
      const seg = map.segmentMap.get(this.surfaceMain.nearestSegmentId);
      const maxLateral = seg ? seg.def.width * 0.5 + 0.35 : this.surfaceMain.roadDist;
      const overshoot = Math.max(0.18, this.surfaceMain.roadDist - maxLateral);
      const impactKmh = Math.abs(this.speedMs) * 3.6;
      this.x += this.surfaceMain.guardrailPushX * overshoot;
      this.z += this.surfaceMain.guardrailPushZ * overshoot;
      this.speedMs *= 0.94;
      if (impactKmh > 18 && this.collisionCooldownSec <= 0) {
        this.lastCollision = { impactSpeedKmh: impactKmh, label: '公路防撞护栏' };
        this.collisionCooldownSec = 1.4;
      }
    } else if (this.surfaceMain.medianBarrierHit) {
      const pen = Math.max(0.2, this.surfaceMain.medianPenetration ?? 0.35);
      const impactKmh = Math.abs(this.speedMs) * 3.6;
      this.x += (this.surfaceMain.medianPushX ?? 0) * pen;
      this.z += (this.surfaceMain.medianPushZ ?? 0) * pen;
      this.speedMs *= 0.90;
      if (impactKmh > 18 && this.collisionCooldownSec <= 0) {
        this.lastCollision = { impactSpeedKmh: impactKmh, label: '高速中央防撞护栏' };
        this.collisionCooldownSec = 1.4;
      }
    }

    // Static building/pillar AABB collision check (tractor bounding radius = 2.0m + trailer rear axle)
    const r = 2.0;
    const trRearX = this.trailerX - Math.sin(this.trailerYaw) * 4.8;
    const trRearZ = this.trailerZ - Math.cos(this.trailerYaw) * 4.8;
    for (let i = 0; i < map.colliders.length; i++) {
      const c = map.colliders[i]!;
      if (Math.abs(this.y - c.y) > 8) continue;
      const closestX = THREE.MathUtils.clamp(this.x, c.minX, c.maxX);
      const closestZ = THREE.MathUtils.clamp(this.z, c.minZ, c.maxZ);
      const dx = this.x - closestX;
      const dz = this.z - closestZ;
      const distSq = dx * dx + dz * dz;
      if (distSq < r * r) {
        const dist = Math.sqrt(distSq) || 0.001;
        const pen = r - dist;
        this.x += (dx / dist) * pen;
        this.z += (dz / dist) * pen;
        const impactKmh = Math.abs(this.speedMs) * 3.6;
        this.speedMs *= -0.15;
        if (impactKmh > 8 && this.collisionCooldownSec <= 0) {
          this.lastCollision = { impactSpeedKmh: impactKmh, label: c.label };
          this.collisionCooldownSec = 1.0;
        }
      }

      if (this.trailerAttached) {
        const tClosestX = THREE.MathUtils.clamp(trRearX, c.minX, c.maxX);
        const tClosestZ = THREE.MathUtils.clamp(trRearZ, c.minZ, c.maxZ);
        const tdx = trRearX - tClosestX;
        const tdz = trRearZ - tClosestZ;
        const tDistSq = tdx * tdx + tdz * tdz;
        if (tDistSq < 1.6 * 1.6) {
          const dist = Math.sqrt(tDistSq) || 0.001;
          const pen = 1.6 - dist;
          this.x += (tdx / dist) * pen * 0.5;
          this.z += (tdz / dist) * pen * 0.5;
          const impactKmh = Math.abs(this.speedMs) * 3.6;
          this.speedMs *= -0.12;
          if (impactKmh > 6 && this.collisionCooldownSec <= 0) {
            this.lastCollision = { impactSpeedKmh: impactKmh, label: `${c.label} (挂车刮擦)` };
            this.collisionCooldownSec = 1.0;
          }
        }
      }
    }
  }

  public syncVisuals(
    visuals: TruckVisualRefs,
    input: InputManager,
    nightFactor: number,
    rainIntensity = 0,
    alpha = 1
  ): void {
    const t = THREE.MathUtils.clamp(alpha, 0, 1);
    const ix = THREE.MathUtils.lerp(this.prevX, this.x, t);
    const iy = THREE.MathUtils.lerp(this.prevY, this.y, t);
    const iz = THREE.MathUtils.lerp(this.prevZ, this.z, t);
    const ipitch = THREE.MathUtils.lerp(this.prevPitch, this.pitch, t);
    const iyaw = this.prevYaw + wrapAngle(this.yaw - this.prevYaw) * t;

    const itx = THREE.MathUtils.lerp(this.prevTrailerX, this.trailerX, t);
    const ity = THREE.MathUtils.lerp(this.prevTrailerY, this.trailerY, t);
    const itz = THREE.MathUtils.lerp(this.prevTrailerZ, this.trailerZ, t);
    const itpitch = THREE.MathUtils.lerp(this.prevTrailerPitch, this.trailerPitch, t);
    const itroll = THREE.MathUtils.lerp(this.prevTrailerRoll, this.trailerRoll, t);
    const ityaw = this.prevTrailerYaw + wrapAngle(this.trailerYaw - this.prevTrailerYaw) * t;

    const icabPitch = THREE.MathUtils.lerp(this.prevCabPitch, this.cabPitch, t);
    const icabRoll = THREE.MathUtils.lerp(this.prevCabRoll, this.cabRoll, t);
    const isteer = THREE.MathUtils.lerp(this.prevSteerAngleRad, this.steerAngleRad, t);
    const iwheelSpin = THREE.MathUtils.lerp(this.prevWheelSpinAngle, this.wheelSpinAngle, t);

    visuals.tractorRoot.position.set(ix, iy, iz);
    visuals.tractorRoot.rotation.set(ipitch, iyaw, 0, 'YXZ');

    visuals.cabSuspensionGroup.rotation.set(icabPitch, 0, icabRoll);
    // Negative z rotation turns steering wheel counter-clockwise on left (+isteer) up to +-450 deg (900 deg lock-to-lock)
    visuals.steeringWheel.rotation.z = -isteer * 10.9;

    for (const pivot of visuals.frontWheelSteerPivots) {
      pivot.rotation.y = isteer;
    }
    for (const wheel of visuals.tractorWheelSpinMeshes) {
      wheel.rotation.x = iwheelSpin;
    }

    visuals.trailerRoot.position.set(itx, ity, itz);
    visuals.trailerRoot.rotation.set(itpitch, ityaw, itroll, 'YXZ');
    visuals.trailerLandingGear.position.y = this.trailerAttached ? 0.85 : 0.48;
    for (const wheel of visuals.trailerWheelSpinMeshes) {
      wheel.rotation.x = iwheelSpin;
    }
    visuals.syncWheelInstances();

    const braking =
      this.parkingBrake ||
      (this.gear >= 0 && input.brake > 0.08) ||
      (this.gear < 0 && input.throttle > 0.08);
    visuals.updateLights({
      headlightMode: this.headlightMode,
      nightFactor,
      rainIntensity,
      braking,
      reversing: this.gear < 0,
      leftBlinkerLit: this.blinkerLit && (this.leftBlinker || this.hazardLights),
      rightBlinkerLit: this.blinkerLit && (this.rightBlinker || this.hazardLights),
    });
  }
}
