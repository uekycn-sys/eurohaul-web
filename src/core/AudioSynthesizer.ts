import { WipersMode } from '../store/useGameStore';

/**
 * Real-time Web Audio API synthesizer for EuroHaul Web.
 * Multi-layer I6 / V8 diesel synthesis, turbo boost & blow-off, tire/offroad/wet-spray noise,
 * high-speed wind rush, camera-aware cabin low-pass insulation, wiper swish, E-Toll chime,
 * fifth-wheel mechanical lock, and distant thunder — with zero external assets.
 */
export class AudioSynthesizer {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private exteriorBus: GainNode | null = null;
  private cabinFilter: BiquadFilterNode | null = null;
  private interiorBus: GainNode | null = null;

  private engineSubOsc: OscillatorNode | null = null;
  private engineOsc1: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineSubGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private exhaustPeakFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;
  private injectorSource: AudioBufferSourceNode | null = null;
  private injectorGain: GainNode | null = null;

  private turboOsc: OscillatorNode | null = null;
  private turboGain: GainNode | null = null;

  private hornOsc1: OscillatorNode | null = null;
  private hornOsc2: OscillatorNode | null = null;
  private hornGain: GainNode | null = null;

  private rainGain: GainNode | null = null;
  private rainSource: AudioBufferSourceNode | null = null;

  private tireSource: AudioBufferSourceNode | null = null;
  private tireFilter: BiquadFilterNode | null = null;
  private tireGain: GainNode | null = null;
  private wetSprayGain: GainNode | null = null;

  private windSource: AudioBufferSourceNode | null = null;
  private windGain: GainNode | null = null;

  private exhaustBrakeOsc: OscillatorNode | null = null;
  private exhaustBrakeGain: GainNode | null = null;

  private noiseBuffer: AudioBuffer | null = null;
  private enabled = true;
  private volume = 0.6;
  private lastEngineTier = 0;
  private prevBlinkerLit = false;
  private prevParkingBrake = true;
  private prevGear = 1;
  private reverseBeepClock = 0;
  private lowAirBeepClock = 0;
  private prevWiperAngle = -0.02;
  private prevWiperDir = 0;
  private wiperSwishCooldown = 0;

