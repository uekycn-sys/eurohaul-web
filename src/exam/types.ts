export type A2ExamLevelId =
  | 'reverse_bay'
  | 'hill_start'
  | 'parallel_park'
  | 'single_bridge'
  | 's_curve'
  | 'right_angle_gates'
  | 'mountain_hazard'
  | 'subject3_road';

export type A2ExamPhase = 'briefing' | 'running' | 'passed' | 'failed';

export interface A2DeductionRecord {
  id: string;
  timestampSec: number;
  points: number;
  reason: string;
  fatal?: boolean;
}

export interface A2ExamLiveMetric {
  label: string;
  value: string;
  status: 'ok' | 'warn' | 'bad';
}

export interface A2ExamStateSnapshot {
  levelId: A2ExamLevelId;
  title: string;
  subjectLabel: string;
  phase: A2ExamPhase;
  score: number;
  passingScore: number;
  elapsedSec: number;
  timeLimitSec: number;
  currentStepIndex: number;
  totalSteps: number;
  instruction: string;
  coachTip: string;
  metrics: A2ExamLiveMetric[];
  deductions: A2DeductionRecord[];
  strictCamera: boolean;
  failReason?: string;
}

export interface A2LevelBestRecord {
  passed: boolean;
  bestScore: number;
  bestTimeSec: number | null;
  attempts: number;
}

export interface A2ExamLevelDef {
  id: A2ExamLevelId;
  order: number;
  subjectLabel: string;
  title: string;
  subtitle: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  timeLimitSec: number;
  passingScore: number;
  spawnPosition: readonly [number, number, number];
  spawnHeadingRad: number;
  trailerAttached: boolean;
  description: string;
  rulesSummary: string[];
  coachTip: string;
}
