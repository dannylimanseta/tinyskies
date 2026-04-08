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
  mobile?: boolean;
  onPlay: (vehicle: Vehicle) => void;
  onNameChange?: (name: string) => void;
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
          <h1 class="lobby-title">Tiny Skies</h1>
          <p class="lobby-username">Hello, <span class="lobby-name" contenteditable="true" spellcheck="false">${this.options.playerName}</span><button type="button" class="lobby-edit-btn" aria-label="Edit name"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg></button></p>
        </div>
        <div class="lobby-bar">
          <div class="lobby-vehicles" role="radiogroup" aria-label="Vehicle">
            <button type="button" class="lobby-vbtn active" data-vehicle="plane" aria-checked="true">
              <span class="lobby-vicon" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg></span>
              <span class="lobby-vlabel">Plane</span>
            </button>
            <button type="button" class="lobby-vbtn" data-vehicle="boat" aria-checked="false">
              <span class="lobby-vicon" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 18H2"/><path d="M6 18h12l-3.5-3.5C15 12 13 12 10 10c-3.5 5.5-6.5 5.5-6.5 5.5L6 18Z"/><path d="M10 2v4"/><path d="M9 5l2-2 2 2"/></svg></span>
              <span class="lobby-vlabel">Boat</span>
            </button>
            <button type="button" class="lobby-vbtn" data-vehicle="carpet" aria-checked="false">
              <span class="lobby-vicon" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72Z"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/></svg></span>
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

    const nameEl = this.el.querySelector(".lobby-name") as HTMLElement;
    const editBtn = this.el.querySelector(".lobby-edit-btn") as HTMLElement;
    const mobile = this.options.mobile ?? false;

    if (mobile) {
      nameEl.setAttribute("contenteditable", "false");
      nameEl.style.cursor = "pointer";

      const promptName = () => {
        const result = window.prompt("Enter your name", this.options.playerName);
        if (result !== null && result.trim().length > 0) {
          this.options.playerName = result.trim();
          nameEl.textContent = result.trim();
          this.options.onNameChange?.(this.options.playerName);
        }
      };
      editBtn.addEventListener("click", promptName);
      nameEl.addEventListener("click", promptName);
    } else {
      editBtn.addEventListener("click", () => {
        nameEl.focus();
        const range = document.createRange();
        range.selectNodeContents(nameEl);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      });

      nameEl.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter") {
          e.preventDefault();
          nameEl.blur();
        }
      });

      nameEl.addEventListener("blur", () => {
        const trimmed = nameEl.textContent?.trim() || "";
        if (trimmed.length === 0) {
          nameEl.textContent = this.options.playerName;
        } else {
          this.options.playerName = trimmed;
          nameEl.textContent = trimmed;
        }
        this.options.onNameChange?.(this.options.playerName);
      });
    }

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
        font-size: clamp(2.5rem, 10vw, 6rem);
        font-weight: 800;
        margin: 0;
        color: white;
        text-shadow: 0 0 30px rgba(255, 255, 255, 0.3);
      }
      .lobby-username {
        margin: 8px 0 0;
        font-size: 1.2rem;
        font-weight: 400;
        color: rgba(255, 255, 255, 1.0);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0;
      }
      .lobby-name {
        font-weight: 600;
        color: rgba(255, 255, 255, 1.0);
        outline: none;
        border-bottom: 1px dashed rgba(255, 255, 255, 0.3);
        padding: 0 2px;
        min-width: 40px;
        cursor: text;
        transition: border-color 0.2s;
      }
      .lobby-name:focus {
        border-bottom-color: rgba(255, 255, 255, 0.7);
      }
      .lobby-edit-btn {
        background: none;
        border: none;
        color: rgba(255, 255, 255, 0.4);
        cursor: pointer;
        padding: 0 6px;
        transition: color 0.2s;
        line-height: 1;
        display: inline-flex;
        align-items: center;
      }
      .lobby-edit-btn:hover {
        color: rgba(255, 255, 255, 0.8);
      }

      /* ── Bottom Bar ─────────────────────────────────── */
      .lobby-bar {
        position: fixed;
        bottom: max(32px, calc(16px + env(safe-area-inset-bottom)));
        left: 50%;
        transform: translateX(-50%) translateY(30px);
        max-width: 480px;
        width: calc(100% - 48px);
        padding: 10px 12px;
        display: flex;
        align-items: center;
        gap: 10px;
        background: rgba(255, 255, 255, 0.1);
        backdrop-filter: blur(32px) saturate(120%);
        -webkit-backdrop-filter: blur(32px) saturate(120%) brightness(0.85);
        border: 1px solid rgba(255, 255, 255, 0.12);
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
        color: #ffffff;
        cursor: pointer;
        transition: background 0.2s, color 0.2s, box-shadow 0.2s, border-color 0.2s;
        font-family: inherit;
      }
      .lobby-vbtn:hover:not(.active) {
        background: rgba(255, 255, 255, 0.12);
        color: #ffffff;
      }
      .lobby-vbtn.active {
        background: rgba(255, 255, 255, 1.0);
        color: rgba(20, 30, 50, 0.9);
      }
      .lobby-vicon {
        display: flex;
        align-items: center;
        justify-content: center;
        line-height: 0;
      }
      .lobby-vicon svg {
        width: 24px;
        height: 24px;
        flex-shrink: 0;
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
        background: #000000;
        color: #ffffff;
        font-family: inherit;
        font-size: 1rem;
        font-weight: 700;
        letter-spacing: 0.06em;
        cursor: pointer;
        transition: background 0.2s, transform 0.15s, box-shadow 0.3s;
        animation: fly-pulse 2s ease-in-out infinite;
      }
      .lobby-fly:hover {
        background: #1a1a1a;
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
        0%, 100% { box-shadow: 0 0 8px rgba(0, 0, 0, 0.35); }
        50% { box-shadow: 0 0 18px rgba(0, 0, 0, 0.55); }
      }

      @media (max-width: 480px) {
        .lobby-username { font-size: 1rem; }
        .lobby-edit-btn { padding: 8px 12px; min-width: 44px; min-height: 44px; }
        .lobby-bar {
          bottom: max(16px, calc(8px + env(safe-area-inset-bottom)));
          padding: 8px 10px;
          width: calc(100% - 32px);
          gap: 6px;
        }
        .lobby-vbtn { padding: 10px 6px; min-height: 44px; }
        .lobby-vicon svg { width: 22px; height: 22px; }
        .lobby-vlabel { font-size: 0.75rem; }
        .lobby-fly { padding: 0 20px; font-size: 0.9rem; min-height: 44px; }
      }
    `;
    document.head.appendChild(style);
  }
}