  public unlock(): void {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      this.setupGraph(this.ctx);
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  private setupGraph(ctx: AudioContext): void {
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = this.enabled ? this.volume : 0;
    this.masterGain.connect(ctx.destination);

    // Exterior bus -> cabin insulation lowpass -> master
    this.exteriorBus = ctx.createGain();
    this.exteriorBus.gain.value = 1.0;
    this.cabinFilter = ctx.createBiquadFilter();
    this.cabinFilter.type = 'lowpass';
    this.cabinFilter.frequency.value = 850;
    this.cabinFilter.Q.value = 0.6;
    this.exteriorBus.connect(this.cabinFilter);
    this.cabinFilter.connect(this.masterGain);

    // Interior bus (unfiltered cab relays, chimes, wipers, UI cues) -> master
    this.interiorBus = ctx.createGain();
    this.interiorBus.gain.value = 1.0;
    this.interiorBus.connect(this.masterGain);

    // Noise buffer for air brakes, tires, wind, rain & collisions
    const bufLen = ctx.sampleRate * 1.5;
    this.noiseBuffer = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufLen; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    // Multi-layer Diesel Engine (sub-harmonic + firing fundamental + harmonic + exhaust peak + injector clatter)
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 180;
    this.engineFilter.Q.value = 2.0;

    this.exhaustPeakFilter = ctx.createBiquadFilter();
    this.exhaustPeakFilter.type = 'peaking';
    this.exhaustPeakFilter.frequency.value = 95;
    this.exhaustPeakFilter.Q.value = 1.8;
    this.exhaustPeakFilter.gain.value = 3.0;

    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0.14;

    this.engineSubOsc = ctx.createOscillator();
    this.engineSubOsc.type = 'sine';
    this.engineSubOsc.frequency.value = 17;
    this.engineSubGain = ctx.createGain();
    this.engineSubGain.gain.value = 0.55;

    this.engineOsc1 = ctx.createOscillator();
    this.engineOsc1.type = 'sawtooth';
    this.engineOsc1.frequency.value = 34;

    this.engineOsc2 = ctx.createOscillator();
    this.engineOsc2.type = 'triangle';
    this.engineOsc2.frequency.value = 68;

    this.engineSubOsc.connect(this.engineSubGain);
    this.engineSubGain.connect(this.engineFilter);
    this.engineOsc1.connect(this.engineFilter);
    this.engineOsc2.connect(this.engineFilter);
    this.engineFilter.connect(this.exhaustPeakFilter);
    this.exhaustPeakFilter.connect(this.engineGain);
    this.engineGain.connect(this.exteriorBus);

    this.engineSubOsc.start();
    this.engineOsc1.start();
    this.engineOsc2.start();

    // Mechanical diesel injector clatter
    const injectorFilter = ctx.createBiquadFilter();
    injectorFilter.type = 'bandpass';
    injectorFilter.frequency.value = 1350;
    injectorFilter.Q.value = 2.5;
    this.injectorGain = ctx.createGain();
    this.injectorGain.gain.value = 0;
    this.injectorSource = ctx.createBufferSource();
    this.injectorSource.buffer = this.noiseBuffer;
    this.injectorSource.loop = true;
    this.injectorSource.connect(injectorFilter);
    injectorFilter.connect(this.injectorGain);
    this.injectorGain.connect(this.exteriorBus);
    this.injectorSource.start();

    // Turbocharger spool whistle
    this.turboOsc = ctx.createOscillator();
    this.turboOsc.type = 'sine';
    this.turboOsc.frequency.value = 1400;
    this.turboGain = ctx.createGain();
    this.turboGain.gain.value = 0;
    this.turboOsc.connect(this.turboGain);
    this.turboGain.connect(this.exteriorBus);
    this.turboOsc.start();

    // Dual-tone truck air horn
    const hornFilter = ctx.createBiquadFilter();
    hornFilter.type = 'lowpass';
    hornFilter.frequency.value = 980;
    this.hornGain = ctx.createGain();
    this.hornGain.gain.value = 0;
    this.hornOsc1 = ctx.createOscillator();
    this.hornOsc1.type = 'sawtooth';
    this.hornOsc1.frequency.value = 185;
    this.hornOsc2 = ctx.createOscillator();
    this.hornOsc2.type = 'sawtooth';
    this.hornOsc2.frequency.value = 233;
    this.hornOsc1.connect(hornFilter);
    this.hornOsc2.connect(hornFilter);
    hornFilter.connect(this.hornGain);
    this.hornGain.connect(this.exteriorBus);
    this.hornOsc1.start();
    this.hornOsc2.start();

    // Soft ambient rain loop (passes through cabinFilter for immersive interior rain patter)
    const rainFilter = ctx.createBiquadFilter();
    rainFilter.type = 'bandpass';
    rainFilter.frequency.value = 1250;
    rainFilter.Q.value = 0.6;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    this.rainSource = ctx.createBufferSource();
    this.rainSource.buffer = this.noiseBuffer;
    this.rainSource.loop = true;
    this.rainSource.connect(rainFilter);
    rainFilter.connect(this.rainGain);
    this.rainGain.connect(this.exteriorBus);
    this.rainSource.start();

    // Tire roll noise + wet road spray layer
    this.tireFilter = ctx.createBiquadFilter();
    this.tireFilter.type = 'lowpass';
    this.tireFilter.frequency.value = 300;
    this.tireFilter.Q.value = 0.8;
    this.tireGain = ctx.createGain();
    this.tireGain.gain.value = 0;

    const wetSprayFilter = ctx.createBiquadFilter();
    wetSprayFilter.type = 'bandpass';
    wetSprayFilter.frequency.value = 1850;
    wetSprayFilter.Q.value = 0.8;
    this.wetSprayGain = ctx.createGain();
    this.wetSprayGain.gain.value = 0;

    this.tireSource = ctx.createBufferSource();
    this.tireSource.buffer = this.noiseBuffer;
    this.tireSource.loop = true;
    this.tireSource.connect(this.tireFilter);
    this.tireFilter.connect(this.tireGain);
    this.tireGain.connect(this.exteriorBus);
    this.tireSource.connect(wetSprayFilter);
    wetSprayFilter.connect(this.wetSprayGain);
    this.wetSprayGain.connect(this.exteriorBus);
    this.tireSource.start();

    // High-speed aerodynamic wind layer (> 60 km/h)
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 620;
    windFilter.Q.value = 0.7;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windSource = ctx.createBufferSource();
    this.windSource.buffer = this.noiseBuffer;
    this.windSource.loop = true;
    this.windSource.connect(windFilter);
    windFilter.connect(this.windGain);
    this.windGain.connect(this.exteriorBus);
    this.windSource.start();

    // Heavy diesel exhaust / Jake brake low-frequency pulsed rumble
    const exhFilter = ctx.createBiquadFilter();
    exhFilter.type = 'lowpass';
    exhFilter.frequency.value = 180;
    this.exhaustBrakeGain = ctx.createGain();
    this.exhaustBrakeGain.gain.value = 0;
    this.exhaustBrakeOsc = ctx.createOscillator();
    this.exhaustBrakeOsc.type = 'sawtooth';
    this.exhaustBrakeOsc.frequency.value = 24;
    this.exhaustBrakeOsc.connect(exhFilter);
    exhFilter.connect(this.exhaustBrakeGain);
    this.exhaustBrakeGain.connect(this.exteriorBus);
    this.exhaustBrakeOsc.start();
  }

  public setSettings(enabled: boolean, volume: number): void {
    this.enabled = enabled;
    this.volume = volume;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(enabled ? volume : 0, this.ctx.currentTime, 0.04);
    }
  }

