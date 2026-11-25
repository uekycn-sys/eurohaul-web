import { X, Package, ArrowRight, AlertCircle, Zap, Weight, RefreshCw } from 'lucide-react';
import { useGameStore } from '../store/useGameStore';

interface JobMarketModalProps {
  onRefreshJobs: () => void;
}

export function JobMarketModal({ onRefreshJobs }: JobMarketModalProps) {
  const activeModal = useGameStore((s) => s.activeModal);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const availableJobs = useGameStore((s) => s.availableJobs);
  const activeJob = useGameStore((s) => s.activeJob);
  const acceptJob = useGameStore((s) => s.acceptJob);
  const cancelActiveJob = useGameStore((s) => s.cancelActiveJob);

  if (activeModal !== 'jobs') return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3.5 sm:px-6 sm:py-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <Package className="h-5 w-5 shrink-0 text-amber-400" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-base font-bold text-white sm:text-lg">欧洲货运市场 (Freight Market)</h2>
                <span className="shrink-0 whitespace-nowrap rounded bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-300">
                  驾驶已暂停
                </span>
              </div>
              <p className="truncate text-xs text-slate-400">选择最适合你当前引擎吨位与路线的货运订单 (跨城订单将自动调拨至起点)</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onRefreshJobs}
              className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
            >
              <RefreshCw className="h-3.5 w-3.5 shrink-0" />
              刷新货源
            </button>
            <button
              type="button"
              onClick={() => setActiveModal('none')}
              className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {activeJob && (
          <div className="mx-6 mt-4 flex items-center justify-between rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs">
            <div>
              <span className="font-semibold text-amber-300">当前正在执行: </span>
              <span className="text-white">{activeJob.job.cargoName}</span>
              <span className="ml-2 text-slate-300">
                ({activeJob.job.originCityName} → {activeJob.job.destinationCityName})
              </span>
            </div>
            <button
              type="button"
              onClick={cancelActiveJob}
              className="rounded-lg bg-rose-600/80 px-3 py-1 font-semibold text-white hover:bg-rose-500"
            >
              放弃订单 (-€800)
            </button>
          </div>
        )}

        <div className="grid flex-1 grid-cols-1 gap-3 overflow-y-auto p-6 md:grid-cols-2">
          {availableJobs.map((job) => (
            <div
              key={job.id}
              className="flex flex-col justify-between rounded-xl border border-slate-700/80 bg-slate-800/60 p-4 transition hover:border-amber-500/50"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-400">
                      {job.cargoCategory}
                    </span>
                    <h3 className="text-base font-bold text-white">{job.cargoName}</h3>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-lg font-bold text-emerald-400">
                      €{job.basePayEur.toLocaleString()}
                    </div>
                    <div className="text-[11px] text-slate-400">+{job.xpReward} XP</div>
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-2 rounded-lg bg-slate-900/70 px-3 py-2 text-xs text-slate-200">
                  <span className="font-medium text-sky-300">{job.originCityName}</span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                  <span className="font-medium text-emerald-300">{job.destinationCityName}</span>
                  <span className="ml-auto font-mono text-slate-400">{job.distanceKm} km</span>
                </div>

                <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="inline-flex items-center gap-1 rounded bg-slate-700/80 px-2 py-0.5 text-slate-200">
                    <Weight className="h-3 w-3 text-slate-400" />
                    {job.weightTons} 吨
                  </span>
                  {job.fragile && (
                    <span className="inline-flex items-center gap-1 rounded bg-rose-500/20 px-2 py-0.5 text-rose-300">
                      <AlertCircle className="h-3 w-3" />
                      易碎精密
                    </span>
                  )}
                  {job.urgent && (
                    <span className="inline-flex items-center gap-1 rounded bg-amber-500/20 px-2 py-0.5 text-amber-300">
                      <Zap className="h-3 w-3" />
                      加急限时 {job.timeLimitMin}m
                    </span>
                  )}
                </div>
              </div>

              <button
                type="button"
                disabled={Boolean(activeJob)}
                onClick={() => acceptJob(job)}
                className="mt-4 w-full rounded-lg bg-amber-500 py-2 text-sm font-bold text-slate-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
              >
                {activeJob ? '请先完成或放弃当前订单' : '承接该货运订单'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
