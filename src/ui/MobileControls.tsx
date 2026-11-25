import { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Lightbulb,
  Link2,
  Megaphone,
  Smartphone,
  RotateCcw,
  Hand,
} from 'lucide-react';
import { useGameStore } from '../store/useGameStore';
import { MobileActionType } from '../core/GameEngine';

interface MobileControlsProps {
  onTouchSteer: (steerNorm: number | null) => void;
  onTouchThrottle: (val: number) => void;
  onTouchBrake: (val: number) => void;
  onTouchHorn: (active: boolean) => void;
  onMobileAction: (action: MobileActionType) => void;
}

export function MobileControls({
  onTouchSteer,
  onTouchThrottle,
  onTouchBrake,
  onTouchHorn,
  onMobileAction,
}: MobileControlsProps) {
  const mobileControlsEnabled = useGameStore((s) => s.mobileControlsEnabled);
  const mobileSteeringStyle = useGameStore((s) => s.mobileSteeringStyle);
  const activeModal = useGameStore((s) => s.activeModal);
  const telemetry = useGameStore((s) => s.telemetry);
  const nearbyInteraction = useGameStore((s) => s.nearbyInteraction);

  const [isPortrait, setIsPortrait] = useState(
    () => typeof window !== 'undefined' && window.innerHeight > window.innerWidth
  );
  const [portraitDismissed, setPortraitDismissed] = useState(false);

  const [wheelSteerVisual, setWheelSteerVisual] = useState(0);
  const [throttlePressed, setThrottlePressed] = useState(false);
  const [brakePressed, setBrakePressed] = useState(false);
  const [leftBtnPressed, setLeftBtnPressed] = useState(false);
  const [rightBtnPressed, setRightBtnPressed] = useState(false);

  const wheelRef = useRef<HTMLDivElement | null>(null);
  const wheelPointerId = useRef<number | null>(null);
  const throttlePointerId = useRef<number | null>(null);
  const brakePointerId = useRef<number | null>(null);
  const leftBtnPointerId = useRef<number | null>(null);
  const rightBtnPointerId = useRef<number | null>(null);

  useEffect(() => {
    const checkOrientation = () => {
      const portrait = window.innerHeight > window.innerWidth;
      setIsPortrait(portrait);
      if (!portrait) setPortraitDismissed(false);
    };
    window.addEventListener('resize', checkOrientation);
    window.addEventListener('orientationchange', checkOrientation);
    return () => {
      window.removeEventListener('resize', checkOrientation);
      window.removeEventListener('orientationchange', checkOrientation);
    };
  }, []);

  // Reset all active touch controls if disabled or modal opens
  useEffect(() => {
    if (!mobileControlsEnabled || activeModal !== 'none') {
      wheelPointerId.current = null;
      throttlePointerId.current = null;
      brakePointerId.current = null;
      leftBtnPointerId.current = null;
      rightBtnPointerId.current = null;
      setWheelSteerVisual(0);
      setThrottlePressed(false);
      setBrakePressed(false);
      setLeftBtnPressed(false);
      setRightBtnPressed(false);
      onTouchSteer(null);
      onTouchThrottle(0);
      onTouchBrake(0);
      onTouchHorn(false);
    }
  }, [mobileControlsEnabled, activeModal, onTouchSteer, onTouchThrottle, onTouchBrake, onTouchHorn]);

  if (!mobileControlsEnabled || activeModal !== 'none') return null;

  const updateWheelFromPointer = (clientX: number) => {
    const el = wheelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width * 0.5;
    const dx = clientX - cx;
    const maxDragPx = Math.max(44, rect.width * 0.44);
    // +1 = Left turn (drag left -> dx < 0), -1 = Right turn (drag right -> dx > 0)
    const steerNorm = Math.max(-1, Math.min(1, -dx / maxDragPx));
    setWheelSteerVisual(steerNorm);
    onTouchSteer(steerNorm);
  };

  return (
    <>
      {/* Portrait Orientation Recommendation Overlay */}
      {isPortrait && !portraitDismissed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-6 backdrop-blur-md">
          <div className="w-full max-w-xs rounded-2xl border border-amber-500/40 bg-slate-900 p-6 text-center shadow-2xl">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-400">
              <Smartphone className="h-7 w-7 rotate-90" />
            </div>
            <h3 className="mt-4 text-lg font-bold text-white">建议横屏驾驶</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-300">
              请旋转手机进入横屏模式，以获得完整的驾驶室视野与舒适的双手多点触控体验。
            </p>
            <button
              type="button"
              onClick={() => setPortraitDismissed(true)}
              className="mt-5 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-amber-500 py-2.5 text-xs font-bold text-slate-950 hover:bg-amber-400"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              继续竖屏游玩
            </button>
          </div>
        </div>
      )}

      {/* Bottom-Left Steering Zone */}
      <div
        className="fixed z-25 select-none"
        style={{
          left: 'max(14px, env(safe-area-inset-left, 0px))',
          bottom: 'max(14px, env(safe-area-inset-bottom, 0px))',
        }}
      >
        {mobileSteeringStyle === 'wheel' ? (
          <div
            ref={wheelRef}
            onPointerDown={(e) => {
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              wheelPointerId.current = e.pointerId;
              updateWheelFromPointer(e.clientX);
            }}
            onPointerMove={(e) => {
              if (wheelPointerId.current !== e.pointerId) return;
              updateWheelFromPointer(e.clientX);
            }}
            onPointerUp={(e) => {
              if (wheelPointerId.current !== e.pointerId) return;
              wheelPointerId.current = null;
              setWheelSteerVisual(0);
              onTouchSteer(null);
            }}
            onPointerCancel={(e) => {
              if (wheelPointerId.current !== e.pointerId) return;
              wheelPointerId.current = null;
              setWheelSteerVisual(0);
              onTouchSteer(null);
            }}
            className="relative flex h-[136px] w-[136px] touch-none items-center justify-center rounded-full border border-slate-600/60 bg-slate-950/45 shadow-2xl backdrop-blur-sm"
          >
            <svg
              viewBox="0 0 120 120"
              className="h-[122px] w-[122px] transition-transform duration-75"
              style={{ transform: `rotate(${-wheelSteerVisual * 380}deg)` }}
            >
              <circle
                cx="60"
                cy="60"
                r="48"
                fill="none"
                stroke="#334155"
                strokeWidth="12"
              />
              <circle
                cx="60"
                cy="60"
                r="48"
                fill="none"
                stroke="#f59e0b"
                strokeOpacity="0.8"
                strokeWidth="3"
                strokeDasharray="24 278"
                strokeDashoffset="12"
              />
              {/* Spokes */}
              <path
                d="M14 60 L44 60 M76 60 L106 60 M60 76 L60 106"
                stroke="#475569"
                strokeWidth="9"
                strokeLinecap="round"
              />
              {/* Center Hub */}
              <circle cx="60" cy="60" r="16" fill="#0f172a" stroke="#f59e0b" strokeWidth="2.5" />
              <text
                x="60"
                y="63"
                textAnchor="middle"
                fill="#fbbf24"
                fontSize="8"
                fontWeight="bold"
              >
                EURO
              </text>
            </svg>
          </div>
        ) : (
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                leftBtnPointerId.current = e.pointerId;
                setLeftBtnPressed(true);
                onTouchSteer(1);
              }}
              onPointerUp={(e) => {
                if (leftBtnPointerId.current !== e.pointerId) return;
                leftBtnPointerId.current = null;
                setLeftBtnPressed(false);
                onTouchSteer(rightBtnPressed ? -1 : null);
              }}
              onPointerCancel={(e) => {
                if (leftBtnPointerId.current !== e.pointerId) return;
                leftBtnPointerId.current = null;
                setLeftBtnPressed(false);
                onTouchSteer(null);
              }}
              className={`flex h-16 w-16 touch-none items-center justify-center rounded-2xl border text-xl font-black backdrop-blur-md transition ${
                leftBtnPressed
                  ? 'scale-95 border-amber-400 bg-amber-500/35 text-white'
                  : 'border-slate-600/80 bg-slate-900/70 text-slate-200'
              }`}
            >
              ◄
            </button>
            <button
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                rightBtnPointerId.current = e.pointerId;
                setRightBtnPressed(true);
                onTouchSteer(-1);
              }}
              onPointerUp={(e) => {
                if (rightBtnPointerId.current !== e.pointerId) return;
                rightBtnPointerId.current = null;
                setRightBtnPressed(false);
                onTouchSteer(leftBtnPressed ? 1 : null);
              }}
              onPointerCancel={(e) => {
                if (rightBtnPointerId.current !== e.pointerId) return;
                rightBtnPointerId.current = null;
                setRightBtnPressed(false);
                onTouchSteer(null);
              }}
              className={`flex h-16 w-16 touch-none items-center justify-center rounded-2xl border text-xl font-black backdrop-blur-md transition ${
                rightBtnPressed
                  ? 'scale-95 border-amber-400 bg-amber-500/35 text-white'
                  : 'border-slate-600/80 bg-slate-900/70 text-slate-200'
              }`}
            >
              ►
            </button>
          </div>
        )}
      </div>

      {/* Bottom-Right Quick Actions & Pedals */}
      <div
        className="fixed z-25 flex flex-col items-end gap-2 select-none"
        style={{
          right: 'max(14px, env(safe-area-inset-right, 0px))',
          bottom: 'max(14px, env(safe-area-inset-bottom, 0px))',
        }}
      >
        {/* Compact Quick Action Bar */}
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {nearbyInteraction && (
            <button
              type="button"
              onClick={() => onMobileAction('interact')}
              className="rounded-xl border border-amber-300 bg-amber-500 px-3 py-1.5 text-xs font-extrabold text-slate-950 shadow-lg"
            >
              交互
            </button>
          )}

          <button
            type="button"
            onClick={() => onMobileAction('left_blinker')}
            className={`rounded-xl border px-2.5 py-1.5 text-xs font-bold backdrop-blur-md ${
              telemetry.leftBlinker
                ? 'border-emerald-400 bg-emerald-500/30 text-emerald-300'
                : 'border-slate-700/80 bg-slate-900/75 text-slate-300'
            }`}
          >
            ◄
          </button>

          <button
            type="button"
            onClick={() => onMobileAction('right_blinker')}
            className={`rounded-xl border px-2.5 py-1.5 text-xs font-bold backdrop-blur-md ${
              telemetry.rightBlinker
                ? 'border-emerald-400 bg-emerald-500/30 text-emerald-300'
                : 'border-slate-700/80 bg-slate-900/75 text-slate-300'
            }`}
          >
            ►
          </button>

          <button
            type="button"
            onClick={() => onMobileAction('lights')}
            className={`rounded-xl border p-2 backdrop-blur-md ${
              telemetry.headlightMode > 0
                ? 'border-sky-400 bg-sky-500/25 text-sky-300'
                : 'border-slate-700/80 bg-slate-900/75 text-slate-300'
            }`}
            title="切换灯光"
          >
            <Lightbulb className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={() => onMobileAction('camera')}
            className="rounded-xl border border-slate-700/80 bg-slate-900/75 p-2 text-slate-200 backdrop-blur-md"
            title="切换视角"
          >
            <Camera className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={() => onMobileAction('trailer')}
            className={`rounded-xl border p-2 backdrop-blur-md ${
              telemetry.trailerAttached
                ? 'border-slate-700/80 bg-slate-900/75 text-emerald-300'
                : 'border-amber-400 bg-amber-500/25 text-amber-300'
            }`}
            title="挂/摘挂车"
          >
            <Link2 className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              onTouchHorn(true);
            }}
            onPointerUp={() => onTouchHorn(false)}
            onPointerCancel={() => onTouchHorn(false)}
            className="touch-none rounded-xl border border-slate-700/80 bg-slate-900/75 p-2 text-amber-300 backdrop-blur-md active:bg-amber-500/30"
            title="气喇叭"
          >
            <Megaphone className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={() => onMobileAction('parking_brake')}
            className={`flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs font-extrabold backdrop-blur-md ${
              telemetry.parkingBrake
                ? 'border-rose-400 bg-rose-600/85 text-white animate-pulse'
                : 'border-slate-700/80 bg-slate-900/75 text-slate-300'
            }`}
          >
            <Hand className="h-3.5 w-3.5" />
            P
          </button>
        </div>

        {/* Multi-touch Brake/Reverse + Throttle Pedals */}
        <div className="flex items-end gap-2.5">
          <button
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              brakePointerId.current = e.pointerId;
              setBrakePressed(true);
              onTouchBrake(1);
            }}
            onPointerUp={(e) => {
              if (brakePointerId.current !== e.pointerId) return;
              brakePointerId.current = null;
              setBrakePressed(false);
              onTouchBrake(0);
            }}
            onPointerCancel={(e) => {
              if (brakePointerId.current !== e.pointerId) return;
              brakePointerId.current = null;
              setBrakePressed(false);
              onTouchBrake(0);
            }}
            className={`flex h-[82px] w-[70px] touch-none flex-col items-center justify-center rounded-2xl border-2 font-bold backdrop-blur-md transition ${
              brakePressed
                ? 'scale-95 border-rose-400 bg-rose-600/55 text-white shadow-lg shadow-rose-500/30'
                : 'border-rose-500/45 bg-slate-950/65 text-rose-300'
            }`}
          >
            <span className="text-xs">刹车</span>
            <span className="mt-0.5 text-[10px] opacity-80">倒车</span>
          </button>

          <button
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              throttlePointerId.current = e.pointerId;
              setThrottlePressed(true);
              onTouchThrottle(1);
            }}
            onPointerUp={(e) => {
              if (throttlePointerId.current !== e.pointerId) return;
              throttlePointerId.current = null;
              setThrottlePressed(false);
              onTouchThrottle(0);
            }}
            onPointerCancel={(e) => {
              if (throttlePointerId.current !== e.pointerId) return;
              throttlePointerId.current = null;
              setThrottlePressed(false);
              onTouchThrottle(0);
            }}
            className={`flex h-[102px] w-[76px] touch-none flex-col items-center justify-center rounded-2xl border-2 font-bold backdrop-blur-md transition ${
              throttlePressed
                ? 'scale-95 border-emerald-400 bg-emerald-500/55 text-white shadow-lg shadow-emerald-500/30'
                : 'border-emerald-500/45 bg-slate-950/65 text-emerald-300'
            }`}
          >
            <span className="text-sm">油门</span>
            <span className="mt-1 text-[10px] opacity-80">GAS</span>
          </button>
        </div>
      </div>
    </>
  );
}
