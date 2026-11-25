import { memo } from 'react';
import {
  Map as MapIcon,
  Package,
  Wrench,
  Settings,
  LogOut,
} from 'lucide-react';
import {
  CameraMode,
  getDriverRankTitle,
  useGameStore,
} from '../../store/useGameStore';

interface TopStatusBarProps {
  onRefreshJobs: () => void;
}

function formatClock(hours: number): string {
  const totalMin = Math.floor((((hours % 24) + 24) % 24) * 60);
  const hh = String(Math.floor(totalMin / 60)).padStart(2, '0');
  const mm = String(totalMin % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

export const TopStatusBar = memo(function TopStatusBar({ onRefreshJobs }: TopStatusBarProps) {
  const moneyEur = useGameStore((s) => s.moneyEur);
  const level = useGameStore((s) => s.level);
  const showFps = useGameStore((s) => s.showFps);
  const showDrawCalls = useGameStore((s) => s.showDrawCalls);
  const cameraMode = useGameStore((s) => s.cameraMode);
  const setCameraMode = useGameStore((s) => s.setCameraMode);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const setGamePhase = useGameStore((s) => s.setGamePhase);

  const fps = useGameStore((s) => s.telemetry.fps);
  const drawCalls = useGameStore((s) => s.telemetry.drawCalls);
  const currentCityName = useGameStore((s) => s.telemetry.currentCityName);
  const timeOfDayHours = useGameStore((s) => s.telemetry.timeOfDayHours);

  return (
    <div
      className="pointer-events-none fixed top-0 left-0 right-0 z-20 flex items-center justify-between gap-2 bg-gradient-to-b from-slate-950/85 to-transparent py-2"
      style={{
        paddingTop: 'max(0.5rem, env(safe-area-inset-top, 0px))',
        paddingLeft: 'max(0.75rem, env(safe-area-inset-left, 0px))',
        paddingRight: 'max(0.75rem, env(safe-area-inset-right, 0px))',
      }}
    >
      <div className="pointer-events-auto flex min-w-0 items-center gap-2">
        <div className="flex items-center whitespace-nowrap rounded-xl border border-slate-700/80 bg-slate-900/85 px-2.5 py-1.5 text-xs backdrop-blur-md sm:px-3">
          <span className="font-mono font-bold text-emerald-400">€{moneyEur.toLocaleString()}</span>
          <span className="mx-1.5 text-slate-600">|</span>
          <span className="font-semibold text-amber-300" title={getDriverRankTitle(level)}>
            Lv.{level}
          </span>
          <span className="hidden text-[11px] text-slate-400 xl:inline">
            &nbsp;· {getDriverRankTitle(level)}
          </span>
          <span className="mx-1.5 hidden text-slate-600 sm:inline">|</span>
          <span className="hidden truncate text-slate-200 sm:inline">{currentCityName}</span>
          <span className="mx-1.5 hidden text-slate-600 md:inline">|</span>
          <span className="hidden font-mono text-sky-300 md:inline">
            {formatClock(timeOfDayHours)}
          </span>
          {(showFps || showDrawCalls) && (
            <>
              <span className="mx-1.5 hidden text-slate-600 sm:inline">|</span>
              <span className="hidden font-mono text-slate-300 sm:inline">
                {showFps ? `${fps} FPS` : ''}
                {showFps && showDrawCalls ? ' · ' : ''}
                {showDrawCalls ? `DC: ${drawCalls}` : ''}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="pointer-events-auto flex shrink-0 items-center gap-1.5">
        <div className="hidden items-center rounded-xl border border-slate-700/80 bg-slate-900/85 p-0.5 text-[11px] backdrop-blur-md xl:flex">
          {(
            [
              [1, '1 驾驶室'],
              [2, '2 追尾'],
              [3, '3 倒车'],
              [4, '4 环绕'],
            ] as [CameraMode, string][]
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              onClick={() => setCameraMode(m)}
              className={`rounded-lg px-2 py-1 font-medium transition ${
                cameraMode === m
                  ? 'bg-amber-500 text-slate-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setCameraMode(((cameraMode % 4) + 1) as CameraMode)}
          className="hidden shrink-0 items-center gap-1 whitespace-nowrap rounded-xl border border-slate-700/80 bg-slate-900/85 px-2.5 py-1.5 text-xs font-medium text-amber-300 backdrop-blur-md hover:bg-slate-800 sm:inline-flex xl:hidden"
          title="切换视角 [1-4 / V]"
        >
          视角 {cameraMode}
        </button>

        <button
          type="button"
          onClick={() => {
            onRefreshJobs();
            setActiveModal('jobs');
          }}
          className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border border-amber-500/40 bg-slate-900/85 px-2.5 py-1.5 text-xs font-semibold text-amber-300 backdrop-blur-md hover:bg-amber-500/20 sm:px-3"
        >
          <Package className="h-3.5 w-3.5 shrink-0" />
          <span className="hidden sm:inline">货运市场</span>
          <span className="sm:hidden">货源</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveModal('garage')}
          className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border border-sky-500/40 bg-slate-900/85 px-2.5 py-1.5 text-xs font-semibold text-sky-300 backdrop-blur-md hover:bg-sky-500/20 sm:px-3"
        >
          <Wrench className="h-3.5 w-3.5 shrink-0" />
          <span className="hidden sm:inline">车库改装</span>
          <span className="sm:hidden">车库</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveModal('map')}
          className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border border-slate-700/80 bg-slate-900/85 px-2.5 py-1.5 text-xs font-medium text-slate-200 backdrop-blur-md hover:bg-slate-800"
        >
          <MapIcon className="h-3.5 w-3.5 shrink-0" />
          <span className="hidden sm:inline">地图</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveModal('settings')}
          className="rounded-xl border border-slate-700/80 bg-slate-900/85 p-1.5 text-slate-300 backdrop-blur-md hover:text-white"
          title="画质与音效设置"
        >
          <Settings className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={() => setGamePhase('menu')}
          className="rounded-xl border border-slate-700/80 bg-slate-900/85 p-1.5 text-slate-300 backdrop-blur-md hover:text-rose-400"
          title="返回主菜单 (Esc)"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
});