  public update(opts: {
    playing: boolean;
    rpm: number;
    throttle: number;
    horn: boolean;
    blinkerLit: boolean;
    parkingBrake: boolean;
    gear?: number;
    engineRunning?: boolean;
    engineTier?: number;
    turboBoostNorm?: number;
    speedKmh?: number;
    onRoad?: boolean;
    isInteriorCam?: boolean;
    wipersMode?: WipersMode;
    wiperAngleRad?: number;
    retarderActive?: boolean;
    exhaustBrakeActive?: boolean;
    lowAirWarning?: boolean;
    rainIntensity?: number;
    dtSec?: number;
  }): void {
    if (
      !this.ctx ||
      !this.engineSubOsc ||
      !this.engineOsc1 ||
      !this.engineOsc2 ||
      !this.engineSubGain ||
      !this.engineFilter ||
      !this.exhaustPeakFilter ||
      !this.engineGain ||
      !this.turboOsc ||
      !this.turboGain ||
      !this.hornGain ||
      !this.cabinFilter
    ) {
      return;
    }

    const now = this.ctx.currentTime;
    const dt = opts.dtSec ?? 0.016;
    if (!opts.playing || !this.enabled) {
      this.engineGain.gain.setTargetAtTime(0, now, 0.08);
      this.injectorGain?.gain.setTargetAtTime(0, now, 0.08);
      this.turboGain.gain.setTargetAtTime(0, now, 0.08);
      this.hornGain.gain.setTargetAtTime(0, now, 0.04);
      this.rainGain?.gain.setTargetAtTime(0, now, 0.12);
      this.tireGain?.gain.setTargetAtTime(0, now, 0.1);
      this.wetSprayGain?.gain.setTargetAtTime(0, now, 0.1);
      this.windGain?.gain.setTargetAtTime(0, now, 0.1);
      this.exhaustBrakeGain?.gain.setTargetAtTime(0, now, 0.06);
      return;
    }

    // Camera-aware cabin acoustic insulation
    const isInterior = opts.isInteriorCam ?? false;
    this.cabinFilter.frequency.setTargetAtTime(isInterior ? 860 : 18000, now, 0.07);

    // Rain ambient
    const rain = opts.rainIntensity ?? 0;
    if (this.rainGain) {
      this.rainGain.gain.setTargetAtTime(rain * (isInterior ? 0.085 : 0.065), now, 0.2);
    }

    // Tire roll, offroad gravel rumble, wet spray, & high-speed wind rush
    const absKmh = Math.abs(opts.speedKmh ?? 0);
    const onRoad = opts.onRoad ?? true;
    const tireSpeedFactor = Math.max(0, Math.min(1, (absKmh - 12) / 85));
    if (this.tireFilter && this.tireGain) {
      this.tireFilter.frequency.setTargetAtTime(onRoad ? 280 + tireSpeedFactor * 160 : 135, now, 0.08);
      this.tireGain.gain.setTargetAtTime(
        tireSpeedFactor * (onRoad ? 0.055 : 0.115),
        now,
        0.08
      );
    }
    if (this.wetSprayGain) {
      this.wetSprayGain.gain.setTargetAtTime(
        onRoad ? tireSpeedFactor * rain * 0.065 : 0,
        now,
        0.09
      );
    }
    if (this.windGain) {
      const windFactor = Math.max(0, Math.min(1, (absKmh - 56) / 50));
      this.windGain.gain.setTargetAtTime(windFactor * 0.048, now, 0.1);
    }

    // Multi-layer I6 vs V8 Diesel Synthesis
    const tier = opts.engineTier ?? 0;
    const isV8 = tier >= 2;
    if (tier !== this.lastEngineTier) {
      this.lastEngineTier = tier;
      this.engineOsc2.type = isV8 ? 'sawtooth' : 'triangle';
    }

    const running = opts.engineRunning ?? true;
    const rpmRatio = Math.max(0, Math.min(1, (opts.rpm - 600) / 1700));
    if (running) {
      const baseFreq = (isV8 ? 22.5 : 26) + rpmRatio * (isV8 ? 58 : 68);
      this.engineSubOsc.frequency.setTargetAtTime(baseFreq * 0.5, now, 0.05);
      this.engineOsc1.frequency.setTargetAtTime(baseFreq, now, 0.05);
      this.engineOsc2.frequency.setTargetAtTime(baseFreq * (isV8 ? 1.5 : 2.02), now, 0.05);
      this.engineSubGain.gain.setTargetAtTime(isV8 ? 0.8 : 0.5, now, 0.05);

      this.engineFilter.frequency.setTargetAtTime(
        (isV8 ? 130 : 145) +
          rpmRatio * 270 +
          opts.throttle * 185 +
          (opts.retarderActive ? 150 : 0),
        now,
        0.06
      );
      this.exhaustPeakFilter.frequency.setTargetAtTime(
        (isV8 ? 82 : 102) + rpmRatio * 48,
        now,
        0.06
      );
      this.exhaustPeakFilter.gain.setTargetAtTime(2.0 + opts.throttle * 6.5, now, 0.06);

      // Quiet coasting when lifting off throttle vs deep growl under load
      const loadGain = 0.075 + opts.throttle * 0.165 + rpmRatio * 0.048 + (opts.retarderActive ? 0.045 : 0);
      this.engineGain.gain.setTargetAtTime(loadGain, now, 0.05);
      this.injectorGain?.gain.setTargetAtTime(
        0.008 + opts.throttle * 0.02 + rpmRatio * 0.012,
        now,
        0.05
      );

      // Turbo spool whistle bound to real turboBoostNorm (or retarder whine)
      const boostNorm = opts.turboBoostNorm ?? Math.max(0, rpmRatio - 0.3) * opts.throttle;
      const turboAudible = opts.retarderActive ? 0.55 : boostNorm * (0.35 + rpmRatio * 0.65);
      this.turboOsc.frequency.setTargetAtTime(
        opts.retarderActive ? 680 + rpmRatio * 520 : 1220 + boostNorm * 1450 + rpmRatio * 680,
        now,
        0.07
      );
      this.turboGain.gain.setTargetAtTime(turboAudible * 0.032, now, 0.07);
    } else {
      this.engineGain.gain.setTargetAtTime(0, now, 0.07);
      this.injectorGain?.gain.setTargetAtTime(0, now, 0.07);
      this.turboGain.gain.setTargetAtTime(0, now, 0.06);
    }

    if (this.exhaustBrakeGain && this.exhaustBrakeOsc) {
      if (running && opts.exhaustBrakeActive) {
        this.exhaustBrakeOsc.frequency.setTargetAtTime(19 + rpmRatio * 22, now, 0.05);
        this.exhaustBrakeGain.gain.setTargetAtTime(0.11 + rpmRatio * 0.07, now, 0.04);
      } else {
        this.exhaustBrakeGain.gain.setTargetAtTime(0, now, 0.05);
      }
    }

    // Air horn
    this.hornGain.gain.setTargetAtTime(opts.horn ? 0.22 : 0, now, 0.025);

    // Wiper rubber swish at stroke reversal (interior cab only or subtle)
    if (this.wiperSwishCooldown > 0) {
      this.wiperSwishCooldown = Math.max(0, this.wiperSwishCooldown - dt);
    }
    if ((opts.wipersMode ?? 0) > 0 && opts.wiperAngleRad !== undefined) {
      const delta = opts.wiperAngleRad - this.prevWiperAngle;
      if (Math.abs(delta) > 0.004) {
        const dir = Math.sign(delta);
        if (this.prevWiperDir !== 0 && dir !== this.prevWiperDir && this.wiperSwishCooldown <= 0) {
          this.playWiperSwish(isInterior);
          this.wiperSwishCooldown = 0.28;
        }
        this.prevWiperDir = dir;
      }
      this.prevWiperAngle = opts.wiperAngleRad;
    } else {
      this.prevWiperDir = 0;
    }

    // Turn-signal relay click
    if (opts.blinkerLit !== this.prevBlinkerLit) {
      this.prevBlinkerLit = opts.blinkerLit;
      this.playBlinkerTick(opts.blinkerLit);
    }

    // Parking brake pneumatic hiss
    if (opts.parkingBrake !== this.prevParkingBrake) {
      this.prevParkingBrake = opts.parkingBrake;
      this.playAirBrake();
    }

    // Low air pressure cab buzzer
    if (opts.lowAirWarning) {
      this.lowAirBeepClock += dt;
      if (this.lowAirBeepClock >= 0.85) {
        this.lowAirBeepClock = 0;
        this.playLowAirBeep();
      }
    } else {
      this.lowAirBeepClock = 0.7;
    }

    // Pneumatic gearshift click & European reverse warning beep
    if (opts.gear !== undefined) {
      if (opts.gear !== this.prevGear) {
        this.prevGear = opts.gear;
        this.playGearShift();
      }
      if (opts.gear < 0 && !opts.parkingBrake) {
        this.reverseBeepClock += dt;
        if (this.reverseBeepClock >= 0.72) {
          this.reverseBeepClock = 0;
          this.playReverseBeep();
        }
      } else {
        this.reverseBeepClock = 0.65;
      }
    }
  }

