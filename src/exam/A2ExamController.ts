import { InputManager } from '../core/InputManager';
import { TruckPhysics, Point2D } from '../physics/TruckPhysics';
import { WipersMode } from '../store/useGameStore';
import { BuiltExamArena } from './A2ExamArenaBuilder';
import {
  A2_LAYOUT,
  getA2ExamLevel,
  getSCurveCenterline,
  mountainCenterX,
} from './A2ExamCatalog';
import {
  A2DeductionRecord,
  A2ExamLevelId,
  A2ExamLiveMetric,
  A2ExamPhase,
  A2ExamStateSnapshot,
} from './types';

export interface ExamTickFeedback {
  cue?: 'step' | 'deduct' | 'fail' | 'pass';
  voice?: string;
  forcedRainIntensity?: number;
}

export class A2ExamController {
  public readonly levelId: A2ExamLevelId;
  private readonly def;
  private readonly strictCamera: boolean;

  public phase: A2ExamPhase = 'briefing';
  public score = 100;
  public elapsedSec = 0;
  public currentStepIndex = 0;
  public totalSteps = 1;
  public instruction = '';
  public deductions: A2DeductionRecord[] = [];
  public failReason?: string;

  private deductionSeq = 1;
  private readonly cooldowns = new Map<string, number>();
  private stoppedSec = 0;
  private holdTimerSec = 0;
  private metrics: A2ExamLiveMetric[] = [];

  // Level-specific tracking state
  private hillStopped = false;
  private hillStopPeakZ = 0;
  private hillMinZAfterStop = Infinity;

  private parallelStage: 'forward' | 'reverse' | 'exit' = 'forward';
  private bridgeMissedAxles = new Set<string>();

  private angleLeftBlinkerSeen = false;
  private mountainTunnelHeadlightChecked = false;
  private mountainHornHeard = false;
  private mountainNeutralSec = 0;
  private mountainBarricadeTriggered = false;

  private s3StartBlinkerSec = 0;
  private s3StartHornHeard = false;
  private s3StartChecked = false;
  private s3LaneBlinkerSec = 0;
  private s3LaneCrossChecked = false;
  private s3SignalClock = 0;
  private s3SignalState: 'green' | 'amber' | 'red' = 'green';
  private s3RedLightChecked = false;
  private s3Reached45 = false;
  private s3ReachedBelow25 = false;
  private s3GearChecked = false;
  private s3PulloverBlinkerSec = 0;
  private s3PulloverBlinkerChecked = false;
  private s3PulloverScoreChecked = false;

  private queuedFeedback: ExamTickFeedback = {};

  constructor(levelId: A2ExamLevelId, strictCamera: boolean) {
    this.levelId = levelId;
    this.def = getA2ExamLevel(levelId);
    this.strictCamera = strictCamera;
    this.initSteps();
  }

  private initSteps(): void {
    switch (this.levelId) {
      case 'reverse_bay':
        this.totalSteps = 2;
        this.instruction = '准备就绪：松开手刹，将重型半挂车整体倒入黄线库位内';
        break;
      case 'hill_start':
        this.totalSteps = 3;
        this.instruction = '驶上 10% 坡道，将车头精准停在红白定点线 (±50cm)，右侧边距 ≤35cm';
        break;
      case 'parallel_park':
        this.totalSteps = 3;
        this.instruction = '第 1 步：沿主车道向前行驶，使半挂车尾越过侧方库位线';
        break;
      case 'single_bridge':
        this.totalSteps = 3;
        this.instruction = '第 1 步：对准左单边桥低速匀速通过，注意半挂车轴轨迹';
        break;
      case 's_curve':
        this.totalSteps = 2;
        this.instruction = '保持 12~18 km/h 匀速通过 S 弯，入弯贴外线以留足半挂内轮差';
        break;
      case 'right_angle_gates':
        this.totalSteps = 2;
        this.instruction = '第 1 步：开启左转向灯 [Q]，靠右完成 90° 直角左转';
        break;
      case 'mountain_hazard':
        this.totalSteps = 3;
        this.instruction = '第 1 步：进入隧道前开启近光灯 [L] 并鸣笛 [H]，限速 40 km/h';
        break;
      case 'subject3_road':
        this.totalSteps = 5;
        this.instruction = '第 1 步 (起步)：开左灯 [Q] ≥2秒，鸣笛 [H]，松手刹平稳起步';
        break;
    }
  }

  public beginRun(): ExamTickFeedback {
    this.phase = 'running';
    return {
      cue: 'step',
      voice: `现在开始${this.def.title}考试，请按语音提示操作`,
    };
  }

  public getSnapshot(): A2ExamStateSnapshot {
    return {
      levelId: this.levelId,
      title: this.def.title,
      subjectLabel: this.def.subjectLabel,
      phase: this.phase,
      score: this.score,
      passingScore: this.def.passingScore,
      elapsedSec: this.elapsedSec,
      timeLimitSec: this.def.timeLimitSec,
      currentStepIndex: this.currentStepIndex,
      totalSteps: this.totalSteps,
      instruction: this.instruction,
      coachTip: this.def.coachTip,
      metrics: this.metrics,
      deductions: this.deductions,
      strictCamera: this.strictCamera,
      failReason: this.failReason,
    };
  }

