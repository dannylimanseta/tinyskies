import type { Vehicle } from "@globefly/shared";

export class HUD {
  private el: HTMLDivElement;
  private hidden = false;
  private onKey: (e: KeyboardEvent) => void;

  private worldNameEl!: HTMLElement;
  private playerCountEl!: HTMLElement;
  private xpPanelEl!: HTMLElement;
  private xpLevelEl!: HTMLElement;
  private xpBarFill!: HTMLElement;
  private xpValueEl!: HTMLElement;
  private muteBtn!: HTMLButtonElement;

  private _bubbleVisible = false;
  private landmarkHiddenByBubble = false;
  private landmarkHUD: { setHidden(h: boolean): void } | null = null;
  private onMuteToggle: (() => boolean) | null = null;
  private entranceDone = false;

  constructor(container: HTMLElement) {
    this.el = document.createElement("div");
    this.el.id = "hud";
    this.buildUI();
    container.appendChild(this.el);

    this.onKey = (e: KeyboardEvent) => {
      if (e.key === "h" || e.key === "H") {
        this.hidden = !this.hidden;
        this.el.style.display = this.hidden ? "none" : "";
      }
      if (e.key === "m" || e.key === "M") {
        this.muteBtn?.click();
      }
    };
    window.addEventListener("keydown", this.onKey);
  }

