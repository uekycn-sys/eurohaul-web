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
  private cabLookYaw = 0;
  private cabLookPitch = 0;
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
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
  }

  public resetCabLook(): void {
    this.cabLookYaw = 0;
    this.cabLookPitch = 0;
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
    this.orbitYaw -= dx * 0.006;
    this.orbitPitch = THREE.MathUtils.clamp(this.orbitPitch + dy * 0.004, 0.08, 1.05);
    // First-person cab head look (clamp comfortably to left/right side windows)
    this.cabLookYaw = THREE.MathUtils.clamp(this.cabLookYaw - dx * 0.005, -1.25, 1.25);
    this.cabLookPitch = THREE.MathUtils.clamp(this.cabLookPitch - dy * 0.0035, -0.35, 0.32);
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
    cabMotionEnabled = true
  ): void {
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
      if (cabMotionEnabled) {
        this.rumbleClockSec += safeDt * (1 + Math.min(2.0, absKmh / 45));
        const accelSignal = Math.abs(physics.filteredAccelMs2) < 0.08 ? 0 : physics.filteredAccelMs2;
        const offroadRumble =
          !physics.onRoad && absKmh > 3
            ? Math.sin(this.rumbleClockSec * 22) * 0.008 * Math.min(1, absKmh / 30)
            : 0;
        const targetHeave = THREE.MathUtils.clamp(accelSignal * 0.0032 + offroadRumble, -0.015, 0.015);
        const lpAlpha = 1 - Math.exp(-8.5 * safeDt);
        this.seatHeaveY += (targetHeave - this.seatHeaveY) * lpAlpha;
        if (targetHeave === 0 && Math.abs(this.seatHeaveY) < 0.00015) {
          this.seatHeaveY = 0;
        }
        heaveY = THREE.MathUtils.clamp(this.seatHeaveY, -0.015, 0.015);
      } else {
        this.seatHeaveY = 0;
      }

      const steerAlpha = 1 - Math.exp(-7.5 * safeDt);
      this.smoothLookSteer += (physics.steerAngleRad * 4.5 - this.smoothLookSteer) * steerAlpha;

      visuals.tractorRoot.updateMatrixWorld(true);
      this.tempVec.set(0.58, 2.57 + heaveY, 1.74);
      visuals.cabSuspensionGroup.localToWorld(this.tempVec);
      this.desiredPos.copy(this.tempVec);

      const headYawSin = Math.sin(this.cabLookYaw);
      const headYawCos = Math.cos(this.cabLookYaw);
      this.tempVec.set(
        0.58 + this.smoothLookSteer * headYawCos + headYawSin * 20,
        2.40 + heaveY * 0.35 + this.cabLookPitch * 14,
        1.74 + headYawCos * 20.3
      );
      visuals.cabSuspensionGroup.localToWorld(this.tempVec);
      this.desiredLook.copy(this.tempVec);

      this.currentPos.copy(this.desiredPos);
      this.currentLook.copy(this.desiredLook);
      this.initialized = true;
      const fovAlpha = 1 - Math.exp(-8 * safeDt);
      this.camera.fov += (64 - this.camera.fov) * fovAlpha;
      this.camera.updateProjectionMatrix();
      this.camera.position.copy(this.currentPos);
      this.camera.lookAt(this.currentLook);
      return;
    }

    if (mode === 2) {
      // Third-person chase camera behind tractor & trailer
      const backDist = physics.trailerAttached ? 17.5 : 10.5;
      const fwdX = Math.sin(physics.yaw);
      const fwdZ = Math.cos(physics.yaw);
      const trFwdX = physics.trailerAttached ? Math.sin(physics.trailerYaw) : fwdX;
      const trFwdZ = physics.trailerAttached ? Math.cos(physics.trailerYaw) : fwdZ;

      const mixX = fwdX * 0.45 + trFwdX * 0.55;
      const mixZ = fwdZ * 0.45 + trFwdZ * 0.55;
      const len = Math.hypot(mixX, mixZ) || 1;
      const dirX = mixX / len;
      const dirZ = mixZ / len;

      this.desiredPos.set(
        physics.x - dirX * backDist,
        physics.y + (physics.trailerAttached ? 6.4 : 4.8),
        physics.z - dirZ * backDist
      );
      this.desiredLook.set(
        physics.x + fwdX * 8,
        physics.y + 2.3,
        physics.z + fwdZ * 8
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

    // Mode 3: Driver-side reverse sightline (looks along left side of trailer & bay)
    const fwdX = Math.sin(physics.yaw);
    const fwdZ = Math.cos(physics.yaw);
    const leftX = Math.cos(physics.yaw);
    const leftZ = -Math.sin(physics.yaw);

    this.desiredPos.set(
      physics.x + leftX * 3.4 + fwdX * 2.8,
      physics.y + 4.3,
      physics.z + leftZ * 3.4 + fwdZ * 2.8
    );
    this.desiredLook.set(
      physics.trailerX - Math.sin(physics.trailerYaw) * 6.5,
      physics.trailerY + 1.1,
      physics.trailerZ - Math.cos(physics.trailerYaw) * 6.5
    );

    this.camera.fov += (58 - this.camera.fov) * Math.min(1, dtSec * 8);
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
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
  }
}
