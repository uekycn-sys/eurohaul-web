import { useEffect, useRef, useState } from 'react';
import {
  Map as MapIcon,
  Package,
  Wrench,
  Settings,
  LogOut,
  Fuel,
  ShieldAlert,
  Gauge,
  Sun,
  Moon,
  Volume2,
  CheckCircle2,
  CornerUpRight,
  ParkingSquare,
  AlertTriangle,
  Link2,
  Link2Off,
} from 'lucide-react';
import {
  AdvisorTab,
  CameraMode,
  ENGINE_TIERS,
  QualityPreset,
  getMaxFuelLiters,
  useGameStore,
} from '../store/useGameStore';
import { MapManifest } from '../map/types';
import { RoutePoint } from '../gameplay/NavigationSystem';

interface HUDProps {
  mapManifest: MapManifest;
  getRoutePoints: () => RoutePoint[];
  onRefreshJobs: () => void;
  onCompleteDelivery: (manual: boolean) => void;
  onSetTimeOfDay: (hours: number) => void;
}

function formatClock(hours: number): string {
  const totalMin = Math.floor(((hours % 24) + 24) % 24 * 60);
  const hh = String(Math.floor(totalMin / 60)).padStart(2, '0');
  const mm = String(totalMin % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatEta(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

export function HUD({
  mapManifest,
  getRoutePoints,
  onRefreshJobs,
  onCompleteDelivery,
  onSetTimeOfDay,
}: HUDProps) {
  const minimapRef = useRef<HTMLCanvasElement | null>(null);
  const worldMapRef = useRef<HTMLCanvasElement | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const moneyEur = useGameStore((s) => s.moneyEur);
  const level = useGameStore((s) => s.level);
  const engineTier = useGameStore((s) => s.engineTier);
  const tankTier = useGameStore((s) => s.tankTier);
  const fuelLiters = useGameStore((s) => s.fuelLiters);
  const truckHealth = useGameStore((s) => s.truckHealth);
  const showFps = useGameStore((s) => s.showFps);
  const setShowFps = useGameStore((s) => s.setShowFps);
  const qualityPreset = useGameStore((s) => s.qualityPreset);
  const setQualityPreset = useGameStore((s) => s.setQualityPreset);
  const mirrorsEnabled = useGameStore((s) => s.mirrorsEnabled);
  const setMirrorsEnabled = useGameStore((s) => s.setMirrorsEnabled);
  const audioEnabled = useGameStore((s) => s.audioEnabled);
  const setAudioEnabled = useGameStore((s) => s.setAudioEnabled);
  const masterVolume = useGameStore((s) => s.masterVolume);
  const setMasterVolume = useGameStore((s) => s.setMasterVolume);

  const cameraMode = useGameStore((s) => s.cameraMode);
  const setCameraMode = useGameStore((s) => s.setCameraMode);
  const advisorTab = useGameStore((s) => s.advisorTab);
  const setAdvisorTab = useGameStore((s) => s.setAdvisorTab);
  const transmissionMode = useGameStore((s) => s.transmissionMode);
  const toggleTransmissionMode = useGameStore((s) => s.toggleTransmissionMode);
  const activeModal = useGameStore((s) => s.activeModal);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const setGamePhase = useGameStore((s) => s.setGamePhase);
  const activeJob = useGameStore((s) => s.activeJob);
  const lastDeliveryResult = useGameStore((s) => s.lastDeliveryResult);
  const nearbyInteraction = useGameStore((s) => s.nearbyInteraction);
  const parkingGuide = useGameStore((s) => s.parkingGuide);
  const notifications = useGameStore((s) => s.notifications);
  const speedCameraFlashAt = useGameStore((s) => s.speedCameraFlashAt);
  const telemetry = useGameStore((s) => s.telemetry);

  const refuelFull = useGameStore((s) => s.refuelFull);
  const repairTruckFull = useGameStore((s) => s.repairTruckFull);

  const maxFuel = getMaxFuelLiters(tankTier);
  const fuelPct = Math.round((fuelLiters / maxFuel) * 100);
  const engineSpec = ENGINE_TIERS[engineTier] ?? ENGINE_TIERS[0]!;

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  // Draw rotating 2D Route Advisor Minimap
  useEffect(() => {
    if (advisorTab !== 'nav') return;
    const canvas = minimapRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Dark GPS background
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, w, h);

    const scale = 0.24; // pixels per meter
    const cx = w * 0.5;
    const cy = h * 0.68;

    ctx.save();
    ctx.translate(cx, cy);
    // Rotate world so truck forward (headingRad) always points UP (-Y on canvas)
    // In Three.js world: fwd = (sin(yaw), cos(yaw)). Map world (dx, dz) onto rotated frame:
    // Let's transform world delta directly for crystal clarity!
    const sinY = Math.sin(telemetry.truckHeadingRad);
    const cosY = Math.cos(telemetry.truckHeadingRad);
    const rightX = -cosY;
    const rightZ = sinY;

    const toMini = (wx: number, wz: number): [number, number] => {
      const dx = wx - telemetry.truckX;
      const dz = wz - telemetry.truckZ;
      const lateral = dx * rightX + dz * rightZ;
      const forward = dx * sinY + dz * cosY;
      return [lateral * scale, -forward * scale];
    };

    const nodeLookup = new Map(mapManifest.nodes.map((n) => [n.id, n]));

    // Draw roads
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

    // Draw purple active navigation route
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

    // Draw city markers & service icons
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
        if (activeJob && activeJob.job.destinationDepotId === depot.id) {
          const [dx, dy] = toMini(depot.parkingBayPosition[0], depot.parkingBayPosition[2]);
          ctx.fillStyle = '#10b981';
          ctx.beginPath();
          ctx.arc(dx, dy, 6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Player truck arrow at origin (0, 0) pointing UP
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(6, 7);
    ctx.lineTo(0, 4);
    ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }, [advisorTab, mapManifest, getRoutePoints, telemetry, activeJob]);

  // Draw Full World Map Modal (M)
  useEffect(() => {
    if (activeModal !== 'map') return;
    const canvas = worldMapRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = '#09101d';
    ctx.fillRect(0, 0, w, h);

    const { minX, maxX, minZ, maxZ } = mapManifest.worldBounds;
    const pad = 42;
    const scaleX = (w - pad * 2) / (maxX - minX);
    const scaleZ = (h - pad * 2) / (maxZ - minZ);
    const scale = Math.min(scaleX, scaleZ);
    const offsetX = w * 0.5 - ((minX + maxX) * 0.5) * scale;
    const offsetZ = h * 0.5 - ((minZ + maxZ) * 0.5) * scale;

    // World map north-up: +X right, +Z down? Wait: in Three.js, if yaw=PI/2 faces +X, +Z is South on screen if X is East!
    // Let's keep +X right (East) and +Z down (South) consistently on the full map!
    const toMap = (wx: number, wz: number): [number, number] => [
      wx * scale + offsetX,
      wz * scale + offsetZ,
    ];

    const nodeLookup = new Map(mapManifest.nodes.map((n) => [n.id, n]));

    // Subtle grid
    ctx.strokeStyle = 'rgba(51, 65, 85, 0.35)';
    ctx.lineWidth = 1;
    for (let x = -1500; x <= 1500; x += 500) {
      const [gx] = toMap(x, 0);
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, h);
      ctx.stroke();
    }
    for (let z = -1500; z <= 1500; z += 500) {
      const [, gz] = toMap(0, z);
      ctx.beginPath();
      ctx.moveTo(0, gz);
      ctx.lineTo(w, gz);
      ctx.stroke();
    }

    // Roads
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const seg of mapManifest.segments) {
      const a = nodeLookup.get(seg.fromNodeId);
      const b = nodeLookup.get(seg.toNodeId);
      if (!a || !b) continue;
      const pts = [a.position, ...(seg.controlPoints ?? []), b.position];
      ctx.strokeStyle = seg.roadClass === 'motorway' ? '#f59e0b' : seg.biome === 'alpine' ? '#38bdf8' : '#64748b';
      ctx.lineWidth = seg.lanes >= 4 ? 5 : 3;
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const [mx, my] = toMap(pts[i]![0], pts[i]![2]);
        if (i === 0) ctx.moveTo(mx, my);
        else ctx.lineTo(mx, my);
      }
      ctx.stroke();
    }

    // Active route
    const routePts = getRoutePoints();
    if (routePts.length > 1) {
      ctx.strokeStyle = '#c084fc';
      ctx.lineWidth = 5;
      ctx.beginPath();
      for (let i = 0; i < routePts.length; i++) {
        const [mx, my] = toMap(routePts[i]!.x, routePts[i]!.z);
        if (i === 0) ctx.moveTo(mx, my);
        else ctx.lineTo(mx, my);
      }
      ctx.stroke();
    }

    // Cities & depots
    for (const city of mapManifest.cities) {
      const [cx, cy] = toMap(city.position[0], city.position[2]);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 13px Inter, sans-serif';
      ctx.fillText(`${city.name} (${city.country})`, cx + 14, cy + 4);

      for (const depot of city.depots) {
        const [dx, dy] = toMap(depot.parkingBayPosition[0], depot.parkingBayPosition[2]);
        const isDest = activeJob?.job.destinationDepotId === depot.id;
        ctx.fillStyle = isDest ? '#10b981' : '#94a3b8';
        ctx.fillRect(dx - 3, dy - 3, 6, 6);
      }
    }

    // Player Truck marker
    const [px, py] = toMap(telemetry.truckX, telemetry.truckZ);
    ctx.save();
    ctx.translate(px, py);
    // On this map: +X right, +Z down. Yaw=0 (+Z) points down (+Y canvas); Yaw=PI/2 (+X) points right (+X canvas)
    ctx.rotate(-telemetry.truckHeadingRad);
    ctx.fillStyle = '#f59e0b';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 10);
    ctx.lineTo(7, -8);
    ctx.lineTo(0, -4);
    ctx.lineTo(-7, -8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }, [activeModal, mapManifest, getRoutePoints, telemetry, activeJob]);

  const showFlash = nowMs - speedCameraFlashAt < 380;
  const visibleNotifs = notifications.filter((n) => nowMs - n.createdAt < 6500);
  const rpmPct = Math.min(100, Math.max(0, ((telemetry.rpm - 600) / 1750) * 100));

  return (
    <>
      {/* Speed Camera Flash */}
      {showFlash && (
        <div className="pointer-events-none fixed inset-0 z-50 bg-white/65 transition-opacity" />
      )}

      {/* Top Navigation & Economy Bar */}
      <div className="pointer-events-none fixed top-0 left-0 right-0 z-20 flex items-center justify-between gap-3 bg-gradient-to-b from-slate-950/85 to-transparent px-4 py-2.5">
        <div className="pointer-events-auto flex flex-wrap items-center gap-2.5">
          <div className="rounded-xl border border-slate-700/80 bg-slate-900/85 px-3 py-1.5 text-xs backdrop-blur-md">
            <span className="font-mono font-bold text-emerald-400">€{moneyEur.toLocaleString()}</span>
            <span className="mx-2 text-slate-600">|</span>
            <span className="font-semibold text-amber-300">Lv.{level}</span>
            <span className="mx-2 text-slate-600">|</span>
            <span className="text-slate-200">{telemetry.currentCityName}</span>
            <span className="mx-2 text-slate-600">|</span>
            <span className="font-mono text-sky-300">{formatClock(telemetry.timeOfDayHours)}</span>
          </div>

          {showFps && (
            <div className="rounded-lg border border-slate-700/70 bg-slate-900/80 px-2.5 py-1.5 font-mono text-xs text-slate-300 backdrop-blur-md">
              {telemetry.fps} FPS
            </div>
          )}
        </div>

        {/* Quick Camera + Modal Triggers */}
        <div className="pointer-events-auto flex flex-wrap items-center gap-1.5">
          <div className="hidden items-center rounded-xl border border-slate-700/80 bg-slate-900/85 p-0.5 text-[11px] backdrop-blur-md md:flex">
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
            onClick={() => {
              onRefreshJobs();
              setActiveModal('jobs');
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-slate-900/85 px-3 py-1.5 text-xs font-semibold text-amber-300 backdrop-blur-md hover:bg-amber-500/20"
          >
            <Package className="h-3.5 w-3.5" />
            货运市场
          </button>

          <button
            type="button"
            onClick={() => setActiveModal('garage')}
            className="inline-flex items-center gap-1.5 rounded-xl border border-sky-500/40 bg-slate-900/85 px-3 py-1.5 text-xs font-semibold text-sky-300 backdrop-blur-md hover:bg-sky-500/20"
          >
            <Wrench className="h-3.5 w-3.5" />
            车库改装
          </button>

          <button
            type="button"
            onClick={() => setActiveModal('map')}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700/80 bg-slate-900/85 px-2.5 py-1.5 text-xs font-medium text-slate-200 backdrop-blur-md hover:bg-slate-800"
          >
            <MapIcon className="h-3.5 w-3.5" />
            地图
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

      {/* Toast Notifications */}
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

      {/* Nearby Zone Interaction Banner */}
      {nearbyInteraction && activeModal === 'none' && (
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
          </div>
        </div>
      )}

      {/* Precision Reverse Parking Guide Overlay */}
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
                  : '倒车入库指引 (绿色框可获 +30% 奖金)'}
              </div>
              <div className="mt-0.5 font-mono text-[11px] text-slate-300">
                距离框心: {parkingGuide.distanceMeters}m · 偏角: {parkingGuide.angleErrorDeg}°
              </div>
            </div>
            <button
              type="button"
              onClick={() => onCompleteDelivery(false)}
              className="rounded-lg border border-slate-600 bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-slate-200 hover:bg-slate-700"
            >
              跳过倒车
            </button>
          </div>
        </div>
      )}

      {/* Center-Bottom Digital Truck Dashboard */}
      <div className="pointer-events-none fixed bottom-3 left-3 z-20 sm:left-1/2 sm:-translate-x-1/2">
        <div className="pointer-events-auto flex items-center gap-4 rounded-2xl border border-slate-700/80 bg-slate-950/88 px-4 py-2.5 shadow-2xl backdrop-blur-md">
          {/* Blinker & Lights Column */}
          <div className="flex flex-col items-center gap-1.5">
            <div className="flex items-center gap-2">
              <span
                className={`text-sm font-bold ${
                  telemetry.blinkerLit && (telemetry.leftBlinker || telemetry.hazardLights)
                    ? 'text-emerald-400'
                    : 'text-slate-700'
                }`}
              >
                ◄
              </span>
              <span
                className={`text-sm font-bold ${
                  telemetry.blinkerLit && (telemetry.rightBlinker || telemetry.hazardLights)
                    ? 'text-emerald-400'
                    : 'text-slate-700'
                }`}
              >
                ►
              </span>
            </div>
            <div className="flex items-center gap-1 text-[10px] font-bold">
              <span
                className={`rounded px-1.5 py-0.5 ${
                  telemetry.headlightMode === 2
                    ? 'bg-sky-500 text-slate-950'
                    : telemetry.headlightMode === 1
                    ? 'bg-emerald-500/25 text-emerald-300'
                    : 'bg-slate-800 text-slate-500'
                }`}
              >
                {telemetry.headlightMode === 2 ? '远光' : telemetry.headlightMode === 1 ? '近光' : '关灯'}
              </span>
              <span
                className={`rounded px-1.5 py-0.5 ${
                  telemetry.parkingBrake
                    ? 'bg-rose-600 text-white'
                    : 'bg-slate-800 text-slate-500'
                }`}
              >
                P
              </span>
            </div>
          </div>

          {/* Speed & RPM */}
          <div className="min-w-[116px] text-center">
            <div className="flex items-baseline justify-center gap-1">
              <span
                className={`font-mono text-3xl font-black leading-none ${
                  telemetry.isSpeeding ? 'text-rose-400' : 'text-white'
                }`}
              >
                {telemetry.speedKmh}
              </span>
              <span className="text-[10px] font-semibold text-slate-400">KM/H</span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className={`h-full transition-all duration-75 ${
                  telemetry.rpm > 1850
                    ? 'bg-rose-500'
                    : telemetry.rpm > 1500
                    ? 'bg-amber-400'
                    : 'bg-emerald-400'
                }`}
                style={{ width: `${rpmPct}%` }}
              />
            </div>
            <div className="mt-0.5 flex justify-between font-mono text-[10px] text-slate-400">
              <span>{telemetry.rpm} RPM</span>
              <span>{telemetry.odometerKm.toFixed(1)}km</span>
            </div>
          </div>

          {/* Gear & Assists */}
          <div className="flex flex-col items-center gap-1">
            <button
              type="button"
              onClick={toggleTransmissionMode}
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 hover:border-amber-400"
              title="点击切换 自动/序列手动变速箱"
            >
              <span className="font-mono text-lg font-black text-amber-400">
                {telemetry.gearLabel}
              </span>
              <span className="text-[9px] uppercase text-slate-400">
                {transmissionMode === 'auto' ? 'AT' : 'MT'}
              </span>
            </button>
            <div className="flex items-center gap-1 text-[10px] font-semibold">
              <span
                className={`rounded px-1.5 py-0.5 ${
                  telemetry.cruiseControlKmh !== null
                    ? 'bg-emerald-500/25 text-emerald-300'
                    : 'bg-slate-800 text-slate-500'
                }`}
              >
                CC {telemetry.cruiseControlKmh ?? '--'}
              </span>
              <span
                className={`rounded px-1.5 py-0.5 ${
                  telemetry.retarderLevel > 0
                    ? 'bg-amber-500/25 text-amber-300'
                    : 'bg-slate-800 text-slate-500'
                }`}
              >
                R{telemetry.retarderLevel}
              </span>
            </div>
          </div>

          {/* Fuel & Condition Mini Bars */}
          <div className="hidden flex-col gap-1.5 text-[10px] sm:flex">
            <div className="flex items-center gap-1.5">
              <Fuel className={`h-3.5 w-3.5 ${fuelPct < 18 ? 'text-rose-400 animate-pulse' : 'text-amber-400'}`} />
              <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-800">
                <div
                  className={`h-full ${fuelPct < 18 ? 'bg-rose-500' : 'bg-amber-400'}`}
                  style={{ width: `${fuelPct}%` }}
                />
              </div>
              <span className="w-7 font-mono text-slate-300">{fuelPct}%</span>
            </div>
            <div className="flex items-center gap-1.5">
              <ShieldAlert className="h-3.5 w-3.5 text-sky-400" />
              <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full bg-sky-400"
                  style={{ width: `${truckHealth}%` }}
                />
              </div>
              <span className="w-7 font-mono text-slate-300">{Math.round(truckHealth)}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom-Right ETS2 Route Advisor */}
      <div className="fixed right-3 bottom-3 z-20 w-[276px] rounded-2xl border border-slate-700/85 bg-slate-950/90 shadow-2xl backdrop-blur-md">
        {/* Advisor Tabs */}
        <div className="grid grid-cols-4 border-b border-slate-800 text-[11px] font-semibold">
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

        {/* Tab Content */}
        <div className="p-2.5">
          {advisorTab === 'nav' && (
            <div>
              <div className="relative overflow-hidden rounded-xl border border-slate-800">
                <canvas ref={minimapRef} width={254} height={148} className="block w-full" />
                {/* Circular European Speed Limit Sign */}
                <div
                  className={`absolute top-2 right-2 flex h-9 w-9 items-center justify-center rounded-full border-[3px] font-mono text-xs font-black shadow-md ${
                    telemetry.isSpeeding
                      ? 'border-rose-500 bg-rose-600 text-white animate-pulse'
                      : 'border-rose-600 bg-white text-slate-950'
                  }`}
                >
                  {telemetry.speedLimitKmh}
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px]">
                <span className="flex items-center gap-1 truncate font-medium text-sky-300">
                  <CornerUpRight className="h-3.5 w-3.5 shrink-0" />
                  {telemetry.navInstruction}
                </span>
              </div>
              {activeJob ? (
                <div className="mt-1 flex items-center justify-between font-mono text-[11px] text-slate-300">
                  <span>剩余 {(telemetry.navDistanceMeters / 1000).toFixed(2)} km</span>
                  <span className="text-emerald-400">ETA {formatEta(telemetry.navEtaSeconds)}</span>
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
                  {Math.round(fuelLiters)} / {maxFuel} L
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">半挂车状态</span>
                <span className="inline-flex items-center gap-1 font-semibold text-emerald-400">
                  {telemetry.trailerAttached ? (
                    <>
                      <Link2 className="h-3.5 w-3.5" /> 已挂接 ({telemetry.hitchAngleDeg}°)
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
              {telemetry.parkingBrake && (
                <div className="flex items-center gap-1 rounded bg-rose-500/20 px-2 py-1 text-[11px] text-rose-300">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  驻车手刹已拉起 (按 Space 松开)
                </div>
              )}
            </div>
          )}

          {advisorTab === 'controls' && (
            <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-slate-300">
              <span><b className="text-amber-300">W / S</b> 油门 / 刹车</span>
              <span><b className="text-amber-300">A / D</b> 转向</span>
              <span><b className="text-amber-300">Space</b> 手刹启闭</span>
              <span><b className="text-amber-300">Q / E</b> 左右转向灯</span>
              <span><b className="text-amber-300">L / F</b> 大灯 / 双闪</span>
              <span><b className="text-amber-300">C / B</b> 巡航 / 缓速器</span>
              <span><b className="text-amber-300">T / H</b> 摘挂 / 气喇叭</span>
              <span><b className="text-amber-300">1 - 4</b> 切换视角</span>
              <span><b className="text-amber-300">Shift/Ctrl</b> 升降档</span>
              <span><b className="text-amber-300">Enter</b> 货场/加油交互</span>
            </div>
          )}
        </div>
      </div>

      {/* World Map Modal (M) */}
      {activeModal === 'map' && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-4xl rounded-2xl border border-slate-700 bg-slate-900 p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-base font-bold text-white">
                <MapIcon className="h-5 w-5 text-amber-400" />
                {mapManifest.name} — 欧陆导航全图
              </div>
              <button
                type="button"
                onClick={() => setActiveModal('none')}
                className="rounded-lg bg-slate-800 px-3 py-1 text-xs text-slate-200 hover:bg-slate-700"
              >
                关闭 [M / Esc]
              </button>
            </div>
            <canvas
              ref={worldMapRef}
              width={860}
              height={520}
              className="w-full rounded-xl border border-slate-800"
            />
            <div className="mt-2.5 flex flex-wrap items-center gap-4 text-xs text-slate-400">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-4 rounded bg-amber-500" /> 高速公路
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-4 rounded bg-sky-400" /> 阿尔卑斯山路
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-4 rounded bg-purple-400" /> GPS 规划航线
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-400" /> 目的卸货位
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {activeModal === 'settings' && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-bold text-white">
                <Gauge className="h-5 w-5 text-amber-400" />
                模拟与性能设置
              </h2>
              <button
                type="button"
                onClick={() => setActiveModal('none')}
                className="rounded-lg bg-slate-800 px-2.5 py-1 text-xs text-slate-300"
              >
                完成
              </button>
            </div>

            <div className="mt-5 space-y-4 text-xs">
              <div>
                <div className="mb-2 font-semibold text-slate-300">图形画质预设</div>
                <div className="grid grid-cols-3 gap-2">
                  {(['low', 'medium', 'high'] as QualityPreset[]).map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => setQualityPreset(q)}
                      className={`rounded-lg border py-2 font-semibold ${
                        qualityPreset === q
                          ? 'border-amber-400 bg-amber-500/20 text-amber-300'
                          : 'border-slate-700 bg-slate-800 text-slate-300'
                      }`}
                    >
                      {q === 'low' ? '低/省电' : q === 'medium' ? '中/平衡' : '高/精致'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-300">显示实时 FPS</span>
                <button
                  type="button"
                  onClick={() => setShowFps(!showFps)}
                  className={`rounded-lg px-3 py-1 font-semibold ${
                    showFps ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {showFps ? '已开启' : '已关闭'}
                </button>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-300">电子画中画后视镜</span>
                <button
                  type="button"
                  onClick={() => setMirrorsEnabled(!mirrorsEnabled)}
                  className={`rounded-lg px-3 py-1 font-semibold ${
                    mirrorsEnabled ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {mirrorsEnabled ? '已开启' : '已关闭'}
                </button>
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-slate-300">
                    <Volume2 className="h-4 w-4 text-amber-400" />
                    Web Audio 合成音量
                  </span>
                  <button
                    type="button"
                    onClick={() => setAudioEnabled(!audioEnabled)}
                    className="text-amber-300 underline"
                  >
                    {audioEnabled ? '静音' : '恢复'}
                  </button>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={masterVolume}
                  onChange={(e) => setMasterVolume(Number(e.target.value))}
                  className="w-full accent-amber-500"
                />
              </div>

              <div>
                <div className="mb-2 font-semibold text-slate-300">快速切换时刻 (测试昼夜光影)</div>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { label: '黎明', h: 6.2, icon: Sun },
                    { label: '正午', h: 12.5, icon: Sun },
                    { label: '黄昏', h: 18.0, icon: Sun },
                    { label: '夜晚', h: 22.5, icon: Moon },
                  ].map((t) => (
                    <button
                      key={t.label}
                      type="button"
                      onClick={() => onSetTimeOfDay(t.h)}
                      className="flex items-center justify-center gap-1 rounded-lg border border-slate-700 bg-slate-800 py-1.5 text-slate-200 hover:border-amber-400"
                    >
                      <t.icon className="h-3 w-3 text-amber-400" />
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delivery Summary Modal */}
      {activeModal === 'delivery_summary' && lastDeliveryResult && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-emerald-500/40 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center gap-3 text-emerald-400">
              <CheckCircle2 className="h-8 w-8" />
              <div>
                <h2 className="text-xl font-bold text-white">货运交付结算完成！</h2>
                <p className="text-xs text-slate-400">
                  {lastDeliveryResult.job.cargoName} → {lastDeliveryResult.job.destinationCityName}
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-2.5 rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-sm">
              <div className="flex justify-between text-slate-300">
                <span>基础运费</span>
                <span className="font-mono">€{lastDeliveryResult.basePayEur.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-emerald-400">
                <span>
                  {lastDeliveryResult.manualParking ? '精准倒车入库奖金 (+30%)' : '快速停靠模式'}
                </span>
                <span className="font-mono">+€{lastDeliveryResult.parkingBonusEur.toLocaleString()}</span>
              </div>
              {lastDeliveryResult.damagePenaltyEur > 0 && (
                <div className="flex justify-between text-rose-400">
                  <span>货损扣款 (完整度 {lastDeliveryResult.cargoHealth.toFixed(0)}%)</span>
                  <span className="font-mono">-€{lastDeliveryResult.damagePenaltyEur.toLocaleString()}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-slate-800 pt-2.5 text-base font-bold text-white">
                <span>实得总收入</span>
                <span className="font-mono text-emerald-400">
                  +€{lastDeliveryResult.totalEarnedEur.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between text-xs text-amber-300">
                <span>驾驶经验奖励</span>
                <span className="font-mono">+{lastDeliveryResult.xpEarned} XP</span>
              </div>
            </div>

            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => {
                  onRefreshJobs();
                  setActiveModal('jobs');
                }}
                className="flex-1 rounded-xl bg-amber-500 py-2.5 text-sm font-bold text-slate-950 hover:bg-amber-400"
              >
                继续接取下一单
              </button>
              <button
                type="button"
                onClick={() => setActiveModal('none')}
                className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-700"
              >
                自由漫游
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
