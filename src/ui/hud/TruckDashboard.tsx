import { memo } from 'react';
import { Fuel, ShieldAlert } from 'lucide-react';
import { getMaxFuelLiters, useGameStore } from '../../store/useGameStore';

export const TruckDashboard = memo(function TruckDashboard() {
  const tankTier = useGameStore((s) => s.tankTier);
  const fuelLiters = useGameStore((s) => s.fuelLiters);
  const cameraMode = useGameStore((s) => s.cameraMode);
  const mobileControlsEnabled = useGameStore((s) => s.mobileControlsEnabled);
  const transmissionMode = useGameStore((s) => s.transmissionMode);
  const toggleTransmissionMode = useGameStore((s) => s.toggleTransmissionMode);

  const speedKmh = useGameStore((s) => s.telemetry.speedKmh);
  const rpm = useGameStore((s) => s.telemetry.rpm);
  const gearLabel = useGameStore((s) => s.telemetry.gearLabel);
  const isSpeeding = useGameStore((s) => s.telemetry.isSpeeding);
  const odometerKm = useGameStore((s) => s.telemetry.odometerKm);
  const blinkerLit = useGameStore((s) => s.telemetry.blinkerLit);
  const leftBlinker = useGameStore((s) => s.telemetry.leftBlinker);
  const rightBlinker = useGameStore((s) => s.telemetry.rightBlinker);
  const hazardLights = useGameStore((s) => s.telemetry.hazardLights);
  const headlightMode = useGameStore((s) => s.telemetry.headlightMode);
  const parkingBrake = useGameStore((s) => s.telemetry.parkingBrake);
  const cruiseControlKmh = useGameStore((s) => s.telemetry.cruiseControlKmh);
  const retarderLevel = useGameStore((s) => s.telemetry.retarderLevel);
  const wipersMode = useGameStore((s) => s.telemetry.wipersMode);
  const airPressureBar = useGameStore((s) => s.telemetry.airPressureBar);
  const lowAirWarning = useGameStore((s) => s.telemetry.lowAirWarning);
  const emergencyBrakeLock = useGameStore((s) => s.telemetry.emergencyBrakeLock);
  const brakeTempC = useGameStore((s) => s.telemetry.brakeTempC);
  const engineRunning = useGameStore((s) => s.telemetry.engineRunning);
  const engineStalled = useGameStore((s) => s.telemetry.engineStalled);
  const exhaustBrakeActive = useGameStore((s) => s.telemetry.exhaustBrakeActive);
  const diffLockActive = useGameStore((s) => s.telemetry.diffLockActive);
  const clutchPedal = useGameStore((s) => s.telemetry.clutchPedal);
  const frontWheelAngleDeg = useGameStore((s) => s.telemetry.frontWheelAngleDeg);
  const hitchAngleDeg = useGameStore((s) => s.telemetry.hitchAngleDeg);

  const maxFuel = getMaxFuelLiters(tankTier);
  const fuelPct = Math.round((fuelLiters / maxFuel) * 100);
  const rpmPct = Math.min(100, Math.max(0, ((rpm - 600) / 1750) * 100));
  const airPct = Math.min(100, Math.max(0, (airPressureBar / 8.5) * 100));

  // In 1st-person Cab View, hide the large centered 2D speed/gear bar so the 3D wheel & gauges remain unobstructed
  if (cameraMode === 1 && !mobileControlsEnabled) {
    return (
      <div className="pointer-events-none fixed bottom-3 left-3 z-20">
        <div className="pointer-events-auto flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-700/75 bg-slate-950/82 px-2.5 py-1.5 text-[10px] font-bold shadow-lg backdrop-blur-md">
          <div className="flex items-center gap-1">
            <span
              className={
                blinkerLit && (leftBlinker || hazardLights) ? 'text-emerald-400' : 'text-slate-600'
              }
            >
              ◄
            </span>
            <span
              className={
                blinkerLit && (rightBlinker || hazardLights) ? 'text-emerald-400' : 'text-slate-600'
              }
            >
              ►
            </span>
          </div>
          <span
            className={`rounded px-1.5 py-0.5 ${
              headlightMode === 2
                ? 'bg-sky-500 text-slate-950'
                : headlightMode === 1
                ? 'bg-emerald-500/25 text-emerald-300'
                : 'bg-slate-800 text-slate-500'
            }`}
          >
            {headlightMode === 2 ? '远光' : headlightMode === 1 ? '近光' : '关灯'}
          </span>
          <span
            className={`rounded px-1.5 py-0.5 ${
              parkingBrake ? 'bg-rose-600 text-white' : 'bg-slate-800 text-slate-500'
            }`}
          >
            P
          </span>
          {!engineRunning && (
            <span className="animate-pulse rounded bg-rose-600 px-1.5 py-0.5 text-white">
              {engineStalled ? '熄火 [I]' : '关机 [I]'}
            </span>
          )}
          <span
            className={`rounded px-1.5 py-0.5 font-mono ${
              lowAirWarning ? 'animate-pulse bg-rose-600 text-white' : 'bg-sky-500/20 text-sky-300'
            }`}
          >
            气{(airPressureBar / 10).toFixed(2)}MPa
          </span>
          {exhaustBrakeActive && (
            <span className="rounded bg-sky-500/25 px-1.5 py-0.5 text-sky-300">排气</span>
          )}
          {diffLockActive && (
            <span className="rounded bg-amber-500/25 px-1.5 py-0.5 text-amber-300">差速</span>
          )}
          {retarderLevel > 0 && (
            <span className="rounded bg-amber-500/25 px-1.5 py-0.5 text-amber-300">
              R{retarderLevel}
            </span>
          )}
          {brakeTempC > 180 && (
            <span
              className={`rounded px-1.5 py-0.5 font-mono ${
                brakeTempC > 300 ? 'bg-rose-600 text-white' : 'bg-amber-500/25 text-amber-300'
              }`}
            >
              闸{brakeTempC}°C
            </span>
          )}
          <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-slate-300">
            轮{frontWheelAngleDeg > 0 ? `左${frontWheelAngleDeg}` : frontWheelAngleDeg < 0 ? `右${-frontWheelAngleDeg}` : '0'}° · 挂{hitchAngleDeg}°
          </span>
          <span
            className={`rounded px-1.5 py-0.5 ${
              cruiseControlKmh !== null
                ? 'bg-emerald-500/25 text-emerald-300'
                : 'bg-slate-800 text-slate-500'
            }`}
          >
            CC {cruiseControlKmh ?? '--'}
          </span>
          {wipersMode > 0 && (
            <span className="rounded bg-sky-500/25 px-1.5 py-0.5 text-sky-300">
              刷{wipersMode}
            </span>
          )}
          <span className={`font-mono ${fuelPct < 18 ? 'text-rose-400' : 'text-amber-300'}`}>
            油{fuelPct}%
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`pointer-events-none fixed z-20 ${
        mobileControlsEnabled
          ? 'left-1/2 -translate-x-1/2'
          : 'bottom-3 left-1/2 -translate-x-1/2 sm:left-3 sm:translate-x-0 lg:left-1/2 lg:-translate-x-1/2'
      }`}
      style={
        mobileControlsEnabled
          ? { bottom: 'max(10px, env(safe-area-inset-bottom, 0px))' }
          : undefined
      }
    >
      <div
        className={`pointer-events-auto flex items-center rounded-2xl border border-slate-700/80 bg-slate-950/88 shadow-2xl backdrop-blur-md ${
          mobileControlsEnabled ? 'gap-2.5 px-3 py-1.5' : 'gap-4 px-4 py-2.5'
        }`}
      >
        <div className="flex flex-col items-center gap-1.5">
          <div className="flex items-center gap-2">
            <span
              className={`text-sm font-bold ${
                blinkerLit && (leftBlinker || hazardLights)
                  ? 'text-emerald-400'
                  : 'text-slate-700'
              }`}
            >
              ◄
            </span>
            <span
              className={`text-sm font-bold ${
                blinkerLit && (rightBlinker || hazardLights)
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
                headlightMode === 2
                  ? 'bg-sky-500 text-slate-950'
                  : headlightMode === 1
                  ? 'bg-emerald-500/25 text-emerald-300'
                  : 'bg-slate-800 text-slate-500'
              }`}
            >
              {headlightMode === 2 ? '远光' : headlightMode === 1 ? '近光' : '关灯'}
            </span>
            <span
              className={`rounded px-1.5 py-0.5 ${
                parkingBrake ? 'bg-rose-600 text-white' : 'bg-slate-800 text-slate-500'
              }`}
            >
              P
            </span>
          </div>
        </div>

        <div className="min-w-[116px] text-center">
          <div className="flex items-baseline justify-center gap-1">
            <span
              className={`font-mono text-3xl font-black leading-none ${
                isSpeeding ? 'text-rose-400' : 'text-white'
              }`}
            >
              {speedKmh}
            </span>
            <span className="text-[10px] font-semibold text-slate-400">KM/H</span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className={`h-full transition-all duration-75 ${
                rpm > 1850 ? 'bg-rose-500' : rpm > 1500 ? 'bg-amber-400' : 'bg-emerald-400'
              }`}
              style={{ width: `${rpmPct}%` }}
            />
          </div>
          <div className="mt-0.5 flex justify-between font-mono text-[10px] text-slate-400">
            <span>{rpm} RPM</span>
            <span>{odometerKm.toFixed(1)}km</span>
          </div>
        </div>

        <div className="flex flex-col items-center gap-1">
          <button
            type="button"
            onClick={toggleTransmissionMode}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 hover:border-amber-400"
            title="点击切换 自动/序列手动变速箱"
          >
            <span className="font-mono text-lg font-black text-amber-400">{gearLabel}</span>
            <span className="text-[9px] uppercase text-slate-400">
              {transmissionMode === 'auto' ? 'AT' : 'MT'}
            </span>
          </button>
          <div className="flex items-center gap-1 text-[10px] font-semibold">
            <span
              className={`rounded px-1.5 py-0.5 ${
                cruiseControlKmh !== null
                  ? 'bg-emerald-500/25 text-emerald-300'
                  : 'bg-slate-800 text-slate-500'
              }`}
            >
              CC {cruiseControlKmh ?? '--'}
            </span>
            <span
              className={`rounded px-1.5 py-0.5 ${
                retarderLevel > 0 ? 'bg-amber-500/25 text-amber-300' : 'bg-slate-800 text-slate-500'
              }`}
            >
              R{retarderLevel}
            </span>
            {exhaustBrakeActive && (
              <span className="rounded bg-sky-500/25 px-1.5 py-0.5 text-sky-300">排气</span>
            )}
            {diffLockActive && (
              <span className="rounded bg-amber-500/25 px-1.5 py-0.5 text-amber-300">差速</span>
            )}
            {wipersMode > 0 && (
              <span className="rounded bg-sky-500/25 px-1.5 py-0.5 text-sky-300">
                刷{wipersMode}
              </span>
            )}
          </div>
          {!engineRunning && (
            <div className="animate-pulse rounded bg-rose-600 px-1.5 py-0.5 text-[9px] font-bold text-white">
              {engineStalled ? '已熄火 · 按 I 启动' : '引擎关闭 · 按 I'}
            </div>
          )}
        </div>

        <div className="hidden flex-col gap-1 text-[10px] sm:flex">
          <div className="flex items-center gap-1.5" title="双回路制动储气筒压力 (MPa)">
            <span className={`w-5 font-bold ${lowAirWarning ? 'animate-pulse text-rose-400' : 'text-sky-400'}`}>
              气压
            </span>
            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-800">
              <div
                className={`h-full ${emergencyBrakeLock || lowAirWarning ? 'bg-rose-500' : 'bg-sky-400'}`}
                style={{ width: `${airPct}%` }}
              />
            </div>
            <span className="w-11 font-mono text-slate-300">{(airPressureBar / 10).toFixed(2)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Fuel
              className={`h-3.5 w-3.5 ${
                fuelPct < 18 ? 'animate-pulse text-rose-400' : 'text-amber-400'
              }`}
            />
            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-800">
              <div
                className={`h-full ${fuelPct < 18 ? 'bg-rose-500' : 'bg-amber-400'}`}
                style={{ width: `${fuelPct}%` }}
              />
            </div>
            <span className="w-8 font-mono text-slate-300">{fuelPct}%</span>
          </div>
          <div className="flex items-center gap-1.5">
            <ShieldAlert className="h-3.5 w-3.5 text-emerald-400" />
            <span className="font-mono text-[9px] text-slate-300">
              轮{frontWheelAngleDeg > 0 ? `L${frontWheelAngleDeg}` : frontWheelAngleDeg < 0 ? `R${-frontWheelAngleDeg}` : '0'}°·挂{hitchAngleDeg}°
              {transmissionMode === 'sequential' && clutchPedal > 0.05 ? `·离${Math.round(clutchPedal * 100)}%` : ''}
            </span>
          </div>
          {brakeTempC > 180 && (
            <div className={`font-mono text-[9px] ${brakeTempC > 300 ? 'animate-pulse text-rose-400' : 'text-amber-300'}`}>
              刹车温 {brakeTempC}°C
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
