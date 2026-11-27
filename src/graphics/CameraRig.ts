import * as THREE from 'three';
import { CameraMode } from '../store/useGameStore';
import { TruckPhysics } from '../physics/TruckPhysics';
import { TruckVisualRefs } from './TruckMeshBuilder';

/**
 * Multi-mode camera rig supporting:
 * 1: Cabin First-Person (inside cab suspension with look-ahead & subtle road head-bob)
 * 2: Third-Person Chase (speed-reactive FOV & damped follow)
 * 3: Reverse Side-Mirror Angle (driver-side elevated look-back at trailer & bay)
 * 4: Cinematic Orbit (auto-orbit + pointer drag support)
 * 5: Overhead Precision Top-Down (ideal for A2 exam lines & trailer off-tracking)
 */
export class CameraRig {
  private readonly camera: THREE.PerspectiveCamera;
  private readonly domElement: HTMLElement;
  private readonly currentPos = new THREE.Vector3();
  private readonly currentLook = new THREE.Vector3();
  private readonly desiredPos = new THREE.Vector3();
  private readonly desiredLook = new THREE.Vector3();
  private readonly tempVec = new THREE.Vector3();

  private orbitYaw = 0.65;
  private orbitPitch = 0.28;
  private chaseYawOffset = 0;
  private chasePitchOffset = 0;
  private overheadHeight = 24;
  private cabLookYaw = 0;
  private cabLookPitch = 0;
  private quickLookYaw = 0;
  private lastMode: CameraMode = 1;
  private isMenuMode = false;
  private isDragging = false;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private initialized = false;

