import { memo } from 'react';
import {
  CheckCircle2,
  CloudRain,
  Gauge,
  Moon,
  Sun,
  Volume2,
} from 'lucide-react';
import {
  MobileSteeringStyle,
  QUALITY_SPECS,
  QualityPreset,
  WeatherSetting,
  useGameStore,
} from '../../store/useGameStore';

interface SettingsAndSummaryModalsProps {
  onRefreshJobs: () => void;
  onSetTimeOfDay: (hours: number) => void;
}

const PRESET_ORDER: QualityPreset[] = [
  'mobile_fast',
  'mobile_balanced',
  'pc_igpu',
  'high',
  'ultra',
];

export const SettingsAndSummaryModals = memo(function SettingsAndSummaryModals({
  onRefreshJobs,
  onSetTimeOfDay,
}: SettingsAndSummaryModalsProps) {
  const activeModal = useGameStore((s) => s.activeModal);
  const setActiveModal = useGameStore((s) => s.setActiveModal);
  const detectedDeviceLabel = useGameStore((s) => s.detectedDeviceLabel);
  const qualityPreset = useGameStore((s) => s.qualityPreset);
  const setQualityPreset = useGameStore((s) => s.setQualityPreset);
  const drsEnabled = useGameStore((s) => s.drsEnabled);
  const setDrsEnabled = useGameStore((s) => s.setDrsEnabled);
  const showFps = useGameStore((s) => s.showFps);
  const setShowFps = useGameStore((s) => s.setShowFps);
  const showDrawCalls = useGameStore((s) => s.showDrawCalls);
  const setShowDrawCalls = useGameStore((s) => s.setShowDrawCalls);
  const cabMotionEnabled = useGameStore((s) => s.cabMotionEnabled);
  const setCabMotionEnabled = useGameStore((s) => s.setCabMotionEnabled);
  const mirrorsEnabled = useGameStore((s) => s.mirrorsEnabled);
  const setMirrorsEnabled = useGameStore((s) => s.setMirrorsEnabled);
  const speedLimiterEnabled = useGameStore((s) => s.speedLimiterEnabled);
  const setSpeedLimiterEnabled = useGameStore((s) => s.setSpeedLimiterEnabled);
  const mobileControlsEnabled = useGameStore((s) => s.mobileControlsEnabled);
  const setMobileControlsEnabled = useGameStore((s) => s.setMobileControlsEnabled);
  const mobileSteeringStyle = useGameStore((s) => s.mobileSteeringStyle);
  const setMobileSteeringStyle = useGameStore((s) => s.setMobileSteeringStyle);
  const audioEnabled = useGameStore((s) => s.audioEnabled);
  const setAudioEnabled = useGameStore((s) => s.setAudioEnabled);
  const masterVolume = useGameStore((s) => s.masterVolume);
  const setMasterVolume = useGameStore((s) => s.setMasterVolume);
  const weatherSetting = useGameStore((s) => s.weatherSetting);
  const setWeatherSetting = useGameStore((s) => s.setWeatherSetting);
  const lastDeliveryResult = useGameStore((s) => s.lastDeliveryResult);
  const drsPixelRatio = useGameStore((s) => s.telemetry.drsPixelRatio);

  return (
    <>
      {activeModal === 'settings' && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-bold text-white">
                  <Gauge className="h-5 w-5 text-amber-400" />
                  模拟与性能设置
                </h2>
                <p className="mt-0.5 text-[11px] text-sky-300">硬件识别: {detectedDeviceLabel}</p>
              </div>
              <button
                type="button"
                onClick={() => setActiveModal('none')}
                className="rounded-lg bg-slate-800 px-2.5 py-1 text-xs text-slate-300"
              >
                完成
              </button>
            </div>

            <div className="mt-4 space-y-4 text-xs">
              <div>
                <div className="mb-2 font-semibold text-slate-300">5 档画质预设 (热切换)</div>
                <div className="grid grid-cols-2 gap-2">
                  {PRESET_ORDER.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => setQualityPreset(q)}
                      className={`rounded-lg border px-2.5 py-2 text-left ${
                        qualityPreset === q
                          ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                          : 'border-slate-700 bg-slate-800 text-slate-300'
                      }`}
                    >
                      <div className="font-semibold">{QUALITY_SPECS[q].label}</div>
                      <div className="mt-0.5 text-[10px] opacity-80">
                        {QUALITY_SPECS[q].shortDesc}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-300">
                  动态分辨率缩放 (DRS{' '}
                  <span className="font-mono text-sky-300">{drsPixelRatio.toFixed(2)}x</span>)
                </span>
                <button
                  type="button"
                  onClick={() => setDrsEnabled(!drsEnabled)}
                  className={`rounded-lg px-3 py-1 font-semibold ${
                    drsEnabled ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {drsEnabled ? '已开启' : '已关闭'}
                </button>
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
                <span className="text-slate-300">显示 Draw Call (DC)</span>
                <button
                  type="button"
                  onClick={() => setShowDrawCalls(!showDrawCalls)}
                  className={`rounded-lg px-3 py-1 font-semibold ${
                    showDrawCalls ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {showDrawCalls ? '已开启' : '已关闭'}
                </button>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-300">驾驶室减震晃动</span>
                <button
                  type="button"
                  onClick={() => setCabMotionEnabled(!cabMotionEnabled)}
                  className={`rounded-lg px-3 py-1 font-semibold ${
                    cabMotionEnabled ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {cabMotionEnabled ? '柔和' : '关闭'}
                </button>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-300">电子画中画后视镜 (20Hz交替)</span>
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

              <div className="flex items-center justify-between">
                <span className="text-slate-300">欧卡电子限速器 (90 / 110 km/h)</span>
                <button
                  type="button"
                  onClick={() => setSpeedLimiterEnabled(!speedLimiterEnabled)}
                  className={`rounded-lg px-3 py-1 font-semibold ${
                    speedLimiterEnabled
                      ? 'bg-amber-500 text-slate-950'
                      : 'bg-emerald-500 text-slate-950'
                  }`}
                >
                  {speedLimiterEnabled ? '开启 (90 km/h)' : '关闭 (110 km/h)'}
                </button>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-300">移动端触控 HUD</span>
                <button
                  type="button"
                  onClick={() => setMobileControlsEnabled(!mobileControlsEnabled)}
                  className={`rounded-lg px-3 py-1 font-semibold ${
                    mobileControlsEnabled
                      ? 'bg-sky-500 text-slate-950'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {mobileControlsEnabled ? '已开启' : '已关闭'}
                </button>
              </div>

              {mobileControlsEnabled && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-300">触控转向模式</span>
                  <div className="flex gap-1.5">
                    {(
                      [
                        ['wheel', '虚拟方向盘'],
                        ['buttons', '左右大按键'],
                      ] as [MobileSteeringStyle, string][]
                    ).map(([style, label]) => (
                      <button
                        key={style}
                        type="button"
                        onClick={() => setMobileSteeringStyle(style)}
                        className={`rounded-lg px-2.5 py-1 font-semibold ${
                          mobileSteeringStyle === style
                            ? 'bg-amber-500 text-slate-950'
                            : 'bg-slate-800 text-slate-300'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

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
                <div className="mb-2 flex items-center gap-1.5 font-semibold text-slate-300">
                  <CloudRain className="h-4 w-4 text-sky-400" />
                  天气系统 (动态降雨 / 湿滑路面)
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      ['auto', '自动动态'],
                      ['clear', '晴朗干燥'],
                      ['rain', '欧陆阵雨'],
                    ] as [WeatherSetting, string][]
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setWeatherSetting(mode)}
                      className={`rounded-lg border py-1.5 font-semibold ${
                        weatherSetting === mode
                          ? 'border-sky-400 bg-sky-500/20 text-sky-200'
                          : 'border-slate-700 bg-slate-800 text-slate-300'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
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
                <span className="font-mono">
                  +€{lastDeliveryResult.parkingBonusEur.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between text-sky-300">
                <span>{lastDeliveryResult.onTime ? '准点送达奖金 (+12%)' : '超时送达'}</span>
                <span className="font-mono">
                  +€{lastDeliveryResult.onTimeBonusEur.toLocaleString()}
                </span>
              </div>
              {lastDeliveryResult.damagePenaltyEur > 0 && (
                <div className="flex justify-between text-rose-400">
                  <span>货损扣款 (完整度 {lastDeliveryResult.cargoHealth.toFixed(0)}%)</span>
                  <span className="font-mono">
                    -€{lastDeliveryResult.damagePenaltyEur.toLocaleString()}
                  </span>
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
              <div className="flex justify-between border-t border-slate-800/80 pt-2 text-xs text-slate-300">
                <span>
                  百公里油耗:{' '}
                  <b className="font-mono text-white">
                    {lastDeliveryResult.avgFuelLPer100Km} L/100km
                  </b>
                </span>
                <span>
                  安全评级:{' '}
                  <b
                    className={`font-mono ${
                      lastDeliveryResult.safetyGrade === 'S'
                        ? 'text-emerald-400'
                        : lastDeliveryResult.safetyGrade === 'A'
                        ? 'text-sky-400'
                        : 'text-amber-400'
                    }`}
                  >
                    {lastDeliveryResult.safetyGrade} 级
                  </b>
                </span>
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
});
