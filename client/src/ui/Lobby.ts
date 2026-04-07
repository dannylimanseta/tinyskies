import type { Vehicle } from "@globefly/shared";

/* ── Whimsical Name Generator ──────────────────────────────────────── */

const ADJECTIVES = [
  "Brave", "Swift", "Jolly", "Clever", "Gentle", "Daring", "Merry", "Noble",
  "Plucky", "Cozy", "Nimble", "Trusty", "Lucky", "Mighty", "Wee", "Rosy",
  "Bold", "Kind", "Keen", "Bonny", "Spry", "Peppy", "Stout", "Grand",
  "True", "Fair", "Brisk", "Warm", "Calm", "Zesty",
];
const NOUNS = [
  "Biscuit", "Sparrow", "Pebble", "Maple", "Compass", "Lantern", "Whistle",
  "Clover", "Bramble", "Feather", "Acorn", "Teacup", "Ginger", "Cobble",
  "Turnip", "Cricket", "Walnut", "Thistle", "Nutmeg", "Pudding", "Mittens",
  "Pickle", "Crumpet", "Muffin", "Starling", "Wren", "Juniper", "Ember",
  "Marble", "Truffle",
];

export function generateWhimsicalName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj} ${noun}`;
}

/* ── Lobby ─────────────────────────────────────────────────────────── */

interface LobbyOptions {
  playerName: string;
  onPlay: (vehicle: Vehicle) => void;
}

export class Lobby {
  private container: HTMLElement;
  private el: HTMLDivElement;
  private options: LobbyOptions;
  private selectedVehicle: Vehicle = "plane";

  constructor(container: HTMLElement, options: LobbyOptions) {
    this.container = container;
    this.options = options;
    this.el = document.createElement("div");
    this.el.id = "lobby";
    this.buildUI();
  }

  private buildUI() {
    this.el.innerHTML = `
      <div class="lobby-overlay">
        <div class="lobby-header">
          <h1 class="lobby-title">GlobeFly</h1>
          <p class="lobby-username">${this.options.playerName}</p>
        </div>
        <div class="lobby-bar">
          <div class="lobby-vehicles" role="radiogroup" aria-label="Vehicle">
            <button type="button" class="lobby-vbtn active" data-vehicle="plane" aria-checked="true">
              <span class="lobby-vicon">✈</span>
              <span class="lobby-vlabel">Plane</span>
            </button>
            <button type="button" class="lobby-vbtn" data-vehicle="boat" aria-checked="false">
              <span class="lobby-vicon">⛵</span>
              <span class="lobby-vlabel">Boat</span>
            </button>
            <button type="button" class="lobby-vbtn" data-vehicle="carpet" aria-checked="false">
              <span class="lobby-vicon">🪄</span>
              <span class="lobby-vlabel">Carpet</span>
            </button>
          </div>
          <button type="button" class="lobby-fly" id="btn-fly">GO</button>
        </div>
      </div>
    `;

    this.el.querySelectorAll(".lobby-vbtn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const v = (btn as HTMLButtonElement).dataset.vehicle as Vehicle;
        if (v === "plane" || v === "boat" || v === "carpet") {
          this.selectedVehicle = v;
          this.el.querySelectorAll(".lobby-vbtn").forEach((b) => {
            const active = (b as HTMLElement).dataset.vehicle === v;
            b.classList.toggle("active", active);
            b.setAttribute("aria-checked", active ? "true" : "false");
          });
        }
      });
    });

    this.el.querySelector("#btn-fly")!.addEventListener("click", () => {
      const btn = this.el.querySelector("#btn-fly") as HTMLButtonElement;
      btn.disabled = true;
      this.options.onPlay(this.selectedVehicle);
    });

    this.applyStyles();
  }

  show() {
    this.container.appendChild(this.el);
    requestAnimationFrame(() => {
      this.el.querySelector(".lobby-header")?.classList.add("visible");
      this.el.querySelector(".lobby-bar")?.classList.add("visible");
    });
  }

  fadeOut(onComplete: () => void) {
    const overlay = this.el.querySelector(".lobby-overlay") as HTMLElement;
    if (!overlay) { onComplete(); return; }

    let called = false;
    const onEnd = () => {
      if (called) return;
      called = true;
      clearTimeout(fallback);
      overlay.removeEventListener("transitionend", onEnd);
      onComplete();
    };

    overlay.classList.add("fade-out");
    overlay.addEventListener("transitionend", onEnd);
    const fallback = setTimeout(onEnd, 800);
  }

  dispose() {
    this.el.remove();
    document.getElementById("lobby-styles")?.remove();
  }

  private applyStyles() {
    if (document.getElementById("lobby-styles")) return;
    const style = document.createElement("style");
    style.id = "lobby-styles";
    style.textContent = `
      .lobby-overlay {
        position: fixed; inset: 0; z-index: 100;
        pointer-events: none;
        font-family: 'Inter', system-ui, sans-serif;
        transition: opacity 0.6s ease-out;
      }
      .lobby-overlay.fade-out {
        opacity: 0;
        pointer-events: none;
      }

      /* ── Header ─────────────────────────────────────── */
      .lobby-header {
        position: fixed;
        top: 15vh; left: 0; right: 0;
        text-align: center;
        pointer-events: auto;
        opacity: 0;
        transform: translateY(-20px);
        transition: opacity 0.8s ease-out, transform 0.8s ease-out;
        transition-delay: 0.3s;
      }
      .lobby-header.visible {
        opacity: 1;
        transform: translateY(0);
      }
      .lobby-title {
        font-size: 3rem;
        font-weight: 800;
        margin: 0;
        color: white;
        text-shadow: 0 0 30px rgba(255, 255, 255, 0.3);
      }
      .lobby-username {
        margin: 8px 0 0;
        font-size: 0.9rem;
        font-weight: 400;
        color: rgba(255, 255, 255, 0.55);
      }

      /* ── Bottom Bar ─────────────────────────────────── */
      .lobby-bar {
        position: fixed;
        bottom: 32px;
        left: 50%;
        transform: translateX(-50%) translateY(30px);
        max-width: 480px;
        width: calc(100% - 48px);
        padding: 10px 12px;
        display: flex;
        align-items: center;
        gap: 10px;
        background: rgba(255, 255, 255, 0.35);
        backdrop-filter: blur(32px) saturate(120%);
        -webkit-backdrop-filter: blur(32px) saturate(120%) brightness(0.85);
        border: 1px solid rgba(255, 255, 255, 0.18);
        border-radius: 16px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
        pointer-events: auto;
        opacity: 0;
        transition: opacity 0.6s ease-out, transform 0.6s ease-out;
        transition-delay: 0.6s;
      }
      .lobby-bar.visible {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
      .lobby-overlay.fade-out .lobby-bar {
        transform: translateX(-50%) translateY(20px);
      }

      /* ── Vehicle Buttons ────────────────────────────── */
      .lobby-vehicles {
        display: flex; gap: 4px; flex: 1;
      }
      .lobby-vbtn {
        flex: 1;
        display: flex; flex-direction: column; align-items: center; gap: 4px;
        padding: 10px 12px;
        border: 2px solid transparent;
        border-radius: 10px;
        background: transparent;
        color: rgba(30, 40, 60, 0.6);
        cursor: pointer;
        transition: background 0.2s, color 0.2s, box-shadow 0.2s, border-color 0.2s;
        font-family: inherit;
      }
      .lobby-vbtn:hover {
        background: rgba(255, 255, 255, 0.1);
        color: rgba(30, 40, 60, 0.85);
      }
      .lobby-vbtn.active {
        background: rgba(255, 255, 255, 1.0);
        color: rgba(20, 30, 50, 0.9);
      }
      .lobby-vicon {
        font-size: 1.5rem;
        line-height: 1;
      }
      .lobby-vlabel {
        font-size: 0.85rem;
        font-weight: 600;
        letter-spacing: 0.03em;
      }

      /* ── FLY Button ─────────────────────────────────── */
      .lobby-fly {
        align-self: stretch;
        padding: 0 32px;
        border: none;
        border-radius: 10px;
        background: #2288ee;
        color: white;
        font-family: inherit;
        font-size: 1rem;
        font-weight: 700;
        letter-spacing: 0.06em;
        cursor: pointer;
        transition: background 0.2s, transform 0.15s, box-shadow 0.3s;
        animation: fly-pulse 2s ease-in-out infinite;
      }
      .lobby-fly:hover {
        background: #3399ff;
        transform: scale(1.04);
      }
      .lobby-fly:active {
        transform: scale(0.97);
      }
      .lobby-fly:disabled {
        opacity: 0.6;
        cursor: default;
        animation: none;
        transform: none;
      }
      @keyframes fly-pulse {
        0%, 100% { box-shadow: 0 0 8px rgba(34, 136, 238, 0.2); }
        50% { box-shadow: 0 0 20px rgba(34, 136, 238, 0.45); }
      }
    `;
    document.head.appendChild(style);
  }
}
