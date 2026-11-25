import { useState } from 'react';
import {
  Truck,
  Play,
  MapPin,
  Settings2,
  Volume2,
  VolumeX,
  Eye,
  RotateCcw,
  Award,
  Coins,
  Maximize2,
  Minimize2,
  Info,
} from 'lucide-react';
import {
  ENGINE_TIERS,
  QUALITY_SPECS,
  QualityPreset,
  useGameStore,
} from '../store/useGameStore';
import { MapRegistry } from '../map/MapRegistry';
import { toggleDocumentFullscreen, useIsFullscreen } from '../utils/fullscreen';

interface MainMenuProps {
  onSelectMap: (mapId: string) => void;
}

const PRESET_ORDER: QualityPreset[] = ['mobile_fast', 'mobile_balanced', 'pc_igpu', 'high', 'ultra'];

export function MainMenu({ onSelectMap }: MainMenuProps) {
  const maps = MapRegistry.getAllMaps();
  const [confirmReset, setConfirmReset] = useState(false);
  const [showGpuGuide, setShowGpuGuide] = useState(false);
  const isFullscreen = useIsFullscreen();

  const selectedMapId = useGameStore((s) => s.selectedMapId);
  const setSelectedMapId = useGameStore((s) => s.setSelectedMapId);
  const setGamePhase = useGameStore((s) => s.setGamePhase);
  const moneyEur = useGameStore((s) => s.moneyEur);
  const level = useGameStore((s) => s.level);
  const completedJobs = useGameStore((s) => s.completedJobs);
  const totalDistanceKm = useGameStore((s) => s.totalDistanceKm);
  const engineTier = useGameStore((s) => s.engineTier);
  const qualityPreset = useGameStore((s) => s.qualityPreset);
  const setQualityPreset = useGameStore((s) => s.setQualityPreset);
  const mirrorsEnabled = useGameStore((s) => s.mirrorsEnabled);
  const setMirrorsEnabled = useGameStore((s) => s.setMirrorsEnabled);
  const audioEnabled = useGameStore((s) => s.audioEnabled);
  const setAudioEnabled = useGameStore((s) => s.setAudioEnabled);
  const mobileControlsEnabled = useGameStore((s) => s.mobileControlsEnabled);
  const setMobileControlsEnabled = useGameStore((s) => s.setMobileControlsEnabled);
  const detectedDeviceLabel = useGameStore((s) => s.detectedDeviceLabel);
  const resetCareer = useGameStore((s) => s.resetCareer);

  const engineSpec = ENGINE_TIERS[engineTier] ?? ENGINE_TIERS[0]!;
  const isIntegratedHint =
    /核显|Intel|UHD|Iris|桌面端/i.test(detectedDeviceLabel) &&
    !/高性能独显/i.test(detectedDeviceLabel);

  return (
    <div className="safe-area-inset absolute inset-0 z-30 flex items-center justify-center overflow-y-auto bg-gradient-to-br from-slate-950/85 via-slate-900/65 to-slate-950/85 p-3 backdrop-blur-[2px] sm:p-4">
      <div className="relative my-auto grid max-h-[94vh] w-full max-w-5xl grid-cols-1 gap-5 overflow-y-auto rounded-3xl border border-amber-500/25 bg-slate-900/90 p-5 shadow-2xl lg:grid-cols-12 lg:p-8">
        <button
          type="button"
          onClick={() => void toggleDocumentFullscreen()}
          className="absolute top-4 right-4 z-10 inline-flex items-center gap-1.5 rounded-xl border border-slate-700/80 bg-slate-800/80 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:border-amber-400/60 hover:text-white"
          title="进入/退出全屏 [F]"
        >
          {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          <span className="hidden sm:inline">{isFullscreen ? '退出全屏' : '全屏'}</span>
        </button>
        {/* Left Column: Branding + Career Overview + Launch */}
        <div className="flex flex-col justify-between lg:col-span-5">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/35 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-300">
              <Truck className="h-3.5 w-3.5" />
              WEBGL 3D TRUCK SIMULATOR
            </div>
            <h1 className="mt-3 text-4xl font-extrabold tracking-tight text-white">
              EuroHaul <span className="text-amber-400">Web</span>
            </h1>
            <p className="mt-1.5 text-sm text-slate-300">
              致敬《欧洲卡车模拟 2》的浏览器端硬核重卡货运体验
            </p>

            {/* Career Card */}
            <div className="mt-5 grid grid-cols-2 gap-3 rounded-2xl border border-slate-700/70 bg-slate-800/65 p-4">
              <div>
                <div className="flex items-center gap-1.5 text-xs text-slate-400">
                  <Coins className="h-3.5 w-3.5 text-emerald-400" />
                  公司资金
                </div>
                <div className="mt-0.5 font-mono text-xl font-bold text-emerald-400">
                  €{moneyEur.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-xs text-slate-400">
                  <Award className="h-3.5 w-3.5 text-amber-400" />
                  驾驶员等级
                </div>
                <div className="mt-0.5 font-mono text-xl font-bold text-white">
                  Lv.{level}{' '}
                  <span className="text-xs font-normal text-slate-400">
                    ({completedJobs} 单)
                  </span>
                </div>
              </div>
              <div className="col-span-2 flex items-center justify-between border-t border-slate-700/70 pt-2.5 text-xs text-slate-300">
                <span>动力配置: {engineSpec.name} ({engineSpec.hp} HP)</span>
                <span className="font-mono text-amber-300">
                  {totalDistanceKm.toFixed(1)} km
                </span>
              </div>
            </div>
          </div>

          <div className="mt-6 space-y-2.5">
            <button
              type="button"
              onClick={() => setGamePhase('playing')}
              className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-amber-500 px-6 py-3.5 text-base font-bold text-slate-950 shadow-lg shadow-amber-500/25 transition hover:bg-amber-400 active:scale-[0.99]"
            >
              <Play className="h-5 w-5 fill-current" />
              {completedJobs > 0 || totalDistanceKm > 0.2 ? '继续驾驶生涯' : '开始货运生涯'}
            </button>

            <div className="flex items-center justify-between pt-1">
              {!confirmReset ? (
                <button
                  type="button"
                  onClick={() => setConfirmReset(true)}
                  className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-rose-400"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  重置本地存档
                </button>
              ) : (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-rose-400">确认清空资产与等级?</span>
                  <button
                    type="button"
                    onClick={() => {
                      resetCareer();
                      setConfirmReset(false);
                    }}
                    className="rounded bg-rose-600 px-2 py-0.5 font-semibold text-white hover:bg-rose-500"
                  >
                    确认
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmReset(false)}
                    className="rounded bg-slate-700 px-2 py-0.5 text-slate-200 hover:bg-slate-600"
                  >
                    取消
                  </button>
                </div>
              )}
              <span className="text-xs text-slate-500">按 Space 松开手刹起步</span>
            </div>
          </div>
        </div>

        {/* Right Column: Map Selection & Graphics/Audio Settings */}
        <div className="flex flex-col justify-between space-y-5 lg:col-span-7">
          {/* Map Selector */}
          <div className="rounded-2xl border border-slate-700/70 bg-slate-800/50 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <MapPin className="h-4 w-4 text-amber-400" />
              选择货运版图
            </div>
            <div className="mt-3 space-y-2">
              {maps.map((m) => {
                const selected = m.id === selectedMapId;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      setSelectedMapId(m.id);
                      onSelectMap(m.id);
                    }}
                    className={`w-full rounded-xl border p-3.5 text-left transition ${
                      selected
                        ? 'border-amber-400 bg-amber-500/12'
                        : 'border-slate-700 bg-slate-900/50 hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-white">{m.name}</span>
                      <span className="rounded-full bg-slate-700/80 px-2.5 py-0.5 text-[11px] text-amber-300">
                        {m.cities.length} 座城市 · 约 {m.recommendedDurationMin} 分钟环线
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-amber-200/80">{m.subtitle}</div>
                    <p className="mt-1.5 text-xs leading-relaxed text-slate-300">
                      {m.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Hardware & Audio Settings */}
          <div className="rounded-2xl border border-slate-700/70 bg-slate-800/50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 pr-14 sm:pr-20">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Settings2 className="h-4 w-4 text-sky-400" />
                画质分级与多端硬件适配
              </div>
              <div className="relative flex items-center gap-1.5">
                <span className="rounded-full bg-sky-500/15 px-2.5 py-0.5 text-[11px] font-medium text-sky-300">
                  已识别: {detectedDeviceLabel}
                </span>
                {isIntegratedHint && (
                  <button
                    type="button"
                    onClick={() => setShowGpuGuide((v) => !v)}
                    onMouseEnter={() => setShowGpuGuide(true)}
                    onMouseLeave={() => setShowGpuGuide(false)}
                    className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300 hover:bg-amber-500/25"
                    title="双显卡切换独显说明"
                  >
                    <Info className="h-3 w-3" />
                    独显引导
                  </button>
                )}
                {isIntegratedHint && showGpuGuide && (
                  <div className="absolute top-7 right-0 z-30 w-72 rounded-xl border border-amber-400/40 bg-slate-950/95 p-3 text-[11px] leading-relaxed text-slate-200 shadow-2xl backdrop-blur-md">
                    双显卡电脑可能因 Windows 省电策略默认使用核显运行浏览器；若需调用独显，请在{' '}
                    <span className="font-semibold text-amber-300">
                      Windows 设置 → 系统 → 屏幕 → 显示卡
                    </span>{' '}
                    中将浏览器设为「高性能」，或直接手动点选高画质。
                  </div>
                )}
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {PRESET_ORDER.map((presetId) => {
                const preset = QUALITY_SPECS[presetId];
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setQualityPreset(preset.id)}
                    className={`rounded-xl border px-3 py-2 text-left transition ${
                      qualityPreset === preset.id
                        ? 'border-sky-400 bg-sky-500/15 text-white'
                        : 'border-slate-700 bg-slate-900/50 text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    <div className="text-xs font-semibold">{preset.label}</div>
                    <div className="mt-0.5 text-[10px] leading-snug text-slate-400">
                      {preset.shortDesc}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setMirrorsEnabled(!mirrorsEnabled)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                  mirrorsEnabled
                    ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300'
                    : 'border-slate-700 bg-slate-900/60 text-slate-400'
                }`}
              >
                <Eye className="h-3.5 w-3.5" />
                电子后视镜: {mirrorsEnabled ? '开启' : '关闭'}
              </button>

              <button
                type="button"
                onClick={() => setAudioEnabled(!audioEnabled)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                  audioEnabled
                    ? 'border-amber-500/50 bg-amber-500/15 text-amber-300'
                    : 'border-slate-700 bg-slate-900/60 text-slate-400'
                }`}
              >
                {audioEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
                声浪: {audioEnabled ? '开启' : '静音'}
              </button>

              <button
                type="button"
                onClick={() => setMobileControlsEnabled(!mobileControlsEnabled)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                  mobileControlsEnabled
                    ? 'border-sky-500/50 bg-sky-500/15 text-sky-300'
                    : 'border-slate-700 bg-slate-900/60 text-slate-400'
                }`}
              >
                触控 HUD: {mobileControlsEnabled ? '开启' : '关闭'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
