import { memo, useEffect, useRef, useState } from 'react';
import { ParkingSquare } from 'lucide-react';
import { MapManifest } from '../map/types';
import { RoutePoint } from '../gameplay/NavigationSystem';
import { A2ExamLevelId } from '../exam/types';
import { useGameStore } from '../store/useGameStore';
import { TopStatusBar } from './hud/TopStatusBar';
import { TruckDashboard } from './hud/TruckDashboard';
import { RouteAdvisor } from './hud/RouteAdvisor';
import { WorldMapModal } from './hud/WorldMapModal';
import { SettingsAndSummaryModals } from './hud/SettingsAndSummaryModals';
import { A2ExamHUD } from './hud/A2ExamHUD';

interface HUDProps {
  mapManifest: MapManifest;
  getRoutePoints: () => RoutePoint[];
  onRefreshJobs: () => void;
  onCompleteDelivery: (manual: boolean) => void;
  onSetTimeOfDay: (hours: number) => void;
  onRest: () => void;
  onRoadsideRescue: () => void;
  getNearestStation: () => {
    name: string;
    cityName: string;
    distanceKm: number;
  } | null;
  onBeginExam: () => void;
  onRestartExam: () => void;
  onSelectExamLevel: (levelId: A2ExamLevelId) => void;
  onExitExamToCareer: () => void;
}

const ParkingAlignmentRadar = memo(function ParkingAlignmentRadar({
  bayX,
  bayZ,
  bayHeadingRad,
  aligned,
  readyToDeliver,
}: {
  bayX: number;
  bayZ: number;
  bayHeadingRad: number;
  aligned: boolean;
  readyToDeliver: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const s = useGameStore.getState().telemetry;
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      ctx.fillStyle = '#070f1d';
      ctx.fillRect(0, 0, w, h);

      const cx = w * 0.5;
      const cy = h * 0.52;
      const pxPerM = 2.0;

      // Bay axes in world XZ: forward = (sin h, cos h), right = (-cos h, sin h)
      const fx = Math.sin(bayHeadingRad);
      const fz = Math.cos(bayHeadingRad);
      const rx = -Math.cos(bayHeadingRad);
      const rz = Math.sin(bayHeadingRad);

      const toRadar = (wx: number, wz: number): [number, number] => {
        const dx = wx - bayX;
        const dz = wz - bayZ;
        const lon = dx * fx + dz * fz;
        const lat = dx * rx + dz * rz;
        return [cx + lat * pxPerM, cy - lon * pxPerM];
      };

      // Target parking bay box (3.8m x 14.4m)
      ctx.strokeStyle = readyToDeliver ? '#34d399' : aligned ? '#38bdf8' : '#f59e0b';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(cx - 1.9 * pxPerM, cy - 7.2 * pxPerM, 3.8 * pxPerM, 14.4 * pxPerM);
      ctx.setLineDash([]);

      // Bay front direction tick
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fillRect(cx - 2, cy - 7.2 * pxPerM - 2, 4, 2);

      // Trailer body (centered ~3.2m ahead/behind trailer axle ref -> trailerX/Z)
      if (s.trailerAttached) {
        const [tx, ty] = toRadar(s.trailerX, s.trailerZ);
        ctx.save();
        ctx.translate(tx, ty);
        ctx.rotate(-(s.trailerHeadingRad - bayHeadingRad));
        ctx.fillStyle = '#94a3b8';
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 1;
        ctx.fillRect(-1.3 * pxPerM, -6.4 * pxPerM, 2.6 * pxPerM, 12.8 * pxPerM);
        ctx.strokeRect(-1.3 * pxPerM, -6.4 * pxPerM, 2.6 * pxPerM, 12.8 * pxPerM);
        ctx.restore();
      }

      // Tractor cab
      const [kx, ky] = toRadar(s.truckX, s.truckZ);
      ctx.save();
      ctx.translate(kx, ky);
      ctx.rotate(-(s.truckHeadingRad - bayHeadingRad));
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(-1.3 * pxPerM, -3.1 * pxPerM, 2.6 * pxPerM, 6.2 * pxPerM);
      // Windshield front indicator
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(-1.0 * pxPerM, -3.1 * pxPerM, 2.0 * pxPerM, 1.8);
      ctx.restore();
    };

    draw();
    const unsub = useGameStore.subscribe((state, prev) => {
      if (
        state.telemetry.truckX !== prev.telemetry.truckX ||
        state.telemetry.truckZ !== prev.telemetry.truckZ ||
        state.telemetry.trailerX !== prev.telemetry.trailerX ||
        state.telemetry.trailerZ !== prev.telemetry.trailerZ ||
        state.telemetry.truckHeadingRad !== prev.telemetry.truckHeadingRad
      ) {
        draw();
      }
    });
    return unsub;
  }, [bayX, bayZ, bayHeadingRad, aligned, readyToDeliver]);

  return (
    <canvas
      ref={canvasRef}
      width={112}
      height={76}
      className="shrink-0 rounded-lg border border-slate-700/80"
    />
  );
});

