type TimePhase = "day" | "evening" | "night";

interface MusicLayer {
  buffer: AudioBuffer | null;
  source: AudioBufferSourceNode | null;
  gain: GainNode;
  targetVolume: number;
}

const MUSIC_TRACKS: Record<TimePhase, string[]> = {
  day: ["/audio/music/day_1.mp3", "/audio/music/day_2.mp3"],
  evening: ["/audio/music/evening_1.mp3", "/audio/music/evening_2.mp3"],
  night: ["/audio/music/night_1.mp3", "/audio/music/night_2.mp3"],
};

const END_TIMES_TRACKS = [
  "/audio/music/end_times_1.mp3",
  "/audio/music/end_times_2.mp3",
];

const FADE_SPEED = 2.0;
const MASTER_MUSIC_VOLUME = 0.35;

export class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private layers: Record<TimePhase, MusicLayer> | null = null;
  private endTimesLayers: MusicLayer[] = [];
  private endTimesIndex = 0;
  private endTimesWeight = 0;
  private started = false;
  private _muted = false;
  private sfxBuffers = new Map<string, AudioBuffer>();
  private loopingSources = new Map<
    string,
    {
      source: AudioBufferSourceNode;
      gain: GainNode;
      targetVolume: number;
      /** When true, `stopLoop` runs once gain reaches 0 after fade-out. */
      stopWhenSilent?: boolean;
    }
  >();

  get muted() { return this._muted; }

  async init() {
    if (this.ctx) return;
    this.ctx = new AudioContext();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this._muted ? 0 : 1;
    this.masterGain.connect(this.ctx.destination);

    this.layers = {
      day: this.createLayer(),
      evening: this.createLayer(),
      night: this.createLayer(),
    };
    this.endTimesLayers = END_TIMES_TRACKS.map(() => this.createLayer());
    this.endTimesIndex = Math.round(Math.random());

    // Load click_1 immediately (before music loading) so it is ready for the very first user click.
    void this.loadSFX("click_1", "/audio/sfx/click_1.mp3");

    await this.loadAllMusic();
  }

  private createLayer(): MusicLayer {
    const gain = this.ctx!.createGain();
    gain.gain.value = 0;
    gain.connect(this.masterGain!);
    return { buffer: null, source: null, gain, targetVolume: 0 };
  }

  private async loadAllMusic() {
    const phases: TimePhase[] = ["day", "evening", "night"];
    const promises = phases.map(async (phase) => {
      const urls = MUSIC_TRACKS[phase];
      const pick = urls[Math.floor(Math.random() * urls.length)];
      try {
        const res = await fetch(pick);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const arrayBuf = await res.arrayBuffer();
        this.layers![phase].buffer = await this.ctx!.decodeAudioData(arrayBuf);
      } catch (e) {
        console.warn(`AudioManager: failed to load ${pick}`, e);
      }
    });

    const endPromises = END_TIMES_TRACKS.map(async (url, i) => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const arrayBuf = await res.arrayBuffer();
        this.endTimesLayers[i]!.buffer = await this.ctx!.decodeAudioData(arrayBuf);
      } catch (e) {
        console.warn(`AudioManager: failed to load ${url}`, e);
      }
    });

    await Promise.all([...promises, ...endPromises]);
  }

  /** Call after user gesture (e.g. lobby "Play" click) to start playback. */
  startMusic() {
    if (this.started || !this.ctx || !this.layers) return;
    this.started = true;

    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }

    for (const phase of ["day", "evening", "night"] as TimePhase[]) {
      this.startLayer(this.layers[phase]);
    }
    for (const layer of this.endTimesLayers) {
      this.startLayer(layer);
    }
  }

  private startLayer(layer: MusicLayer) {
    if (!layer.buffer || !this.ctx) return;
    const source = this.ctx.createBufferSource();
    source.buffer = layer.buffer;
    source.loop = true;
    source.connect(layer.gain);
    source.start(0);
    layer.source = source;
  }

  /**
   * Set per-phase weights (0–1). Call every frame.
   * Weights are smoothed internally for crossfade.
   * Normal music is attenuated when endTimesWeight > 0.
   */
  setWeights(day: number, evening: number, night: number) {
    if (!this.layers) return;
    const normal = 1 - this.endTimesWeight;
    this.layers.day.targetVolume = day * MASTER_MUSIC_VOLUME * normal;
    this.layers.evening.targetVolume = evening * MASTER_MUSIC_VOLUME * normal;
    this.layers.night.targetVolume = night * MASTER_MUSIC_VOLUME * normal;
  }

  /**
   * Blend in end-times music (0 = silent, 1 = full).
   * Alternates between the two tracks each time weight rises from 0.
   */
  setEndTimesWeight(weight: number) {
    if (this.endTimesWeight === 0 && weight > 0) {
      this.endTimesIndex = (this.endTimesIndex + 1) % this.endTimesLayers.length;
    }
    this.endTimesWeight = weight;
    for (let i = 0; i < this.endTimesLayers.length; i++) {
      this.endTimesLayers[i]!.targetVolume =
        i === this.endTimesIndex ? weight * MASTER_MUSIC_VOLUME : 0;
    }
  }

  /** Smooth gain ramping — call every frame with dt. */
  update(dt: number) {
    if (!this.layers) return;
    for (const phase of ["day", "evening", "night"] as TimePhase[]) {
      const layer = this.layers[phase];
      const current = layer.gain.gain.value;
      const target = layer.targetVolume;
      const diff = target - current;
      if (Math.abs(diff) < 0.001) {
        layer.gain.gain.value = target;
      } else {
        layer.gain.gain.value = current + diff * Math.min(1, FADE_SPEED * dt);
      }
    }

    for (const layer of this.endTimesLayers) {
      const current = layer.gain.gain.value;
      const target = layer.targetVolume;
      const diff = target - current;
      if (Math.abs(diff) < 0.001) {
        layer.gain.gain.value = target;
      } else {
        layer.gain.gain.value = current + diff * Math.min(1, FADE_SPEED * dt);
      }
    }

    const toStop: string[] = [];
    for (const [name, loop] of this.loopingSources) {
      const cur = loop.gain.gain.value;
      const diff = loop.targetVolume - cur;
      if (Math.abs(diff) < 0.001) {
        loop.gain.gain.value = loop.targetVolume;
      } else {
        loop.gain.gain.value = cur + diff * Math.min(1, FADE_SPEED * 3 * dt);
      }
      if (
        loop.stopWhenSilent &&
        loop.targetVolume === 0 &&
        loop.gain.gain.value < 0.001
      ) {
        toStop.push(name);
      }
    }
    for (const name of toStop) {
      this.stopLoop(name);
    }
  }

  toggleMute(): boolean {
    this._muted = !this._muted;
    if (this.masterGain) {
      this.masterGain.gain.value = this._muted ? 0 : 1;
    }
    return this._muted;
  }

  /* ── SFX ───────────────────────────────────────────────── */

  /** True if this one-shot SFX was loaded successfully (buffer present). */
  hasSFX(name: string): boolean {
    return this.sfxBuffers.has(name);
  }

  async loadSFX(name: string, url: string) {
    if (!this.ctx || this.sfxBuffers.has(name)) return;
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const buf = await res.arrayBuffer();
      this.sfxBuffers.set(name, await this.ctx.decodeAudioData(buf));
    } catch {
      console.warn(`AudioManager: failed to load SFX "${name}"`);
    }
  }

  /**
   * One-shot SFX. `playbackRate` shifts pitch (and length); use >1 for slightly higher combo tones.
   * `endFadeFraction` (0–1): linear fade to silence over the last fraction of playback (e.g. 0.05 = last 5%).
   */
  /**
   * Short UI feedback click. Awaits AudioContext resume so the sound isn't
   * dropped on the very first user gesture (before the context is running).
   */
  playUIClick(volume = 0.42) {
    if (!this.hasSFX("click_1") || this._muted) return;
    if (this.ctx?.state === "suspended") {
      void this.ctx.resume().then(() => this.playSFX("click_1", volume));
    } else {
      this.playSFX("click_1", volume);
    }
  }

  playSFX(name: string, volume = 1.0, playbackRate = 1.0, endFadeFraction = 0) {
    if (!this.ctx || !this.masterGain || this._muted) return;
    const buffer = this.sfxBuffers.get(name);
    if (!buffer) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const rate = Math.max(0.35, Math.min(2, playbackRate));
    source.playbackRate.value = rate;
    const gain = this.ctx.createGain();
    source.connect(gain);
    gain.connect(this.masterGain);

    const playDur = buffer.duration / rate;
    const fade = Math.max(0, Math.min(1, endFadeFraction));
    if (fade > 0 && playDur > 0.001) {
      const t0 = this.ctx.currentTime;
      const holdEnd = t0 + playDur * (1 - fade);
      gain.gain.setValueAtTime(volume, t0);
      gain.gain.linearRampToValueAtTime(volume, holdEnd);
      gain.gain.linearRampToValueAtTime(0, t0 + playDur);
    } else {
      gain.gain.value = volume;
    }
    source.start(0);
  }

  /**
   * Start a looping SFX. If a loop with the same `name` exists, it is stopped first.
   * Volume is ramped via setLoopVolume(). Playback rates below 1 lower pitch (e.g. male voice).
   */
  startLoop(name: string, initialVolume = 0, playbackRate = 1) {
    if (!this.ctx || !this.masterGain) return;
    if (this.loopingSources.has(name)) this.stopLoop(name);
    const buffer = this.sfxBuffers.get(name);
    if (!buffer) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.playbackRate.value = Math.max(0.5, Math.min(2, playbackRate));
    const gain = this.ctx.createGain();
    gain.gain.value = initialVolume;
    source.connect(gain);
    gain.connect(this.masterGain);
    source.start(0);
    this.loopingSources.set(name, {
      source,
      gain,
      targetVolume: initialVolume,
      stopWhenSilent: false,
    });
  }

  setLoopVolume(name: string, volume: number) {
    const loop = this.loopingSources.get(name);
    if (loop) loop.targetVolume = volume;
  }

  /**
   * Set loop output gain immediately (no smoothing). Use when gain is driven by an external
   * animation (e.g. moon rewind overlay alpha).
   */
  setLoopGainImmediate(name: string, gain: number) {
    const loop = this.loopingSources.get(name);
    if (!loop) return;
    const v = Math.max(0, Math.min(1, gain));
    loop.gain.gain.value = v;
    loop.targetVolume = v;
  }

  resumeContextIfNeeded() {
    if (this.ctx?.state === "suspended") {
      void this.ctx.resume();
    }
  }

  /** Fade loop to silence, then stop the source (used for dialogue bed). */
  fadeOutLoop(name: string) {
    const loop = this.loopingSources.get(name);
    if (!loop) return;
    loop.targetVolume = 0;
    loop.stopWhenSilent = true;
  }

  stopLoop(name: string) {
    const loop = this.loopingSources.get(name);
    if (!loop) return;
    loop.source.stop();
    loop.source.disconnect();
    loop.gain.disconnect();
    this.loopingSources.delete(name);
  }

  dispose() {
    for (const loop of this.loopingSources.values()) {
      loop.source.stop();
      loop.source.disconnect();
      loop.gain.disconnect();
    }
    this.loopingSources.clear();
    if (this.layers) {
      for (const phase of ["day", "evening", "night"] as TimePhase[]) {
        this.layers[phase].source?.stop();
        this.layers[phase].source?.disconnect();
        this.layers[phase].gain.disconnect();
      }
    }
    for (const layer of this.endTimesLayers) {
      layer.source?.stop();
      layer.source?.disconnect();
      layer.gain.disconnect();
    }
    this.endTimesLayers = [];
    this.masterGain?.disconnect();
    this.ctx?.close();
    this.ctx = null;
    this.layers = null;
    this.started = false;
  }
}