  public playTurboBlowoff(intensity = 0.7): void {
    if (!this.ctx || !this.exteriorBus || !this.noiseBuffer || !this.enabled) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(2900, now);
    filter.frequency.exponentialRampToValueAtTime(1250, now + 0.22);
    filter.Q.value = 3.2;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.025 + Math.min(1, intensity) * 0.045, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.23);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.exteriorBus);
    src.start(now);
    src.stop(now + 0.25);
  }

  private playWiperSwish(isInterior: boolean): void {
    if (!this.ctx || !this.interiorBus || !this.noiseBuffer || !this.enabled) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 920;
    filter.Q.value = 1.4;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(isInterior ? 0.026 : 0.008, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.interiorBus);
    src.start(now);
    src.stop(now + 0.1);
  }

  public playFifthWheelLock(attached: boolean): void {
    if (!this.ctx || !this.exteriorBus || !this.noiseBuffer || !this.enabled) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const og = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(attached ? 105 : 75, now);
    osc.frequency.exponentialRampToValueAtTime(38, now + 0.16);
    og.gain.setValueAtTime(0.24, now);
    og.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(og);
    og.connect(this.exteriorBus);
    osc.start(now);
    osc.stop(now + 0.2);

    this.playAirRelease(attached ? 0.85 : 0.6);
  }

  public playTollChime(): void {
    if (!this.ctx || !this.interiorBus || !this.enabled) return;
    const now = this.ctx.currentTime;
    for (const [idx, freq] of [1318.5, 1760].entries()) {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = now + idx * 0.09;
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.11, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
      osc.connect(g);
      g.connect(this.interiorBus);
      osc.start(t);
      osc.stop(t + 0.26);
    }
  }

  public playThunder(): void {
    if (!this.ctx || !this.exteriorBus || !this.noiseBuffer || !this.enabled) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(140, now);
    filter.frequency.exponentialRampToValueAtTime(55, now + 2.0);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.24, now + 0.18);
    g.gain.exponentialRampToValueAtTime(0.001, now + 2.2);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.exteriorBus);
    src.start(now);
    src.stop(now + 2.25);
  }

  public playEngineStart(): void {
    if (!this.ctx || !this.exteriorBus || !this.enabled) return;
    const now = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const t = now + i * 0.13;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(52, t);
      osc.frequency.linearRampToValueAtTime(64, t + 0.09);
      g.gain.setValueAtTime(0.08, t);
      g.gain.exponentialRampToValueAtTime(0.005, t + 0.11);
      osc.connect(g);
      g.connect(this.exteriorBus);
      osc.start(t);
      osc.stop(t + 0.12);
    }
    const fire = this.ctx.createOscillator();
    const fg = this.ctx.createGain();
    fire.type = 'triangle';
    fire.frequency.setValueAtTime(38, now + 0.39);
    fire.frequency.exponentialRampToValueAtTime(28, now + 0.78);
    fg.gain.setValueAtTime(0.18, now + 0.39);
    fg.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
    fire.connect(fg);
    fg.connect(this.exteriorBus);
    fire.start(now + 0.39);
    fire.stop(now + 0.82);
  }

  public playEngineStall(): void {
    if (!this.ctx || !this.exteriorBus || !this.enabled) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(42, now);
    osc.frequency.exponentialRampToValueAtTime(16, now + 0.28);
    g.gain.setValueAtTime(0.16, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc.connect(g);
    g.connect(this.exteriorBus);
    osc.start(now);
    osc.stop(now + 0.32);
  }

  public playAirRelease(intensity = 0.7): void {
    if (!this.ctx || !this.exteriorBus || !this.noiseBuffer || !this.enabled) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 3100;
    filter.Q.value = 1.6;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.04 + Math.min(1, intensity) * 0.08, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.exteriorBus);
    src.start(now);
    src.stop(now + 0.16);
  }

  public playAirDryerPurge(): void {
    if (!this.ctx || !this.exteriorBus || !this.noiseBuffer || !this.enabled) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 3400;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.11, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.exteriorBus);
    src.start(now);
    src.stop(now + 0.13);
  }

  private playLowAirBeep(): void {
    if (!this.ctx || !this.interiorBus || !this.enabled) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    g.gain.setValueAtTime(0.065, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    osc.connect(g);
    g.connect(this.interiorBus);
    osc.start(now);
    osc.stop(now + 0.18);
  }

  public playExamCue(kind: 'step' | 'deduct' | 'fail' | 'pass'): void {
    if (!this.ctx || !this.interiorBus || !this.enabled) return;
    const now = this.ctx.currentTime;
    const tones =
      kind === 'pass'
        ? [523.25, 659.25, 783.99, 1046.5]
        : kind === 'fail'
        ? [440, 311.13, 220]
        : kind === 'deduct'
        ? [620, 440]
        : [784, 987.77];

    for (let i = 0; i < tones.length; i++) {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = kind === 'deduct' || kind === 'fail' ? 'triangle' : 'sine';
      osc.frequency.value = tones[i]!;
      const t = now + i * 0.11;
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.1, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
      osc.connect(g);
      g.connect(this.interiorBus);
      osc.start(t);
      osc.stop(t + 0.26);
    }
  }

  public speakChinese(text: string, voiceEnabled: boolean): void {
    if (!voiceEnabled || !this.enabled || typeof window === 'undefined') return;
    try {
      const synth = window.speechSynthesis;
      if (!synth) return;
      synth.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'zh-CN';
      utter.rate = 1.08;
      utter.volume = Math.min(1, Math.max(0.2, this.volume));
      const voices = synth.getVoices();
      const zhVoice = voices.find((v) => /zh[-_]?CN|Chinese/i.test(v.lang));
      if (zhVoice) utter.voice = zhVoice;
      synth.speak(utter);
    } catch {
      // Speech synthesis is optional; fail silently on restricted browsers
    }
  }

  public playGearShift(): void {
    if (!this.ctx || !this.interiorBus || !this.noiseBuffer || !this.enabled) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1650;
    filter.Q.value = 2.0;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.055, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.075);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.interiorBus);
    src.start(now);
    src.stop(now + 0.08);
  }

  public playReverseBeep(): void {
    if (!this.ctx || !this.exteriorBus || !this.enabled) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 1080;
    g.gain.setValueAtTime(0.05, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(g);
    g.connect(this.exteriorBus);
    osc.start(now);
    osc.stop(now + 0.2);
  }

  public playBlinkerTick(high: boolean): void {
    if (!this.ctx || !this.interiorBus || !this.enabled) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = high ? 920 : 680;
    g.gain.setValueAtTime(0.085, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
    osc.connect(g);
    g.connect(this.interiorBus);
    osc.start(now);
    osc.stop(now + 0.05);
  }

  public playAirBrake(): void {
    if (!this.ctx || !this.exteriorBus || !this.noiseBuffer || !this.enabled) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2600;
    filter.Q.value = 1.4;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.16, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

    src.connect(filter);
    filter.connect(g);
    g.connect(this.exteriorBus);
    src.start(now);
    src.stop(now + 0.3);
  }

  public playCameraFlash(): void {
    if (!this.ctx || !this.interiorBus || !this.enabled) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1480, now);
    osc.frequency.exponentialRampToValueAtTime(620, now + 0.14);
    g.gain.setValueAtTime(0.18, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    osc.connect(g);
    g.connect(this.interiorBus);
    osc.start(now);
    osc.stop(now + 0.17);
  }

  public playCollision(intensity01: number): void {
    if (!this.ctx || !this.exteriorBus || !this.noiseBuffer || !this.enabled) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.14 + intensity01 * 0.28, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    src.connect(filter);
    filter.connect(g);
    g.connect(this.exteriorBus);
    src.start(now);
    src.stop(now + 0.38);
  }

  public playSuccess(): void {
    if (!this.ctx || !this.interiorBus || !this.enabled) return;
    const now = this.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99];
    for (let i = 0; i < notes.length; i++) {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = notes[i]!;
      const t = now + i * 0.09;
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.12, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      osc.connect(g);
      g.connect(this.interiorBus);
      osc.start(t);
      osc.stop(t + 0.38);
    }
  }

  public suspend(): void {
    if (this.ctx && this.ctx.state === 'running') {
      void this.ctx.suspend();
    }
  }

  public resume(): void {
    if (this.ctx && this.ctx.state === 'suspended' && this.enabled) {
      void this.ctx.resume();
    }
  }

  public dispose(): void {
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}
