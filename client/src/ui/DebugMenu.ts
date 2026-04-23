export class DebugMenu {
  private container: HTMLElement;
  private menu: HTMLElement;
  private isVisible = false;
  private onSpawnEternalFlame: () => void;

  constructor(container: HTMLElement, onSpawnEternalFlame: () => void) {
    this.container = container;
    this.onSpawnEternalFlame = onSpawnEternalFlame;

    this.menu = document.createElement("div");
    this.menu.className = "debug-menu";
    this.menu.style.display = "none";
    this.menu.innerHTML = `
      <h3>Debug Menu</h3>
      <button id="debug-spawn-eternal-flame">Spawn Eternal Flame</button>
    `;

    this.container.appendChild(this.menu);

    this.menu.querySelector("#debug-spawn-eternal-flame")?.addEventListener("click", () => {
      this.onSpawnEternalFlame();
    });

    window.addEventListener("keydown", this.handleKeyDown);
    this.ensureStyles();
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.shiftKey && e.key.toLowerCase() === "q") {
      this.toggle();
    }
  };

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
        font-family: sans-serif;
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
    window.removeEventListener("keydown", this.handleKeyDown);
    this.menu.remove();
  }
}