  private deduct(key: string, points: number, reason: string, fatal = false, cooldownSec = 6): void {
    if (this.phase !== 'running') return;
    const lastAt = this.cooldowns.get(key);
    if (!fatal && lastAt !== undefined && this.elapsedSec - lastAt < cooldownSec) return;
    this.cooldowns.set(key, this.elapsedSec);

    this.score = Math.max(0, this.score - points);
    this.deductions = [
      {
        id: `ded_${this.deductionSeq++}`,
        timestampSec: Number(this.elapsedSec.toFixed(1)),
        points,
        reason,
        fatal,
      },
      ...this.deductions,
    ];

    if (fatal || this.score < this.def.passingScore) {
      this.phase = 'failed';
      this.failReason = reason;
      this.queuedFeedback = {
        cue: 'fail',
        voice: `考试不合格：${reason}`,
      };
    } else {
      this.queuedFeedback = {
        cue: 'deduct',
        voice: `扣${points}分，${reason}`,
      };
    }
  }

  private passExam(summaryVoice?: string): void {
    if (this.phase !== 'running') return;
    this.phase = 'passed';
    this.queuedFeedback = {
      cue: 'pass',
      voice: summaryVoice ?? `考试合格，最终成绩 ${this.score} 分`,
    };
  }

  private setStep(idx: number, text: string, voiceText?: string): void {
    if (this.currentStepIndex !== idx) {
      this.currentStepIndex = idx;
      this.instruction = text;
      if (!this.queuedFeedback.cue) {
        this.queuedFeedback = {
          cue: 'step',
          voice: voiceText ?? text,
        };
      }
    } else {
      this.instruction = text;
    }
  }

  private checkMidStop(activeMovingPhase: boolean, absKmh: number, dtSec: number): void {
    if (!activeMovingPhase) {
      this.stoppedSec = 0;
      return;
    }
    if (absKmh < 0.75) {
      this.stoppedSec += dtSec;
      if (this.stoppedSec > 2.0) {
        this.stoppedSec = 0;
        this.deduct('mid_stop', 5, '考试过程中途停车超过 2 秒', false, 4.5);
      }
    } else {
      this.stoppedSec = 0;
    }
  }

  public step(
    dtSec: number,
    physics: TruckPhysics,
    input: InputManager,
    arena: BuiltExamArena,
    wipersMode: WipersMode
  ): ExamTickFeedback {
    this.queuedFeedback = {};
    if (this.phase !== 'running') {
      return this.queuedFeedback;
    }

    this.elapsedSec += dtSec;
    if (this.elapsedSec > this.def.timeLimitSec) {
      this.deduct('timeout', 100, '考试项目超时未完成', true);
      return this.queuedFeedback;
    }

    // Global A2 penalties: Engine stall + Excessive jackknife angle
    if (physics.engineJustStalled) {
      this.deduct('stall', 10, '操作不当导致发动机熄火', false, 1.5);
      if (this.phase !== 'running') return this.queuedFeedback;
    }
    const hitchDeg = Math.abs((physics.hitchAngleRad * 180) / Math.PI);
    if (hitchDeg > 68) {
      this.deduct('jackknife', 10, '倒车/转弯折头夹角过大 (>68°)', false, 5);
      if (this.phase !== 'running') return this.queuedFeedback;
    }

    const absKmh = Math.abs(physics.speedMs) * 3.6;
    const fp = physics.getVehicleFootprint();
    const allCorners: Point2D[] = [...fp.tractorCorners, ...fp.trailerCorners];
    const allWheels: Point2D[] = [
      fp.tractorWheels.fl,
      fp.tractorWheels.fr,
      fp.tractorWheels.rl,
      fp.tractorWheels.rr,
      ...fp.trailerAxleWheels,
    ];

    switch (this.levelId) {
      case 'reverse_bay':
        this.stepReverseBay(dtSec, physics, arena, absKmh, hitchDeg, allCorners, allWheels);
        break;
      case 'hill_start':
        this.stepHillStart(dtSec, physics, arena, absKmh, fp, allWheels);
        break;
      case 'parallel_park':
        this.stepParallelPark(dtSec, physics, arena, absKmh, hitchDeg, fp, allCorners, allWheels);
        break;
      case 'single_bridge':
        this.stepSingleBridge(dtSec, physics, arena, absKmh, fp, allWheels);
        break;
      case 's_curve':
        this.stepSCurve(dtSec, physics, arena, absKmh, hitchDeg, fp, allWheels);
        break;
      case 'right_angle_gates':
        this.stepRightAngleGates(dtSec, physics, arena, absKmh, fp, allCorners, allWheels);
        break;
      case 'mountain_hazard':
        this.stepMountainHazard(dtSec, physics, input, arena, wipersMode, absKmh, fp);
        break;
      case 'subject3_road':
        this.stepSubject3(dtSec, physics, input, arena, absKmh, fp);
        break;
    }

    return this.queuedFeedback;
  }