  // Air-suspension driver seat exponential low-pass filter state (heave ±0.015m max)
  private seatHeaveY = 0;
  private smoothLookSteer = 0;
  private rumbleClockSec = 0;

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement) {
    this.camera = camera;
    this.domElement = domElement;
    domElement.addEventListener('pointerdown', this.onPointerDown);
    domElement.addEventListener('dblclick', this.onDoubleClick);
    domElement.addEventListener('wheel', this.onWheel, { passive: true });
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
  }

  private readonly onWheel = (e: WheelEvent): void => {
    this.overheadHeight = THREE.MathUtils.clamp(this.overheadHeight + e.deltaY * 0.015, 14, 38);
  };

  public resetCabLook(): void {
    this.cabLookYaw = 0;
    this.cabLookPitch = 0;
    this.chaseYawOffset = 0;
    this.chasePitchOffset = 0;
  }

  private readonly onDoubleClick = (): void => {
    this.resetCabLook();
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.isDragging = true;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (!this.isDragging) return;
    const dx = e.clientX - this.lastPointerX;
    const dy = e.clientY - this.lastPointerY;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
    if (this.isMenuMode || this.lastMode === 4) {
      this.orbitYaw -= dx * 0.006;
      this.orbitPitch = THREE.MathUtils.clamp(this.orbitPitch + dy * 0.004, 0.08, 1.05);
    } else if (this.lastMode === 2) {
      this.chaseYawOffset = THREE.MathUtils.clamp(this.chaseYawOffset - dx * 0.006, -2.4, 2.4);
      this.chasePitchOffset = THREE.MathUtils.clamp(this.chasePitchOffset + dy * 0.004, -0.18, 0.62);
    } else if (this.lastMode === 1) {
      // First-person cab head look (clamp comfortably to left/right side windows)
      this.cabLookYaw = THREE.MathUtils.clamp(this.cabLookYaw - dx * 0.005, -1.25, 1.25);
      this.cabLookPitch = THREE.MathUtils.clamp(this.cabLookPitch - dy * 0.0035, -0.35, 0.32);
    }
  };

  private readonly onPointerUp = (): void => {
    this.isDragging = false;
  };

  public update(
    dtSec: number,
    mode: CameraMode,
    physics: TruckPhysics,
    visuals: TruckVisualRefs,
    isMenu: boolean,
    cabMotionEnabled = true,
    quickLookDir: -1 | 0 | 1 = 0,
    cabOptions?: {
      fovDeg?: number;
      seatOffsetZ?: number;
      seatOffsetY?: number;
      steeringCameraEnabled?: boolean;
    }
  ): void {
    this.lastMode = mode;
    this.isMenuMode = isMenu;
    const absKmh = Math.abs(physics.speedMs) * 3.6;

    if (isMenu || mode === 4) {
      if (!this.isDragging) {
        this.orbitYaw += dtSec * (isMenu ? 0.14 : 0.22);
      }
      const radius = isMenu ? 15.5 : 19.5;
      const cx = physics.trailerAttached ? (physics.x + physics.trailerX) * 0.5 : physics.x;
      const cz = physics.trailerAttached ? (physics.z + physics.trailerZ) * 0.5 : physics.z;
      this.desiredPos.set(
        cx + Math.cos(this.orbitYaw) * Math.cos(this.orbitPitch) * radius,
        physics.y + 2.2 + Math.sin(this.orbitPitch) * radius,
        cz + Math.sin(this.orbitYaw) * Math.cos(this.orbitPitch) * radius
      );
      this.desiredLook.set(cx, physics.y + 2.0, cz);
      this.camera.fov += (54 - this.camera.fov) * Math.min(1, dtSec * 6);
      this.camera.updateProjectionMatrix();

      if (!this.initialized) {
        this.currentPos.copy(this.desiredPos);
        this.currentLook.copy(this.desiredLook);
        this.initialized = true;
      } else {
        const s = Math.min(1, dtSec * 6);
        this.currentPos.lerp(this.desiredPos, s);
        this.currentLook.lerp(this.desiredLook, s);
      }
      this.camera.position.copy(this.currentPos);
      this.camera.lookAt(this.currentLook);
      return;
    }

    if (mode === 1) {
      // First-person LHD driver eye rigidly transformed in cabSuspensionGroup local space
      // after tractorRoot world matrix update (eliminates rAF vs fixed-step phase judder).
      const safeDt = Math.min(0.033, Math.max(0.001, dtSec));

      let heaveY = 0;
      const rumbleActive = (physics as { onRumbleStrip?: boolean }).onRumbleStrip ?? false;
      if (cabMotionEnabled) {
        this.rumbleClockSec += safeDt * (1 + Math.min(2.0, absKmh / 45));
        const accelSignal = Math.abs(physics.filteredAccelMs2) < 0.08 ? 0 : physics.filteredAccelMs2;
        const offroadRumble =
          !physics.onRoad && absKmh > 3
            ? Math.sin(this.rumbleClockSec * 22) * 0.008 * Math.min(1, absKmh / 30)
            : 0;
        const stripRumble =
          rumbleActive && absKmh > 25
            ? Math.sin(this.rumbleClockSec * 72) * 0.0045
            : 0;
        const targetHeave = THREE.MathUtils.clamp(accelSignal * 0.0032 + offroadRumble + stripRumble, -0.015, 0.015);
        const lpAlpha = 1 - Math.exp(-8.5 * safeDt);
        this.seatHeaveY += (targetHeave - this.seatHeaveY) * lpAlpha;
        if (targetHeave === 0 && Math.abs(this.seatHeaveY) < 0.00015) {
          this.seatHeaveY = 0;
        }
        heaveY = THREE.MathUtils.clamp(this.seatHeaveY, -0.015, 0.015);
      } else {
        this.seatHeaveY = 0;
      }

      const steeringCamOn = cabOptions?.steeringCameraEnabled ?? true;
      const steerAlpha = 1 - Math.exp(-6.5 * safeDt);
      const speedLookScale = THREE.MathUtils.clamp((absKmh - 6) / 30, 0, 1);
      const blinkerLookRad =
        (physics.leftBlinker ? 0.07 : physics.rightBlinker ? -0.07 : 0) * (absKmh > 4 ? 1 : 0.4);
      // Up to +-14 deg (+-0.244 rad) head yaw into corner apex
      const targetSteerYaw = steeringCamOn
        ? THREE.MathUtils.clamp(physics.steerAngleRad * 0.44 * speedLookScale + blinkerLookRad, -0.244, 0.244)
        : 0;
      this.smoothLookSteer += (targetSteerYaw - this.smoothLookSteer) * steerAlpha;
      this.quickLookYaw += (quickLookDir * 0.68 - this.quickLookYaw) * (1 - Math.exp(-12 * safeDt));

      const seatOffsetY = cabOptions?.seatOffsetY ?? 0;
      const seatOffsetZ = cabOptions?.seatOffsetZ ?? 0;
      const eyeY = 2.64 + seatOffsetY + heaveY;
      const eyeZ = Math.max(1.48, 1.58 + seatOffsetZ);

      visuals.tractorRoot.updateMatrixWorld(true);
      this.tempVec.set(0.58, eyeY, eyeZ);
      visuals.cabSuspensionGroup.localToWorld(this.tempVec);
      this.desiredPos.copy(this.tempVec);

      const totalHeadYaw = THREE.MathUtils.clamp(
        this.cabLookYaw + this.quickLookYaw + this.smoothLookSteer,
        -1.35,
        1.35
      );
      const headYawSin = Math.sin(totalHeadYaw);
      const headYawCos = Math.cos(totalHeadYaw);
      // Default ~ -4 deg downward gaze (dy = -1.40 at 20m forward) so road + full cluster + wheel are unobstructed
      this.tempVec.set(
        0.58 + headYawSin * 20,
        eyeY - 1.40 + heaveY * 0.35 + this.cabLookPitch * 14,
        eyeZ + headYawCos * 20
      );
      visuals.cabSuspensionGroup.localToWorld(this.tempVec);
      this.desiredLook.copy(this.tempVec);

      this.currentPos.copy(this.desiredPos);
      this.currentLook.copy(this.desiredLook);
      this.initialized = true;
      const targetCabFov = cabOptions?.fovDeg ?? 68;
      const fovAlpha = 1 - Math.exp(-8 * safeDt);
      this.camera.fov += (targetCabFov - this.camera.fov) * fovAlpha;
      this.camera.updateProjectionMatrix();
      this.camera.position.copy(this.currentPos);
      this.camera.lookAt(this.currentLook);
      return;
    }

    if (mode === 2) {
      // Third-person chase camera behind tractor & trailer (supports mouse-drag orbit & gentle auto-center)
      if (!this.isDragging && Math.abs(physics.speedMs) > 1.5) {
        const recenterAlpha = Math.min(1, dtSec * 1.4);
        this.chaseYawOffset += (0 - this.chaseYawOffset) * recenterAlpha;
        this.chasePitchOffset += (0 - this.chasePitchOffset) * recenterAlpha;
      }

      const backDist = physics.trailerAttached ? 17.5 : 10.5;
      const fwdX = Math.sin(physics.yaw);
      const fwdZ = Math.cos(physics.yaw);
      const trFwdX = physics.trailerAttached ? Math.sin(physics.trailerYaw) : fwdX;
      const trFwdZ = physics.trailerAttached ? Math.cos(physics.trailerYaw) : fwdZ;

      const mixX = fwdX * 0.45 + trFwdX * 0.55;
      const mixZ = fwdZ * 0.45 + trFwdZ * 0.55;
      const len = Math.hypot(mixX, mixZ) || 1;
      const baseDirX = mixX / len;
      const baseDirZ = mixZ / len;

      const cosO = Math.cos(this.chaseYawOffset);
      const sinO = Math.sin(this.chaseYawOffset);
      const dirX = baseDirX * cosO + baseDirZ * sinO;
      const dirZ = -baseDirX * sinO + baseDirZ * cosO;
      const baseHeight = physics.trailerAttached ? 6.4 : 4.8;
      const camHeight = Math.max(1.8, baseHeight + this.chasePitchOffset * 8.5);

      this.desiredPos.set(
        physics.x - dirX * backDist,
        physics.y + camHeight,
        physics.z - dirZ * backDist
      );
      this.desiredLook.set(
        physics.x + fwdX * (Math.abs(this.chaseYawOffset) > 0.3 ? 1.5 : 8),
        physics.y + 2.3,
        physics.z + fwdZ * (Math.abs(this.chaseYawOffset) > 0.3 ? 1.5 : 8)
      );

      const targetFov = THREE.MathUtils.lerp(56, 65, THREE.MathUtils.clamp(absKmh / 100, 0, 1));
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dtSec * 6);
      this.camera.updateProjectionMatrix();

      if (!this.initialized) {
        this.currentPos.copy(this.desiredPos);
        this.currentLook.copy(this.desiredLook);
        this.initialized = true;
      } else {
        this.currentPos.lerp(this.desiredPos, Math.min(1, dtSec * 6.5));
        this.currentLook.lerp(this.desiredLook, Math.min(1, dtSec * 9));
      }
      this.camera.position.copy(this.currentPos);
      this.camera.lookAt(this.currentLook);
      return;
    }

    if (mode === 5) {
      // Overhead precision camera tracking tractor-trailer midpoint
      const fwdX = Math.sin(physics.yaw);
      const fwdZ = Math.cos(physics.yaw);
      const cx = physics.trailerAttached ? (physics.x * 0.45 + physics.trailerX * 0.55) : physics.x;
      const cz = physics.trailerAttached ? (physics.z * 0.45 + physics.trailerZ * 0.55) : physics.z;

      this.desiredPos.set(
        cx - fwdX * 4.5,
        physics.y + this.overheadHeight,
        cz - fwdZ * 4.5
      );
      this.desiredLook.set(cx + fwdX * 1.2, physics.y + 0.5, cz + fwdZ * 1.2);

      this.camera.fov += (52 - this.camera.fov) * Math.min(1, dtSec * 8);
      this.camera.updateProjectionMatrix();

      if (!this.initialized) {
        this.currentPos.copy(this.desiredPos);
        this.currentLook.copy(this.desiredLook);
        this.initialized = true;
      } else {
        this.currentPos.lerp(this.desiredPos, Math.min(1, dtSec * 8));
        this.currentLook.lerp(this.desiredLook, Math.min(1, dtSec * 10));
      }
      this.camera.position.copy(this.currentPos);
      this.camera.lookAt(this.currentLook);
      return;
    }

    // Mode 3: ETS2 Classic Lean-Out Driver Window Reverse Sightline (along left trailer flank)
    visuals.tractorRoot.updateMatrixWorld(true);
    this.tempVec.set(1.42, 2.68, 1.92);
    visuals.cabSuspensionGroup.localToWorld(this.tempVec);
    this.desiredPos.copy(this.tempVec);
    if (physics.trailerAttached) {
      this.desiredLook.set(
        physics.trailerX - Math.sin(physics.trailerYaw) * 6.5,
        physics.trailerY + 1.2,
        physics.trailerZ - Math.cos(physics.trailerYaw) * 6.5
      );
    } else {
      this.desiredLook.set(
        physics.x - Math.sin(physics.yaw) * 7.5,
        physics.y + 1.0,
        physics.z - Math.cos(physics.yaw) * 7.5
      );
    }

    this.camera.fov += (56 - this.camera.fov) * Math.min(1, dtSec * 8);
    this.camera.updateProjectionMatrix();

    if (!this.initialized) {
      this.currentPos.copy(this.desiredPos);
      this.currentLook.copy(this.desiredLook);
      this.initialized = true;
    } else {
      this.currentPos.lerp(this.desiredPos, Math.min(1, dtSec * 9));
      this.currentLook.lerp(this.desiredLook, Math.min(1, dtSec * 10));
    }
    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.currentLook);
  }

  public dispose(): void {
    this.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.domElement.removeEventListener('dblclick', this.onDoubleClick);
    this.domElement.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
  }
}
