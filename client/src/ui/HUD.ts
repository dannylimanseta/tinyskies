import type { Vehicle } from "@globefly/shared";

export class HUD {
  private el: HTMLDivElement;

  private worldNameEl!: HTMLElement;
  private vehicleHintEl!: HTMLElement;
  private playerCountEl!: HTMLElement;
  private speedEl!: HTMLElement;
  private altitudeEl!: HTMLElement;
  private altitudeLabelEl!: HTMLElement;
  private xpPanelEl!: HTMLElement;
  private xpLevelEl!: HTMLElement;
  private xpBarFill!: HTMLElement;
  private xpValueEl!: HTMLElement;

  constructor(container: HTMLElement) {
    this.el = document.createElement("div");
    this.el.id = "hud";
    this.buildUI();
    container.appendChild(this.el);
  }

  private buildUI() {
    this.el.innerHTML = `
      <div class="hud-top">
        <div class="hud-world-name"></div>
        <div class="hud-vehicle-hint"></div>
        <div class="hud-player-count">1 player</div>
      </div>
      <div class="hud-bottom">
        <div class="hud-stat">
          <span class="hud-label">SPD</span>
          <span class="hud-value hud-speed">1.0</span>
        </div>
        <div class="hud-stat">
          <span class="hud-label hud-alt-label">ALT</span>
          <span class="hud-value hud-altitude">0.55</span>
        </div>
      </div>
      <div class="hud-xp-panel">
        <div class="hud-xp-level">LVL 1</div>
        <div class="hud-xp-bar">
          <div class="hud-xp-bar-fill"></div>
        </div>
        <div class="hud-xp-value">0 XP</div>
      </div>
      <div class="hud-controls"></div>
    `;

    this.worldNameEl = this.el.querySelector(".hud-world-name")!;
    this.vehicleHintEl = this.el.querySelector(".hud-vehicle-hint")!;
    this.playerCountEl = this.el.querySelector(".hud-player-count")!;
    this.speedEl = this.el.querySelector(".hud-speed")!;
    this.altitudeEl = this.el.querySelector(".hud-altitude")!;
    this.altitudeLabelEl = this.el.querySelector(".hud-alt-label")!;
    this.xpPanelEl = this.el.querySelector(".hud-xp-panel")!;
    this.xpLevelEl = this.el.querySelector(".hud-xp-level")!;
    this.xpBarFill = this.el.querySelector(".hud-xp-bar-fill")!;
    this.xpValueEl = this.el.querySelector(".hud-xp-value")!;

    this.applyStyles();
  }

  setWorldName(name: string) {
    this.worldNameEl.textContent = name;
  }

  setVehicle(vehicle: Vehicle, options?: { showXpProgression?: boolean }) {
    const showXp = options?.showXpProgression ?? true;
    this.xpPanelEl.style.display = showXp ? "flex" : "none";

    if (vehicle === "boat") {
      this.vehicleHintEl.textContent = "Boat · ocean only";
      this.altitudeLabelEl.textContent = "SEA";
    } else if (vehicle === "carpet") {
      this.vehicleHintEl.textContent = "Magic Carpet";
      this.altitudeLabelEl.textContent = "ALT";
    } else {
      this.vehicleHintEl.textContent = "Plane";
      this.altitudeLabelEl.textContent = "ALT";
    }
    const controls = this.el.querySelector(".hud-controls")!;
    if (vehicle === "boat") {
      controls.innerHTML = `<span>W</span> forward &middot; <span>S</span> brake &middot; <span>A/D</span> turn`;
    } else if (vehicle === "carpet") {
      controls.innerHTML = `<span>W</span> forward &middot; <span>S</span> brake &middot; <span>A/D</span> turn &middot; <span>Space</span> lift`;
    } else {
      controls.innerHTML = `<span>W</span> forward &middot; <span>S</span> brake &middot; <span>A/D</span> turn &middot; <span>E</span> barrel roll`;
    }
  }

  setPlayerCount(count: number) {
    this.playerCountEl.textContent = `${count} player${count !== 1 ? "s" : ""}`;
  }

  setSpeed(speed: number) {
    this.speedEl.textContent = speed.toFixed(1);
  }