  private stepReverseBay(
    dtSec: number,
    physics: TruckPhysics,
    arena: BuiltExamArena,
    absKmh: number,
    hitchDeg: number,
    allCorners: Point2D[],
    allWheels: Point2D[]
  ): void {
    const L = A2_LAYOUT.reverseBay;

    // Apron boundary check
    for (const p of allCorners) {
      if (
        p.x < L.apronMinX - 0.1 ||
        p.x > L.apronMaxX + 0.1 ||
        p.z < L.apronMinZ - 0.1 ||
        p.z > L.apronMaxZ + 0.1
      ) {
        arena.setTargetZoneState('violation');
        this.deduct('apron_out', 100, '车身驶出考场黄色边界线', true);
        return;
      }
    }

    // Pole & Bay wall collision check
    const poles: [number, number][] = [];
    for (const px of [L.bayMinX - 0.12, L.bayMaxX + 0.12]) {
      for (const pz of [L.bayMaxZ, (L.bayMaxZ + L.bayMinZ) * 0.5, L.bayMinZ]) {
        poles.push([px, pz]);
      }
    }
    for (const c of allCorners) {
      for (const [px, pz] of poles) {
        if (Math.hypot(c.x - px, c.z - pz) < 0.28) {
          arena.setTargetZoneState('violation');
          this.deduct('pole_hit', 100, '车身碰撞库位标杆', true);
          return;
        }
      }
      if (c.z < L.bayMinZ - 0.05) {
        arena.setTargetZoneState('violation');
        this.deduct('bay_back', 100, '倒车越过库底黄线', true);
        return;
      }
      if (c.z < L.bayMaxZ - 0.25 && Math.abs(c.x) > L.bayMaxX + 0.04 && Math.abs(c.x) < L.bayMaxX + 1.8) {
        arena.setTargetZoneState('violation');
        this.deduct('bay_side', 100, '车身压库位边线', true);
        return;
      }
    }
    for (const w of allWheels) {
      if (w.z < L.bayMaxZ - 0.2 && Math.abs(w.x) > L.bayMaxX + 0.03 && Math.abs(w.x) < L.bayMaxX + 1.5) {
        arena.setTargetZoneState('violation');
        this.deduct('bay_wheel', 100, '车轮压库位黄线', true);
        return;
      }
    }

    const allInsideBay = allCorners.every(
      (c) => c.x >= L.bayMinX && c.x <= L.bayMaxX && c.z >= L.bayMinZ && c.z <= L.bayMaxZ
    );
    const yawDeg = Math.abs(((physics.yaw * 180) / Math.PI));
    const aligned = allInsideBay && yawDeg <= 12 && hitchDeg <= 10;

    if (allInsideBay) {
      this.setStep(1, '车身已入库！请回正车头并停稳保持 1.2 秒', '车身已进入库位，请回正停稳');
    }

    if (aligned) {
      arena.setTargetZoneState('aligned');
      if (absKmh < 1.0) {
        this.holdTimerSec += dtSec;
        if (this.holdTimerSec >= 1.2) {
          this.passExam();
        }
      } else {
        this.holdTimerSec = 0;
      }
    } else {
      arena.setTargetZoneState('idle');
      this.holdTimerSec = 0;
      this.checkMidStop(physics.z < L.bayMaxZ + 12 && !allInsideBay, absKmh, dtSec);
    }

    this.metrics = [
      {
        label: '全车入库',
        value: allInsideBay ? '已全入' : '调整中',
        status: allInsideBay ? 'ok' : 'warn',
      },
      {
        label: '铰接夹角',
        value: `${Math.round(hitchDeg)}°`,
        status: hitchDeg > 55 ? 'bad' : hitchDeg > 35 ? 'warn' : 'ok',
      },
      {
        label: '停稳计时',
        value: `${this.holdTimerSec.toFixed(1)}/1.2s`,
        status: aligned ? 'ok' : 'warn',
      },
    ];
  }

  private stepHillStart(
    dtSec: number,
    _physics: TruckPhysics,
    arena: BuiltExamArena,
    absKmh: number,
    fp: ReturnType<TruckPhysics['getVehicleFootprint']>,
    allWheels: Point2D[]
  ): void {
    const L = A2_LAYOUT.hillStart;
    for (const w of allWheels) {
      if (w.x < L.minX - 0.04) {
        arena.setTargetZoneState('violation');
        this.deduct('hill_right_line', 100, '右侧车轮压坡道边线', true);
        return;
      }
      if (w.x > L.maxX + 0.04) {
        arena.setTargetZoneState('violation');
        this.deduct('hill_left_line', 100, '左侧车轮越出坡道', true);
        return;
      }
    }

    const frontZ = fp.frontBumperCenter.z;
    const minRightWheelX = Math.min(
      fp.tractorWheels.fr.x,
      fp.tractorWheels.rr.x,
      fp.trailerAxleWheels[1]!.x
    );
    const marginCm = Math.round((minRightWheelX - L.minX) * 100);
    const errCm = Math.round((frontZ - L.stopLineZ) * 100);

    if (!this.hillStopped) {
      if (frontZ > 18 && frontZ < L.stopLineZ + 2.5) {
        this.setStep(1, '接近红白定点线，请减速将前保险杠精准停在线上 (±50cm)');
      }

      if (frontZ > L.stopLineZ + 2.2) {
        arena.setTargetZoneState('violation');
        this.deduct('hill_overshoot', 100, '驶过定点停车区域未停车', true);
        return;
      }

      if (frontZ >= 16 && absKmh < 0.7) {
        this.holdTimerSec += dtSec;
        if (this.holdTimerSec >= 0.55) {
          this.hillStopped = true;
          this.hillStopPeakZ = frontZ;
          this.hillMinZAfterStop = frontZ;
          this.holdTimerSec = 0;

          if (Math.abs(errCm) > 150) {
            arena.setTargetZoneState('violation');
            this.deduct('hill_stop_err', 100, `前保险杠距定点线偏差 ${Math.abs(errCm)}cm (>150cm)`, true);
            return;
          } else if (Math.abs(errCm) > 50) {
            this.deduct('hill_stop_warn', 10, `定点停车前后偏差 ${Math.abs(errCm)}cm (>50cm)`);
          }

          if (marginCm > 55) {
            arena.setTargetZoneState('violation');
            this.deduct('hill_margin', 100, `右侧边距 ${marginCm}cm (>55cm)`, true);
            return;
          } else if (marginCm > 35) {
            this.deduct('hill_margin_warn', 10, `右侧边距 ${marginCm}cm (35~55cm)`);
          }

          arena.setTargetZoneState('aligned');
          this.setStep(
            2,
            '定点停稳！请拉紧手刹 [Space]，再半联动平稳起步防后溜通过坡顶',
            '定点合格，请平稳起步，防止后溜'
          );
        }
      } else {
        this.holdTimerSec = 0;
      }
    } else {
      this.hillMinZAfterStop = Math.min(this.hillMinZAfterStop, frontZ);
      const rollbackCm = Math.round((this.hillStopPeakZ - this.hillMinZAfterStop) * 100);
      if (rollbackCm > 30) {
        arena.setTargetZoneState('violation');
        this.deduct('hill_rollback_fatal', 100, `坡道起步后溜 ${rollbackCm}cm (>30cm)`, true);
        return;
      } else if (rollbackCm > 10) {
        this.deduct('hill_rollback', 10, `坡道起步轻微后溜 ${rollbackCm}cm (10~30cm)`, false, 99);
      }

      if (frontZ >= L.finishZ) {
        this.passExam();
      }
    }

    this.metrics = [
      {
        label: '定点偏差',
        value: `${errCm >= 0 ? '+' : ''}${errCm} cm`,
        status: Math.abs(errCm) <= 50 ? 'ok' : Math.abs(errCm) <= 150 ? 'warn' : 'bad',
      },
      {
        label: '右侧边距',
        value: `${marginCm} cm`,
        status: marginCm <= 35 ? 'ok' : marginCm <= 55 ? 'warn' : 'bad',
      },
      {
        label: '后溜距离',
        value: this.hillStopped
          ? `${Math.max(0, Math.round((this.hillStopPeakZ - this.hillMinZAfterStop) * 100))} cm`
          : '未定点',
        status:
          !this.hillStopped
            ? 'warn'
            : this.hillStopPeakZ - this.hillMinZAfterStop > 0.1
            ? 'bad'
            : 'ok',
      },
    ];
  }