  private buildUI() {
    this.el.innerHTML = `
      <div class="hud-top">
        <div class="hud-world-name"></div>
        <div class="hud-player-count">1 player</div>
      </div>
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
    this.xpPanelEl = this.el.querySelector(".hud-xp-panel")!;
    this.xpLevelEl = this.el.querySelector(".hud-xp-level")!;
    this.xpBarFill = this.el.querySelector(".hud-xp-bar-fill")!;
    this.xpValueEl = this.el.querySelector(".hud-xp-value")!;
    this.muteBtn = this.el.querySelector(".hud-mute-btn")!;

    this.muteBtn.addEventListener("click", () => {
      if (!this.onMuteToggle) return;
      const muted = this.onMuteToggle();
      this.muteBtn.querySelector<SVGElement>(".hud-mute-icon-on")!.style.display = muted ? "none" : "";
      this.muteBtn.querySelector<SVGElement>(".hud-mute-icon-off")!.style.display = muted ? "" : "none";
    });

    this.applyStyles();
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

  setXP(current: number, nextLevelXP: number, currentLevelXP: number, level: number) {
    this.xpLevelEl.textContent = `LVL ${level}`;
    const range = nextLevelXP - currentLevelXP;
    const progress = range > 0 ? (current - currentLevelXP) / range : 1;
    this.xpBarFill.style.width = `${Math.min(100, Math.max(0, progress * 100))}%`;
    this.xpValueEl.textContent = `${current} XP`;
  }

  showXPGain(amount: number, bonus = false) {
    const popup = document.createElement("div");
    popup.className = bonus ? "hud-xp-popup hud-xp-popup-bonus" : "hud-xp-popup";
    popup.textContent = bonus ? `+${amount} XP BARREL ROLL!` : `+${amount} XP`;
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

  /** Shown when bird flock formation completes; matches XP popup line + float styling, below the flock ring. */
  showFlockFormationCelebrate() {
    const el = document.createElement("div");
    el.className = "hud-flock-celebration";
    el.textContent = "You flew with the birds";
    this.el.appendChild(el);

    requestAnimationFrame(() => el.classList.add("hud-flock-celebration-animate"));
    setTimeout(() => el.remove(), 1600);
  }

  showRainbowCelebrate() {
    const el = document.createElement("div");
    el.className = "hud-rainbow-celebration";
    el.textContent = "You flew through a rainbow";
    this.el.appendChild(el);

    requestAnimationFrame(() => el.classList.add("hud-rainbow-celebration-animate"));
    setTimeout(() => el.remove(), 1600);
  }

  showLanternCelebrate() {
    const el = document.createElement("div");
    el.className = "hud-lantern-celebration";
    el.textContent = "You drifted through the lanterns";
    this.el.appendChild(el);

    requestAnimationFrame(() => el.classList.add("hud-lantern-celebration-animate"));
    setTimeout(() => el.remove(), 1600);
  }

  showFireflyCelebrate() {
    const el = document.createElement("div");
    el.className = "hud-firefly-celebration";
    el.textContent = "Fireflies!";
    this.el.appendChild(el);

    requestAnimationFrame(() => el.classList.add("hud-firefly-celebration-animate"));
    setTimeout(() => el.remove(), 1400);
  }

  setMuteToggle(fn: () => boolean) {
    this.onMuteToggle = fn;
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

  private applyStyles() {
    if (document.getElementById("hud-styles")) return;
    const style = document.createElement("style");
    style.id = "hud-styles";
    style.textContent = `
      #hud {
        position: fixed; inset: 0; z-index: 100;
        pointer-events: none;
        font-family: 'Inter', system-ui, sans-serif;
        color: rgba(255, 255, 255, 0.85);
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
        top: 20px;
        left: 24px;
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

      .hud-mute-btn {
        position: absolute;
        top: 20px;
        right: 24px;
        z-index: 1;
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
      .hud-mute-btn:hover {
        background: rgba(255, 255, 255, 0.15);
        color: rgba(255, 255, 255, 0.95);
      }
      .hud-mute-btn:active {
        background: rgba(255, 255, 255, 0.2);
      }

      .hud-xp-panel {
        position: absolute;
        bottom: 24px;
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
        font-size: 1.1rem;
        font-weight: 700;
        color: rgba(255, 255, 255, 0.95);
        text-shadow: 0 0 12px rgba(255, 255, 255, 0.4), 0 2px 6px rgba(0, 0, 0, 0.4);
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
        height: 1px;
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
        font-size: 1.3rem;
        text-shadow: 0 0 16px rgba(255, 255, 255, 0.6), 0 2px 6px rgba(0, 0, 0, 0.4);
      }

      .hud-flock-celebration {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, calc(-50% - 72px));
        font-size: 0.95rem;
        font-weight: 600;
        letter-spacing: 0.03em;
        color: rgba(255, 255, 255, 0.95);
        text-shadow: 0 0 14px rgba(180, 220, 255, 0.45), 0 2px 8px rgba(0, 0, 0, 0.45);
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
        height: 1px;
        flex-shrink: 0;
      }
      .hud-flock-celebration::before {
        background: linear-gradient(90deg, transparent, rgba(180, 220, 255, 0.55));
      }
      .hud-flock-celebration::after {
        background: linear-gradient(90deg, rgba(180, 220, 255, 0.55), transparent);
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
        font-size: 0.95rem;
        font-weight: 600;
        letter-spacing: 0.03em;
        color: rgba(255, 255, 255, 0.95);
        text-shadow: 0 0 14px rgba(255, 180, 80, 0.5), 0 0 28px rgba(255, 100, 200, 0.3), 0 2px 8px rgba(0, 0, 0, 0.4);
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
        height: 1px;
        flex-shrink: 0;
      }
      .hud-rainbow-celebration::before {
        background: linear-gradient(90deg, transparent, rgba(255, 160, 60, 0.55));
      }
      .hud-rainbow-celebration::after {
        background: linear-gradient(90deg, rgba(200, 80, 255, 0.55), transparent);
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

      .hud-lantern-celebration {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, calc(-50% - 72px));
        font-size: 0.95rem;
        font-weight: 600;
        letter-spacing: 0.03em;
        color: rgba(255, 255, 255, 0.95);
        text-shadow: 0 0 14px rgba(255, 170, 50, 0.6), 0 0 28px rgba(255, 120, 20, 0.35), 0 2px 8px rgba(0, 0, 0, 0.5);
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
        height: 1px;
        flex-shrink: 0;
      }
      .hud-lantern-celebration::before {
        background: linear-gradient(90deg, transparent, rgba(255, 180, 60, 0.6));
      }
      .hud-lantern-celebration::after {
        background: linear-gradient(90deg, rgba(255, 140, 30, 0.6), transparent);
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
        font-size: 0.95rem;
        font-weight: 600;
        letter-spacing: 0.03em;
        color: rgba(255, 255, 255, 0.95);
        text-shadow: 0 0 14px rgba(255, 170, 50, 0.6), 0 0 28px rgba(255, 120, 20, 0.35), 0 2px 8px rgba(0, 0, 0, 0.5);
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
        height: 1px;
        flex-shrink: 0;
      }
      .hud-firefly-celebration::before {
        background: linear-gradient(90deg, transparent, rgba(140, 255, 60, 0.6));
      }
      .hud-firefly-celebration::after {
        background: linear-gradient(90deg, rgba(100, 220, 40, 0.6), transparent);
      }
      .hud-firefly-celebration-animate {
        opacity: 1;
        transform: translate(-50%, calc(-50% - 92px));
      }

      @media (max-width: 768px) {
        .hud-firefly-celebration {
          transform: translate(-50%, calc(-50% - 58px));
        }
        .hud-firefly-celebration-animate {
          transform: translate(-50%, calc(-50% - 78px));
        }
      }

      .hud-levelup {
        position: absolute; top: 35%; left: 50%;
        transform: translate(-50%, -50%) scale(0.5);
        font-size: 2.5rem; font-weight: 800;
        letter-spacing: 0.12em;
        color: rgba(255, 255, 255, 0);
        text-shadow: 0 0 30px rgba(255, 255, 255, 0.6), 0 0 60px rgba(255, 255, 255, 0.3);
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
        height: 1px;
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
      #hud.hud--entrance .hud-mute-btn {
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
          top: max(12px, env(safe-area-inset-top));
          left: max(12px, env(safe-area-inset-left));
        }
        .hud-mute-btn {
          top: max(12px, env(safe-area-inset-top));
          right: max(12px, env(safe-area-inset-right));
          width: 40px;
          height: 40px;
        }
        .hud-world-name { font-size: 0.8rem; }
        .hud-player-count { font-size: 0.65rem; }

        .hud-xp-panel {
          bottom: max(12px, calc(4px + env(safe-area-inset-bottom)));
          padding: 8px 16px;
          min-width: 140px;
          backdrop-filter: none;
        }
        .hud-xp-level { font-size: 0.6rem; }
        .hud-xp-value { font-size: 0.55rem; }

        .hud-xp-popup { bottom: 120px; font-size: 0.9rem; }
        .hud-xp-popup::before, .hud-xp-popup::after { width: 32px; }

        .hud-flock-celebration {
          font-size: 0.82rem;
          gap: 8px;
        }
        .hud-flock-celebration::before,
        .hud-flock-celebration::after { width: 24px; }
        .hud-flock-celebration-animate {
          transform: translate(-50%, calc(-50% - 78px));
        }

        .hud-rainbow-celebration {
          font-size: 0.82rem;
          gap: 8px;
        }
        .hud-rainbow-celebration::before,
        .hud-rainbow-celebration::after { width: 24px; }
        .hud-rainbow-celebration-animate {
          transform: translate(-50%, calc(-50% - 78px));
        }

        .hud-lantern-celebration {
          font-size: 0.82rem;
          gap: 8px;
        }
        .hud-lantern-celebration::before,
        .hud-lantern-celebration::after { width: 24px; }
        .hud-lantern-celebration-animate {
          transform: translate(-50%, calc(-50% - 78px));
        }

        .hud-firefly-celebration {
          font-size: 0.82rem;
          gap: 8px;
        }
        .hud-firefly-celebration::before,
        .hud-firefly-celebration::after { width: 24px; }
        .hud-firefly-celebration-animate {
          transform: translate(-50%, calc(-50% - 78px));
        }

        .hud-levelup { font-size: 1.8rem; }
        .hud-levelup::before, .hud-levelup::after { width: 40px; }
      }
    `;
    document.head.appendChild(style);
  }

  get root(): HTMLDivElement {
    return this.el;
  }

  show() {
    this.hidden = false;
    this.el.style.display = "";
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
    window.removeEventListener("keydown", this.onKey);
    this.el.remove();
  }
}
