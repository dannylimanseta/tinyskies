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

const FADE_SPEED = 2.0;
const MASTER_MUSIC_VOLUME = 0.35;

export class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private layers: Record<TimePhase, MusicLayer> | null = null;
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
    await Promise.all(promises);
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
   */
  setWeights(day: number, evening: number, night: number) {
    if (!this.layers) return;
    this.layers.day.targetVolume = day * MASTER_MUSIC_VOLUME;
    this.layers.evening.targetVolume = evening * MASTER_MUSIC_VOLUME;
    this.layers.night.targetVolume = night * MASTER_MUSIC_VOLUME;
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
   */
  playSFX(name: string, volume = 1.0, playbackRate = 1.0) {
    if (!this.ctx || !this.masterGain || this._muted) return;
    const buffer = this.sfxBuffers.get(name);
    if (!buffer) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = Math.max(0.5, Math.min(2, playbackRate));
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(this.masterGain);
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
    this.masterGain?.disconnect();
    this.ctx?.close();
    this.ctx = null;
    this.layers = null;
    this.started = false;
  }
}