  private stepParallelPark(
    dtSec: number,
    physics: TruckPhysics,
    arena: BuiltExamArena,
    absKmh: number,
    hitchDeg: number,
    fp: ReturnType<TruckPhysics['getVehicleFootprint']>,
    allCorners: Point2D[],
    allWheels: Point2D[]
  ): void {
    const L = A2_LAYOUT.parallelPark;

    // Outer boundary checks
    for (const p of [...allCorners, ...allWheels]) {
      if (p.x > L.laneMaxX + 0.05) {
        arena.setTargetZoneState('violation');
        this.deduct('para_left', 100, '车轮压主车道左侧黄线', true);
        return;
      }
      if (p.x < L.bayMinX - 0.05) {
        arena.setTargetZoneState('violation');
        this.deduct('para_bay_back', 100, '车身越出侧方库底边线', true);
        return;
      }
      if (p.z < L.bayMinZ && p.x < L.laneMinX - 0.04) {
        arena.setTargetZoneState('violation');
        this.deduct('para_before_bay', 100, '压侧方库前边线', true);
        return;
      }
      if (p.z > L.bayMaxZ && p.x < L.laneMinX - 0.04) {
        arena.setTargetZoneState('violation');
        this.deduct('para_after_bay', 100, '压侧方库后边线', true);
        return;
      }
    }

    if (this.parallelStage === 'forward') {
      if (fp.trailerRearCenter.z >= L.passBayRearZ) {
        this.parallelStage = 'reverse';
        this.setStep(1, '第 2 步：挂倒档 (R) 将整车平稳倒入右侧侧方车位并停稳', '请倒车入库');
      }
    } else if (this.parallelStage === 'reverse') {
      const inBay = allCorners.every(
        (c) => c.x >= L.bayMinX && c.x <= L.bayMaxX && c.z >= L.bayMinZ && c.z <= L.bayMaxZ
      );
      const yawDeg = Math.abs((physics.yaw * 180) / Math.PI);
      if (inBay && yawDeg <= 12 && hitchDeg <= 10) {
        arena.setTargetZoneState('aligned');
        if (absKmh < 1.0) {
          this.holdTimerSec += dtSec;
          if (this.holdTimerSec >= 1.0) {
            this.parallelStage = 'exit';
            this.holdTimerSec = 0;
            this.setStep(2, '第 3 步：入库停稳！请开左转向灯 [Q] 安全驶出考区', '入库成功，请打左转向灯出库');
          }
        } else {
          this.holdTimerSec = 0;
        }
      } else {
        arena.setTargetZoneState('idle');
        this.holdTimerSec = 0;
        this.checkMidStop(true, absKmh, dtSec);
      }
    } else {
      // Exit stage
      if (fp.tractorCorners[0]!.x > L.bayMaxX + 0.3 && !physics.leftBlinker) {
        this.deduct('para_blinker', 10, '侧方出库未提前开启左转向灯', false, 20);
      }
      if (fp.trailerRearCenter.z >= L.finishZ) {
        this.passExam();
      }
    }

    const inBayCount = allCorners.filter(
      (c) => c.x >= L.bayMinX && c.x <= L.bayMaxX && c.z >= L.bayMinZ && c.z <= L.bayMaxZ
    ).length;

    this.metrics = [
      {
        label: '当前阶段',
        value:
          this.parallelStage === 'forward'
            ? '向前拉直'
            : this.parallelStage === 'reverse'
            ? '倒车入库'
            : '打灯出库',
        status: 'ok',
      },
      {
        label: '入库角点',
        value: `${inBayCount}/8`,
        status: inBayCount === 8 ? 'ok' : 'warn',
      },
      {
        label: '铰接夹角',
        value: `${Math.round(hitchDeg)}°`,
        status: hitchDeg > 55 ? 'bad' : 'ok',
      },
    ];
  }

