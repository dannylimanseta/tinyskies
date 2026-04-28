import type { Vehicle } from "@globefly/shared";
import { CAMPSITE_HOME_ENABLED } from "../config/features";

/** Quest progress shown under the world name (driven from {@link HUD.setQuestTrackers}). */
export type QuestTrackerState =
  | {
      vehicle: "plane";
      gremlin: { current: number; max: number };
      /** Null when package quests are disabled for this build. */
      pkg: { current: number; max: number } | null;
      /** True once the player has won at least one time trial. */
      raceCompleted: boolean;
    }
  | {
      vehicle: "carpet";
      jelly: { current: number; max: number };
      brazierHint: boolean;
      eternalFlameActive: boolean;
    }
  | { vehicle: "boat"; fish: { current: number; max: number } };

/** Quest row icons: assets in `client/public/2D/`. */
const QT_ICONS = {
  gremlin: `<img class="hud-qt-ico" src="/2D/icon_gremlin.svg" alt="" draggable="false" />`,
  package: `<img class="hud-qt-ico" src="/2D/icon_package.svg" alt="" draggable="false" />`,
  jellyfish: `<img class="hud-qt-ico hud-qt-ico--carpet" src="/2D/icon_jellyfish.svg" alt="" draggable="false" />`,
  fish: `<img class="hud-qt-ico" src="/2D/icon_fish.svg" alt="" draggable="false" />`,
  /** Brazier pot icon (smaller than carpet standard; −40%). */
  brazier: `<img class="hud-qt-ico hud-qt-ico--brazier" src="/2D/icon_brazier.svg" alt="" draggable="false" />`,
  /** Inline flame for the eternal-flame defend quest. */
  flame: `<svg class="hud-qt-ico hud-qt-ico--flame-quest" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2s2.5 3.2 2.5 6.5c0 1.2-.3 2.1-.5 2.5.8-.3 1.3-1.1 1.3-2.1 0-1.5-.4-2.3-.4-2.3S18 8.2 18 12c0 3.3-2.7 6-6 6s-6-2.7-6-6c0-3.5 1.2-4.3 1.2-4.3s1 1.3 1 3.2c0 1.4-.4 1.7-.4 1.7s-.1-1.3-.1-2.3C6.5 5.2 12 2 12 2z"/></svg>`,
  race: `<img class="hud-qt-ico hud-qt-ico--race" src="/2D/icon_race.svg" alt="" draggable="false" />`,
} as const;

export class HUD {
  private el: HTMLDivElement;
  private hidden = false;
  private onResize: () => void;
  private onFullscreenChange: () => void;

  private worldNameEl!: HTMLElement;
  private playerCountEl!: HTMLElement;
  private xpPanelEl!: HTMLElement;
  private xpLevelEl!: HTMLElement;
  private xpBarFill!: HTMLElement;
  private xpValueEl!: HTMLElement;
  private topRightEl!: HTMLDivElement;
  private fullscreenBtn!: HTMLButtonElement;
  private muteBtn!: HTMLButtonElement;

  private _bubbleVisible = false;
  private landmarkHiddenByBubble = false;
  private landmarkHUD: { setHidden(h: boolean): void } | null = null;
  private onMuteToggle: (() => boolean) | null = null;
  private onCampsiteClick: (() => void) | null = null;
  private campsiteBtn!: HTMLButtonElement;
  private entranceDone = false;
  private campsitePromptEl: HTMLDivElement | null = null;

  private brazierTrackerEl: HTMLElement | null = null;
  private brazierIconEls: HTMLElement[] = [];
  private brazierFillEls: Element[] = [];
  private brazierTrackerShown = false;
  private centeredToastEls: HTMLDivElement[] = [];
  private raceConfettiEl: HTMLElement | null = null;

  /** Multiplayer hot-flag: shown when another player is attempting to steal. */
  private flagCarrierWarningEl: HTMLDivElement | null = null;

  private questTrackersEl: HTMLElement | null = null;
  private lastQuestTrackerSig = "";

  /** True when the game client was started with mobile optimizations (`isMobile()`). */
  private mobileSession = false;

  constructor(container: HTMLElement, opts?: { mobile?: boolean }) {
    this.el = document.createElement("div");
    this.el.id = "hud";
    this.mobileSession = opts?.mobile ?? false;
    if (this.mobileSession) this.el.classList.add("hud--mobile-session");
    this.buildUI();
    container.appendChild(this.el);

    this.onResize = () => this.syncFullscreenButtonState();
    this.onFullscreenChange = () => this.syncFullscreenButtonState();

    window.addEventListener("resize", this.onResize);
    document.addEventListener("fullscreenchange", this.onFullscreenChange);
    document.addEventListener("webkitfullscreenchange", this.onFullscreenChange);
    this.syncFullscreenButtonState();
  }

  private buildUI() {
    this.el.innerHTML = `
      <div class="hud-top">
        <div class="hud-world-name"></div>
        <div class="hud-player-count">1 player</div>
        <div class="hud-quest-trackers" style="display:none" aria-label="Quest progress"></div>
      </div>
      <div class="hud-top-right">
        <button class="hud-campsite-btn" aria-label="Go to campsite">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2 3 20h18Z"/>
            <path d="M9 20v-6l3-2 3 2v6"/>
          </svg>
        </button>
        <button class="hud-fullscreen-btn" aria-label="Enter fullscreen">
          <svg class="hud-fullscreen-icon-enter" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="8 3 3 3 3 8"/>
            <polyline points="16 3 21 3 21 8"/>
            <polyline points="8 21 3 21 3 16"/>
            <polyline points="16 21 21 21 21 16"/>
          </svg>
          <svg class="hud-fullscreen-icon-exit" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none">
            <polyline points="9 3 9 9 3 9"/>
            <polyline points="15 3 15 9 21 9"/>
            <polyline points="9 21 9 15 3 15"/>
            <polyline points="15 21 15 15 21 15"/>
          </svg>
        </button>
        <button class="hud-mute-btn" aria-label="Toggle music">
          <svg class="hud-mute-icon-on" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
          </svg>
          <svg class="hud-mute-icon-off" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
            <line x1="23" y1="9" x2="17" y2="15"/>
            <line x1="17" y1="9" x2="23" y2="15"/>
          </svg>
        </button>
      </div>
      <div class="hud-xp-panel">
        <span class="hud-xp-level">LVL 1</span>
        <div class="hud-xp-bar-row">
          <div class="hud-xp-bar">
            <div class="hud-xp-bar-fill"></div>
          </div>
          <span class="hud-xp-value">0 XP</span>
        </div>
      </div>
    `;

    this.worldNameEl = this.el.querySelector(".hud-world-name")!;
    this.playerCountEl = this.el.querySelector(".hud-player-count")!;
    this.questTrackersEl = this.el.querySelector(".hud-quest-trackers");
    this.xpPanelEl = this.el.querySelector(".hud-xp-panel")!;
    this.xpLevelEl = this.el.querySelector(".hud-xp-level")!;
    this.xpBarFill = this.el.querySelector(".hud-xp-bar-fill")!;
    this.xpValueEl = this.el.querySelector(".hud-xp-value")!;
    this.topRightEl = this.el.querySelector(".hud-top-right")!;
    this.fullscreenBtn = this.el.querySelector(".hud-fullscreen-btn")!;
    this.muteBtn = this.el.querySelector(".hud-mute-btn")!;
    this.campsiteBtn = this.el.querySelector(".hud-campsite-btn")!;

    if (!CAMPSITE_HOME_ENABLED) {
      this.campsiteBtn.style.display = "none";
    }

    this.campsiteBtn.addEventListener("click", () => {
      this.onCampsiteClick?.();
    });

    this.fullscreenBtn.addEventListener("click", () => {
      void this.toggleFullscreen();
    });

    this.muteBtn.addEventListener("click", () => {
      if (!this.onMuteToggle) return;
      const muted = this.onMuteToggle();
      this.muteBtn.querySelector<SVGElement>(".hud-mute-icon-on")!.style.display = muted ? "none" : "";
      this.muteBtn.querySelector<SVGElement>(".hud-mute-icon-off")!.style.display = muted ? "" : "none";
    });

    this.applyStyles();
  }

