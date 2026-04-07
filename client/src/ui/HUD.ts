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

  private _bubbleVisible = false;
  private landmarkHiddenByBubble = false;
  private landmarkHUD: { setHidden(h: boolean): void } | null = null;

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
    };
    window.addEventListener("keydown", this.onKey);
  }

  private buildUI() {
    this.el.innerHTML = `
      <div class="hud-top">
        <div class="hud-world-name"></div>
        <div class="hud-player-count">1 player</div>
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
    this.xpPanelEl = this.el.querySelector(".hud-xp-panel")!;
    this.xpLevelEl = this.el.querySelector(".hud-xp-level")!;
    this.xpBarFill = this.el.querySelector(".hud-xp-bar-fill")!;
    this.xpValueEl = this.el.querySelector(".hud-xp-value")!;

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
    `;
    document.head.appendChild(style);
  }

  get root(): HTMLDivElement {
    return this.el;
  }

  show() {
    this.hidden = false;
    this.el.style.display = "";
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
