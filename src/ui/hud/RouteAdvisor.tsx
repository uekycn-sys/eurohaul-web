import { memo, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUp,
  CornerUpLeft,
  CornerUpRight,
  Flag,
  LifeBuoy,
  Link2,
  Link2Off,
} from 'lucide-react';
import {
  AdvisorTab,
  ENGINE_TIERS,
  getMaxFuelLiters,
  useGameStore,
} from '../../store/useGameStore';
import { MapManifest } from '../../map/types';
import { RoutePoint } from '../../gameplay/NavigationSystem';

interface RouteAdvisorProps {
  mapManifest: MapManifest;
  getRoutePoints: () => RoutePoint[];
  onRefreshJobs: () => void;
}

function formatEta(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

type MinimapZoomMode = 'auto' | 'close' | 'mid' | 'far';

export const RouteAdvisor = memo(function RouteAdvisor({
  mapManifest,
  getRoutePoints,
  onRefreshJobs,
}: RouteAdvisorProps) {
  const minimapRef = useRef<HTMLCanvasElement | null>(null);
  const [zoomMode, setZoomMode] = useState<MinimapZoomMode>('auto');
  const zoomModeRef = useRef<MinimapZoomMode>('auto');
  zoomModeRef.current = zoomMode;

  const advisorTab = useGameStore((s) => s.advisorTab);
  const setAdvisorTab = useGameStore((s) => s.setAdvisorTab);
  const advisorDisplayMode = useGameStore((s) => s.advisorDisplayMode);
  const cycleAdvisorDisplayMode = useGameStore((s) => s.cycleAdvisorDisplayMode);
  const activeJob = useGameStore((s) => s.activeJob);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const engineTier = useGameStore((s) => s.engineTier);
  const tankTier = useGameStore((s) => s.tankTier);
  const fuelLiters = useGameStore((s) => s.fuelLiters);
  const truckHealth = useGameStore((s) => s.truckHealth);
  const mirrorsEnabled = useGameStore((s) => s.mirrorsEnabled);
  const mobileControlsEnabled = useGameStore((s) => s.mobileControlsEnabled);
  const fatigueEnabled = useGameStore((s) => s.fatigueEnabled);
  const driverFatiguePct = useGameStore((s) => s.driverFatiguePct);

  const speedLimitKmh = useGameStore((s) => s.telemetry.speedLimitKmh);
  const isSpeeding = useGameStore((s) => s.telemetry.isSpeeding);
  const upcomingSignal = useGameStore((s) => s.telemetry.upcomingSignal);
  const upcomingSignalDistMeters = useGameStore((s) => s.telemetry.upcomingSignalDistMeters);
  const navInstruction = useGameStore((s) => s.telemetry.navInstruction);
  const navTurnDir = useGameStore((s) => s.telemetry.navTurnDir);
  const navTurnDistMeters = useGameStore((s) => s.telemetry.navTurnDistMeters);
  const estFuelRangeKm = useGameStore((s) => s.telemetry.estFuelRangeKm);
  const navDistanceMeters = useGameStore((s) => s.telemetry.navDistanceMeters);
  const navEtaSeconds = useGameStore((s) => s.telemetry.navEtaSeconds);
  const trailerAttached = useGameStore((s) => s.telemetry.trailerAttached);
  const hitchAngleDeg = useGameStore((s) => s.telemetry.hitchAngleDeg);
  const parkingBrake = useGameStore((s) => s.telemetry.parkingBrake);

  const maxFuel = getMaxFuelLiters(tankTier);
  const engineSpec = ENGINE_TIERS[engineTier] ?? ENGINE_TIERS[0]!;
  const restHoursRemain = Math.max(0, ((100 - driverFatiguePct) / 100) * 11).toFixed(1);

  // Draw rotating 2D Route Advisor Minimap directly via store subscription (zero React re-renders!)
  useEffect(() => {
    if (advisorDisplayMode !== 'full' || advisorTab !== 'nav') return;

    const drawMinimap = () => {
      const canvas = minimapRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const state = useGameStore.getState();
      const { truckX, truckZ, truckHeadingRad, speedKmh } = state.telemetry;
      const currentJob = state.activeJob;

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#0b1220';
      ctx.fillRect(0, 0, w, h);

      const mode = zoomModeRef.current;
      const scale =
        mode === 'close'
          ? 0.44
          : mode === 'mid'
          ? 0.25
          : mode === 'far'
          ? 0.14
          : Math.max(0.15, Math.min(0.42, 0.42 - (Math.min(100, speedKmh) / 100) * 0.26));
      const cx = w * 0.5;
      const cy = h * 0.68;

      ctx.save();
      ctx.translate(cx, cy);
      const sinY = Math.sin(truckHeadingRad);
      const cosY = Math.cos(truckHeadingRad);
      const rightX = -cosY;
      const rightZ = sinY;

      const toMini = (wx: number, wz: number): [number, number] => {
        const dx = wx - truckX;
        const dz = wz - truckZ;
        const lateral = dx * rightX + dz * rightZ;
        const forward = dx * sinY + dz * cosY;
        return [lateral * scale, -forward * scale];
      };

      const nodeLookup = new Map(mapManifest.nodes.map((n) => [n.id, n]));
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const seg of mapManifest.segments) {
        const a = nodeLookup.get(seg.fromNodeId);
        const b = nodeLookup.get(seg.toNodeId);
        if (!a || !b) continue;
        const pts = [a.position, ...(seg.controlPoints ?? []), b.position];
        ctx.strokeStyle = seg.roadClass === 'motorway' ? '#475569' : '#334155';
        ctx.lineWidth = seg.lanes >= 4 ? 7 : 5;
        ctx.beginPath();
        for (let i = 0; i < pts.length; i++) {
          const [mx, my] = toMini(pts[i]![0], pts[i]![2]);
          if (i === 0) ctx.moveTo(mx, my);
          else ctx.lineTo(mx, my);
        }
        ctx.stroke();
      }

      const routePts = getRoutePoints();
      if (routePts.length > 1) {
        ctx.strokeStyle = '#a855f7';
        ctx.lineWidth = 4.5;
        ctx.beginPath();
        for (let i = 0; i < routePts.length; i++) {
          const [mx, my] = toMini(routePts[i]!.x, routePts[i]!.z);
          if (i === 0) ctx.moveTo(mx, my);
          else ctx.lineTo(mx, my);
        }
        ctx.stroke();
      }

      for (const city of mapManifest.cities) {
        const [mx, my] = toMini(city.position[0], city.position[2]);
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.arc(mx, my, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(226, 232, 240, 0.85)';
        ctx.font = '10px Inter, sans-serif';
        ctx.fillText(city.name.slice(0, 4), mx + 6, my + 3);

        for (const depot of city.depots) {
          if (currentJob && currentJob.job.destinationDepotId === depot.id) {
            const [dx, dy] = toMini(depot.parkingBayPosition[0], depot.parkingBayPosition[2]);
            ctx.fillStyle = '#10b981';
            ctx.beginPath();
            ctx.arc(dx, dy, 6, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        for (const st of city.stations) {
          const [sx, sy] = toMini(st.position[0], st.position[2]);
          ctx.fillStyle = st.kind === 'fuel' ? '#f59e0b' : '#38bdf8';
          ctx.fillRect(sx - 3, sy - 3, 6, 6);
        }
      }

      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(6, 7);
      ctx.lineTo(0, 4);
      ctx.lineTo(-6, 7);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    };

    drawMinimap();
    const unsub = useGameStore.subscribe((state, prev) => {
      if (
        state.telemetry.truckX !== prev.telemetry.truckX ||
        state.telemetry.truckZ !== prev.telemetry.truckZ ||
        state.telemetry.truckHeadingRad !== prev.telemetry.truckHeadingRad ||
        state.telemetry.speedKmh !== prev.telemetry.speedKmh ||
        state.activeJob !== prev.activeJob
      ) {
        drawMinimap();
      }
    });
    return unsub;
  }, [advisorDisplayMode, advisorTab, mapManifest, getRoutePoints, zoomMode]);

  if (advisorDisplayMode === 'hidden') {
    return (
      <button
        type="button"
        onClick={cycleAdvisorDisplayMode}
        className={`fixed z-20 flex items-center gap-1.5 rounded-xl border border-slate-700/85 bg-slate-950/90 px-3 py-1.5 text-xs font-semibold text-slate-200 shadow-lg backdrop-blur-md transition hover:border-amber-400/60 hover:text-white ${
          mobileControlsEnabled ? 'right-3 top-14' : 'right-3 bottom-3'
        }`}
        title="展开 Route Advisor [F3]"
      >
        <ArrowUp className="h-3.5 w-3.5 text-purple-400" />
        <span>导航 [F3]</span>
      </button>
    );
  }

  if (advisorDisplayMode === 'mini') {
    const distLabel =
      navDistanceMeters >= 1000
        ? `${(navDistanceMeters / 1000).toFixed(1)}km`
        : `${Math.round(navDistanceMeters)}m`;
    return (
      <div
        className={`fixed z-20 flex items-center gap-2 rounded-xl border border-slate-700/85 bg-slate-950/92 px-3 py-2 text-xs shadow-2xl backdrop-blur-md ${
          mobileControlsEnabled ? 'right-3 top-14' : 'right-3 bottom-3'
        }`}
      >
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-black ${
            isSpeeding
              ? 'border-rose-500 bg-rose-950 text-rose-200 animate-pulse'
              : 'border-rose-600 bg-white text-slate-950'
          }`}
        >
          {speedLimitKmh}
        </span>
        {navTurnDir === 'left' ? (
          <CornerUpLeft className="h-4 w-4 shrink-0 text-purple-400" />
        ) : navTurnDir === 'right' ? (
          <CornerUpRight className="h-4 w-4 shrink-0 text-purple-400" />
        ) : navTurnDir === 'arrive' ? (
          <Flag className="h-4 w-4 shrink-0 text-emerald-400" />
        ) : (
          <ArrowUp className="h-4 w-4 shrink-0 text-sky-400" />
        )}
        <div className="max-w-[155px] truncate font-medium text-slate-100">
          {navInstruction}
        </div>
        <span className="font-mono text-[11px] font-semibold text-amber-300">
          {distLabel} · {formatEta(navEtaSeconds)}
        </span>
        <button
          type="button"
          onClick={cycleAdvisorDisplayMode}
          className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300 hover:border-amber-400/60 hover:text-white"
          title="切换导航栏模式 [F3]"
        >
          F3
        </button>
      </div>
    );
  }

  return (
    <div
      className={`fixed z-20 rounded-2xl border border-slate-700/85 bg-slate-950/90 shadow-2xl backdrop-blur-md ${
        mobileControlsEnabled
          ? 'w-[210px]'
          : 'top-14 right-2.5 w-[204px] sm:top-auto sm:right-3 sm:bottom-3 sm:w-[248px] lg:w-[276px]'
      }`}
      style={
        mobileControlsEnabled
          ? {
              top: mirrorsEnabled
                ? 'calc(180px + env(safe-area-inset-top, 0px))'
                : 'calc(50px + env(safe-area-inset-top, 0px))',
              right: 'max(12px, env(safe-area-inset-right, 0px))',
            }
          : undefined
      }
    >
      <div className="flex items-center border-b border-slate-800 text-[11px] font-semibold">
        <div className="grid flex-1 grid-cols-4">
          {(
            [
              ['nav', '导航'],
              ['cargo', '货物'],
              ['truck', '车况'],
              ['controls', '按键'],
            ] as [AdvisorTab, string][]
          ).map(([tab, label]) => (
            <button
              key={tab}
              type="button"
              onClick={() => setAdvisorTab(tab)}
              className={`py-1.5 transition ${
                advisorTab === tab
                  ? 'border-b-2 border-amber-400 text-amber-300'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={cycleAdvisorDisplayMode}
          className="mr-1.5 rounded border border-slate-700/80 bg-slate-900 px-1.5 py-0.5 text-[9.5px] font-semibold text-slate-400 hover:border-amber-400/60 hover:text-white"
          title="切换迷你导航 / 隐藏导航 [F3]"
        >
          F3
        </button>
      </div>

      <div className="p-2.5">
        {advisorTab === 'nav' && (
          <div>
            <div className="relative overflow-hidden rounded-xl border border-slate-800">
              <canvas
                ref={minimapRef}
                width={254}
                height={148}
                onClick={() =>
                  setZoomMode((z) =>
                    z === 'auto' ? 'close' : z === 'close' ? 'mid' : z === 'mid' ? 'far' : 'auto'
                  )
                }
                title="点击切换小地图缩放 (自适应 / 近 / 中 / 远)"
                className="block w-full cursor-pointer"
              />
              <span className="pointer-events-none absolute right-2 bottom-1.5 rounded bg-slate-950/80 px-1.5 py-0.5 font-mono text-[9px] font-bold text-slate-300">
                {zoomMode === 'auto'
                  ? 'AUTO'
                  : zoomMode === 'close'
                  ? '近'
                  : zoomMode === 'mid'
                  ? '中'
                  : '远'}
              </span>
              <div
                className={`absolute top-2 right-2 flex h-9 w-9 items-center justify-center rounded-full border-[3px] font-mono text-xs font-black shadow-md ${
                  isSpeeding
                    ? 'animate-pulse border-rose-500 bg-rose-600 text-white'
                    : 'border-rose-600 bg-white text-slate-950'
                }`}
              >
                {speedLimitKmh}
              </div>
              {upcomingSignal && (
                <div className="absolute top-2 left-2 flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950/90 px-2 py-1 text-[10px] font-bold shadow-md">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      upcomingSignal === 'green'
                        ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]'
                        : upcomingSignal === 'amber'
                        ? 'bg-amber-400 shadow-[0_0_8px_#fbbf24]'
                        : 'animate-pulse bg-rose-500 shadow-[0_0_8px_#f43f5e]'
                    }`}
                  />
                  <span className="text-slate-200">
                    {upcomingSignal === 'green'
                      ? '绿灯'
                      : upcomingSignal === 'amber'
                      ? '黄灯'
                      : '红灯'}{' '}
                    {upcomingSignalDistMeters ?? 0}m
                  </span>
                </div>
              )}
            </div>
            <div className="mt-2 flex items-center justify-between gap-1.5 text-[11px]">
              <span className="flex min-w-0 items-center gap-1.5 truncate font-medium text-sky-300">
                {navTurnDir === 'left' ? (
                  <CornerUpLeft className="h-4 w-4 shrink-0 text-amber-300" />
                ) : navTurnDir === 'right' ? (
                  <CornerUpRight className="h-4 w-4 shrink-0 text-amber-300" />
                ) : navTurnDir === 'arrive' ? (
                  <Flag className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                ) : (
                  <ArrowUp className="h-3.5 w-3.5 shrink-0 text-sky-300" />
                )}
                <span className="truncate">{navInstruction}</span>
              </span>
              {navTurnDistMeters !== null && (
                <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-amber-300">
                  {navTurnDistMeters}m
                </span>
              )}
            </div>
            {activeJob ? (
              <div className="mt-1 flex items-center justify-between font-mono text-[11px] text-slate-300">
                <span>剩余 {(navDistanceMeters / 1000).toFixed(2)} km</span>
                <span className="text-emerald-400">ETA {formatEta(navEtaSeconds)}</span>
              </div>
            ) : (
              <div className="mt-1 flex items-center justify-between text-[11px] text-slate-400">
                <span>当前无货运合同</span>
                <button
                  type="button"
                  onClick={() => {
                    onRefreshJobs();
                    setActiveModal('jobs');
                  }}
                  className="font-semibold text-amber-400 hover:underline"
                >
                  接取订单 →
                </button>
              </div>
            )}
            <div className="mt-1 flex items-center justify-between border-t border-slate-800/80 pt-1 font-mono text-[10px] text-slate-400">
              <span>续航 ~{estFuelRangeKm} km</span>
              {fatigueEnabled && (
                <span className={driverFatiguePct > 80 ? 'animate-pulse text-rose-400' : 'text-sky-300'}>
                  记录仪 剩余 {restHoursRemain}h
                </span>
              )}
            </div>
          </div>
        )}

        {advisorTab === 'cargo' && (
          <div className="space-y-2 text-xs">
            {activeJob ? (
              <>
                <div className="font-bold text-white">{activeJob.job.cargoName}</div>
                <div className="text-[11px] text-slate-300">
                  终点: {activeJob.job.destinationCityName} · {activeJob.job.destinationDepotName}
                </div>
                <div className="flex justify-between text-[11px] text-slate-400">
                  <span>货重: {activeJob.job.weightTons}t</span>
                  <span>运费: €{activeJob.job.basePayEur.toLocaleString()}</span>
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-[11px]">
                    <span className="text-slate-400">货物完整度</span>
                    <span className="font-mono text-emerald-400">
                      {activeJob.cargoHealth.toFixed(0)}%
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full bg-emerald-400"
                      style={{ width: `${activeJob.cargoHealth}%` }}
                    />
                  </div>
                </div>
                <div className="text-[11px] text-amber-300">
                  剩余时限: {formatEta(activeJob.remainingSeconds)}
                </div>
              </>
            ) : (
              <div className="py-5 text-center text-slate-400">
                当前空载漫游中
                <button
                  type="button"
                  onClick={() => {
                    onRefreshJobs();
                    setActiveModal('jobs');
                  }}
                  className="mt-3 block w-full rounded-lg bg-amber-500 py-1.5 font-bold text-slate-950"
                >
                  打开货运市场
                </button>
              </div>
            )}
          </div>
        )}

        {advisorTab === 'truck' && (
          <div className="space-y-2 text-xs text-slate-300">
            <div className="flex justify-between">
              <span className="text-slate-400">引擎配置</span>
              <span className="font-semibold text-white">{engineSpec.hp} HP</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">油箱余量</span>
              <span className="font-mono text-amber-300">
                {Math.round(fuelLiters)} / {maxFuel} L (~{estFuelRangeKm}km)
              </span>
            </div>
            {fatigueEnabled && (
              <div className="flex justify-between">
                <span className="text-slate-400">行车记录仪</span>
                <span className={`font-mono ${driverFatiguePct > 80 ? 'text-rose-400' : 'text-sky-300'}`}>
                  剩余 {restHoursRemain}h (疲劳 {Math.round(driverFatiguePct)}%)
                </span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-slate-400">半挂车状态</span>
              <span className="inline-flex items-center gap-1 font-semibold text-emerald-400">
                {trailerAttached ? (
                  <>
                    <Link2 className="h-3.5 w-3.5" /> 已挂接 ({hitchAngleDeg}°)
                  </>
                ) : (
                  <>
                    <Link2Off className="h-3.5 w-3.5 text-amber-400" /> 已摘除
                  </>
                )}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">整车完整度</span>
              <span className="font-mono text-sky-400">{Math.round(truckHealth)}%</span>
            </div>
            <button
              type="button"
              onClick={() => setActiveModal('rescue')}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/15 py-1.5 text-[11px] font-bold text-rose-200 hover:bg-rose-500/30"
            >
              <LifeBuoy className="h-3.5 w-3.5" />
              呼叫道路救援拖车 [F7]
            </button>
            {parkingBrake && (
              <div className="flex items-center gap-1 rounded bg-rose-500/20 px-2 py-1 text-[11px] text-rose-300">
                <AlertTriangle className="h-3.5 w-3.5" />
                驻车手刹已拉起 (按 Space 松开)
              </div>
            )}
          </div>
        )}

        {advisorTab === 'controls' && (
          <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[10.5px] text-slate-300">
            <span>
              <b className="text-amber-300">W / S</b> 油门 / 刹车
            </span>
            <span>
              <b className="text-amber-300">A / D / N</b> 转向 / 回正
            </span>
            <span>
              <b className="text-amber-300">Space</b> 手刹启闭
            </span>
            <span>
              <b className="text-amber-300">I / Z</b> 点火 / 离合
            </span>
            <span>
              <b className="text-amber-300">J / B</b> 排气制 / 缓速器
            </span>
            <span>
              <b className="text-amber-300">U / Y</b> 差速锁 / 挂车刹
            </span>
            <span>
              <b className="text-amber-300">Q / E</b> 左右转向灯
            </span>
            <span>
              <b className="text-amber-300">L / X / O</b> 车灯/双闪/顶灯
            </span>
            <span>
              <b className="text-amber-300">C / [ / ]</b> 巡航与调速
            </span>
            <span>
              <b className="text-amber-300">T / H / F7</b> 挂车/喇叭/救援
            </span>
            <span>
              <b className="text-amber-300">1-5 / V / N4·6</b> 视角/观望
            </span>
            <span>
              <b className="text-amber-300">Shift/Ctrl</b> 升降档/DNR
            </span>
            <span>
              <b className="text-amber-300">P / F / R</b> 雨刷/全屏/休息
            </span>
            <span>
              <b className="text-amber-300">M / Enter</b> 全图 / 交互
            </span>
            <span>
              <b className="text-amber-300">F2 / F3 / F4</b> 镜/导航/座椅
            </span>
          </div>
        )}
      </div>
    </div>
  );
});