  private layoutCenteredToasts() {
    this.centeredToastEls = this.centeredToastEls.filter((el) => el.isConnected);
    let offset = 0;
    for (const el of this.centeredToastEls) {
      el.style.setProperty("--hud-toast-stack-offset", `${offset}px`);
      offset += el.offsetHeight + 12;
    }
  }

  private removeCenteredToast(el: HTMLDivElement) {
    const idx = this.centeredToastEls.indexOf(el);
    if (idx !== -1) this.centeredToastEls.splice(idx, 1);
    el.remove();
    this.layoutCenteredToasts();
  }

  private showCenteredToast(className: string, text: string, durationMs: number) {
    const el = document.createElement("div");
    el.className = `${className} hud-center-toast`;
    el.textContent = text;
    this.el.appendChild(el);
    this.centeredToastEls.push(el);
    this.layoutCenteredToasts();

    requestAnimationFrame(() => el.classList.add("hud-center-toast-animate"));
    setTimeout(() => this.removeCenteredToast(el), durationMs);
  }

  setWorldName(name: string) {
    this.worldNameEl.textContent = name;
  }

  setVehicle(_vehicle: Vehicle, options?: { showXpProgression?: boolean }) {
    const showXp = options?.showXpProgression ?? true;
    this.xpPanelEl.style.display = showXp ? "flex" : "none";
  }

  setPlayerCount(count: number) {
    this.playerCountEl.textContent = `${count} player${count !== 1 ? "s" : ""}`;
  }

  setPlayerCountVisible(v: boolean) {
    this.playerCountEl.style.display = v ? "" : "none";
  }

  /**
   * Per-vehicle quest lines under the world name. Pass `null` to hide the block.
   * Updates are a no-op when the serialized state is unchanged.
   */
  setQuestTrackers(state: QuestTrackerState | null) {
    if (!this.questTrackersEl) return;
    if (!state) {
      if (this.lastQuestTrackerSig === "" && this.questTrackersEl.style.display === "none") return;
      this.questTrackersEl.style.display = "none";
      this.questTrackersEl.innerHTML = "";
      this.lastQuestTrackerSig = "";
      return;
    }
    const sig = JSON.stringify(state);
    if (sig === this.lastQuestTrackerSig) return;
    this.lastQuestTrackerSig = sig;
    this.questTrackersEl.style.display = "flex";

    const frac = (c: number, m: number) => {
      const cc = Math.max(0, Math.min(m, c));
      return `<span class="hud-quest-frac">${cc}/${m}</span>`;
    };
    const row = (html: string) => `<div class="hud-quest-row">${html}</div>`;

    if (state.vehicle === "plane") {
      const g = state.gremlin;
      const parts: string[] = [row(`${QT_ICONS.gremlin}${frac(g.current, g.max)}`)];
      if (state.pkg) {
        const p = state.pkg;
        parts.push(row(`${QT_ICONS.package}${frac(p.current, p.max)}`));
      }
      const raceLabel = state.raceCompleted
        ? `<span class="hud-quest-done">Finish a race ✓</span>`
        : `<span class="hud-quest-hint">Finish a race</span>`;
      parts.push(row(`${QT_ICONS.race}${raceLabel}`));
      this.questTrackersEl.innerHTML = parts.join("");
    } else if (state.vehicle === "carpet") {
      const j = state.jelly;
      const parts: string[] = [row(`${QT_ICONS.jellyfish}${frac(j.current, j.max)}`)];
      if (state.brazierHint) {
        parts.push(
          row(`${QT_ICONS.brazier}<span class="hud-quest-hint">Figure out how to raise the braziers</span>`),
        );
      }
      const flameLabel = state.eternalFlameActive
        ? `<span class="hud-quest-done">Defend the eternal flame ✓</span>`
        : `<span class="hud-quest-hint">Defend the eternal flame</span>`;
      parts.push(row(`${QT_ICONS.flame}${flameLabel}`));
      this.questTrackersEl.innerHTML = parts.join("");
    } else {
      const f = state.fish;
      this.questTrackersEl.innerHTML = row(`${QT_ICONS.fish}${frac(f.current, f.max)}`);
    }
  }

  setXP(current: number, nextLevelXP: number, currentLevelXP: number, level: number) {
    this.xpLevelEl.textContent = `LVL ${level}`;
    const range = nextLevelXP - currentLevelXP;
    const progress = range > 0 ? (current - currentLevelXP) / range : 1;
    this.xpBarFill.style.width = `${Math.min(100, Math.max(0, progress * 100))}%`;
    this.xpValueEl.textContent = `${current} XP`;
  }

  showXPGain(amount: number) {
    const popup = document.createElement("div");
    popup.className = "hud-xp-popup";
    popup.textContent = `+${amount} XP`;
    this.el.appendChild(popup);

    requestAnimationFrame(() => popup.classList.add("hud-xp-popup-animate"));
    setTimeout(() => popup.remove(), 1200);
  }

  showLevelUp(level: number) {
    const banner = document.createElement("div");
    banner.className = "hud-levelup";
    banner.textContent = `LEVEL ${level}`;
    this.el.appendChild(banner);

    requestAnimationFrame(() => banner.classList.add("hud-levelup-animate"));
    setTimeout(() => banner.remove(), 2000);
  }

  /** Generic one-liner toast — used for NPC wave greetings and similar ambient messages. */
  showAmbientToast(message: string, durationMs = 2800) {
    this.showCenteredToast("hud-ambient-toast", message, durationMs);
  }

  /** Multiplayer hot-flag world announcements (gold). */
  showFlagAnnounce(text: string, durationMs = 4000) {
    this.showCenteredToast("hud-flag-announce", text, durationMs);
  }

  /**
   * True while at least one other player is in capture range (server-driven).
   * Only shown when the local player is the flag bearer.
   */
  showFlagCarrierWarning(on: boolean) {
    if (!this.flagCarrierWarningEl) {
      const el = document.createElement("div");
      el.className = "hud-flag-carrier-warning";
      el.textContent = "Someone is circling you!";
      el.setAttribute("aria-live", "polite");
      el.style.display = "none";
      this.el.appendChild(el);
      this.flagCarrierWarningEl = el;
    }
    this.flagCarrierWarningEl.style.display = on ? "block" : "none";
  }

  /** Root `#hud` element — for DOM overlays that must stack with HUD (e.g. flag capture ring). */
  getHudRoot(): HTMLElement {
    return this.el;
  }

  /** Shown when bird flock formation completes; matches XP popup line + float styling, below the flock ring. */
  showFlockFormationCelebrate() {
    this.showCenteredToast("hud-flock-celebration", "You flew with the birds", 1600);
  }

  showRainbowCelebrate() {
    this.showCenteredToast("hud-rainbow-celebration", "You went through the rainbow", 1600);
  }

  /** Gremlin King spawns after 7 sky gremlin takedowns in a session. */
  showGremlinKingWarning() {
    this.showCenteredToast(
      "hud-gremlin-king-warning",
      "Your actions have angered the Gremlin King. He seeks vengeance.",
      5200,
    );
  }

