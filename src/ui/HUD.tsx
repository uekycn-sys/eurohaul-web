import { useEffect, useState } from 'react';
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
  const refuelFull = useGameStore((s) => s.refuelFull);
  const repairTruckFull = useGameStore((s) => s.repairTruckFull);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 300);
    return () => window.clearInterval(id);
  }, []);

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
            <ParkingSquare
              className={`h-6 w-6 ${
                parkingGuide.readyToDeliver ? 'text-emerald-400' : 'text-amber-400'
              }`}
            />
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