  private stepSingleBridge(
    dtSec: number,
    _physics: TruckPhysics,
    arena: BuiltExamArena,
    absKmh: number,
    fp: ReturnType<TruckPhysics['getVehicleFootprint']>,
    allWheels: Point2D[]
  ): void {
    const L = A2_LAYOUT.singleBridge;
    for (const w of allWheels) {
      if (w.x < L.minX - 0.05 || w.x > L.maxX + 0.05) {
        arena.setTargetZoneState('violation');
        this.deduct('bridge_lane', 100, '车轮压单边桥考道边线', true);
        return;
      }
    }

    const checkAxle = (id: string, wx: number, wz: number, startZ: number, endZ: number, cx: number) => {
      if (wz >= startZ + 1.0 && wz <= endZ - 1.0) {
        if (Math.abs(wx - cx) > L.bridgeWidth * 0.56) {
          if (!this.bridgeMissedAxles.has(id)) {
            this.bridgeMissedAxles.add(id);
            this.deduct(`bridge_${id}`, 10, `车轴未上桥或掉桥 (${id.includes('left') ? '左桥' : '右桥'})`);
          }
        }
      }
    };

    // Left bridge checks
    checkAxle('left_front', fp.tractorWheels.fl.x, fp.tractorWheels.fl.z, L.leftStartZ, L.leftEndZ, L.leftCenterX);
    checkAxle('left_rear', fp.tractorWheels.rl.x, fp.tractorWheels.rl.z, L.leftStartZ, L.leftEndZ, L.leftCenterX);
    checkAxle('left_trailer', fp.trailerAxleWheels[2]!.x, fp.trailerAxleWheels[2]!.z, L.leftStartZ, L.leftEndZ, L.leftCenterX);

    // Right bridge checks
    checkAxle('right_front', fp.tractorWheels.fr.x, fp.tractorWheels.fr.z, L.rightStartZ, L.rightEndZ, L.rightCenterX);
    checkAxle('right_rear', fp.tractorWheels.rr.x, fp.tractorWheels.rr.z, L.rightStartZ, L.rightEndZ, L.rightCenterX);
    checkAxle('right_trailer', fp.trailerAxleWheels[3]!.x, fp.trailerAxleWheels[3]!.z, L.rightStartZ, L.rightEndZ, L.rightCenterX);

    if (fp.trailerRearCenter.z > L.leftEndZ + 1) {
      this.setStep(1, '第 2 步：准备对齐右侧单边桥，保持直线平滑通过');
    }
    if (fp.frontBumperCenter.z >= L.finishZ - 5) {
      this.setStep(2, '即将到达终点线，保持稳定驶出');
    }
    if (fp.trailerRearCenter.z >= L.finishZ) {
      this.passExam();
      return;
    }

    this.checkMidStop(true, absKmh, dtSec);
    const leftOffsetCm = Math.round((fp.tractorWheels.fl.x - L.leftCenterX) * 100);
    const rightOffsetCm = Math.round((fp.tractorWheels.fr.x - L.rightCenterX) * 100);

    this.metrics = [
      {
        label: '左轮距左桥',
        value: `${leftOffsetCm >= 0 ? '+' : ''}${leftOffsetCm} cm`,
        status: Math.abs(leftOffsetCm) <= 28 ? 'ok' : 'warn',
      },
      {
        label: '右轮距右桥',
        value: `${rightOffsetCm >= 0 ? '+' : ''}${rightOffsetCm} cm`,
        status: Math.abs(rightOffsetCm) <= 28 ? 'ok' : 'warn',
      },
      {
        label: '掉桥次数',
        value: `${this.bridgeMissedAxles.size} 次`,
        status: this.bridgeMissedAxles.size === 0 ? 'ok' : 'bad',
      },
    ];
  }

  private stepSCurve(
    dtSec: number,
    _physics: TruckPhysics,
    arena: BuiltExamArena,
    absKmh: number,
    hitchDeg: number,
    fp: ReturnType<TruckPhysics['getVehicleFootprint']>,
    allWheels: Point2D[]
  ): void {
    const poly = getSCurveCenterline();
    const hw = A2_LAYOUT.sCurve.halfWidth;
    let worstMarginM = 99;
    let progressS = 0;

    const minDistToCurve = (p: Point2D): { dist: number; s: number } => {
      let bestSq = Infinity;
      let bestS = 0;
      for (let i = 0; i < poly.length; i++) {
        const pt = poly[i]!;
        const dSq = (p.x - pt.x) ** 2 + (p.z - pt.z) ** 2;
        if (dSq < bestSq) {
          bestSq = dSq;
          bestS = pt.s;
        }
      }
      return { dist: Math.sqrt(bestSq), s: bestS };
    };

    for (const w of allWheels) {
      const res = minDistToCurve(w);
      const margin = hw - res.dist;
      worstMarginM = Math.min(worstMarginM, margin);
      if (res.dist > hw - 0.04) {
        arena.setTargetZoneState('violation');
        this.deduct('scurve_line', 100, '车轮压 S 弯黄色边线', true);
        return;
      }
    }

    const rearRes = minDistToCurve(fp.trailerRearCenter);
    progressS = rearRes.s;
    const totalLen = poly[poly.length - 1]!.s;
    const pct = Math.min(100, Math.round((progressS / totalLen) * 100));

    if (pct >= 50) {
      this.setStep(1, '进入后半段右弯，注意观察后视镜中挂车内侧边缘！');
    }
    if (pct >= 94) {
      arena.setTargetZoneState('aligned');
      this.passExam();
      return;
    }

    this.checkMidStop(true, absKmh, dtSec);
    this.metrics = [
      {
        label: '最小边距',
        value: `${Math.max(0, Math.round(worstMarginM * 100))} cm`,
        status: worstMarginM > 0.5 ? 'ok' : worstMarginM > 0.2 ? 'warn' : 'bad',
      },
      {
        label: '铰接夹角',
        value: `${Math.round(hitchDeg)}°`,
        status: hitchDeg > 50 ? 'warn' : 'ok',
      },
      {
        label: '弯道进度',
        value: `${pct}%`,
        status: 'ok',
      },
    ];
  }

