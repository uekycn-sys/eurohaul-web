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

  // Air-suspension driver seat spring-damper state (heave & micro road rumble)
  private seatHeaveY = 0;
  private seatHeaveVel = 0;
  private prevTruckSpeedMs = 0;
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
    isMenu: boolean
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
      // First-person LHD driver eye inside air-suspended cab with spring-damper heave & shoulder micro-vibration:
      // frames steering wheel, dynamic gauges, A-pillar SatNav, wipers, and wide windshield view
      const safeDt = Math.min(0.05, Math.max(0.001, dtSec));
      const longAccel = (physics.speedMs - this.prevTruckSpeedMs) / safeDt;
      this.prevTruckSpeedMs = physics.speedMs;

      this.rumbleClockSec += safeDt * (1 + Math.min(2.5, absKmh / 45));
      const speedNorm = THREE.MathUtils.clamp(absKmh / 80, 0, 1);
      const shoulderRumble =
        !physics.onRoad && absKmh > 3
          ? (Math.sin(this.rumbleClockSec * 29) * 0.016 + Math.cos(this.rumbleClockSec * 43) * 0.01) *
            Math.min(1, absKmh / 25)
          : Math.sin(this.rumbleClockSec * 8.5) * 0.004 * speedNorm;
      const targetHeave = THREE.MathUtils.clamp(
        longAccel * 0.0045 + shoulderRumble,
        -0.045,
        0.045
      );
      this.seatHeaveVel +=
        ((targetHeave - this.seatHeaveY) * 52 - this.seatHeaveVel * 9.5) * safeDt;
      this.seatHeaveY = THREE.MathUtils.clamp(
        this.seatHeaveY + this.seatHeaveVel * safeDt,
        -0.05,
        0.05
      );

      visuals.tractorRoot.updateMatrixWorld(true);
      this.tempVec.set(0.58, 2.58 + this.seatHeaveY, 1.72);
      visuals.cabSuspensionGroup.localToWorld(this.tempVec);
      this.desiredPos.copy(this.tempVec);

      const lookOffsetSide = physics.steerAngleRad * 6.0;
      const headYawSin = Math.sin(this.cabLookYaw);
      const headYawCos = Math.cos(this.cabLookYaw);
      this.tempVec.set(
        0.58 + lookOffsetSide * headYawCos + headYawSin * 20,
        2.35 + this.seatHeaveY * 0.45 + this.cabLookPitch * 14,
        1.72 + headYawCos * 20.3
      );
      visuals.cabSuspensionGroup.localToWorld(this.tempVec);
      this.desiredLook.copy(this.tempVec);

      if (!this.initialized) {
        this.currentPos.copy(this.desiredPos);
        this.currentLook.copy(this.desiredLook);
        this.initialized = true;
      } else {
        const eyeFollow = Math.min(1, safeDt * 24);
        this.currentPos.lerp(this.desiredPos, eyeFollow);
        this.currentLook.lerp(this.desiredLook, eyeFollow);
      }
      this.camera.fov += (68 - this.camera.fov) * Math.min(1, safeDt * 8);
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
