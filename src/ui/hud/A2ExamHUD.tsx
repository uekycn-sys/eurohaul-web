import { memo } from 'react';
import {
  AlertTriangle,
  Award,
  CheckCircle2,
  Clock,
  Eye,
  Play,
  RotateCcw,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { A2_EXAM_LEVELS, getA2ExamLevel } from '../../exam/A2ExamCatalog';
import { A2ExamLevelId } from '../../exam/types';
import { useGameStore } from '../../store/useGameStore';

interface A2ExamHUDProps {
  onBeginExam: () => void;
  onRestartExam: () => void;
  onSelectExamLevel: (levelId: A2ExamLevelId) => void;
  onExitExamToCareer: () => void;
}

function formatTimer(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, '0')}`;
}

export const A2ExamHUD = memo(function A2ExamHUD({
  onBeginExam,
  onRestartExam,
  onSelectExamLevel,
  onExitExamToCareer,
}: A2ExamHUDProps) {
  const gameMode = useGameStore((s) => s.gameMode);
  const activeModal = useGameStore((s) => s.activeModal);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const examState = useGameStore((s) => s.a2ExamState);
  const a2ExamProgress = useGameStore((s) => s.a2ExamProgress);
  const examStrictCamera = useGameStore((s) => s.examStrictCamera);
  const setExamStrictCamera = useGameStore((s) => s.setExamStrictCamera);

  if (gameMode !== 'a2_exam' || !examState) return null;

  const def = getA2ExamLevel(examState.levelId);
  const remainSec = Math.max(0, examState.timeLimitSec - examState.elapsedSec);
  const nextLevel = A2_EXAM_LEVELS.find((l) => l.order === def.order + 1) ?? null;

  return (
    <>
      {/* Top-Center Live Exam Telemetry Bar */}
      {activeModal === 'none' && (
        <div className="pointer-events-none fixed top-14 left-1/2 z-20 w-[min(94vw,660px)] -translate-x-1/2">
          <div className="pointer-events-auto rounded-2xl border border-slate-700/85 bg-slate-950/90 px-4 py-2.5 shadow-2xl backdrop-blur-md">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-amber-500/20 px-2 py-0.5 text-[11px] font-bold text-amber-300">
                  {examState.subjectLabel}
                </span>
                <span className="text-sm font-bold text-white">{examState.title}</span>
                <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
                  阶段 {Math.min(examState.totalSteps, examState.currentStepIndex + 1)}/{examState.totalSteps}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1 font-mono text-xs text-sky-300">
                  <Clock className="h-3.5 w-3.5" />
                  {formatTimer(remainSec)}
                </span>
                <div
                  className={`rounded-lg px-2.5 py-0.5 font-mono text-sm font-black ${
                    examState.score === 100
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : examState.score >= examState.passingScore
                      ? 'bg-amber-500/20 text-amber-300'
                      : 'bg-rose-500/25 text-rose-300'
                  }`}
                >
                  {examState.score} 分
                </div>
              </div>
            </div>

            <div className="mt-1.5 rounded-lg border border-sky-500/25 bg-sky-950/40 px-2.5 py-1.5 text-xs font-medium text-sky-200">
              {examState.instruction}
            </div>

            {examState.metrics.length > 0 && (
              <div className="mt-2 grid grid-cols-3 gap-2">
                {examState.metrics.map((m) => (
                  <div
                    key={m.label}
                    className={`flex items-center justify-between rounded-lg border px-2 py-1 text-[11px] ${
                      m.status === 'ok'
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                        : m.status === 'warn'
                        ? 'border-amber-500/35 bg-amber-500/10 text-amber-200'
                        : 'border-rose-500/45 bg-rose-500/15 text-rose-200'
                    }`}
                  >
                    <span className="opacity-80">{m.label}</span>
                    <span className="font-mono font-bold">{m.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Live Deduction Ticker */}
      {examState.deductions.length > 0 && examState.phase === 'running' && activeModal === 'none' && (
        <div className="pointer-events-none fixed top-44 right-3 z-20 flex w-64 flex-col gap-1.5">
          {examState.deductions.slice(0, 4).map((d) => (
            <div
              key={d.id}
              className="rounded-xl border border-rose-500/60 bg-rose-950/90 px-3 py-1.5 text-[11px] text-rose-100 shadow-lg backdrop-blur-md"
            >
              <div className="flex items-center justify-between font-bold text-rose-300">
                <span>扣 {d.points} 分</span>
                <span className="font-mono text-[10px] opacity-75">{d.timestampSec.toFixed(1)}s</span>
              </div>
              <div className="mt-0.5">{d.reason}</div>
            </div>
          ))}
        </div>
      )}

      {/* Pre-Exam Briefing Modal */}
      {examState.phase === 'briefing' && activeModal === 'none' && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-amber-500/40 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <span className="rounded-full bg-amber-500/15 px-3 py-0.5 text-xs font-bold text-amber-300">
                中国 A2 重型牵引挂车考场 · {examState.subjectLabel}
              </span>
              <span className="font-mono text-xs text-slate-400">
                限时 {Math.round(examState.timeLimitSec / 60)} 分钟 · 90分合格
              </span>
            </div>

            <h2 className="mt-3 text-2xl font-extrabold text-white">{def.title}</h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-300">{def.description}</p>

            <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/65 p-3.5">
              <div className="flex items-center gap-1.5 text-xs font-bold text-rose-300">
                <ShieldAlert className="h-4 w-4" />
                GA/T 1028 评判标准
              </div>
              <ul className="mt-2 space-y-1 text-xs text-slate-300">
                {def.rulesSummary.map((r) => (
                  <li key={r} className="flex items-start gap-1.5">
                    <span className="text-amber-400">•</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-3 rounded-xl border border-sky-500/30 bg-sky-950/35 p-3 text-xs leading-relaxed text-sky-200">
              <b className="text-sky-300">教练实操提示：</b>
              {def.coachTip}
            </div>

            <div className="mt-4 flex items-center justify-between rounded-xl border border-slate-800 bg-slate-800/40 px-3 py-2 text-xs">
              <span className="flex items-center gap-1.5 text-slate-200">
                <Eye className="h-4 w-4 text-amber-400" />
                严格考场视角 (禁用俯视/环绕上帝视角)
              </span>
              <button
                type="button"
                onClick={() => setExamStrictCamera(!examStrictCamera)}
                className={`rounded-lg px-2.5 py-1 font-semibold ${
                  examStrictCamera ? 'bg-amber-500 text-slate-950' : 'bg-slate-700 text-slate-300'
                }`}
              >
                {examStrictCamera ? '已开启' : '自由视角'}
              </button>
            </div>

            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={onBeginExam}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-amber-500 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-amber-500/20 hover:bg-amber-400"
              >
                <Play className="h-4 w-4 fill-current" />
                开始考试 [Enter]
              </button>
              <button
                type="button"
                onClick={() => setActiveModal('exam_select')}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-xs font-semibold text-slate-200 hover:bg-slate-700"
              >
                切换项目
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Official Transcript Modal (Pass / Fail) */}
      {(examState.phase === 'passed' || examState.phase === 'failed') && activeModal === 'none' && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
          <div
            className={`w-full max-w-md rounded-2xl border p-6 shadow-2xl ${
              examState.phase === 'passed'
                ? 'border-emerald-500/50 bg-slate-900'
                : 'border-rose-500/50 bg-slate-900'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {examState.phase === 'passed' ? (
                  <CheckCircle2 className="h-9 w-9 text-emerald-400" />
                ) : (
                  <XCircle className="h-9 w-9 text-rose-400" />
                )}
                <div>
                  <h2 className="text-xl font-black text-white">
                    {examState.phase === 'passed' ? '考试合格！' : '考试不合格'}
                  </h2>
                  <p className="text-xs text-slate-400">
                    {examState.subjectLabel} · {examState.title}
                  </p>
                </div>
              </div>
              <div
                className={`rounded-xl border px-3 py-1.5 font-mono text-2xl font-black ${
                  examState.phase === 'passed'
                    ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                    : 'border-rose-500/40 bg-rose-500/15 text-rose-300'
                }`}
              >
                {examState.score}
              </div>
            </div>

            {examState.failReason && (
              <div className="mt-4 flex items-center gap-2 rounded-xl border border-rose-500/40 bg-rose-950/60 px-3 py-2 text-xs text-rose-200">
                <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
                <span>不合格原因：{examState.failReason}</span>
              </div>
            )}

            <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/65 p-3 text-xs">
              <div className="flex justify-between text-slate-300">
                <span>用时</span>
                <span className="font-mono">{examState.elapsedSec.toFixed(1)} 秒</span>
              </div>
              <div className="mt-1 flex justify-between text-slate-300">
                <span>扣分项明细</span>
                <span className="font-mono">{examState.deductions.length} 项</span>
              </div>
              {examState.deductions.length > 0 && (
                <div className="mt-2 max-h-32 space-y-1 overflow-y-auto border-t border-slate-800 pt-2">
                  {examState.deductions.map((d) => (
                    <div key={d.id} className="flex justify-between text-[11px] text-rose-300">
                      <span className="truncate pr-2">{d.reason}</span>
                      <span className="shrink-0 font-mono">-{d.points}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={onRestartExam}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 py-2.5 text-xs font-bold text-white hover:bg-slate-700"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                重新考试 [Backspace]
              </button>

              {nextLevel ? (
                <button
                  type="button"
                  onClick={() => onSelectExamLevel(nextLevel.id)}
                  className="flex items-center justify-center gap-1.5 rounded-xl bg-amber-500 py-2.5 text-xs font-bold text-slate-950 hover:bg-amber-400"
                >
                  下一关: {nextLevel.title.slice(0, 6)}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setActiveModal('exam_select')}
                  className="flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500 py-2.5 text-xs font-bold text-slate-950 hover:bg-emerald-400"
                >
                  <Award className="h-3.5 w-3.5" />
                  全部考项总览
                </button>
              )}
            </div>

            <div className="mt-2.5 flex justify-between text-xs">
              <button
                type="button"
                onClick={() => setActiveModal('exam_select')}
                className="text-sky-300 hover:underline"
              >
                切换其他考项
              </button>
              <button
                type="button"
                onClick={onExitExamToCareer}
                className="text-slate-400 hover:text-white"
              >
                退出考场返回主菜单
              </button>
            </div>
          </div>
        </div>
      )}

      {/* In-Game Exam Level Select Modal */}
      {activeModal === 'exam_select' && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <div className="max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-white">中国 A2 重型牵引挂车驾考项目</h2>
                <p className="text-xs text-slate-400">科目二场地驾驶技能 (01~07) · 科目三道路驾驶技能 (08)</p>
              </div>
              <button
                type="button"
                onClick={() => setActiveModal('none')}
                className="rounded-lg bg-slate-800 px-3 py-1 text-xs text-slate-300 hover:text-white"
              >
                关闭
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {A2_EXAM_LEVELS.map((lvl) => {
                const rec = a2ExamProgress[lvl.id];
                const isCurrent = lvl.id === examState.levelId;
                return (
                  <button
                    key={lvl.id}
                    type="button"
                    onClick={() => onSelectExamLevel(lvl.id)}
                    className={`rounded-xl border p-3.5 text-left transition ${
                      isCurrent
                        ? 'border-amber-400 bg-amber-500/15'
                        : 'border-slate-700/80 bg-slate-800/50 hover:border-slate-500'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="rounded bg-slate-700/80 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                        {lvl.subjectLabel}
                      </span>
                      <span
                        className={`text-[11px] font-bold ${
                          rec?.passed ? 'text-emerald-400' : 'text-slate-400'
                        }`}
                      >
                        {rec?.passed ? `已合格 (${rec.bestScore}分)` : rec ? `最高 ${rec.bestScore}分` : '未挑战'}
                      </span>
                    </div>
                    <div className="mt-1.5 text-sm font-bold text-white">{lvl.title}</div>
                    <div className="mt-0.5 text-[11px] text-slate-400">{lvl.subtitle}</div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
});