  private stepRightAngleGates(
    dtSec: number,
    physics: TruckPhysics,
    arena: BuiltExamArena,
    absKmh: number,
    fp: ReturnType<TruckPhysics['getVehicleFootprint']>,
    allCorners: Point2D[],
    allWheels: Point2D[]
  ): void {
    const L = A2_LAYOUT.rightAngleGates;
    const hw = L.legHalfW;

    if (physics.leftBlinker && physics.z < L.cornerOuterZ) {
      this.angleLeftBlinkerSeen = true;
    }
    if (physics.x > 2.2 && !this.angleLeftBlinkerSeen) {
      this.deduct('angle_blinker', 10, '直角转弯前未开启左转向灯', false, 60);
    }

    // L-shaped lane boundary check
    for (const p of [...allCorners, ...allWheels]) {
      const inEntry = p.x >= -hw - 0.05 && p.x <= hw + 0.05 && p.z <= L.cornerOuterZ + 0.05;
      const inExit = p.x >= -hw - 0.05 && p.z >= L.cornerInnerZ - 0.05 && p.z <= L.cornerOuterZ + 0.05;
      if (!inEntry && !inExit) {
        arena.setTargetZoneState('violation');
        this.deduct('angle_line', 100, '车身或车轮压直角转弯边线', true);
        return;
      }
    }

    // Check 3 width-limited gates
    const halfGap = L.gateGapWidth * 0.5;
    let passedGates = 0;
    for (const g of L.gates) {
      if (fp.trailerRearCenter.x > g.x + 0.5) passedGates += 1;
      for (const c of allCorners) {
        if (Math.abs(c.x - g.x) < 0.45) {
          if (c.z < g.centerZ - halfGap + 0.05 || c.z > g.centerZ + halfGap - 0.05) {
            arena.setTargetZoneState('violation');
            this.deduct('gate_hit', 100, '车身碰撞限宽门标杆', true);
            return;
          }
        }
      }
    }

    if (fp.frontBumperCenter.x > 16) {
      this.setStep(1, `第 2 步：对准门心依次平稳穿过三座限宽门 (已过 ${passedGates}/3)`);
    }
    if (fp.trailerRearCenter.x >= L.finishX) {
      arena.setTargetZoneState('aligned');
      this.passExam();
      return;
    }

    this.checkMidStop(true, absKmh, dtSec);
    this.metrics = [
      {
        label: '直角转向灯',
        value: this.angleLeftBlinkerSeen ? '已规范开启' : '请打左灯[Q]',
        status: this.angleLeftBlinkerSeen ? 'ok' : 'warn',
      },
      {
        label: '通过限宽门',
        value: `${passedGates} / 3`,
        status: 'ok',
      },
      {
        label: '车速',
        value: `${Math.round(absKmh)} km/h`,
        status: absKmh > 25 ? 'warn' : 'ok',
      },
    ];
  }