/**
 * Modular HUD shell assembling memoized UI slices so high-frequency telemetry
 * never forces unnecessary React re-renders across unrelated UI panels.
 */
export function HUD({
  mapManifest,
  getRoutePoints,
  onRefreshJobs,
  onCompleteDelivery,
  onSetTimeOfDay,
  onRest,
  onRoadsideRescue,
  getNearestStation,
  onBeginExam,
  onRestartExam,
  onSelectExamLevel,
  onExitExamToCareer,
}: HUDProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  const gameMode = useGameStore((s) => s.gameMode);
  const activeModal = useGameStore((s) => s.activeModal);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const nearbyInteraction = useGameStore((s) => s.nearbyInteraction);
  const parkingGuide = useGameStore((s) => s.parkingGuide);
  const notifications = useGameStore((s) => s.notifications);
  const speedCameraFlashAt = useGameStore((s) => s.speedCameraFlashAt);
  const upcomingTollLabel = useGameStore((s) => s.telemetry.upcomingTollLabel);
  const upcomingTollDistMeters = useGameStore((s) => s.telemetry.upcomingTollDistMeters);
  const refuelFull = useGameStore((s) => s.refuelFull);
  const repairTruckFull = useGameStore((s) => s.repairTruckFull);

  useEffect(() => {
    const now = Date.now();
    setNowMs(now);
    const hasActiveFlash = now - speedCameraFlashAt < 600;
    if (notifications.length === 0 && !hasActiveFlash) {
      return;
    }
    const id = window.setInterval(() => setNowMs(Date.now()), 300);
    return () => window.clearInterval(id);
  }, [notifications, speedCameraFlashAt]);

  const showFlash = nowMs - speedCameraFlashAt < 380;
  const visibleNotifs = notifications.filter((n) => nowMs - n.createdAt < 6500);

  return (
    <>
      {showFlash && (
        <div className="pointer-events-none fixed inset-0 z-50 bg-white/65 transition-opacity" />
      )}

      <TopStatusBar onRefreshJobs={onRefreshJobs} onRestartExam={onRestartExam} />

      <A2ExamHUD
        onBeginExam={onBeginExam}
        onRestartExam={onRestartExam}
        onSelectExamLevel={onSelectExamLevel}
        onExitExamToCareer={onExitExamToCareer}
      />

      {gameMode === 'career' &&
        activeModal === 'none' &&
        upcomingTollDistMeters !== null &&
        upcomingTollDistMeters < 120 && (
          <div className="pointer-events-none fixed top-16 left-1/2 z-20 -translate-x-1/2">
            <div className="flex items-center gap-2 rounded-xl border border-sky-400/60 bg-slate-950/90 px-3.5 py-1.5 text-xs font-semibold text-sky-200 shadow-xl backdrop-blur-md">
              <span className="rounded bg-sky-500 px-1.5 py-0.5 text-[10px] font-black text-slate-950">
                ETC
              </span>
              <span>
                前方 {upcomingTollLabel ?? '高速公路收费站'} ·{' '}
                {Math.round(upcomingTollDistMeters)}m (限速 40 km/h)
              </span>
            </div>
          </div>
        )}

      {visibleNotifs.length > 0 && (
        <div className="pointer-events-none fixed top-16 left-1/2 z-30 flex w-full max-w-md -translate-x-1/2 flex-col gap-2 px-4">
          {visibleNotifs.map((n) => (
            <div
              key={n.id}
              className={`rounded-xl border px-4 py-2.5 shadow-xl backdrop-blur-md ${
                n.type === 'fine'
                  ? 'border-rose-500/70 bg-rose-950/90 text-rose-100'
                  : n.type === 'warning'
                  ? 'border-amber-500/70 bg-amber-950/90 text-amber-100'
                  : n.type === 'success'
                  ? 'border-emerald-500/70 bg-emerald-950/90 text-emerald-100'
                  : 'border-sky-500/60 bg-slate-900/90 text-slate-100'
              }`}
            >
              <div className="text-xs font-bold">{n.title}</div>
              <div className="mt-0.5 text-[11px] opacity-90">{n.detail}</div>
            </div>
          ))}
        </div>
      )}

      {nearbyInteraction &&
        activeModal === 'none' &&
        !(parkingGuide.active && nearbyInteraction.kind === 'delivery_bay') && (
        <div className="fixed bottom-44 left-1/2 z-20 -translate-x-1/2">
          <div className="flex items-center gap-3 rounded-2xl border border-amber-400/50 bg-slate-900/92 px-4 py-2.5 shadow-2xl backdrop-blur-md">
            <div>
              <div className="text-xs font-bold text-amber-300">{nearbyInteraction.label}</div>
              <div className="text-[11px] text-slate-300">{nearbyInteraction.sublabel}</div>
            </div>
            <button
              type="button"
              onClick={() => {
                if (nearbyInteraction.kind === 'depot_job') {
                  onRefreshJobs();
                  setActiveModal('jobs');
                } else if (nearbyInteraction.kind === 'fuel') {
                  refuelFull();
                } else if (nearbyInteraction.kind === 'repair') {
                  repairTruckFull();
                } else if (nearbyInteraction.kind === 'service_hub') {
                  refuelFull();
                  repairTruckFull();
                } else if (nearbyInteraction.kind === 'delivery_bay') {
                  onCompleteDelivery(parkingGuide.readyToDeliver);
                }
              }}
              className="shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-400"
            >
              {nearbyInteraction.kind === 'delivery_bay'
                ? parkingGuide.readyToDeliver
                  ? '确认交货 (+30%)'
                  : '快速停靠'
                : '交互 [Enter]'}
            </button>
            {(nearbyInteraction.kind === 'fuel' ||
              nearbyInteraction.kind === 'repair' ||
              nearbyInteraction.kind === 'service_hub') && (
              <button
                type="button"
                onClick={onRest}
                className="shrink-0 rounded-lg border border-sky-400/50 bg-sky-500/20 px-2.5 py-1.5 text-xs font-semibold text-sky-200 hover:bg-sky-500/35"
              >
                休息 8h [R]
              </button>
            )}
          </div>
        </div>
      )}

      {parkingGuide.active && activeModal === 'none' && (
        <div className="fixed bottom-28 left-1/2 z-20 -translate-x-1/2">
          <div
            className={`flex items-center gap-4 rounded-2xl border px-4 py-2.5 shadow-xl backdrop-blur-md ${
              parkingGuide.readyToDeliver
                ? 'border-emerald-400 bg-emerald-950/90'
                : parkingGuide.aligned
                ? 'border-sky-400 bg-slate-900/90'
                : 'border-amber-500/50 bg-slate-900/90'
            }`}
          >
            {parkingGuide.bayX !== undefined &&
            parkingGuide.bayZ !== undefined &&
            parkingGuide.bayHeadingRad !== undefined ? (
              <ParkingAlignmentRadar
                bayX={parkingGuide.bayX}
                bayZ={parkingGuide.bayZ}
                bayHeadingRad={parkingGuide.bayHeadingRad}
                aligned={parkingGuide.aligned}
                readyToDeliver={parkingGuide.readyToDeliver}
              />
            ) : (
              <ParkingSquare
                className={`h-6 w-6 ${
                  parkingGuide.readyToDeliver ? 'text-emerald-400' : 'text-amber-400'
                }`}
              />
            )}
            <div className="text-xs">
              <div className="font-bold text-white">
                {parkingGuide.readyToDeliver
                  ? '入库精准停稳！正在结算 +30% 技巧奖金...'
                  : parkingGuide.aligned
                  ? '位置角度已对齐！请完全刹停车辆'
                  : '手动倒车入库 (+30% 技巧奖金) · 或选快速停靠'}
              </div>
              <div className="mt-0.5 font-mono text-[11px] text-slate-300">
                距离框心: {parkingGuide.distanceMeters}m · 偏角: {parkingGuide.angleErrorDeg}°
              </div>
            </div>
            <button
              type="button"
              onClick={() => onCompleteDelivery(false)}
              className="shrink-0 rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-[11px] font-semibold text-slate-200 hover:bg-slate-700"
            >
              快速停靠
            </button>
          </div>
        </div>
      )}

      <TruckDashboard />
      {gameMode === 'career' && (
        <>
          <RouteAdvisor
            mapManifest={mapManifest}
            getRoutePoints={getRoutePoints}
            onRefreshJobs={onRefreshJobs}
          />
          <WorldMapModal mapManifest={mapManifest} getRoutePoints={getRoutePoints} />
        </>
      )}
      <SettingsAndSummaryModals
        onRefreshJobs={onRefreshJobs}
        onSetTimeOfDay={onSetTimeOfDay}
        onRoadsideRescue={onRoadsideRescue}
        getNearestStation={getNearestStation}
      />
    </>
  );
}
