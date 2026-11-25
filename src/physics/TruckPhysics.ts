import * as THREE from 'three';
import { BuiltMap, SurfaceQueryResult } from '../map/MapBuilder';
import { ENGINE_TIERS, HeadlightMode, TransmissionMode } from '../store/useGameStore';
import { TruckVisualRefs } from '../graphics/TruckMeshBuilder';
import { InputManager } from '../core/InputManager';

const GEAR_RATIOS = [11.8, 9.2, 7.2, 5.6, 4.35, 3.4, 2.65, 2.05, 1.6, 1.25, 1.0, 0.82] as const;
const REVERSE_RATIO = 9.5;
const FINAL_DRIVE = 3.08;
const WHEEL_RADIUS = 0.52;
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

export interface CollisionEvent {
  impactSpeedKmh: number;
  label: string;
}

/**
 * Articulated tractor + semi-trailer physics model with 12-speed transmission,
 * torque curve, hydraulic retarder, cruise control, slope gravity, and cab suspension.
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
  public gear = 0; // -1 = R, 0 = N, 1..12 = Forward
  public rpm = 650;
  public parkingBrake = true;
  public cruiseControlKmh: number | null = null;
  public retarderLevel = 0; // 0..3
  public headlightMode: HeadlightMode = 1;
  public leftBlinker = false;
  public rightBlinker = false;
  public hazardLights = false;
  public blinkerLit = false;

  // Cab suspension visual dynamics
  public cabPitch = 0;
  public cabRoll = 0;
  private cabPitchVel = 0;
  private cabRollVel = 0;

  // Telemetry & stats
  public odometerKm = 0;
  public speedLimitKmh = 80;
  public onRoad = true;
  public nearestSegmentId: string | null = null;
  public isReversingThrottle = false;
  public wheelSpinAngle = 0;
  public lastCollision: CollisionEvent | null = null;

  private shiftTimerSec = 0;
  private autoReverseHoldSec = 0;
  private blinkerClockSec = 0;
  private leftTurnPeakReached = false;
  private rightTurnPeakReached = false;
  private prevSpeedMs = 0;
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

  public resetToSpawn(spawnPos: readonly [number, number, number], headingRad: number): void {
    this.x = spawnPos[0];
    this.y = spawnPos[1];
    this.z = spawnPos[2];
    this.yaw = headingRad;
    this.pitch = 0;
    this.speedMs = 0;
    this.prevSpeedMs = 0;
    this.steerAngleRad = 0;
    this.gear = 1;
    this.rpm = 650;
    this.parkingBrake = true;
    this.cruiseControlKmh = null;
    this.retarderLevel = 0;
    this.trailerAttached = true;
    this.trailerYaw = headingRad;
    this.trailerPitch = 0;
    this.hitchAngleRad = 0;
    this.cabPitch = 0;
    this.cabRoll = 0;
    this.cabPitchVel = 0;
    this.cabRollVel = 0;
    this.syncAttachedTrailerPosition();
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

  public toggleCruiseControl(): void {
    if (this.cruiseControlKmh !== null) {
      this.cruiseControlKmh = null;
      return;
    }
    const kmh = this.speedMs * 3.6;
    if (kmh >= 25 && !this.parkingBrake && this.gear >= 1) {
      this.cruiseControlKmh = Math.min(100, Math.round(kmh));
    }
  }

  public cycleRetarder(): void {
    this.retarderLevel = (this.retarderLevel + 1) % 4;
  }

  public shiftUp(mode: TransmissionMode): void {
    if (mode === 'auto' && this.gear >= 1) {
      if (this.gear < 12) {
        this.gear += 1;
        this.shiftTimerSec = 0.22;
      }
      return;
    }
    if (this.gear < 12) {
      this.gear += 1;
      this.shiftTimerSec = 0.24;
    }
  }

  public shiftDown(mode: TransmissionMode): void {
    if (mode === 'auto' && this.gear <= 1 && Math.abs(this.speedMs) > 1.5) return;
    if (this.gear > -1) {
      this.gear -= 1;
      this.shiftTimerSec = 0.24;
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

    // Attempt re-hitching
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

  public step(
    dtSec: number,
    input: InputManager,
    map: BuiltMap,
    opts: {
      engineTier: number;
      cargoWeightTons: number;
      fuelLiters: number;
      transmissionMode: TransmissionMode;
      truckHealth: number;
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
    this.blinkerLit = Math.floor(this.blinkerClockSec * 2.3) % 2 === 0 && (this.leftBlinker || this.rightBlinker || this.hazardLights);

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

    // Query road surface under tractor & slope
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
    const targetPitch = -Math.atan2(frontY - backY, 5.5);
    this.pitch += (targetPitch - this.pitch) * Math.min(1, dtSec * 8);
    this.y += (this.surfaceMain.groundY - this.y) * Math.min(1, dtSec * 14);

    // Steering geometry: speed-attenuated max steer angle
    const absSpeedKmh = Math.abs(this.speedMs) * 3.6;
    const maxSteer = THREE.MathUtils.lerp(0.58, 0.21, THREE.MathUtils.clamp(absSpeedKmh / 95, 0, 1));
    this.steerAngleRad = input.steer * maxSteer;

    // Auto transmission & reverse logic
    let throttleCmd = input.throttle;
    let brakeCmd = input.brake;
    this.isReversingThrottle = false;

    if (input.brake > 0.08 || this.parkingBrake) {
      this.cruiseControlKmh = null;
    }

    // Release parking brake smoothly if player presses throttle intentionally? Keep ETS2 realism: notify if parking brake is on, OR keep manual Space.
    if (opts.transmissionMode === 'auto') {
      if (this.gear === 0) this.gear = 1;
      if (this.speedMs > -0.4 && this.speedMs < 0.6 && input.brake > 0.2 && input.throttle < 0.05) {
        this.autoReverseHoldSec += dtSec;
        if (this.autoReverseHoldSec > 0.22) {
          this.gear = -1;
        }
      } else {
        this.autoReverseHoldSec = 0;
      }

      if (this.gear === -1) {
        if (input.throttle > 0.12 && this.speedMs > -1.2) {
          this.gear = 1;
          this.shiftTimerSec = 0.22;
        } else {
          // In reverse, S accelerates backward, W brakes
          throttleCmd = input.brake;
          brakeCmd = input.throttle;
          this.isReversingThrottle = throttleCmd > 0.05;
        }
      }
    } else if (this.gear === -1) {
      this.isReversingThrottle = throttleCmd > 0.05;
    }

    // Cruise control governor
    if (this.cruiseControlKmh !== null && this.gear >= 1 && throttleCmd < 0.05 && brakeCmd < 0.05) {
      const targetMs = this.cruiseControlKmh / 3.6;
      const err = targetMs - this.speedMs;
      if (err > 0) {
        throttleCmd = THREE.MathUtils.clamp(err * 0.45, 0, 0.85);
      } else if (err < -0.9) {
        brakeCmd = THREE.MathUtils.clamp(-err * 0.25, 0, 0.45);
      }
    }

    if (this.shiftTimerSec > 0) {
      this.shiftTimerSec = Math.max(0, this.shiftTimerSec - dtSec);
    }

    // Mass calculation (8.4t tractor + optional 6.8t empty trailer + cargo)
    const tractorMassKg = 8400;
    const trailerMassKg = this.trailerAttached ? 6800 + opts.cargoWeightTons * 1000 : 0;
    const totalMassKg = tractorMassKg + trailerMassKg;

    // Powertrain torque & RPM
    const engineSpec = ENGINE_TIERS[opts.engineTier] ?? ENGINE_TIERS[0]!;
    const hasFuel = opts.fuelLiters > 0.01;
    const gearRatio =
      this.gear === 0
        ? 0
        : this.gear === -1
        ? -REVERSE_RATIO
        : GEAR_RATIOS[Math.max(0, Math.min(11, this.gear - 1))]!;

    const wheelAngularVel = this.speedMs / WHEEL_RADIUS;
    const wheelRpm = Math.abs(wheelAngularVel) * (60 / (Math.PI * 2));
    const coupledRpm = this.gear === 0 ? 650 : wheelRpm * Math.abs(gearRatio) * FINAL_DRIVE;
    const targetRpm =
      this.gear === 0 || this.shiftTimerSec > 0
        ? 650 + throttleCmd * 1350
        : THREE.MathUtils.clamp(Math.max(650, coupledRpm) + throttleCmd * 120, 650, 2350);

    this.rpm += (targetRpm - this.rpm) * Math.min(1, dtSec * 9.5);

    // Auto-shift points
    if (opts.transmissionMode === 'auto' && this.gear >= 1 && this.shiftTimerSec <= 0) {
      if (this.rpm > 1720 && this.gear < 12 && throttleCmd > 0.15) {
        this.gear += 1;
        this.shiftTimerSec = 0.26;
      } else if (this.rpm < 1020 && this.gear > 1) {
        this.gear -= 1;
        this.shiftTimerSec = 0.22;
      }
    }

    // Torque curve multiplier (strong low-mid diesel torque 1000..1600 RPM)
    const rpmNorm = THREE.MathUtils.clamp((this.rpm - 650) / 1550, 0, 1);
    const torqueCurve = 0.72 + Math.sin(rpmNorm * Math.PI * 0.85) * 0.36;
    const healthScale = THREE.MathUtils.clamp(0.65 + (opts.truckHealth / 100) * 0.35, 0.65, 1);

    let driveForceN = 0;
    if (hasFuel && !this.parkingBrake && this.gear !== 0 && this.shiftTimerSec <= 0) {
      const engineTorque = engineSpec.maxTorqueNm * torqueCurve * throttleCmd * healthScale;
      const wheelTorque = engineTorque * gearRatio * FINAL_DRIVE * 0.88;
      driveForceN = wheelTorque / WHEEL_RADIUS;
    }

    // Fuel consumption (realistic ~28-44 L/100km under load)
    if (hasFuel) {
      const burnRateLitersPerSec = (0.0005 + throttleCmd * 0.0085 * (engineSpec.hp / 450)) * (this.trailerAttached ? 1.25 : 0.85);
      opts.onFuelBurned(burnRateLitersPerSec * dtSec);
    }

    // Resistive forces: aerodynamic drag, rolling resistance, off-road mud drag, slope gravity
    const aeroDragN = 0.5 * 1.225 * 7.2 * 0.68 * this.speedMs * Math.abs(this.speedMs);
    const rollingCoeff = this.onRoad ? 0.0075 : 0.032;
    const rollingDragN = Math.sign(this.speedMs) * totalMassKg * 9.81 * rollingCoeff;
    const slopeGravityN = totalMassKg * 9.81 * Math.sin(this.pitch); // pitch < 0 when climbing uphill

    // Braking forces (service brake + parking brake + hydraulic retarder)
    const maxServiceBrakeN = 125000;
    const maxParkingBrakeN = 155000;
    const retarderForceN = this.retarderLevel > 0 && Math.abs(this.speedMs) > 2
      ? Math.sign(this.speedMs) * this.retarderLevel * 13500
      : 0;

    let netForceN = driveForceN - aeroDragN - rollingDragN + slopeGravityN - retarderForceN;
    const totalBrakeN =
      (this.parkingBrake ? maxParkingBrakeN : 0) + brakeCmd * maxServiceBrakeN;

    if (Math.abs(this.speedMs) > 0.08) {
      netForceN -= Math.sign(this.speedMs) * totalBrakeN;
    } else if (Math.abs(driveForceN) < totalBrakeN + Math.abs(slopeGravityN)) {
      // Static friction hold on slopes when stopped
      this.speedMs = 0;
      netForceN = 0;
    }

    const accelMs2 = netForceN / totalMassKg;
    const nextSpeed = this.speedMs + accelMs2 * dtSec;

    // Prevent brake overshoot reversal
    if (
      (this.speedMs > 0 && nextSpeed < 0 && driveForceN >= 0) ||
      (this.speedMs < 0 && nextSpeed > 0 && driveForceN <= 0)
    ) {
      this.speedMs = 0;
    } else {
      // Physical top speed governor (~105 km/h forward, ~24 km/h reverse)
      this.speedMs = THREE.MathUtils.clamp(nextSpeed, -24 / 3.6, 108 / 3.6);
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

      // Jackknife limit
      let clampedDiff = wrapAngle(this.yaw - this.trailerYaw);
      if (Math.abs(clampedDiff) > MAX_HITCH_ANGLE_RAD) {
        const sign = Math.sign(clampedDiff);
        this.trailerYaw = wrapAngle(this.yaw - sign * MAX_HITCH_ANGLE_RAD);
        clampedDiff = sign * MAX_HITCH_ANGLE_RAD;
        // Dampen reversing into jackknife stop
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
    const trTargetPitch = -Math.atan2(trFrontY - trBackY, 9.0);
    this.trailerPitch += (trTargetPitch - this.trailerPitch) * Math.min(1, dtSec * 8);

    // Collisions with guardrails & static building colliders
    this.resolveCollisions(map, dtSec);

    // Keep inside world bounds
    const b = map.manifest.worldBounds;
    this.x = THREE.MathUtils.clamp(this.x, b.minX + 35, b.maxX - 35);
    this.z = THREE.MathUtils.clamp(this.z, b.minZ + 35, b.maxZ - 35);
    if (this.trailerAttached) this.syncAttachedTrailerPosition();

    // Cab suspension spring-damper (pitch on accel/brake, roll on lateral G)
    const longAccel = (this.speedMs - this.prevSpeedMs) / Math.max(0.001, dtSec);
    this.prevSpeedMs = this.speedMs;
    const latAccel = this.speedMs * yawRate;

    const targetCabPitch = THREE.MathUtils.clamp(-longAccel * 0.0065, -0.055, 0.055);
    const targetCabRoll = THREE.MathUtils.clamp(-latAccel * 0.011, -0.075, 0.075);

    const kSpring = 42;
    const kDamp = 7.5;
    this.cabPitchVel += ((targetCabPitch - this.cabPitch) * kSpring - this.cabPitchVel * kDamp) * dtSec;
    this.cabRollVel += ((targetCabRoll - this.cabRoll) * kSpring - this.cabRollVel * kDamp) * dtSec;
    this.cabPitch += this.cabPitchVel * dtSec;
    this.cabRoll += this.cabRollVel * dtSec;
  }

  private syncAttachedTrailerPosition(): void {
    const hitchX = this.x + Math.sin(this.yaw) * HITCH_LOCAL_Z;
    const hitchZ = this.z + Math.cos(this.yaw) * HITCH_LOCAL_Z;
    this.trailerX = hitchX - Math.sin(this.trailerYaw) * KINGPIN_LOCAL_Z;
    this.trailerZ = hitchZ - Math.cos(this.trailerYaw) * KINGPIN_LOCAL_Z;
  }

  private resolveCollisions(map: BuiltMap, dtSec: number): void {
    // Guardrail soft pushback
    map.querySurface(this.x, this.z, this.surfaceMain);
    if (this.surfaceMain.guardrailHit) {
      const impactKmh = Math.abs(this.speedMs) * 3.6;
      this.x += this.surfaceMain.guardrailPushX * Math.max(0.12, Math.abs(this.speedMs) * dtSec * 1.15);
      this.z += this.surfaceMain.guardrailPushZ * Math.max(0.12, Math.abs(this.speedMs) * dtSec * 1.15);
      this.speedMs *= 0.88;
      if (impactKmh > 16 && this.collisionCooldownSec <= 0) {
        this.lastCollision = { impactSpeedKmh: impactKmh, label: '护栏刮擦' };
        this.collisionCooldownSec = 1.2;
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

  public syncVisuals(visuals: TruckVisualRefs, input: InputManager, nightFactor: number): void {
    visuals.tractorRoot.position.set(this.x, this.y, this.z);
    visuals.tractorRoot.rotation.set(this.pitch, this.yaw, 0, 'YXZ');

    visuals.cabSuspensionGroup.rotation.set(this.cabPitch, 0, this.cabRoll);
    visuals.steeringWheel.rotation.z = this.steerAngleRad * 3.2;

    for (const pivot of visuals.frontWheelSteerPivots) {
      pivot.rotation.y = this.steerAngleRad;
    }
    for (const wheel of visuals.tractorWheelSpinMeshes) {
      wheel.rotation.x = this.wheelSpinAngle;
    }

    visuals.trailerRoot.position.set(this.trailerX, this.trailerY, this.trailerZ);
    visuals.trailerRoot.rotation.set(this.trailerPitch, this.trailerYaw, 0, 'YXZ');
    visuals.trailerLandingGear.position.y = this.trailerAttached ? 0.85 : 0.48;
    for (const wheel of visuals.trailerWheelSpinMeshes) {
      wheel.rotation.x = this.wheelSpinAngle;
    }

    const braking = this.parkingBrake || (this.gear !== -1 && input.brake > 0.08) || (this.gear === -1 && input.throttle > 0.08);
    visuals.updateLights({
      headlightMode: this.headlightMode,
      nightFactor,
      braking,
      reversing: this.gear === -1,
      leftBlinkerLit: this.blinkerLit && (this.leftBlinker || this.hazardLights),
      rightBlinkerLit: this.blinkerLit && (this.rightBlinker || this.hazardLights),
    });
  }
}