  setAltitude(alt: number) {
    this.altitudeEl.textContent = alt.toFixed(2);
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

  private applyStyles() {
    if (document.getElementById("hud-styles")) return;
    const style = document.createElement("style");
    style.id = "hud-styles";
    style.textContent = `
      #hud {
        position: fixed; inset: 0; z-index: 100;
        pointer-events: none;
        font-family: 'Inter', system-ui, sans-serif;
        color: rgba(200, 220, 255, 0.8);
      }
      .hud-top {
        position: absolute; top: 20px; left: 50%;
        transform: translateX(-50%);
        display: flex; flex-direction: column; align-items: center; gap: 4px;
      }
      .hud-world-name {
        font-size: 1rem; font-weight: 600;
        color: rgba(200, 220, 255, 0.7);
        text-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
      }
      .hud-vehicle-hint {
        font-size: 0.72rem;
        color: rgba(120, 200, 255, 0.55);
        letter-spacing: 0.04em;
      }
      .hud-player-count {
        font-size: 0.75rem;
        color: rgba(100, 200, 150, 0.6);
      }
      .hud-bottom {
        position: absolute; bottom: 30px; left: 50%;
        transform: translateX(-50%);
        display: flex; gap: 32px;
      }
      .hud-stat {
        display: flex; flex-direction: column; align-items: center;
        background: rgba(0, 0, 20, 0.4);
        border: 1px solid rgba(100, 140, 255, 0.12);
        border-radius: 10px; padding: 8px 18px;
        backdrop-filter: blur(8px);
      }
      .hud-label {
        font-size: 0.65rem; text-transform: uppercase;
        letter-spacing: 0.1em; color: rgba(140, 170, 255, 0.4);
      }
      .hud-value {
        font-size: 1.2rem; font-weight: 600;
        font-variant-numeric: tabular-nums;
        color: rgba(200, 220, 255, 0.9);
      }
      .hud-controls {
        position: absolute; bottom: 10px; left: 50%;
        transform: translateX(-50%);
        font-size: 0.7rem; color: rgba(140, 160, 200, 0.3);
      }
      .hud-controls span {
        color: rgba(180, 200, 255, 0.5);
        font-weight: 500;
      }

      .hud-xp-panel {
        position: absolute; bottom: 30px; left: 24px;
        display: flex; flex-direction: column; gap: 4px;
        background: rgba(0, 0, 20, 0.4);
        border: 1px solid rgba(100, 140, 255, 0.12);
        border-radius: 10px; padding: 10px 16px;
        backdrop-filter: blur(8px);
        min-width: 120px;
      }
      .hud-xp-level {
        font-size: 0.7rem; font-weight: 700;
        letter-spacing: 0.08em;
        color: rgba(255, 220, 120, 0.9);
      }
      .hud-xp-bar {
        width: 100%; height: 6px;
        background: rgba(255, 255, 255, 0.08);
        border-radius: 3px; overflow: hidden;
      }
      .hud-xp-bar-fill {
        height: 100%; width: 0%;
        background: linear-gradient(90deg, rgba(100, 200, 255, 0.8), rgba(180, 140, 255, 0.9));
        border-radius: 3px;
        transition: width 0.4s ease-out;
      }
      .hud-xp-value {
        font-size: 0.6rem;
        color: rgba(180, 200, 255, 0.5);
        font-variant-numeric: tabular-nums;
      }

      .hud-xp-popup {
        position: absolute; bottom: 90px; left: 48px;
        font-size: 1.1rem; font-weight: 700;
        color: rgba(255, 230, 120, 0.95);
        text-shadow: 0 0 12px rgba(255, 200, 60, 0.6), 0 2px 6px rgba(0, 0, 0, 0.4);
        opacity: 0;
        transform: translateY(0px);
        transition: opacity 0.3s ease-out, transform 0.8s ease-out;
        pointer-events: none;
      }
      .hud-xp-popup-animate {
        opacity: 1;
        transform: translateY(-40px);
      }
      .hud-xp-popup-bonus {
        color: rgba(120, 255, 200, 0.95);
        font-size: 1.3rem;
        text-shadow: 0 0 16px rgba(80, 255, 180, 0.7), 0 2px 6px rgba(0, 0, 0, 0.4);
      }

      .hud-levelup {
        position: absolute; top: 35%; left: 50%;
        transform: translate(-50%, -50%) scale(0.5);
        font-size: 2.5rem; font-weight: 800;
        letter-spacing: 0.12em;
        color: rgba(255, 230, 100, 0);
        text-shadow: 0 0 30px rgba(255, 200, 60, 0.8), 0 0 60px rgba(255, 180, 40, 0.4);
        transition: color 0.3s ease-out, transform 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        pointer-events: none;
      }
      .hud-levelup-animate {
        color: rgba(255, 230, 100, 0.95);
        transform: translate(-50%, -50%) scale(1);
      }
    `;
    document.head.appendChild(style);
  }

  dispose() {
    this.el.remove();
  }
}