  /**
   * After 12 fish (boat). Uses a fixed root toast so the message is visible even when #hud
   * is still hidden (intro) or toggled; does not use the regular centered-toast stack.
   */
  showOceanMysteryPresenceHint(rewardAlreadyClaimed: boolean) {
    const el = document.createElement("div");
    el.className = "hud-ocean-mystery-toast";
    el.textContent = rewardAlreadyClaimed
      ? "The ocean stirs, but you already carry its hidden flame."
      : "You feel a large presence in the ocean…";
    el.setAttribute("role", "status");
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("hud-ocean-mystery-toast--in"));
    setTimeout(() => {
      el.classList.remove("hud-ocean-mystery-toast--in");
      el.classList.add("hud-ocean-mystery-toast--out");
      setTimeout(() => el.remove(), 500);
    }, 4200);
  }

  showLanternCelebrate(_count: number) {
    this.showCenteredToast(
      "hud-lantern-celebration",
      "You flew amongst the lanterns",
      1600,
    );
  }

  showPaintballSplatter(colorHex?: number) {
    const el = document.createElement("div");
    el.className = "hud-paintball-splatter";
    
    // Random rotation and position near edges
    const angle = Math.random() * 360;
    const isTop = Math.random() > 0.5;
    const isLeft = Math.random() > 0.5;
    
    const xOffset = 10 + Math.random() * 20; // 10% to 30% from edge
    const yOffset = 10 + Math.random() * 20;
    
    el.style[isTop ? 'top' : 'bottom'] = `${yOffset}%`;
    el.style[isLeft ? 'left' : 'right'] = `${xOffset}%`;

    if (colorHex !== undefined) {
      // Use a mask approach so we can colorize it directly without layout hacks
      el.style.backgroundColor = `#${colorHex.toString(16).padStart(6, '0')}`;
      el.style.maskImage = `url("/2D/splatter_1.png")`;
      el.style.maskSize = `contain`;
      el.style.maskRepeat = `no-repeat`;
      el.style.maskPosition = `center`;
      el.style.webkitMaskImage = `url("/2D/splatter_1.png")`;
      el.style.webkitMaskSize = `contain`;
      el.style.webkitMaskRepeat = `no-repeat`;
      el.style.webkitMaskPosition = `center`;
      el.style.backgroundImage = 'none'; // Clear the original image
    } else {
      el.style.backgroundImage = `url("/2D/splatter_1.png")`;
    }
    
    el.style.setProperty('--rot', `${angle}deg`);
    
    this.el.appendChild(el);

    requestAnimationFrame(() => el.classList.add("hud-paintball-splatter-animate"));
    setTimeout(() => el.remove(), 2500);
  }

  showFireflyCelebrate() {
    this.showCenteredToast("hud-firefly-celebration", "Fireflies!", 1400);
  }

  showVolcanoCelebrate() {
    this.showCenteredToast("hud-volcano-celebration", "Extreme flying!", 1600);
  }

  showBrazierLit() {
    this.showCenteredToast("hud-brazier-celebration", "Brazier lit!", 2000);
  }

  /** Brazier ignited with an eternal flame (permanent burn). */
  showBrazierEternalFlameLit() {
    this.showCenteredToast(
      "hud-brazier-eternal-celebration",
      "Eternal flame — this brazier never goes out.",
      2600,
    );
  }

  /** All-five brazier shield: moon approach pauses locally for a short time. */
  showBrazierMoonSlowed() {
    this.showCenteredToast(
      "hud-brazier-moon-slowed",
      "The braziers have slowed the moon — for a little while.",
      3200,
    );
  }

  /** After shield pause ends — moon approach advances again. */
  showBrazierMoonResumed() {
    this.showCenteredToast("hud-brazier-moon-resumed", "The moon has resumed its movement.", 3200);
  }

  /** Post-moonstone-union world-state toast. */
  showBrazierRiseQuest() {
    this.showCenteredToast(
      "hud-brazier-celebration",
      "5 ancient braziers have risen around the world. Find them",
      4200,
    );
  }

  /** One-time hint after the player's first brazier flame burns out. */
  showBrazierFizzleHint() {
    this.showCenteredToast(
      "hud-brazier-moon-resumed",
      "The brazier flame has died out. There must be a way to keep it burning eternally.",
      5200,
    );
  }

  /** Create the persistent flame-progress tracker (call once after braziers are ready). */
  initBrazierTracker(count: number) {
    if (this.brazierTrackerEl) this.disposeBrazierTracker();

    const flamePath = `M13.5 0.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67zM11.71 19c-1.78 0-3.22-1.4-3.22-3.14 0-1.62 1.05-2.76 2.81-3.12 1.77-.36 3.6-1.21 4.62-2.58.39 1.29.59 2.65.59 4.04 0 2.65-2.15 4.8-4.8 4.8z`;
    const svgHtml = (cls: string) =>
      `<svg viewBox="0 0 24 24" fill="currentColor" class="${cls}" aria-hidden="true"><path d="${flamePath}"/></svg>`;

    const tracker = document.createElement("div");
    tracker.className = "hud-brazier-tracker";
    tracker.setAttribute("aria-label", "Brazier status");

    this.brazierIconEls = [];
    this.brazierFillEls = [];

    for (let i = 0; i < count; i++) {
      const icon = document.createElement("span");
      icon.className = "hud-brazier-tracker-icon";
      // Ghost = always-visible dim outline; fill = clipped bright layer driven by JS
      icon.innerHTML = svgHtml("hud-bt-ghost") + svgHtml("hud-bt-fill");
      tracker.appendChild(icon);
      this.brazierIconEls.push(icon);
      this.brazierFillEls.push(icon.querySelector(".hud-bt-fill")!);
    }

    this.el.appendChild(tracker);
    this.brazierTrackerEl = tracker;
    this.brazierTrackerShown = false;
  }

  /**
   * Update each flame icon's height-fill to show burn progress (0–1).
   * Called every game tick; clips the bright fill SVG from the top so the
   * flame appears to shrink as the timer drains.
   * Fades the whole tracker in the first time any brazier is lit.
   */
  updateBrazierStatus(burnProgress: number[]) {
    if (!this.brazierTrackerEl) return;

    let anyLit = false;
    for (let i = 0; i < burnProgress.length; i++) {
      const p = Math.max(0, Math.min(1, burnProgress[i] ?? 0));
      const fill = this.brazierFillEls[i] as HTMLElement | undefined;
      if (!fill) continue;

      // clip-path inset from the top: 0% = full flame, 100% = no flame
      const clipTop = ((1 - p) * 100).toFixed(1);
      fill.style.clipPath = `inset(${clipTop}% 0 0 0)`;

      if (p > 0) anyLit = true;
    }

    if (anyLit && !this.brazierTrackerShown) {
      this.brazierTrackerEl.classList.add("visible");
      this.brazierTrackerShown = true;
    }
  }

  /** Hide flame tracker during time trial so it does not sit under the race timer. */
  setBrazierTrackerRaceHidden(hidden: boolean) {
    if (!this.brazierTrackerEl) return;
    this.brazierTrackerEl.classList.toggle("hud-brazier-tracker--race-hidden", hidden);
  }

  /** After 3–2–1 when the timed lap begins. */
  showRaceGoToast() {
    this.showAmbientToast("GO!", 1400);
  }

  /** Full-viewport falling confetti when the plane time trial is completed. */
  showRaceWinConfetti(durationMs = 4200) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    this.raceConfettiEl?.remove();
    this.raceConfettiEl = null;

    const wrap = document.createElement("div");
    wrap.className = "hud-race-confetti";
    wrap.setAttribute("aria-hidden", "true");

    const colors = [
      "#ff6b6b",
      "#ffd93d",
      "#6bcb77",
      "#4d96ff",
      "#c56cf0",
      "#ffffff",
      "#ff922b",
      "#339af0",
    ];
    const n = 72;
    for (let i = 0; i < n; i++) {
      const bit = document.createElement("div");
      bit.className = "hud-race-confetti__piece";
      const w = 5 + Math.random() * 8;
      const h = 6 + Math.random() * 12;
      bit.style.width = `${w}px`;
      bit.style.height = `${h}px`;
      bit.style.left = `${Math.random() * 100}%`;
      bit.style.top = `${-30 - Math.random() * 50}px`;
      bit.style.background = colors[Math.floor(Math.random() * colors.length)]!;
      bit.style.setProperty("--dur", `${2.4 + Math.random() * 2.4}s`);
      bit.style.setProperty("--delay", `${Math.random() * 0.95}s`);
      bit.style.setProperty("--drift", `${(Math.random() - 0.5) * 200}px`);
      bit.style.setProperty("--spin", `${(Math.random() - 0.5) * 1080}deg`);
      bit.style.borderRadius = Math.random() > 0.45 ? "2px" : "50%";
      wrap.appendChild(bit);
    }

    this.el.appendChild(wrap);
    this.raceConfettiEl = wrap;
    requestAnimationFrame(() => wrap.classList.add("hud-race-confetti--active"));
    const fadeAt = Math.max(800, durationMs - 550);
    setTimeout(() => wrap.classList.add("hud-race-confetti--out"), fadeAt);
    setTimeout(() => {
      wrap.remove();
      if (this.raceConfettiEl === wrap) this.raceConfettiEl = null;
    }, durationMs);
  }

  disposeBrazierTracker() {
    this.brazierTrackerEl?.remove();
    this.brazierTrackerEl = null;
    this.brazierIconEls = [];
    this.brazierFillEls = [];
    this.brazierTrackerShown = false;
  }

  showCampsitePrompt(visible: boolean) {
    if (!CAMPSITE_HOME_ENABLED) return;
    if (visible && !this.campsitePromptEl) {
      this.campsitePromptEl = document.createElement("div");
      Object.assign(this.campsitePromptEl.style, {
        position: "absolute",
        bottom: "20%",
        left: "50%",
        transform: "translateX(-50%)",
        padding: "10px 24px",
        background: "rgba(0,0,0,0.55)",
        borderRadius: "12px",
        color: "#fff",
        fontFamily: "'Domine', Georgia, serif",
        fontSize: "15px",
        fontWeight: "600",
        letterSpacing: "0.5px",
        pointerEvents: "none",
        whiteSpace: "nowrap",
        border: "1px solid rgba(255,255,255,0.28)",
        textShadow: "none",
      } as CSSStyleDeclaration);
      this.campsitePromptEl.textContent = "Press F to land at camp";
      this.el.appendChild(this.campsitePromptEl);
    } else if (!visible && this.campsitePromptEl) {
      this.campsitePromptEl.remove();
      this.campsitePromptEl = null;
    }
  }

  setMuteToggle(fn: () => boolean) {
    this.onMuteToggle = fn;
  }

  setCampsiteAction(fn: () => void) {
    this.onCampsiteClick = fn;
  }

  setCampsiteButtonVisible(visible: boolean) {
    if (!CAMPSITE_HOME_ENABLED) return;
    this.campsiteBtn.style.display = visible ? "" : "none";
    this.updateTopRightReservedWidth();
  }

  registerLandmarkHUD(lhud: { setHidden(h: boolean): void }) {
    this.landmarkHUD = lhud;
  }

  setBubbleVisible(visible: boolean) {
    if (this._bubbleVisible === visible) return;
    this._bubbleVisible = visible;
    if (visible && this.landmarkHUD) {
      this.landmarkHiddenByBubble = true;
      this.landmarkHUD.setHidden(true);
    } else if (!visible && this.landmarkHiddenByBubble && this.landmarkHUD) {
      this.landmarkHiddenByBubble = false;
      this.landmarkHUD.setHidden(false);
    }
  }

  /**
   * While true on mobile builds, quest tracker rows stay hidden so they do not stack with
   * package NPC bubbles / stonehenge whispers (same vertical band).
   */
  setMobileQuestTrackerSuppressedByDialogue(suppressed: boolean) {
    if (!this.mobileSession) return;
    this.el.classList.toggle("hud--quest-suppressed-dialogue", suppressed);
  }

  private applyStyles() {
    if (document.getElementById("hud-styles")) return;
    const style = document.createElement("style");
    style.id = "hud-styles";
    style.textContent = `
      #hud {
        --hud-top-right-reserved: 120px;
        position: fixed; inset: 0; z-index: 100;
        pointer-events: none;
        font-family: 'Domine', Georgia, serif;
        color: rgba(255, 255, 255, 0.85);
      }

      @keyframes hudRaceConfettiFall {
        0% {
          transform: translateY(0) translateX(0) rotate(0deg);
          opacity: 1;
        }
        100% {
          transform: translateY(110vh) translateX(var(--drift)) rotate(var(--spin));
          opacity: 0.9;
        }
      }

      .hud-race-confetti {
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 220;
        overflow: hidden;
      }
      .hud-race-confetti--active .hud-race-confetti__piece {
        animation: hudRaceConfettiFall var(--dur) linear var(--delay) forwards;
      }
      .hud-race-confetti--out .hud-race-confetti__piece {
        opacity: 0;
        transition: opacity 0.5s ease-out;
      }
      .hud-race-confetti__piece {
        position: absolute;
        opacity: 1;
        box-shadow: 0 0 1px rgba(0, 0, 0, 0.15);
      }
      #hud::before {
        content: '';
        position: fixed;
        inset: 0;
        pointer-events: none;
        background: radial-gradient(
          ellipse at center,
          transparent 50%,
          rgba(0, 0, 0, 0.25) 100%
        );
        z-index: 0;
      }

      .hud-top {
        position: absolute;
        top: 32px;
        left: 36px;
        display: flex;
        flex-direction: column;
        gap: 2px;
        z-index: 1;
      }
      .hud-world-name {
        font-size: 0.95rem;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.85);
      }
      .hud-player-count {
        font-size: 0.75rem;
        font-weight: 400;
        color: rgba(255, 255, 255, 0.45);
      }
      #hud.hud--mobile-session.hud--quest-suppressed-dialogue .hud-quest-trackers {
        display: none !important;
      }

      .hud-quest-trackers {
        display: flex;
        flex-direction: column;
        gap: 5px;
        margin-top: 8px;
        align-items: flex-start;
        /* Match .pkg-banner: delivery distance type scale */
        font-size: 0.95rem;
        font-weight: 600;
        letter-spacing: 0.04em;
        line-height: 1.2;
        color: rgba(255, 255, 255, 0.5);
      }
      .hud-quest-row {
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 3px;
        font: inherit;
      }
      .hud-quest-frac {
        font-size: 1em;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.65);
        font-variant-numeric: tabular-nums;
        min-width: 2.4em;
      }
      .hud-qt-ico {
        width: 1.2em;
        height: 1.2em;
        flex-shrink: 0;
        object-fit: contain;
        display: block;
        opacity: 0.95;
      }
      .hud-qt-ico--carpet {
        width: 1.6em;
        height: 1.6em;
      }
      img.hud-qt-ico--carpet {
        /* Jellyfish quest row: slightly larger than the base carpet slot */
        width: 1.75em;
        height: 1.75em;
      }
      .hud-qt-ico--brazier {
        /* Keep 1.75em flex space so text columns align; scale visually −40%. */
        width: 1.75em;
        height: 1.75em;
        transform: scale(0.6);
        transform-origin: center;
      }
      .hud-qt-ico--flame-quest {
        color: rgba(255, 255, 255, 0.85);
        width: 1.6em;
        height: 1.6em;
        flex-shrink: 0;
      }
      .hud-qt-ico--race {
        width: 1.28em;
        height: 1.28em;
      }
      img.hud-qt-ico--race {
        width: 1.344em;
        height: 1.344em;
      }
      .hud-quest-done,
      .hud-quest-hint {
        font-size: 1em;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.65);
        max-width: min(20rem, 88vw);
        line-height: 1.2;
      }
      @media (max-width: 768px) {
        .hud-quest-trackers {
          /* Match .pkg-banner narrow: same as delivery distance */
          font-size: 0.8rem;
        }
      }
      .hud-top-right {
        position: absolute;
        top: 32px;
        right: 36px;
        z-index: 1;
        display: flex;
        gap: 8px;
        align-items: center;
      }

      .hud-campsite-btn,
      .hud-fullscreen-btn,
      .hud-mute-btn {
        pointer-events: auto;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 10px;
        color: rgba(255, 255, 255, 0.7);
        width: 36px;
        height: 36px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: background 0.2s, color 0.2s;
        padding: 0;
      }
      .hud-campsite-btn:hover,
      .hud-fullscreen-btn:hover,
      .hud-mute-btn:hover {
        background: rgba(255, 255, 255, 0.15);
        color: rgba(255, 255, 255, 0.95);
      }
      .hud-campsite-btn:active,
      .hud-fullscreen-btn:active,
      .hud-mute-btn:active {
        background: rgba(255, 255, 255, 0.2);
      }

      @media (max-width: 768px) {
        .hud-fullscreen-btn {
          display: none !important;
        }
      }

      .hud-xp-panel {
        position: absolute;
        bottom: max(36px, calc(28px + env(safe-area-inset-bottom, 0px)));
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        padding: 10px 24px;
        background: rgba(255, 255, 255, 0.06);
        backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 14px;
        min-width: 180px;
        z-index: 1;
      }
      .hud-xp-level {
        font-size: 0.7rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        color: rgba(255, 255, 255, 0.7);
        white-space: nowrap;
      }
      .hud-xp-bar-row {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
      }
      .hud-xp-bar {
        flex: 1;
        height: 4px;
        background: rgba(255, 255, 255, 0.10);
        border-radius: 2px;
        overflow: hidden;
      }
      .hud-xp-bar-fill {
        height: 100%;
        width: 0%;
        background: rgba(255, 255, 255, 0.60);
        border-radius: 2px;
        transition: width 0.4s ease-out;
      }
      .hud-xp-value {
        font-size: 0.6rem;
        color: rgba(255, 255, 255, 0.4);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }

      .hud-xp-popup {
        position: absolute;
        bottom: 80px;
        left: 50%;
        transform: translateX(-50%) translateY(0px);
        font-size: 1.25rem;
        font-weight: 700;
        color: rgba(255, 255, 255, 1);
        text-shadow: none;
        opacity: 0;
        transition: opacity 0.3s ease-out, transform 0.8s ease-out;
        pointer-events: none;
        display: flex;
        align-items: center;
        gap: 12px;
        white-space: nowrap;
      }
      .hud-xp-popup::before,
      .hud-xp-popup::after {
        content: '';
        display: block;
        width: 48px;
        height: 2px;
        flex-shrink: 0;
      }
      .hud-xp-popup::before {
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.5));
      }
      .hud-xp-popup::after {
        background: linear-gradient(90deg, rgba(255,255,255,0.5), transparent);
      }
      .hud-xp-popup-animate {
        opacity: 1;
        transform: translateX(-50%) translateY(-40px);
      }
      .hud-xp-popup-bonus {
        color: rgba(255, 255, 255, 1.0);
        font-size: 1.45rem;
        text-shadow: none;
      }

      /* NPC greetings, race "GO!", etc. — must match other .hud-center-toast variants (position + fade). */
      .hud-ambient-toast {
        position: absolute;
        top: 50%;
        left: 50%;
        font-size: 1.35rem;
        font-weight: 800;
        letter-spacing: 0.1em;
        color: rgba(255, 255, 255, 1);
        text-shadow: none;
        opacity: 0;
        transition: opacity 0.35s ease-out, transform 0.75s ease-out;
        pointer-events: none;
        white-space: nowrap;
        z-index: 14;
      }

      .hud-flag-announce {
        position: absolute;
        top: 50%;
        left: 50%;
        font-size: 1.25rem;
        font-weight: 800;
        letter-spacing: 0.06em;
        color: #f7c948;
        text-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
        opacity: 0;
        transition: opacity 0.35s ease-out, transform 0.75s ease-out;
        pointer-events: none;
        white-space: nowrap;
        z-index: 14;
        max-width: min(92vw, 28rem);
        text-align: center;
        line-height: 1.35;
      }

      .hud-flag-carrier-warning {
        position: absolute;
        left: 50%;
        bottom: max(28%, calc(120px + env(safe-area-inset-bottom)));
        transform: translateX(-50%);
        font-size: 0.95rem;
        font-weight: 700;
        letter-spacing: 0.04em;
        color: rgba(255, 230, 180, 0.98);
        text-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
        pointer-events: none;
        z-index: 15;
        white-space: nowrap;
      }

      .hud-flock-celebration {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, calc(-50% - 72px));
        font-size: 1.1rem;
        font-weight: 600;
        letter-spacing: 0.03em;
        color: rgba(255, 255, 255, 1);
        text-shadow: none;
        opacity: 0;
        transition: opacity 0.35s ease-out, transform 0.75s ease-out;
        pointer-events: none;
        display: flex;
        align-items: center;
        gap: 10px;
        white-space: nowrap;
        z-index: 14;
      }
      .hud-flock-celebration::before,
      .hud-flock-celebration::after {
        content: '';
        display: block;
        width: 36px;
        height: 2px;
        flex-shrink: 0;
      }
      .hud-flock-celebration::before {
        background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.55));
      }
      .hud-flock-celebration::after {
        background: linear-gradient(90deg, rgba(255, 255, 255, 0.55), transparent);
      }
      .hud-flock-celebration-animate {
        opacity: 1;
        transform: translate(-50%, calc(-50% - 92px));
      }

      @media (max-width: 768px) {
        .hud-flock-celebration {
          transform: translate(-50%, calc(-50% - 58px));
        }
        .hud-flock-celebration-animate {
          transform: translate(-50%, calc(-50% - 78px));
        }
      }

      .hud-rainbow-celebration {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, calc(-50% - 72px));
        font-size: 1.1rem;
        font-weight: 600;
        letter-spacing: 0.03em;
        color: rgba(255, 255, 255, 1);
        text-shadow: none;
        opacity: 0;
        transition: opacity 0.35s ease-out, transform 0.75s ease-out;
        pointer-events: none;
        display: flex;
        align-items: center;
        gap: 10px;
        white-space: nowrap;
        z-index: 14;
      }
      .hud-rainbow-celebration::before,
      .hud-rainbow-celebration::after {
        content: '';
        display: block;
        width: 36px;
        height: 2px;
        flex-shrink: 0;
      }
      .hud-rainbow-celebration::before {
        background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.55));
      }
      .hud-rainbow-celebration::after {
        background: linear-gradient(90deg, rgba(255, 255, 255, 0.55), transparent);
      }
      .hud-rainbow-celebration-animate {
        opacity: 1;
        transform: translate(-50%, calc(-50% - 92px));
      }

      @media (max-width: 768px) {
        .hud-rainbow-celebration {
          transform: translate(-50%, calc(-50% - 58px));
        }
        .hud-rainbow-celebration-animate {
          transform: translate(-50%, calc(-50% - 78px));
        }
      }

      .hud-gremlin-king-warning {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, calc(-50% - 72px));
        max-width: min(22rem, calc(100% - 32px));
        padding: 0 8px;
        font-size: 1.05rem;
        font-weight: 600;
        letter-spacing: 0.02em;
        line-height: 1.4;
        text-align: center;
        color: rgba(255, 255, 255, 1);
        text-shadow: none;
        opacity: 0;
        transition: opacity 0.4s ease-out, transform 0.75s ease-out;
        pointer-events: none;
        z-index: 14;
      }
      .hud-gremlin-king-warning-animate {
        opacity: 1;
        transform: translate(-50%, calc(-50% - 92px));
      }

      @media (max-width: 768px) {
        .hud-gremlin-king-warning {
          transform: translate(-50%, calc(-50% - 58px));
          font-size: 0.95rem;
        }
        .hud-gremlin-king-warning-animate {
          transform: translate(-50%, calc(-50% - 78px));
        }
      }

      .hud-ocean-mystery-toast {
        position: fixed;
        top: 42%;
        left: 50%;
        transform: translate(-50%, -50%) scale(0.96);
        max-width: min(22rem, calc(100% - 32px));
        padding: 10px 14px;
        font-size: 1.1rem;
        font-weight: 600;
        letter-spacing: 0.02em;
        line-height: 1.4;
        text-align: center;
        color: rgba(255, 255, 255, 1);
        text-shadow: none;
        z-index: 200000;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.4s ease-out, transform 0.45s ease-out;
      }
      .hud-ocean-mystery-toast--in {
        opacity: 1;
        transform: translate(-50%, -50%) scale(1);
      }
      .hud-ocean-mystery-toast--out {
        opacity: 0;
        transform: translate(-50%, -48%) scale(0.99);
        transition: opacity 0.45s ease-in, transform 0.5s ease-in;
      }

      .hud-lantern-celebration {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, calc(-50% - 72px));
        font-size: 1.1rem;
        font-weight: 600;
        letter-spacing: 0.03em;
        color: rgba(255, 255, 255, 1);
        text-shadow: none;
        opacity: 0;
        transition: opacity 0.35s ease-out, transform 0.75s ease-out;
        pointer-events: none;
        display: flex;
        align-items: center;
        gap: 10px;
        white-space: nowrap;
        z-index: 14;
      }
      .hud-lantern-celebration::before,
      .hud-lantern-celebration::after {
        content: '';
        display: block;
        width: 36px;
        height: 2px;
        flex-shrink: 0;
      }
      .hud-lantern-celebration::before {
        background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.55));
      }
      .hud-lantern-celebration::after {
        background: linear-gradient(90deg, rgba(255, 255, 255, 0.55), transparent);
      }
      .hud-lantern-celebration-animate {
        opacity: 1;
        transform: translate(-50%, calc(-50% - 92px));
      }

      @media (max-width: 768px) {
        .hud-lantern-celebration {
          transform: translate(-50%, calc(-50% - 58px));
        }
        .hud-lantern-celebration-animate {
          transform: translate(-50%, calc(-50% - 78px));
        }
      }

      .hud-firefly-celebration {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, calc(-50% - 72px));
        font-size: 1.1rem;
        font-weight: 600;
        letter-spacing: 0.03em;
        color: rgba(255, 255, 255, 1);
        text-shadow: none;
        opacity: 0;
        transition: opacity 0.3s ease-out, transform 0.6s ease-out;
        pointer-events: none;
        display: flex;
        align-items: center;
        gap: 10px;
        white-space: nowrap;
        z-index: 14;
      }
      .hud-firefly-celebration::before,
      .hud-firefly-celebration::after {
        content: '';
        display: block;
        width: 36px;
        height: 2px;
        flex-shrink: 0;
      }
      .hud-firefly-celebration::before {
        background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.55));
      }
      .hud-firefly-celebration::after {
        background: linear-gradient(90deg, rgba(255, 255, 255, 0.55), transparent);
      }
      .hud-firefly-celebration-animate {
        opacity: 1;
        transform: translate(-50%, calc(-50% - 92px));
      }

      .hud-paintball-splatter {
        position: absolute;
        width: 375px;
        height: 375px;
        background-size: contain;
        background-repeat: no-repeat;
        background-position: center;
        pointer-events: none;
        opacity: 0;
        transform-origin: center;
        z-index: 50;
      }
      .hud-paintball-splatter-animate {
        animation: splatter-fade 2.5s forwards;
      }
      @keyframes splatter-fade {
        0% { opacity: 0; transform: rotate(var(--rot)) scale(0.5); }
        10% { opacity: 0.85; transform: rotate(var(--rot)) scale(1.1); }
        20% { opacity: 0.8; transform: rotate(var(--rot)) scale(1); }
        70% { opacity: 0.8; transform: rotate(var(--rot)) scale(1); }
        100% { opacity: 0; transform: rotate(var(--rot)) scale(1); }
      }
      @media (max-width: 768px) {
        .hud-paintball-splatter {
          width: min(200px, 40vw);
          height: min(200px, 40vw);
        }
      }

      @media (max-width: 768px) {
        .hud-firefly-celebration {
          transform: translate(-50%, calc(-50% - 58px));
        }
        .hud-firefly-celebration-animate {
          transform: translate(-50%, calc(-50% - 78px));
        }
      }

      .hud-volcano-celebration {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, calc(-50% - 72px));
        font-size: 1.1rem;
        font-weight: 600;
        letter-spacing: 0.03em;
        color: rgba(255, 255, 255, 1);
        text-shadow: none;
        opacity: 0;
        transition: opacity 0.35s ease-out, transform 0.75s ease-out;
        pointer-events: none;
        display: flex;
        align-items: center;
        gap: 10px;
        white-space: nowrap;
        z-index: 14;
      }
      .hud-volcano-celebration::before,
      .hud-volcano-celebration::after {
        content: '';
        display: block;
        width: 36px;
        height: 2px;
        flex-shrink: 0;
      }
      .hud-volcano-celebration::before {
        background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.55));
      }
      .hud-volcano-celebration::after {
        background: linear-gradient(90deg, rgba(255, 255, 255, 0.55), transparent);
      }
      .hud-volcano-celebration-animate {
        opacity: 1;
        transform: translate(-50%, calc(-50% - 92px));
      }

      @media (max-width: 768px) {
        .hud-volcano-celebration {
          transform: translate(-50%, calc(-50% - 58px));
        }
        .hud-volcano-celebration-animate {
          transform: translate(-50%, calc(-50% - 78px));
        }
      }

      /* ── Brazier status tracker ─────────────────────────── */
      .hud-brazier-tracker {
        position: absolute;
        top: 32px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        gap: 12px;
        opacity: 0;
        transition: opacity 0.7s ease;
        pointer-events: none;
        z-index: 14;
      }
      .hud-brazier-tracker.visible { opacity: 1; }
      .hud-brazier-tracker.hud-brazier-tracker--race-hidden {
        opacity: 0 !important;
        visibility: hidden;
      }

      /* Each icon is a stacking context for the two SVG layers */
      .hud-brazier-tracker-icon {
        position: relative;
        width: 18px;
        height: 22px;
        display: block;
        flex-shrink: 0;
      }

      /* Ghost layer — dim white, always full-height */
      .hud-bt-ghost {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        fill: white;
        opacity: 0.25;
      }

      /* Fill layer — bright white, clipped by JS each frame */
      .hud-bt-fill {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        fill: white;
        opacity: 1;
        clip-path: inset(100% 0 0 0); /* JS overrides this every tick */
        filter: none;
      }

      /* ── Brazier notification popup ─────────────────────── */
      .hud-brazier-celebration {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, calc(-50% - 72px));
        font-size: 1.1rem;
        font-weight: 600;
        letter-spacing: 0.03em;
        color: rgba(255, 255, 255, 1);
        text-shadow: none;
        opacity: 0;
        transition: opacity 0.35s ease-out, transform 0.75s ease-out;
        pointer-events: none;
        display: flex;
        align-items: center;
        gap: 10px;
        white-space: nowrap;
        z-index: 14;
      }
      .hud-brazier-celebration::before,
      .hud-brazier-celebration::after {
        content: '';
        display: block;
        width: 36px;
        height: 2px;
        flex-shrink: 0;
      }
      .hud-brazier-celebration::before {
        background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.55));
      }
      .hud-brazier-celebration::after {
        background: linear-gradient(90deg, rgba(255, 255, 255, 0.55), transparent);
      }
      .hud-brazier-celebration-animate {
        opacity: 1;
        transform: translate(-50%, calc(-50% - 92px));
      }

      @media (max-width: 768px) {
        .hud-brazier-celebration {
          transform: translate(-50%, calc(-50% - 58px));
        }
        .hud-brazier-celebration-animate {
          transform: translate(-50%, calc(-50% - 78px));
        }
      }

      .hud-brazier-eternal-celebration {
        position: absolute;
        top: 50%;
        left: 50%;
        font-size: 1.05rem;
        font-weight: 600;
        letter-spacing: 0.03em;
        line-height: 1.35;
        color: rgba(255, 255, 255, 1);
        text-shadow: none;
        opacity: 0;
        transition: opacity 0.35s ease-out, transform 0.75s ease-out;
        pointer-events: none;
        display: flex;
        align-items: center;
        gap: 10px;
        white-space: normal;
        max-width: min(92vw, 380px);
        text-align: center;
        justify-content: center;
        z-index: 14;
      }
      .hud-brazier-eternal-celebration::before,
      .hud-brazier-eternal-celebration::after {
        content: '';
        display: block;
        width: 28px;
        height: 2px;
        flex-shrink: 0;
      }
      .hud-brazier-eternal-celebration::before {
        background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.55));
      }
      .hud-brazier-eternal-celebration::after {
        background: linear-gradient(90deg, rgba(255, 255, 255, 0.55), transparent);
      }

      .hud-brazier-moon-slowed {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, calc(-50% - 72px));
        font-size: 1.05rem;
        font-weight: 600;
        letter-spacing: 0.02em;
        line-height: 1.35;
        color: rgba(255, 255, 255, 1);
        text-shadow: none;
        opacity: 0;
        transition: opacity 0.4s ease-out, transform 0.8s ease-out;
        pointer-events: none;
        white-space: normal;
        max-width: min(92vw, 420px);
        text-align: center;
        padding: 0 12px;
        z-index: 14;
      }
      .hud-brazier-moon-slowed-animate {
        opacity: 1;
        transform: translate(-50%, calc(-50% - 92px));
      }

      @media (max-width: 768px) {
        .hud-brazier-moon-slowed {
          transform: translate(-50%, calc(-50% - 58px));
          font-size: 0.95rem;
        }
        .hud-brazier-moon-slowed-animate {
          transform: translate(-50%, calc(-50% - 78px));
        }
      }

      .hud-brazier-moon-resumed {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, calc(-50% - 72px));
        font-size: 1.05rem;
        font-weight: 600;
        letter-spacing: 0.02em;
        line-height: 1.35;
        color: rgba(255, 255, 255, 1);
        text-shadow: none;
        opacity: 0;
        transition: opacity 0.4s ease-out, transform 0.8s ease-out;
        pointer-events: none;
        white-space: normal;
        max-width: min(92vw, 420px);
        text-align: center;
        padding: 0 12px;
        z-index: 14;
      }
      .hud-brazier-moon-resumed-animate {
        opacity: 1;
        transform: translate(-50%, calc(-50% - 92px));
      }

      @media (max-width: 768px) {
        .hud-brazier-moon-resumed {
          transform: translate(-50%, calc(-50% - 58px));
          font-size: 0.95rem;
        }
        .hud-brazier-moon-resumed-animate {
          transform: translate(-50%, calc(-50% - 78px));
        }
      }

      .hud-levelup {
        position: absolute; top: 35%; left: 50%;
        transform: translate(-50%, -50%) scale(0.5);
        font-size: 2.5rem; font-weight: 800;
        letter-spacing: 0.12em;
        color: rgba(255, 255, 255, 0);
        text-shadow: none;
        transition: color 0.3s ease-out, transform 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        pointer-events: none;
        display: flex;
        align-items: center;
        gap: 16px;
        white-space: nowrap;
      }
      .hud-levelup::before,
      .hud-levelup::after {
        content: '';
        display: block;
        width: 64px;
        height: 2px;
        flex-shrink: 0;
      }
      .hud-levelup::before {
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.45));
      }
      .hud-levelup::after {
        background: linear-gradient(90deg, rgba(255,255,255,0.45), transparent);
      }
      .hud-levelup-animate {
        color: rgba(255, 255, 255, 0.95);
        transform: translate(-50%, -50%) scale(1);
      }

      .hud-center-toast {
        --hud-toast-stack-offset: 0px;
        transform: translate(-50%, calc(-50% - 72px + var(--hud-toast-stack-offset)));
      }
      .hud-center-toast-animate {
        opacity: 1;
        transform: translate(-50%, calc(-50% - 92px + var(--hud-toast-stack-offset)));
      }

      @keyframes hudEntranceInLeft {
        from { opacity: 0; transform: translateX(-18px); }
        to { opacity: 1; transform: translateX(0); }
      }
      @keyframes hudEntranceInRight {
        from { opacity: 0; transform: translateX(20px); }
        to { opacity: 1; transform: translateX(0); }
      }
      @keyframes hudEntranceInUp {
        from { opacity: 0; transform: translateX(-50%) translateY(20px); }
        to { opacity: 1; transform: translateX(-50%) translateY(0); }
      }
      @keyframes hudEntranceInHints {
        from { opacity: 0; transform: translateX(24px); }
        to { opacity: 1; transform: translateX(0); }
      }
      @keyframes hudEntranceVignette {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      #hud.hud--entrance::before {
        opacity: 0;
        animation: hudEntranceVignette 0.48s ease-out forwards;
      }
      #hud.hud--entrance .hud-top {
        opacity: 0;
        animation: hudEntranceInLeft 0.38s cubic-bezier(0.22, 1, 0.36, 1) forwards;
        animation-delay: 0ms;
      }
      #hud.hud--entrance .hud-top-right {
        opacity: 0;
        animation: hudEntranceInRight 0.38s cubic-bezier(0.22, 1, 0.36, 1) forwards;
        animation-delay: 0.05s;
      }
      #hud.hud--entrance .hud-xp-panel {
        opacity: 0;
        animation: hudEntranceInUp 0.38s cubic-bezier(0.22, 1, 0.36, 1) forwards;
        animation-delay: 0.1s;
      }
      #hud.hud--entrance .control-hints {
        opacity: 0;
        animation: hudEntranceInHints 0.38s cubic-bezier(0.22, 1, 0.36, 1) forwards;
        animation-delay: 0.15s;
      }

      @media (max-width: 480px) {
        .hud-top {
          top: max(24px, calc(14px + env(safe-area-inset-top)));
          left: max(24px, calc(14px + env(safe-area-inset-left)));
        }
        .hud-top-right {
          top: max(24px, calc(14px + env(safe-area-inset-top)));
          right: max(24px, calc(14px + env(safe-area-inset-right)));
        }
        .hud-brazier-tracker {
          top: max(24px, calc(14px + env(safe-area-inset-top)));
        }
        .hud-campsite-btn,
        .hud-fullscreen-btn,
        .hud-mute-btn {
          width: 40px;
          height: 40px;
        }
        .hud-world-name { font-size: 0.8rem; }
        .hud-player-count { font-size: 0.65rem; }
        .hud-quest-trackers { font-size: 0.8rem; }

        .hud-xp-panel {
          bottom: max(24px, calc(14px + env(safe-area-inset-bottom)));
          padding: 8px 16px;
          min-width: 140px;
          backdrop-filter: none;
        }
        .hud-xp-level { font-size: 0.6rem; }
        .hud-xp-value { font-size: 0.55rem; }

        .hud-xp-popup { bottom: 120px; font-size: 1.05rem; }
        .hud-xp-popup-bonus { font-size: 1.2rem; }
        .hud-xp-popup::before, .hud-xp-popup::after { width: 32px; }

        .hud-ambient-toast {
          font-size: 1.1rem;
          letter-spacing: 0.08em;
        }

        .hud-flock-celebration {
          font-size: 0.95rem;
          gap: 8px;
        }
        .hud-flock-celebration::before,
        .hud-flock-celebration::after { width: 24px; }
        .hud-flock-celebration-animate {
          transform: translate(-50%, calc(-50% - 78px));
        }

        .hud-rainbow-celebration {
          font-size: 0.95rem;
          gap: 8px;
        }
        .hud-rainbow-celebration::before,
        .hud-rainbow-celebration::after { width: 24px; }
        .hud-rainbow-celebration-animate {
          transform: translate(-50%, calc(-50% - 78px));
        }

        .hud-lantern-celebration {
          font-size: 0.95rem;
          gap: 8px;
        }
        .hud-lantern-celebration::before,
        .hud-lantern-celebration::after { width: 24px; }
        .hud-lantern-celebration-animate {
          transform: translate(-50%, calc(-50% - 78px));
        }

        .hud-firefly-celebration {
          font-size: 0.95rem;
          gap: 8px;
        }
        .hud-firefly-celebration::before,
        .hud-firefly-celebration::after { width: 24px; }
        .hud-firefly-celebration-animate {
          transform: translate(-50%, calc(-50% - 78px));
        }

        .hud-volcano-celebration {
          font-size: 0.95rem;
          gap: 8px;
        }
        .hud-volcano-celebration::before,
        .hud-volcano-celebration::after { width: 24px; }
        .hud-volcano-celebration-animate {
          transform: translate(-50%, calc(-50% - 78px));
        }

        .hud-gremlin-king-warning {
          font-size: 0.95rem;
        }
        .hud-ocean-mystery-toast {
          font-size: 0.95rem;
        }
        .hud-brazier-celebration {
          font-size: 0.95rem;
        }
        .hud-brazier-eternal-celebration {
          font-size: 0.95rem;
        }
        .hud-brazier-moon-slowed,
        .hud-brazier-moon-resumed {
          font-size: 0.95rem;
        }

        .hud-levelup { font-size: 1.8rem; }
        .hud-levelup::before, .hud-levelup::after { width: 40px; }

        .hud-center-toast {
          transform: translate(-50%, calc(-50% - 58px + var(--hud-toast-stack-offset)));
        }
        .hud-center-toast-animate {
          transform: translate(-50%, calc(-50% - 78px + var(--hud-toast-stack-offset)));
        }
      }
    `;
    document.head.appendChild(style);
  }

  get root(): HTMLDivElement {
    return this.el;
  }

  private supportsFullscreen(): boolean {
    const root = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
    };
    const doc = document as Document & {
      webkitExitFullscreen?: () => Promise<void> | void;
    };
    return !!(
      root.requestFullscreen ||
      root.webkitRequestFullscreen ||
      document.exitFullscreen ||
      doc.webkitExitFullscreen
    );
  }

  private isFullscreenActive(): boolean {
    const doc = document as Document & {
      webkitFullscreenElement?: Element | null;
    };
    return !!(document.fullscreenElement || doc.webkitFullscreenElement);
  }

  private shouldShowFullscreenButton(): boolean {
    if (!this.supportsFullscreen()) return false;
    return window.matchMedia("(min-width: 769px) and (hover: hover) and (pointer: fine)").matches;
  }

  /**
   * Re-measure `.hud-top-right` for the package delivery banner. Call after the root is
   * shown again (e.g. `hud.show()`) or when `hud.root.style.display` is toggled without
   * going through `show()` / `hideUI()`.
   */
  refreshTopRightLayout(): void {
    requestAnimationFrame(() => {
      this.updateTopRightReservedWidth();
    });
  }

  private updateTopRightReservedWidth() {
    if (!this.topRightEl?.isConnected) return;
    // When #hud is display:none (intro), rects are 0 — a bogus reserved value makes
    // .pkg-banner's right inset huge and collapses the delivery banner to ~0 width.
    if (this.hidden || this.el.style.display === "none") return;
    const rect = this.topRightEl.getBoundingClientRect();
    if (rect.width < 0.5 || rect.height < 0.5) return;
    const hudW = this.el.getBoundingClientRect().width;
    if (hudW < 1) return;
    const gap = 12;
    const bannerLeft = 10;
    /** Keep room for "Deliver to … · 9999m" even on long names (flex ellipsis on the name). */
    const minBannerWidth = 168;
    const fromClusterLeftToHudRight = Math.ceil(hudW - rect.left + gap);
    // Bad layout (e.g. #hud was display:none) often yields rect.left ≈ 0 and would reserve ~100vw.
    if (fromClusterLeftToHudRight > hudW * 0.88) {
      this.el.style.setProperty("--hud-top-right-reserved", "120px");
      return;
    }
    let reserved = Math.max(72, fromClusterLeftToHudRight);
    const maxReserved = Math.max(72, hudW - bannerLeft - gap - minBannerWidth);
    reserved = Math.min(reserved, maxReserved);
    this.el.style.setProperty("--hud-top-right-reserved", `${reserved}px`);
  }

  private syncFullscreenButtonState() {
    if (!this.fullscreenBtn) return;
    const visible = this.shouldShowFullscreenButton();
    this.fullscreenBtn.style.display = visible ? "" : "none";
    const isActive = visible && this.isFullscreenActive();
    this.fullscreenBtn.querySelector<SVGElement>(".hud-fullscreen-icon-enter")!.style.display = isActive ? "none" : "";
    this.fullscreenBtn.querySelector<SVGElement>(".hud-fullscreen-icon-exit")!.style.display = isActive ? "" : "none";
    this.fullscreenBtn.setAttribute("aria-label", isActive ? "Exit fullscreen" : "Enter fullscreen");
    this.updateTopRightReservedWidth();
  }

  private async toggleFullscreen() {
    if (!this.supportsFullscreen()) return;
    const root = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
    };
    const doc = document as Document & {
      webkitExitFullscreen?: () => Promise<void> | void;
    };

    try {
      if (this.isFullscreenActive()) {
        const exitFullscreen = document.exitFullscreen?.bind(document) ?? doc.webkitExitFullscreen?.bind(doc);
        await exitFullscreen?.();
      } else {
        const requestFullscreen = root.requestFullscreen?.bind(root) ?? root.webkitRequestFullscreen?.bind(root);
        await requestFullscreen?.();
      }
    } catch {
      // Ignore denied fullscreen requests and just resync the visible icon state.
    }

    this.syncFullscreenButtonState();
  }

  show() {
    this.hidden = false;
    this.el.style.display = "";
    this.refreshTopRightLayout();
    if (!this.entranceDone) {
      this.entranceDone = true;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          this.el.classList.add("hud--entrance");
        });
      });
    }
  }

  hideUI() {
    this.hidden = true;
    this.el.style.display = "none";
  }

  dispose() {
    window.removeEventListener("resize", this.onResize);
    document.removeEventListener("fullscreenchange", this.onFullscreenChange);
    document.removeEventListener("webkitfullscreenchange", this.onFullscreenChange);
    this.raceConfettiEl?.remove();
    this.raceConfettiEl = null;
    this.el.remove();
  }
}
