import { Eye, EyeOff, AlertTriangle } from 'lucide-react';
import { useGameStore } from '../store/useGameStore';

/**
 * Picture-in-picture side mirror bezels aligned with GameEngine's WebGL scissor passes.
 * Can be toggled off at any time to save GPU budget on low-spec hardware.
 */
export function VirtualMirrors() {
  const mirrorDisplayMode = useGameStore((s) => s.mirrorDisplayMode);
  const cycleMirrorDisplayMode = useGameStore((s) => s.cycleMirrorDisplayMode);
  const jackknifeWarning = useGameStore((s) => s.telemetry.jackknifeWarning);
  const hitchAngleDeg = useGameStore((s) => s.telemetry.hitchAngleDeg);
  const activeModal = useGameStore((s) => s.activeModal);

  if (activeModal !== 'none') return null;

  if (mirrorDisplayMode === 'off') {
    return (
      <button
        type="button"
        onClick={cycleMirrorDisplayMode}
        className="fixed top-[66px] left-[18px] z-20 hidden items-center gap-1.5 rounded-lg border border-slate-700/80 bg-slate-900/80 px-2.5 py-1.5 text-xs text-slate-300 backdrop-blur-md transition hover:border-amber-400/60 hover:text-white sm:inline-flex"
      >
        <Eye className="h-3.5 w-3.5 text-amber-400" />
        开启电子后视镜 [F2]
      </button>
    );
  }

  const showLeftMirror = mirrorDisplayMode === 'both';

  return (
    <div className="pointer-events-none fixed inset-0 z-10 hidden sm:block">
      {/* Left Mirror Bezel (aligned at left:18px, top:66px, 196x122 matching 16:10 RT) */}
      {showLeftMirror && (
        <div
          className={`fixed top-[66px] left-[18px] h-[122px] w-[196px] rounded-lg border-2 shadow-xl ${
            jackknifeWarning ? 'border-rose-500 animate-pulse' : 'border-slate-700/90'
          }`}
        >
          <div className="flex items-center justify-between bg-slate-950/70 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-slate-300">
            <span>左后视镜 (L)</span>
            <button
              type="button"
              onClick={cycleMirrorDisplayMode}
              className="pointer-events-auto flex items-center gap-1 text-slate-400 hover:text-white"
              title="切换后视镜模式 [F2] (双镜/仅右镜/关闭)"
            >
              <span className="text-[9px] text-amber-300/80">F2</span>
              <EyeOff className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}

      {/* Right Mirror Bezel (aligned at right:18px, top:66px, 196x122 matching 16:10 RT) */}
      <div
        className={`fixed top-[66px] right-[18px] h-[122px] w-[196px] rounded-lg border-2 shadow-xl ${
          jackknifeWarning ? 'border-rose-500 animate-pulse' : 'border-slate-700/90'
        }`}
      >
        <div className="flex items-center justify-between bg-slate-950/70 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-slate-300">
          <span>{showLeftMirror ? '右后视镜 (R)' : '右后视镜 · 单镜 (R)'}</span>
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[10px] text-amber-300">
              折角 {Math.abs(hitchAngleDeg)}°
            </span>
            {!showLeftMirror && (
              <button
                type="button"
                onClick={cycleMirrorDisplayMode}
                className="pointer-events-auto text-slate-400 hover:text-white"
                title="关闭电子后视镜 [F2]"
              >
                <EyeOff className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
        {jackknifeWarning && (
          <div className="absolute bottom-1 left-1 right-1 flex items-center justify-center gap-1 rounded bg-rose-600/85 px-1.5 py-0.5 text-[10px] font-bold text-white">
            <AlertTriangle className="h-3 w-3" />
            挂车折头预警
          </div>
        )}
      </div>
    </div>
  );
}
