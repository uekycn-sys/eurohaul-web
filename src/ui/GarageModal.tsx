import { X, Wrench, Cpu, Fuel, Palette, Check } from 'lucide-react';
import {
  ENGINE_TIERS,
  TANK_TIERS,
  TRUCK_PAINT_PRESETS,
  getMaxFuelLiters,
  useGameStore,
} from '../store/useGameStore';

export function GarageModal() {
  const activeModal = useGameStore((s) => s.activeModal);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const moneyEur = useGameStore((s) => s.moneyEur);
  const engineTier = useGameStore((s) => s.engineTier);
  const tankTier = useGameStore((s) => s.tankTier);
  const paintHex = useGameStore((s) => s.paintHex);
  const truckHealth = useGameStore((s) => s.truckHealth);
  const fuelLiters = useGameStore((s) => s.fuelLiters);

  const upgradeEngine = useGameStore((s) => s.upgradeEngine);
  const upgradeTank = useGameStore((s) => s.upgradeTank);
  const setPaintHex = useGameStore((s) => s.setPaintHex);
  const repairTruckFull = useGameStore((s) => s.repairTruckFull);
  const refuelFull = useGameStore((s) => s.refuelFull);

  if (activeModal !== 'garage') return null;

  const maxFuel = getMaxFuelLiters(tankTier);
  const repairCost = Math.round(Math.max(0, 100 - truckHealth) * 45);
  const fuelCost = Math.round(Math.max(0, maxFuel - fuelLiters) * 1.65);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <Wrench className="h-5 w-5 text-sky-400" />
            <div>
              <h2 className="text-lg font-bold text-white">车库改装与维保中心 (Truck Garage)</h2>
              <p className="text-xs text-slate-400">
                当前资产: <span className="font-mono font-bold text-emerald-400">€{moneyEur.toLocaleString()}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setActiveModal('none')}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-6 overflow-y-auto p-6">
          {/* Maintenance & Refuel */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-700/80 bg-slate-800/50 p-4">
              <div className="flex items-center justify-between text-sm font-semibold text-white">
                <span>牵引车机械完整度</span>
                <span className="font-mono text-emerald-400">{truckHealth.toFixed(0)}%</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-700">
                <div
                  className="h-full bg-emerald-400 transition-all"
                  style={{ width: `${truckHealth}%` }}
                />
              </div>
              <button
                type="button"
                disabled={repairCost === 0}
                onClick={() => repairTruckFull()}
                className="mt-3 w-full rounded-lg bg-sky-500 py-2 text-xs font-bold text-slate-950 hover:bg-sky-400 disabled:bg-slate-700 disabled:text-slate-400"
              >
                {repairCost === 0 ? '车况完美 (无需维修)' : `全面整修 (-€${repairCost.toLocaleString()})`}
              </button>
            </div>

            <div className="rounded-xl border border-slate-700/80 bg-slate-800/50 p-4">
              <div className="flex items-center justify-between text-sm font-semibold text-white">
                <span>柴油油箱余量</span>
                <span className="font-mono text-amber-400">
                  {Math.round(fuelLiters)} / {maxFuel} L
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-700">
                <div
                  className="h-full bg-amber-400 transition-all"
                  style={{ width: `${(fuelLiters / maxFuel) * 100}%` }}
                />
              </div>
              <button
                type="button"
                disabled={fuelCost < 2}
                onClick={() => refuelFull()}
                className="mt-3 w-full rounded-lg bg-amber-500 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:bg-slate-700 disabled:text-slate-400"
              >
                {fuelCost < 2 ? '油箱已满' : `车库加满柴油 (-€${fuelCost.toLocaleString()})`}
              </button>
            </div>
          </div>

          {/* Engine Upgrades */}
          <div>
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
              <Cpu className="h-4 w-4 text-amber-400" />
              发动机动力总成升级 (真实提升爬坡扭矩与重货加速)
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {ENGINE_TIERS.map((eng) => {
                const owned = eng.tier <= engineTier;
                const active = eng.tier === engineTier;
                const canAfford = moneyEur >= eng.priceEur;
                return (
                  <div
                    key={eng.tier}
                    className={`rounded-xl border p-4 ${
                      active
                        ? 'border-amber-400 bg-amber-500/12'
                        : 'border-slate-700 bg-slate-800/50'
                    }`}
                  >
                    <div className="font-bold text-white">{eng.name}</div>
                    <div className="mt-1 font-mono text-xs text-amber-300">
                      {eng.hp} HP · {eng.maxTorqueNm} Nm
                    </div>
                    <button
                      type="button"
                      disabled={owned || !canAfford}
                      onClick={() => upgradeEngine(eng.tier)}
                      className="mt-3 flex w-full items-center justify-center gap-1 rounded-lg bg-amber-500 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                    >
                      {active ? (
                        <>
                          <Check className="h-3.5 w-3.5" /> 当前装配
                        </>
                      ) : owned ? (
                        '已解锁'
                      ) : canAfford ? (
                        `升级 €${eng.priceEur.toLocaleString()}`
                      ) : (
                        `余额不足 (€${eng.priceEur.toLocaleString()})`
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Tank Upgrades */}
          <div>
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
              <Fuel className="h-4 w-4 text-emerald-400" />
              长途油箱改装
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {TANK_TIERS.map((tank) => {
                const owned = tank.tier <= tankTier;
                const active = tank.tier === tankTier;
                const canAfford = moneyEur >= tank.priceEur;
                return (
                  <div
                    key={tank.tier}
                    className={`rounded-xl border p-4 ${
                      active
                        ? 'border-emerald-400 bg-emerald-500/12'
                        : 'border-slate-700 bg-slate-800/50'
                    }`}
                  >
                    <div className="font-bold text-white">{tank.name}</div>
                    <div className="mt-1 font-mono text-xs text-emerald-300">
                      容量 {tank.capacityLiters} L
                    </div>
                    <button
                      type="button"
                      disabled={owned || !canAfford}
                      onClick={() => upgradeTank(tank.tier)}
                      className="mt-3 w-full rounded-lg bg-emerald-500 py-1.5 text-xs font-bold text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                    >
                      {active
                        ? '当前装配'
                        : owned
                        ? '已解锁'
                        : canAfford
                        ? `改装 €${tank.priceEur.toLocaleString()}`
                        : `余额不足 (€${tank.priceEur.toLocaleString()})`}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Paint Shop */}
          <div>
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
              <Palette className="h-4 w-4 text-sky-400" />
              金属车漆定制 (€1,200 / 次)
            </div>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-6">
              {TRUCK_PAINT_PRESETS.map((swatch) => {
                const selected = paintHex === swatch.hex;
                return (
                  <button
                    key={swatch.hex}
                    type="button"
                    onClick={() => setPaintHex(swatch.hex)}
                    className={`flex flex-col items-center rounded-xl border p-2.5 transition ${
                      selected
                        ? 'border-white bg-slate-700/80'
                        : 'border-slate-700 bg-slate-800/50 hover:border-slate-500'
                    }`}
                  >
                    <span
                      className="h-7 w-7 rounded-full border border-white/30 shadow-inner"
                      style={{ backgroundColor: swatch.hex }}
                    />
                    <span className="mt-1.5 text-[11px] text-slate-200">{swatch.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
