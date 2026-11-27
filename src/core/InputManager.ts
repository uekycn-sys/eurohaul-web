export interface InputActions {
  onToggleLeftBlinker?: () => void;
  onToggleRightBlinker?: () => void;
  onToggleHazards?: () => void;
  onCycleHeadlights?: () => void;
  onToggleParkingBrake?: () => void;
  onToggleCruiseControl?: () => void;
  onCruiseIncrease?: () => void;
  onCruiseDecrease?: () => void;
  onCycleRetarder?: () => void;
  onToggleTrailer?: () => void;
  onToggleIgnition?: () => void;
  onToggleExhaustBrake?: () => void;
  onToggleDiffLock?: () => void;
  onToggleCabLight?: () => void;
  onToggleRescueModal?: () => void;
  onCenterSteering?: () => void;
  onRestartExam?: () => void;
  onShiftUp?: () => void;
  onShiftDown?: () => void;
  onCameraMode?: (mode: 1 | 2 | 3 | 4 | 5) => void;
  onCycleCamera?: () => void;
  onToggleMap?: () => void;
  onCycleAdvisorTab?: () => void;
  onInteract?: () => void;
  onRest?: () => void;
  onCycleWipers?: () => void;
  onToggleFullscreen?: () => void;
  onEscape?: () => void;
}

/**
 * Handles smoothed keyboard driving inputs (speed-sensitive steering with configurable caster return,
 * progressive clutch pedal, trailer hand-valve, and discrete vehicle control bindings).
 */
export class InputManager {
  private readonly keys = new Set<string>();
  private readonly actions: InputActions;
  private enabled = true;

  public throttle = 0;
  public brake = 0;
  public steer = 0; // +1 = Left, -1 = Right
  public clutch = 0; // 0 = engaged, 1 = fully depressed
  public trailerBrake = false;
  public horn = false;
  public lookLeft = false;
  public lookRight = false;

  private rawSteer = 0;
  private steerHoldSec = 0;
  private lastSteerDir = 0;
  private centeringSteer = false;
  private touchSteer: number | null = null;
  private touchThrottle = 0;
  private touchBrake = 0;
  private touchHorn = false;

  constructor(actions: InputActions) {
    this.actions = actions;
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
  }

