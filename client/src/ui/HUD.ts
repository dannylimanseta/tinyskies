export class HUD {
  private el: HTMLDivElement;

  private worldNameEl!: HTMLElement;
  private playerCountEl!: HTMLElement;
  private speedEl!: HTMLElement;
  private altitudeEl!: HTMLElement;

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
        <div class="hud-player-count">1 player</div>
      </div>
      <div class="hud-bottom">
        <div class="hud-stat">
          <span class="hud-label">SPD</span>
          <span class="hud-value hud-speed">1.0</span>
        </div>
        <div class="hud-stat">
          <span class="hud-label">ALT</span>
          <span class="hud-value hud-altitude">0.4</span>
        </div>
      </div>
      <div class="hud-controls">
        <span>W</span> forward &middot;
        <span>S</span> brake &middot;
        <span>A/D</span> turn
      </div>
    `;

    this.worldNameEl = this.el.querySelector(".hud-world-name")!;
    this.playerCountEl = this.el.querySelector(".hud-player-count")!;
    this.speedEl = this.el.querySelector(".hud-speed")!;
    this.altitudeEl = this.el.querySelector(".hud-altitude")!;

    this.applyStyles();
  }

  setWorldName(name: string) {
    this.worldNameEl.textContent = name;
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
    `;
    document.head.appendChild(style);
  }

  dispose() {
    this.el.remove();
  }
}
