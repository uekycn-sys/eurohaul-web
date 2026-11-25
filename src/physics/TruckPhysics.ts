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

const TRACTOR_WHEELBASE = 4.2;
const HITCH_LOCAL_Z = -1.65;
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

/**
 * Articulated tractor + semi-trailer physics model with 12-speed + 2-reverse transmission,
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
  public hitchAngleRad = 0;

  // Powertrain & controls
  public gear = 1; // -2=R2, -1=R1, 0=N, 1..12=Forward
  public rpm = IDLE_RPM;
  public parkingBrake = true;
  public cruiseControlKmh: number | null = null;
  public retarderLevel = 0; // 0..3
  public headlightMode: HeadlightMode = 1;
  public leftBlinker = false;
  public rightBlinker = false;
  public hazardLights = false;
  public blinkerLit = false;

  // Cab suspension visual dynamics (strictly low-pass filtered & clamped)
  public cabPitch = 0;
  public cabRoll = 0;
  private filteredLatAccelMs2 = 0;

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
  private prevCabPitch = 0;
  private prevCabRoll = 0;
  private prevWheelSpinAngle = 0;
  private prevSteerAngleRad = 0;

  // Telemetry & stats
  public odometerKm = 0;
  public speedLimitKmh = 80;
  public onRoad = true;
  public nearestSegmentId: string | null = null;
  public isReversingThrottle = false;
  public wheelSpinAngle = 0;
  public lastCollision: CollisionEvent | null = null;

  private shiftTimerSec = 0;
  private shiftCooldownSec = 0;
  private autoReverseHoldSec = 0;
  private blinkerClockSec = 0;
  private leftTurnPeakReached = false;
  private rightTurnPeakReached = false;
  public filteredAccelMs2 = 0;
  private collisionCooldownSec = 0;

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
    this.steerAngleRad = 0;
    this.gear = 1;
    this.rpm = IDLE_RPM;
    this.shiftTimerSec = 0;
    this.shiftCooldownSec = 0;
    this.parkingBrake = true;
    this.cruiseControlKmh = null;
    this.retarderLevel = 0;
    this.trailerAttached = true;
    this.trailerYaw = headingRad;
    this.trailerPitch = 0;
    this.hitchAngleRad = 0;
    this.cabPitch = 0;
    this.cabRoll = 0;
    this.syncAttachedTrailerPosition();
    this.savePreviousPose();
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
    this.parkingBrake = !this.parkingBrake;
    if (this.parkingBrake) {
      this.cruiseControlKmh = null;
    }
  }

  public toggleCruiseControl(speedLimiterEnabled = true): void {
    if (this.cruiseControlKmh !== null) {
      this.cruiseControlKmh = null;
      return;
    }
    const kmh = this.speedMs * 3.6;
    const maxCruise = speedLimiterEnabled ? 90 : 110;
    if (kmh >= 25 && !this.parkingBrake && this.gear >= 1) {
      this.cruiseControlKmh = Math.min(maxCruise, Math.round(kmh));
    }
  }

  public cycleRetarder(): void {
    this.retarderLevel = (this.retarderLevel + 1) % 4;
  }

  public shiftUp(mode: TransmissionMode): void {
    if (mode === 'auto' && this.gear >= 1) {
      if (this.gear < 12) {
        this.gear += 1;
        this.shiftTimerSec = 0.2;
        this.shiftCooldownSec = 0.65;
      }
      return;
    }
    if (this.gear < 12) {
      this.gear += 1;
      this.shiftTimerSec = 0.2;
      this.shiftCooldownSec = 0.4;
    }
  }

  public shiftDown(mode: TransmissionMode): void {
    if (mode === 'auto' && this.gear <= 1 && Math.abs(this.speedMs) > 1.5) return;
    if (this.gear > -2) {
      this.gear -= 1;
      this.shiftTimerSec = 0.2;
      this.shiftCooldownSec = 0.4;
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
      onFuelBurned: (liters: number) => void;
      onDistanceKm: (km: number) => void;
    }
  ): void {
    this.lastCollision = null;
    if (this.collisionCooldownSec > 0) {
      this.collisionCooldownSec = Math.max(0, this.collisionCooldownSec - dtSec);
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
    map.querySurface(this.x, this.z, this.surfaceMain);
    this.speedLimitKmh = this.surfaceMain.speedLimitKmh;
    this.onRoad = this.surfaceMain.onRoad;
    this.nearestSegmentId = this.surfaceMain.nearestSegmentId;

    const fwdX = Math.sin(this.yaw);
    const fwdZ = Math.cos(this.yaw);
    map.querySurface(this.x + fwdX * 3.0, this.z + fwdZ * 3.0, this.surfaceProbe);
    const frontY = this.surfaceProbe.groundY;
    map.querySurface(this.x - fwdX * 2.5, this.z - fwdZ * 2.5, this.surfaceProbe);
    const backY = this.surfaceProbe.groundY;
    const targetPitch = THREE.MathUtils.clamp(-Math.atan2(frontY - backY, 5.5), -0.22, 0.22);
    this.pitch += (targetPitch - this.pitch) * Math.min(1, dtSec * 8);
    this.y += (this.surfaceMain.groundY - this.y) * Math.min(1, dtSec * 14);

    // Steering geometry: speed-attenuated max steer angle
    const absSpeedKmh = Math.abs(this.speedMs) * 3.6;
    const maxSteer = THREE.MathUtils.lerp(0.58, 0.2, THREE.MathUtils.clamp(absSpeedKmh / 95, 0, 1));
    this.steerAngleRad = input.steer * maxSteer;

    // Auto transmission direction & reverse selector
    let throttleCmd = input.throttle;
    let brakeCmd = input.brake;
    this.isReversingThrottle = false;

    if (input.brake > 0.08 || this.parkingBrake) {
      this.cruiseControlKmh = null;
    }

    if (opts.transmissionMode === 'auto') {
      if (this.gear === 0) this.gear = 1;
      if (this.speedMs > -0.4 && this.speedMs < 0.6 && input.brake > 0.2 && input.throttle < 0.05) {
        this.autoReverseHoldSec += dtSec;
        if (this.autoReverseHoldSec > 0.22) {
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
      this.isReversingThrottle = throttleCmd > 0.05;
    }

    // Cruise control governor (respects speed limiter)
    const maxAllowedKmh = opts.speedLimiterEnabled ? 90 : 110;
    if (this.cruiseControlKmh !== null && this.gear >= 1 && throttleCmd < 0.05 && brakeCmd < 0.05) {
      const targetMs = Math.min(this.cruiseControlKmh, maxAllowedKmh) / 3.6;
      const err = targetMs - this.speedMs;
      if (err > 0) {
        throttleCmd = THREE.MathUtils.clamp(err * 0.5, 0, 0.9);
      } else if (err < -0.9) {
        brakeCmd = THREE.MathUtils.clamp(-err * 0.25, 0, 0.45);
      }
    }

    if (this.shiftTimerSec > 0) {
      this.shiftTimerSec = Math.max(0, this.shiftTimerSec - dtSec);
    }
    if (this.shiftCooldownSec > 0) {
      this.shiftCooldownSec = Math.max(0, this.shiftCooldownSec - dtSec);
    }

    // Mass calculation (8,000 kg tractor + optional 7,000 kg empty trailer + 0..25,000 kg cargo)
    const trailerMassKg = this.trailerAttached ? EMPTY_TRAILER_MASS_KG + opts.cargoWeightTons * 1000 : 0;
    const totalMassKg = TRACTOR_MASS_KG + trailerMassKg;

    // Speed-RPM coupling (SI m/s -> wheelRPM -> engineRPM)
    const gearRatio = this.getGearRatio(this.gear);
    const absRatio = Math.abs(gearRatio);
    const wheelRpm = (Math.abs(this.speedMs) / (2 * Math.PI * WHEEL_RADIUS)) * 60;
    const mechanicalRpm = this.gear === 0 ? IDLE_RPM : wheelRpm * absRatio * FINAL_DRIVE;

    let targetRpm: number;
    if (this.gear === 0) {
      targetRpm = IDLE_RPM + throttleCmd * 1450;
    } else if (this.shiftTimerSec > 0) {
      // Clutch momentarily open during shift: RPM settles smoothly toward target gear speed (no spike!)
      targetRpm = THREE.MathUtils.clamp(Math.max(IDLE_RPM, mechanicalRpm), IDLE_RPM, CUTOFF_RPM);
    } else {
      // Smooth launch clutch slip below ~1050 RPM so standing starts build peak torque smoothly
      const clutchLock = THREE.MathUtils.clamp((mechanicalRpm - 550) / 500, 0, 1);
      const launchSlipRpm = IDLE_RPM + throttleCmd * 580;
      const coupledRpm = THREE.MathUtils.lerp(launchSlipRpm, mechanicalRpm, clutchLock);
      targetRpm = THREE.MathUtils.clamp(coupledRpm, IDLE_RPM, CUTOFF_RPM);
    }

    this.rpm += (targetRpm - this.rpm) * Math.min(1, dtSec * 10);

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

    // Smart AT shifting with cooldown, throttle-mapped upshift, uphill hysteresis & 2-gear kickdown
    if (
      opts.transmissionMode === 'auto' &&
      this.shiftTimerSec <= 0 &&
      this.shiftCooldownSec <= 0 &&
      !this.parkingBrake
    ) {
      if (this.gear >= 1) {
        const isClimbing = this.pitch < -0.015;
        const uphillBias = isClimbing ? Math.min(140, -this.pitch * 2200) : 0;
        const baseUpshiftRpm =
          effectiveThrottle <= 0.45
            ? THREE.MathUtils.lerp(1550, 1650, effectiveThrottle / 0.45)
            : THREE.MathUtils.lerp(1650, 1940, (effectiveThrottle - 0.45) / 0.55);
        const upshiftRpm = Math.min(2000, baseUpshiftRpm + uphillBias);
        const minPostShiftRpm =
          THREE.MathUtils.lerp(1160, 1340, effectiveThrottle) + (isClimbing ? 100 : 0);
        const nearSpeedLimiter = this.speedMs >= maxForwardSpeedMs - 3.5 / 3.6;

        if (this.gear < 12 && throttleCmd > 0.12 && brakeCmd < 0.05) {
          const nextRatio = GEAR_RATIOS[this.gear]!;
          const predictedNextRpm = wheelRpm * nextRatio * FINAL_DRIVE;
          const canCruiseOverdrive =
            this.gear === 11 &&
            this.speedMs >= 78 / 3.6 &&
            effectiveThrottle < 0.45 &&
            !isClimbing &&
            predictedNextRpm >= 1150 &&
            (nearSpeedLimiter || mechanicalRpm >= 1520);
          const normalUpshift =
            mechanicalRpm >= upshiftRpm &&
            predictedNextRpm >= minPostShiftRpm &&
            this.filteredAccelMs2 > 0.02;

          if (normalUpshift || canCruiseOverdrive) {
            this.gear += 1;
            this.shiftTimerSec = 0.18;
            this.shiftCooldownSec = 0.72;
          }
        }

        if (this.shiftCooldownSec <= 0 && this.gear > 1) {
          const downshiftFloor = isClimbing ? 1160 : 1050;
          const lowRpmDownshift = mechanicalRpm < downshiftFloor;
          const kickdownTrigger =
            effectiveThrottle > 0.72 && this.filteredAccelMs2 < 0.25 && mechanicalRpm < 1420;

          if (lowRpmDownshift || kickdownTrigger) {
            const dropTwo =
              this.gear > 4 && effectiveThrottle > 0.8 && mechanicalRpm < 1100;
            this.gear = Math.max(1, this.gear - (dropTwo ? 2 : 1));
            this.shiftTimerSec = 0.18;
            this.shiftCooldownSec = 0.68;
          }
        }
      } else if (this.gear < 0) {
        if (this.gear === -1 && mechanicalRpm > 1750 && throttleCmd > 0.2) {
          this.gear = -2;
          this.shiftTimerSec = 0.18;
          this.shiftCooldownSec = 0.65;
        } else if (this.gear === -2 && mechanicalRpm < 950) {
          this.gear = -1;
          this.shiftTimerSec = 0.18;
          this.shiftCooldownSec = 0.65;
        }
      }
    }

    // Torque curve & drivetrain force (100% SI units)
    const engineSpec = ENGINE_TIERS[opts.engineTier] ?? ENGINE_TIERS[0]!;
    const hasFuel = opts.fuelLiters > 0.01;
    const torqueFactor = evaluateTorqueFactor(this.rpm);
    const healthScale = THREE.MathUtils.clamp(0.75 + (opts.truckHealth / 100) * 0.25, 0.75, 1);

    let driveForceN = 0;
    if (hasFuel && !this.parkingBrake && this.gear !== 0 && this.shiftTimerSec <= 0) {
      const activeRatio = this.getGearRatio(this.gear);
      const engineTorqueNm = engineSpec.maxTorqueNm * torqueFactor * effectiveThrottle * healthScale;
      const wheelTorqueNm = engineTorqueNm * activeRatio * FINAL_DRIVE * DRIVETRAIN_EFFICIENCY;
      driveForceN = wheelTorqueNm / WHEEL_RADIUS;
    }

    // Fuel consumption
    if (hasFuel) {
      const burnRateLitersPerSec =
        (0.0005 + effectiveThrottle * 0.0085 * (engineSpec.hp / 480)) *
        (this.trailerAttached ? 1.25 : 0.85);
      opts.onFuelBurned(burnRateLitersPerSec * dtSec);
    }

    // Resistive forces in SI (m/s, kg, N)
    const aeroDragN = AERO_DRAG_COEFF * this.speedMs * Math.abs(this.speedMs);
    const rollingCoeff = this.onRoad ? CRR_PAVED : CRR_OFFROAD;
    const rollingDragN = Math.sign(this.speedMs) * totalMassKg * 9.81 * rollingCoeff;
    const slopeGravityN = totalMassKg * 9.81 * Math.sin(this.pitch); // pitch < 0 when climbing uphill

    // Braking forces (wet asphalt slightly reduces service brake grip)
    const wetGrip = THREE.MathUtils.lerp(1.0, 0.84, opts.rainIntensity ?? 0);
    const maxServiceBrakeN = 135000 * wetGrip;
    const maxParkingBrakeN = 165000;
    const retarderForceN =
      this.retarderLevel > 0 && Math.abs(this.speedMs) > 2 && effectiveThrottle < 0.05
        ? Math.sign(this.speedMs) * this.retarderLevel * 14500
        : 0;

    let netForceN = driveForceN - aeroDragN - rollingDragN + slopeGravityN - retarderForceN;
    const totalBrakeN = (this.parkingBrake ? maxParkingBrakeN : 0) + brakeCmd * maxServiceBrakeN;

    if (Math.abs(this.speedMs) > 0.08) {
      netForceN -= Math.sign(this.speedMs) * totalBrakeN;
    } else if (totalBrakeN > 0 && Math.abs(driveForceN + slopeGravityN) <= totalBrakeN) {
      // Hold truck stationary when brakes are holding against slope/throttle
      this.speedMs = 0;
      netForceN = 0;
    }

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

    // Tractor Ackermann yaw integration
    const yawRate = (this.speedMs / TRACTOR_WHEELBASE) * Math.tan(this.steerAngleRad);
    this.yaw = wrapAngle(this.yaw + yawRate * dtSec);

    const dx = Math.sin(this.yaw) * this.speedMs * dtSec;
    const dz = Math.cos(this.yaw) * this.speedMs * dtSec;
    this.x += dx;
    this.z += dz;

    const stepDistKm = Math.hypot(dx, dz) / 1000;
    this.odometerKm += stepDistKm;
    if (stepDistKm > 0) opts.onDistanceKm(stepDistKm);

    this.wheelSpinAngle += (this.speedMs * dtSec) / WHEEL_RADIUS;

    // Articulated trailer kinematics
    if (this.trailerAttached) {
      const angleDiff = wrapAngle(this.yaw - this.trailerYaw);
      const hitchVelPerp =
        this.speedMs * Math.sin(angleDiff) + yawRate * HITCH_LOCAL_Z * Math.cos(angleDiff);
      const trailerYawRate = hitchVelPerp / TRAILER_WHEELBASE;
      this.trailerYaw = wrapAngle(this.trailerYaw + trailerYawRate * dtSec);

      let clampedDiff = wrapAngle(this.yaw - this.trailerYaw);
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

    // Update trailer ground Y & pitch
    map.querySurface(this.trailerX, this.trailerZ, this.surfaceProbe);
    this.trailerY += (this.surfaceProbe.groundY - this.trailerY) * Math.min(1, dtSec * 14);
    const trFwdX = Math.sin(this.trailerYaw);
    const trFwdZ = Math.cos(this.trailerYaw);
    map.querySurface(this.trailerX + trFwdX * 4.5, this.trailerZ + trFwdZ * 4.5, this.surfaceProbe);
    const trFrontY = this.surfaceProbe.groundY;
    map.querySurface(this.trailerX - trFwdX * 4.5, this.trailerZ - trFwdZ * 4.5, this.surfaceProbe);
    const trBackY = this.surfaceProbe.groundY;
    const trTargetPitch = THREE.MathUtils.clamp(-Math.atan2(trFrontY - trBackY, 9.0), -0.22, 0.22);
    this.trailerPitch += (trTargetPitch - this.trailerPitch) * Math.min(1, dtSec * 8);

    // Collisions with guardrails & static building colliders
    this.resolveCollisions(map);

    // Keep inside world bounds
    const b = map.manifest.worldBounds;
    this.x = THREE.MathUtils.clamp(this.x, b.minX + 35, b.maxX - 35);
    this.z = THREE.MathUtils.clamp(this.z, b.minZ + 35, b.maxZ - 35);
    if (this.trailerAttached) this.syncAttachedTrailerPosition();

    // Cab suspension exponential low-pass filter (strictly clamped ±0.010 pitch, ±0.012 roll; decays to 0 at rest/cruise)
    const safeDt = Math.min(dtSec, 0.033);
    const latAccelRaw = this.speedMs * yawRate;
    const latAlpha = 1 - Math.exp(-5.5 * safeDt);
    this.filteredLatAccelMs2 += (latAccelRaw - this.filteredLatAccelMs2) * latAlpha;

    let targetCabPitch = 0;
    let targetCabRoll = 0;
    if (opts.cabMotionEnabled ?? true) {
      const longAccelFiltered = Math.abs(this.filteredAccelMs2) < 0.08 ? 0 : this.filteredAccelMs2;
      const latAccelFiltered =
        Math.abs(this.filteredLatAccelMs2) < 0.12 ? 0 : this.filteredLatAccelMs2;
      if (Math.abs(this.speedMs) > 0.05 || Math.abs(longAccelFiltered) > 0.05) {
        targetCabPitch = THREE.MathUtils.clamp(-longAccelFiltered * 0.0028, -0.010, 0.010);
        targetCabRoll = THREE.MathUtils.clamp(-latAccelFiltered * 0.0032, -0.012, 0.012);
      }
    }

    const cabAlpha = 1 - Math.exp(-7.0 * safeDt);
    this.cabPitch += (targetCabPitch - this.cabPitch) * cabAlpha;
    this.cabRoll += (targetCabRoll - this.cabRoll) * cabAlpha;
    if (targetCabPitch === 0 && Math.abs(this.cabPitch) < 0.00005) this.cabPitch = 0;
    if (targetCabRoll === 0 && Math.abs(this.cabRoll) < 0.00005) this.cabRoll = 0;
  }

  private syncAttachedTrailerPosition(): void {
    const hitchX = this.x + Math.sin(this.yaw) * HITCH_LOCAL_Z;
    const hitchZ = this.z + Math.cos(this.yaw) * HITCH_LOCAL_Z;
    this.trailerX = hitchX - Math.sin(this.trailerYaw) * KINGPIN_LOCAL_Z;
    this.trailerZ = hitchZ - Math.cos(this.trailerYaw) * KINGPIN_LOCAL_Z;
  }

  private resolveCollisions(map: BuiltMap): void {
    // Guardrail firm lateral barrier deflection (prevents clipping past guardrail posts!)
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
    }

    // Static building/pillar AABB collision check (tractor bounding radius = 2.0m)
    const r = 2.0;
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
    const ityaw = this.prevTrailerYaw + wrapAngle(this.trailerYaw - this.prevTrailerYaw) * t;

    const icabPitch = THREE.MathUtils.lerp(this.prevCabPitch, this.cabPitch, t);
    const icabRoll = THREE.MathUtils.lerp(this.prevCabRoll, this.cabRoll, t);
    const isteer = THREE.MathUtils.lerp(this.prevSteerAngleRad, this.steerAngleRad, t);
    const iwheelSpin = THREE.MathUtils.lerp(this.prevWheelSpinAngle, this.wheelSpinAngle, t);

    visuals.tractorRoot.position.set(ix, iy, iz);
    visuals.tractorRoot.rotation.set(ipitch, iyaw, 0, 'YXZ');

    visuals.cabSuspensionGroup.rotation.set(icabPitch, 0, icabRoll);
    visuals.steeringWheel.rotation.z = isteer * 3.2;

    for (const pivot of visuals.frontWheelSteerPivots) {
      pivot.rotation.y = isteer;
    }
    for (const wheel of visuals.tractorWheelSpinMeshes) {
      wheel.rotation.x = iwheelSpin;
    }

    visuals.trailerRoot.position.set(itx, ity, itz);
    visuals.trailerRoot.rotation.set(itpitch, ityaw, 0, 'YXZ');
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