  public setDrivingEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.keys.clear();
      this.horn = false;
      this.trailerBrake = false;
      this.lookLeft = false;
      this.lookRight = false;
      this.centeringSteer = false;
      this.touchSteer = null;
      this.touchThrottle = 0;
      this.touchBrake = 0;
      this.touchHorn = false;
    }
  }

  public triggerCenterSteering(): void {
    this.centeringSteer = true;
  }

  public setTouchSteer(steerNorm: number | null): void {
    this.touchSteer = steerNorm === null ? null : Math.max(-1, Math.min(1, steerNorm));
  }

  public setTouchThrottle(val: number): void {
    this.touchThrottle = Math.max(0, Math.min(1, val));
  }

  public setTouchBrake(val: number): void {
    this.touchBrake = Math.max(0, Math.min(1, val));
  }

  public setTouchHorn(active: boolean): void {
    this.touchHorn = active;
  }

  public update(dtSec: number, speedKmh: number, realisticSteeringReturn = true): void {
    if (!this.enabled) {
      this.throttle = Math.max(0, this.throttle - dtSec * 4);
      this.brake = Math.max(0, this.brake - dtSec * 4);
      this.clutch = Math.max(0, this.clutch - dtSec * 5);
      this.rawSteer *= Math.max(0, 1 - dtSec * 6);
      this.steer *= Math.max(0, 1 - dtSec * 6);
      this.trailerBrake = false;
      this.horn = false;
      this.lookLeft = false;
      this.lookRight = false;
      return;
    }

    const kbThrottle = this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0;
    const kbBrake = this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0;
    const wantLeft = this.keys.has('KeyA') || this.keys.has('ArrowLeft');
    const wantRight = this.keys.has('KeyD') || this.keys.has('ArrowRight');
    const wantClutch = this.keys.has('KeyZ') ? 1 : 0;

    this.horn = this.keys.has('KeyH') || this.touchHorn;
    this.trailerBrake = this.keys.has('KeyY');
    this.lookLeft = this.keys.has('Numpad4');
    this.lookRight = this.keys.has('Numpad6');

    // Progressive throttle, brake, and clutch pedal (controlled release for half-clutch hill starts)
    const targetThrottle = Math.max(kbThrottle, this.touchThrottle);
    const throttleRate = targetThrottle > this.throttle ? 2.4 : 4.2;
    this.throttle += (targetThrottle - this.throttle) * Math.min(1, dtSec * throttleRate * 3);

    const targetBrake = Math.max(kbBrake, this.touchBrake);
    const brakeRate = targetBrake > this.brake ? 3.2 : 4.8;
    this.brake += (targetBrake - this.brake) * Math.min(1, dtSec * brakeRate * 3);

    if (wantClutch > this.clutch) {
      this.clutch = Math.min(1, this.clutch + dtSec * 8.0);
    } else if (wantClutch < this.clutch) {
      this.clutch = Math.max(0, this.clutch - dtSec * 1.9);
    }

    // Speed-sensitive steering ramp & caster self-centering (1:1 for touch wheel/buttons)
    if (this.touchSteer !== null) {
      this.steer += (this.touchSteer - this.steer) * Math.min(1, dtSec * 14);
      this.rawSteer = this.steer;
      return;
    }

    let targetSteer = 0;
    if (wantLeft && !wantRight) {
      targetSteer = 1;
      this.centeringSteer = false;
    } else if (wantRight && !wantLeft) {
      targetSteer = -1;
      this.centeringSteer = false;
    }

    const absSpeed = Math.abs(speedKmh);
    const speedSteerSpeed = realisticSteeringReturn
      ? Math.max(0.85, 1.85 - absSpeed * 0.012)
      : Math.max(1.15, 2.5 - absSpeed * 0.015);
    const centerSpeed = this.centeringSteer
      ? 6.0
      : realisticSteeringReturn
      ? absSpeed < 1.5
        ? 0
        : 0.6 + Math.min(4.2, absSpeed * 0.08)
      : 3.2 + Math.min(3.0, absSpeed * 0.04);

    if (targetSteer !== 0) {
      if (targetSteer !== this.lastSteerDir) {
        this.steerHoldSec = 0;
        this.lastSteerDir = targetSteer;
      } else {
        this.steerHoldSec += dtSec;
      }
      const holdRamp =
        absSpeed < 22
          ? Math.min(1.0, Math.max(0.55, 0.55 + this.steerHoldSec * 1.8))
          : Math.min(1.0, Math.max(0.28, 0.28 + this.steerHoldSec * 1.6));
      const diff = targetSteer - this.rawSteer;
      const step = Math.sign(diff) * speedSteerSpeed * holdRamp * dtSec;
      if (Math.abs(diff) <= Math.abs(step)) {
        this.rawSteer = targetSteer;
      } else {
        this.rawSteer += step;
      }
    } else {
      this.steerHoldSec = 0;
      this.lastSteerDir = 0;
      if (centerSpeed > 0) {
        const step = centerSpeed * dtSec;
        if (Math.abs(this.rawSteer) <= step) {
          this.rawSteer = 0;
          this.centeringSteer = false;
        } else {
          this.rawSteer -= Math.sign(this.rawSteer) * step;
        }
      }
    }

    // Non-linear progressive steering curve: surgical center precision for lane-keeping, full lock on hold
    const absRaw = Math.abs(this.rawSteer);
    this.steer = Math.sign(this.rawSteer) * (0.5 * absRaw + 0.5 * absRaw * absRaw);
  }

  private readonly handleKeyDown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable)
    ) {
      return;
    }

    if (e.code === 'Tab') {
      e.preventDefault();
    }
    if (e.code === 'Space' && this.enabled) {
      e.preventDefault();
    }

    if (e.repeat) return;

    // Global shortcuts even if modal open or on main menu
    if (e.code === 'Escape') {
      this.actions.onEscape?.();
      return;
    }
    if (e.code === 'KeyF') {
      this.actions.onToggleFullscreen?.();
      return;
    }
    if (e.code === 'KeyM') {
      this.actions.onToggleMap?.();
      return;
    }
    if (e.code === 'F7') {
      e.preventDefault();
      this.actions.onToggleRescueModal?.();
      return;
    }

    if (!this.enabled) return;

    this.keys.add(e.code);

    switch (e.code) {
      case 'KeyQ':
        this.actions.onToggleLeftBlinker?.();
        break;
      case 'KeyE':
        this.actions.onToggleRightBlinker?.();
        break;
      case 'KeyX':
      case 'KeyG':
        this.actions.onToggleHazards?.();
        break;
      case 'KeyL':
        this.actions.onCycleHeadlights?.();
        break;
      case 'Space':
        this.actions.onToggleParkingBrake?.();
        break;
      case 'KeyC':
        this.actions.onToggleCruiseControl?.();
        break;
      case 'BracketRight':
      case 'Equal':
        this.actions.onCruiseIncrease?.();
        break;
      case 'BracketLeft':
      case 'Minus':
        this.actions.onCruiseDecrease?.();
        break;
      case 'KeyO':
        this.actions.onToggleCabLight?.();
        break;
      case 'KeyB':
        this.actions.onCycleRetarder?.();
        break;
      case 'KeyT':
        this.actions.onToggleTrailer?.();
        break;
      case 'KeyI':
        this.actions.onToggleIgnition?.();
        break;
      case 'KeyJ':
        this.actions.onToggleExhaustBrake?.();
        break;
      case 'KeyU':
        this.actions.onToggleDiffLock?.();
        break;
      case 'KeyN':
        this.triggerCenterSteering();
        this.actions.onCenterSteering?.();
        break;
      case 'Backspace':
        this.actions.onRestartExam?.();
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        this.actions.onShiftUp?.();
        break;
      case 'ControlLeft':
      case 'ControlRight':
        this.actions.onShiftDown?.();
        break;
      case 'Digit1':
        this.actions.onCameraMode?.(1);
        break;
      case 'Digit2':
        this.actions.onCameraMode?.(2);
        break;
      case 'Digit3':
        this.actions.onCameraMode?.(3);
        break;
      case 'Digit4':
        this.actions.onCameraMode?.(4);
        break;
      case 'Digit5':
        this.actions.onCameraMode?.(5);
        break;
      case 'KeyV':
        this.actions.onCycleCamera?.();
        break;
      case 'KeyR':
        this.actions.onRest?.();
        break;
      case 'KeyP':
      case 'KeyK':
        this.actions.onCycleWipers?.();
        break;
      case 'Tab':
        this.actions.onCycleAdvisorTab?.();
        break;
      case 'Enter':
        this.actions.onInteract?.();
        break;
    }
  };

  private readonly handleKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private readonly handleBlur = (): void => {
    this.keys.clear();
    this.horn = false;
    this.lookLeft = false;
    this.lookRight = false;
  };

  public dispose(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
  }
}
