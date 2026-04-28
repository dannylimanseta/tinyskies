export class DebugMenu {
  private container: HTMLElement;
  private menu: HTMLElement;
  private isVisible = false;
  private onSpawnEternalFlame: () => void;
  private onEnterCosmicVoid: () => void;
  private onExitCosmicVoid: () => void;
  private onVoidVictory: () => void;
  private onShieldToZero: () => void;
  private onLightAllBraziersEternal: () => void;
  private onJumpMoonTo70: () => void;
  private onForceFlagSpawn: () => void;

  constructor(
    container: HTMLElement,
    onSpawnEternalFlame: () => void,
    onEnterCosmicVoid: () => void,
    onExitCosmicVoid: () => void,
    onVoidVictory: () => void,
    onShieldToZero: () => void,
    onLightAllBraziersEternal: () => void,
    onJumpMoonTo70: () => void,
    onForceFlagSpawn: () => void = () => {},
  ) {
    this.container = container;
    this.onSpawnEternalFlame = onSpawnEternalFlame;
    this.onEnterCosmicVoid = onEnterCosmicVoid;
    this.onExitCosmicVoid = onExitCosmicVoid;
    this.onVoidVictory = onVoidVictory;
    this.onShieldToZero = onShieldToZero;
    this.onLightAllBraziersEternal = onLightAllBraziersEternal;
    this.onJumpMoonTo70 = onJumpMoonTo70;
    this.onForceFlagSpawn = onForceFlagSpawn;

    this.menu = document.createElement("div");
    this.menu.className = "debug-menu";
    this.menu.style.display = "none";
    this.menu.innerHTML = `
      <h3>Debug Menu</h3>
      <button id="debug-spawn-eternal-flame">Spawn Eternal Flame</button>
      <button id="debug-enter-cosmic-void">Enter Cosmic Void (carpet)</button>
      <button id="debug-exit-cosmic-void">Exit Cosmic Void</button>
      <button id="debug-void-victory">Void Victory</button>
      <button id="debug-shield-to-zero">Energy Shield → 0</button>
      <button id="debug-light-all-braziers-eternal">Light all 5 braziers (Eternal)</button>
      <button id="debug-moon-70">Moon progress → 70%</button>
      <button id="debug-force-flag-spawn">Spawn Flag (Single Player)</button>
    `;

    this.container.appendChild(this.menu);

    this.menu.querySelector("#debug-spawn-eternal-flame")?.addEventListener("click", () => {
      this.onSpawnEternalFlame();
      this.hide();
    });

    this.menu.querySelector("#debug-enter-cosmic-void")?.addEventListener("click", () => {
      this.onEnterCosmicVoid();
      this.hide();
    });

    this.menu.querySelector("#debug-exit-cosmic-void")?.addEventListener("click", () => {
      this.onExitCosmicVoid();
      this.hide();
    });

    this.menu.querySelector("#debug-void-victory")?.addEventListener("click", () => {
      this.onVoidVictory();
      this.hide();
    });

    this.menu.querySelector("#debug-shield-to-zero")?.addEventListener("click", () => {
      this.onShieldToZero();
      this.hide();
    });

    this.menu.querySelector("#debug-light-all-braziers-eternal")?.addEventListener("click", () => {
      this.onLightAllBraziersEternal();
      this.hide();
    });

    this.menu.querySelector("#debug-moon-70")?.addEventListener("click", () => {
      this.onJumpMoonTo70();
      this.hide();
    });

    this.menu.querySelector("#debug-force-flag-spawn")?.addEventListener("click", () => {
      this.onForceFlagSpawn();
      this.hide();
    });

    document.addEventListener("pointerdown", this.handlePointerDownOutside, true);
    window.addEventListener("keydown", this.handleKeyDown);
    this.ensureStyles();
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.shiftKey && e.key.toLowerCase() === "q") {
      this.toggle();
    }
  };

  private handlePointerDownOutside = (e: PointerEvent) => {
    if (!this.isVisible) return;
    const t = e.target as Node | null;
    if (t && this.menu.contains(t)) return;
    this.hide();
  };

  private hide() {
    this.isVisible = false;
    this.menu.style.display = "none";
  }

  private toggle() {
    this.isVisible = !this.isVisible;
    this.menu.style.display = this.isVisible ? "flex" : "none";
  }

  private ensureStyles() {
    if (document.getElementById("debug-menu-styles")) return;
    const style = document.createElement("style");
    style.id = "debug-menu-styles";
    style.textContent = `
      .debug-menu {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.85);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 12px;
        padding: 24px;
        display: flex;
        flex-direction: column;
        gap: 16px;
        z-index: 9999;
        color: white;
        font-family: 'Domine', Georgia, serif;
        min-width: 240px;
        backdrop-filter: blur(8px);
      }
      .debug-menu h3 {
        margin: 0;
        font-size: 1.2rem;
        text-align: center;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        padding-bottom: 12px;
      }
      .debug-menu button {
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: white;
        padding: 10px 16px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 1rem;
        transition: background 0.2s;
      }
      .debug-menu button:hover {
        background: rgba(255, 255, 255, 0.2);
      }
      .debug-menu button:active {
        background: rgba(255, 255, 255, 0.3);
      }
    `;
    document.head.appendChild(style);
  }

  dispose() {
    document.removeEventListener("pointerdown", this.handlePointerDownOutside, true);
    window.removeEventListener("keydown", this.handleKeyDown);
    this.menu.remove();
  }
}
