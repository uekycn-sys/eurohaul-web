/**
 * Real-time Web Audio API synthesizer for EuroHaul Web.
 * Synthesizes diesel engine rumble, turbo whistle, air brakes, turn-signal relay,
 * dual-tone air horn, speed camera shutter, and impact sounds with zero external assets.
 */
export class AudioSynthesizer {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;

  private engineOsc1: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;

  private turboOsc: OscillatorNode | null = null;
  private turboGain: GainNode | null = null;

  private hornOsc1: OscillatorNode | null = null;
  private hornOsc2: OscillatorNode | null = null;
  private hornGain: GainNode | null = null;

  private noiseBuffer: AudioBuffer | null = null;
  private enabled = true;
  private volume = 0.6;
  private prevBlinkerLit = false;
  private prevParkingBrake = true;

  public unlock(): void {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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

    // Noise buffer for air brakes & collisions
    const bufLen = ctx.sampleRate * 1.2;
    this.noiseBuffer = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufLen; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    // Diesel engine dual-oscillator through warm lowpass
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 180;
    this.engineFilter.Q.value = 2.2;

    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0.14;

    this.engineOsc1 = ctx.createOscillator();
    this.engineOsc1.type = 'sawtooth';
    this.engineOsc1.frequency.value = 34;

    this.engineOsc2 = ctx.createOscillator();
    this.engineOsc2.type = 'triangle';
    this.engineOsc2.frequency.value = 68;

    this.engineOsc1.connect(this.engineFilter);
    this.engineOsc2.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.masterGain);
    this.engineOsc1.start();
    this.engineOsc2.start();

    // Turbocharger whine
    this.turboOsc = ctx.createOscillator();
    this.turboOsc.type = 'sine';
    this.turboOsc.frequency.value = 1400;
    this.turboGain = ctx.createGain();
    this.turboGain.gain.value = 0;
    this.turboOsc.connect(this.turboGain);
    this.turboGain.connect(this.masterGain);
    this.turboOsc.start();

    // Dual-tone truck air horn
    const hornFilter = ctx.createBiquadFilter();
    hornFilter.type = 'lowpass';
    hornFilter.frequency.value = 950;
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
    this.hornGain.connect(this.masterGain);
    this.hornOsc1.start();
    this.hornOsc2.start();
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
  }): void {
    if (!this.ctx || !this.engineOsc1 || !this.engineOsc2 || !this.engineFilter || !this.engineGain || !this.turboOsc || !this.turboGain || !this.hornGain) {
      return;
    }

    const now = this.ctx.currentTime;
    if (!opts.playing || !this.enabled) {
      this.engineGain.gain.setTargetAtTime(0, now, 0.08);
      this.turboGain.gain.setTargetAtTime(0, now, 0.08);
      this.hornGain.gain.setTargetAtTime(0, now, 0.04);
      return;
    }

    // Diesel engine pitch & harmonic warmth
    const rpmRatio = Math.max(0, Math.min(1, (opts.rpm - 600) / 1700));
    const baseFreq = 26 + rpmRatio * 68;
    this.engineOsc1.frequency.setTargetAtTime(baseFreq, now, 0.05);
    this.engineOsc2.frequency.setTargetAtTime(baseFreq * 2.02, now, 0.05);
    this.engineFilter.frequency.setTargetAtTime(140 + rpmRatio * 290 + opts.throttle * 140, now, 0.06);
    this.engineGain.gain.setTargetAtTime(0.11 + opts.throttle * 0.14 + rpmRatio * 0.06, now, 0.06);

    // Turbo spool
    const turboBoost = Math.max(0, rpmRatio - 0.32) * opts.throttle;
    this.turboOsc.frequency.setTargetAtTime(1250 + rpmRatio * 2100, now, 0.08);
    this.turboGain.gain.setTargetAtTime(turboBoost * 0.032, now, 0.08);

    // Air horn
    this.hornGain.gain.setTargetAtTime(opts.horn ? 0.22 : 0, now, 0.025);

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
  }

  public playBlinkerTick(high: boolean): void {
    if (!this.ctx || !this.masterGain || !this.enabled) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = high ? 920 : 680;
    g.gain.setValueAtTime(0.08, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.05);
  }

  public playAirBrake(): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer || !this.enabled) return;
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
    g.connect(this.masterGain);
    src.start(now);
    src.stop(now + 0.3);
  }

  public playCameraFlash(): void {
    if (!this.ctx || !this.masterGain || !this.enabled) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1480, now);
    osc.frequency.exponentialRampToValueAtTime(620, now + 0.14);
    g.gain.setValueAtTime(0.18, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.17);
  }

  public playCollision(intensity01: number): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer || !this.enabled) return;
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
    g.connect(this.masterGain);
    src.start(now);
    src.stop(now + 0.38);
  }

  public playSuccess(): void {
    if (!this.ctx || !this.masterGain || !this.enabled) return;
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
      g.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.38);
    }
  }

  public dispose(): void {
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}