  private stepMountainHazard(
    dtSec: number,
    physics: TruckPhysics,
    input: InputManager,
    arena: BuiltExamArena,
    wipersMode: WipersMode,
    absKmh: number,
    fp: ReturnType<TruckPhysics['getVehicleFootprint']>
  ): void {
    const L = A2_LAYOUT.mountainHazard;
    const cx = mountainCenterX(physics.z);
    if (Math.abs(physics.x - cx) > L.halfW - 0.85) {
      arena.setTargetZoneState('violation');
      this.deduct('mountain_edge', 100, '车辆偏离山区道路边界', true);
      return;
    }

    if (input.horn) {
      this.mountainHornHeard = true;
    }

    // Tunnel check
    if (physics.z >= L.tunnelStartZ && physics.z <= L.tunnelEndZ) {
      if (!this.mountainTunnelHeadlightChecked && physics.z >= L.tunnelStartZ + 8) {
        this.mountainTunnelHeadlightChecked = true;
        if (physics.headlightMode === 0) {
          this.deduct('tunnel_lights', 10, '进入隧道未开启近光灯 [L]', false, 99);
        }
        if (!this.mountainHornHeard) {
          this.deduct('tunnel_horn', 10, '进入隧道前未鸣笛示警 [H]', false, 99);
        }
      }
      if (absKmh > 44) {
        this.deduct('tunnel_speed', 10, '隧道内超速 (>40 km/h)', false, 8);
      }
    }

    // 8% Mountain Downgrade
    if (physics.z > L.downgradeStartZ && physics.z < L.downgradeEndZ) {
      this.setStep(
        1,
        '第 2 步：8% 长下坡！严禁空挡滑行，请用缓速器 [B] 与排气制动 [J] 控速',
        this.currentStepIndex === 0 ? '进入长下坡路段，请使用缓速器和排气制动控速，严禁空挡滑行' : undefined
      );
      if (physics.gear === 0 && absKmh > 12) {
        this.mountainNeutralSec += dtSec;
        if (this.mountainNeutralSec > 0.8) {
          this.deduct('neutral_coast', 100, '山区长下坡空挡滑行', true);
          return;
        }
      } else {
        this.mountainNeutralSec = 0;
      }

      if (physics.brakeTempC > 320) {
        this.deduct('brake_overheat', 10, '连续踩刹车导致制动热衰减过热 (>320°C)', false, 18);
      }
    }

    // Rainy Slippery Zone + Emergency Barricade
    if (physics.z >= L.rainStartZ) {
      this.queuedFeedback.forcedRainIntensity = 0.85;
      if (!this.mountainBarricadeTriggered && physics.z >= L.triggerZ) {
        this.mountainBarricadeTriggered = true;
        arena.setHazardBarricadeVisible(true);
        this.setStep(
          2,
          '紧急险情！前方出现障碍路障，请立即制动停在黄框内并开启双闪 [X]！',
          '前方突发障碍物，请紧急制动并开启双闪警示灯'
        );
      } else if (!this.mountainBarricadeTriggered) {
        this.setStep(2, '第 3 步：进入雨雾湿滑路段，请开启雨刷 [P] 并保持安全车速');
      }

      if (physics.z > L.rainStartZ + 18 && wipersMode === 0) {
        this.deduct('rain_wipers', 10, '雨雾湿滑路段未开启雨刮器 [P]', false, 20);
      }

      if (this.mountainBarricadeTriggered) {
        if (fp.frontBumperCenter.z >= L.barricadeZ - 0.5) {
          arena.setTargetZoneState('violation');
          this.deduct('barricade_hit', 100, '未及时制动撞击前方障碍物', true);
          return;
        }

        const inStopBox = fp.frontBumperCenter.z >= L.stopMinZ && fp.frontBumperCenter.z <= L.stopMaxZ + 2.5;
        if (inStopBox && absKmh < 1.0 && physics.hazardLights) {
          arena.setTargetZoneState('aligned');
          this.holdTimerSec += dtSec;
          if (this.holdTimerSec >= 1.2) {
            this.passExam();
            return;
          }
        } else {
          this.holdTimerSec = 0;
        }
      }
    }

    this.metrics = [
      {
        label: '制动温度',
        value: `${Math.round(physics.brakeTempC)}°C`,
        status: physics.brakeTempC > 300 ? 'bad' : physics.brakeTempC > 220 ? 'warn' : 'ok',
      },
      {
        label: '辅助制动',
        value: `R${physics.retarderLevel}${physics.exhaustBrakeActive ? '+排气' : ''}`,
        status: physics.retarderLevel > 0 || physics.exhaustBrakeActive ? 'ok' : 'warn',
      },
      {
        label: '险情处置',
        value: !this.mountainBarricadeTriggered
          ? '保持警惕'
          : physics.hazardLights
          ? `双闪已开 (${this.holdTimerSec.toFixed(1)}s)`
          : '请开双闪[X]',
        status:
          !this.mountainBarricadeTriggered || physics.hazardLights ? 'ok' : 'bad',
      },
    ];
  }

  private stepSubject3(
    dtSec: number,
    physics: TruckPhysics,
    input: InputManager,
    arena: BuiltExamArena,
    absKmh: number,
    fp: ReturnType<TruckPhysics['getVehicleFootprint']>
  ): void {
    const L = A2_LAYOUT.subject3;

    // Traffic signal cycling (predictable cycle)
    this.s3SignalClock += dtSec;
    const cyc = this.s3SignalClock % 18;
    this.s3SignalState = cyc < 8 ? 'green' : cyc < 10.5 ? 'amber' : 'red';
    arena.setTrafficSignal(this.s3SignalState);

    // Road boundary check
    if (fp.tractorWheels.fr.x < L.curbX - 0.04 || fp.trailerAxleWheels[1]!.x < L.curbX - 0.04) {
      arena.setTargetZoneState('violation');
      this.deduct('s3_curb', 100, '压右侧路缘石', true);
      return;
    }
    if (fp.tractorWheels.fl.x > 0.15) {
      arena.setTargetZoneState('violation');
      this.deduct('s3_center_yellow', 100, '越过道路中心双黄实线逆行', true);
      return;
    }

    // Step 0: Starting procedure
    if (physics.z < L.laneChangeTriggerZ) {
      if (physics.leftBlinker) this.s3StartBlinkerSec += dtSec;
      if (input.horn) this.s3StartHornHeard = true;
      if (!this.s3StartChecked && physics.z >= 18) {
        this.s3StartChecked = true;
        if (this.s3StartBlinkerSec < 1.5) {
          this.deduct('s3_start_blink', 10, '起步前左转向灯未开满 2 秒');
        }
        if (!this.s3StartHornHeard) {
          this.deduct('s3_start_horn', 10, '重型货车起步未鸣笛示意 [H]');
        }
      }
    }

    // Step 1: Lane Change
    if (physics.z >= L.laneChangeTriggerZ && physics.z < L.laneChangeEndZ + 10) {
      this.setStep(
        1,
        '第 2 步 (变更车道)：开左转向灯 [Q] ≥2秒，平稳变道至左侧内车道',
        this.currentStepIndex === 0 ? '前方请变更车道' : undefined
      );
      if (physics.leftBlinker) this.s3LaneBlinkerSec += dtSec;
      if (!this.s3LaneCrossChecked && physics.x > -3.75) {
        this.s3LaneCrossChecked = true;
        if (this.s3LaneBlinkerSec < 1.5) {
          this.deduct('s3_lane_blink', 10, '变道前开启转向灯不足 2 秒');
        }
      }
      if (physics.z >= L.laneChangeEndZ && physics.x < -3.85) {
        this.deduct('s3_lane_miss', 100, '未在规定路段完成变更车道', true);
        return;
      }
    }

    // Step 2: Signal & School Zone
    if (physics.z >= L.laneChangeEndZ + 10 && physics.z < L.gearZoneStartZ) {
      this.setStep(
        2,
        '第 3 步 (路口与学校区)：遵守红绿灯，通过学校斑马线车速必须 ≤30 km/h',
        this.currentStepIndex === 1 ? '前方路口及学校区域，注意信号灯并减速至30以下' : undefined
      );
      if (!this.s3RedLightChecked && fp.frontBumperCenter.z >= L.signalLineZ) {
        this.s3RedLightChecked = true;
        if (this.s3SignalState === 'red') {
          arena.setTargetZoneState('violation');
          this.deduct('s3_redlight', 100, '路口闯红灯', true);
          return;
        }
      }
      if (physics.z >= L.schoolStartZ && physics.z <= L.schoolEndZ && absKmh > 32) {
        this.deduct('s3_school_speed', 100, `通过学校斑马线超速 (${Math.round(absKmh)} km/h > 30)`, true);
        return;
      }
    }

    // Step 3: Gear shifting speed test
    if (physics.z >= L.gearZoneStartZ && physics.z < L.pulloverStartZ) {
      this.setStep(
        3,
        '第 4 步 (加减挡操作)：加速至 ≥45 km/h 后平稳减速至 ≤25 km/h',
        this.currentStepIndex === 2 ? '请完成加减挡操作，先提速至45以上再减速至25以下' : undefined
      );
      if (absKmh >= 45) this.s3Reached45 = true;
      if (this.s3Reached45 && absKmh <= 25) this.s3ReachedBelow25 = true;
      if (!this.s3GearChecked && physics.z >= L.gearZoneEndZ) {
        this.s3GearChecked = true;
        if (!this.s3Reached45 || !this.s3ReachedBelow25) {
          this.deduct('s3_gear', 10, '未按指令完成加减挡提速与降速操作');
        }
      }
    }

    // Step 4: Curbside Pull-Over
    if (physics.z >= L.pulloverStartZ) {
      this.setStep(
        4,
        '第 5 步 (靠边停车)：打右灯 [E] ≥2秒，靠右侧边线 ≤35cm 停稳，拉手刹开双闪 [X]',
        this.currentStepIndex === 3 ? '前方请靠边停车，靠右侧路缘35厘米以内停稳' : undefined
      );
      if (physics.rightBlinker) this.s3PulloverBlinkerSec += dtSec;
      if (!this.s3PulloverBlinkerChecked && physics.x < -4.2) {
        this.s3PulloverBlinkerChecked = true;
        if (this.s3PulloverBlinkerSec < 1.5) {
          this.deduct('s3_pullover_blink', 10, '靠边停车前右转向灯不足 2 秒');
        }
      }

      if (physics.z > L.pulloverFinishZ + 10) {
        this.deduct('s3_pullover_miss', 100, '驶过靠边停车考区未完成停车', true);
        return;
      }

      const minRightEdge = Math.min(fp.tractorRightEdgeFront.x, fp.tractorRightEdgeRear.x, fp.trailerRightEdgeRear.x);
      const curbMarginCm = Math.round((minRightEdge - L.curbX) * 100);

      if (absKmh < 0.8 && physics.z >= L.pulloverStartZ + 10) {
        if (!this.s3PulloverScoreChecked) {
          this.s3PulloverScoreChecked = true;
          if (curbMarginCm > 55) {
            arena.setTargetZoneState('violation');
            this.deduct('s3_curb_far', 100, `靠边停车边距 ${curbMarginCm}cm (>55cm)`, true);
            return;
          } else if (curbMarginCm > 35) {
            this.deduct('s3_curb_warn', 10, `靠边停车边距 ${curbMarginCm}cm (35~55cm)`);
          }
        }

        if (physics.parkingBrake && physics.hazardLights) {
          arena.setTargetZoneState('aligned');
          this.holdTimerSec += dtSec;
          if (this.holdTimerSec >= 0.9) {
            this.passExam(`恭喜您通过 A2 科目三道路考试，成绩 ${this.score} 分！`);
            return;
          }
        }
      }
    }

    const minRightEdge = Math.min(fp.tractorRightEdgeFront.x, fp.tractorRightEdgeRear.x, fp.trailerRightEdgeRear.x);
    const curbMarginCm = Math.round((minRightEdge - L.curbX) * 100);

    this.metrics = [
      {
        label: '前方信号灯',
        value:
          physics.z < L.signalLineZ + 5
            ? this.s3SignalState === 'green'
              ? '绿灯通行'
              : this.s3SignalState === 'amber'
              ? '黄灯注意'
              : '红灯禁行'
            : '已通过',
        status: this.s3SignalState === 'red' && physics.z < L.signalLineZ ? 'bad' : 'ok',
      },
      {
        label: '加减挡',
        value: this.s3ReachedBelow25 ? '已完成' : this.s3Reached45 ? '已提速待降' : '待≥45km/h',
        status: this.s3ReachedBelow25 ? 'ok' : 'warn',
      },
      {
        label: '右侧边距',
        value: `${curbMarginCm} cm`,
        status: curbMarginCm <= 35 ? 'ok' : curbMarginCm <= 55 ? 'warn' : 'bad',
      },
    ];
  }
}
