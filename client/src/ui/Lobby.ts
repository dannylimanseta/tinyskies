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

export interface PlayOptions {
  startAtCampsite?: boolean;
}

interface LobbyOptions {
  playerName: string;
  mobile?: boolean;
  onPlay: (vehicle: Vehicle, options?: PlayOptions) => void;
  onNameChange?: (name: string) => void;
}

export class Lobby {
  private container: HTMLElement;
  private el: HTMLDivElement;
  private options: LobbyOptions;

  constructor(container: HTMLElement, options: LobbyOptions) {
    this.container = container;
    this.options = options;
    this.el = document.createElement("div");
    this.el.id = "lobby";
    this.buildUI();
  }

  /** Enter fullscreen on Start (user gesture). Browser Esc exits fullscreen. */
  private static requestFullscreen(): void {
    const el = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void>;
    };
    const req =
      el.requestFullscreen?.bind(el) ??
      el.webkitRequestFullscreen?.bind(el);
    if (req) void Promise.resolve(req()).catch(() => {});
  }

  private buildUI() {
    this.el.innerHTML = `
      <div class="lobby-overlay">
        <div class="lobby-header">
          <h1 class="lobby-title">Tiny Skies</h1>
          <p class="lobby-username">Hello, <span class="lobby-name" contenteditable="true" spellcheck="false">${this.options.playerName}</span><button type="button" class="lobby-edit-btn" aria-label="Edit name"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg></button></p>
          <button type="button" class="lobby-start" id="btn-start">START GAME</button>
        </div>
      </div>
    `;

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

    const startBtn = this.el.querySelector("#btn-start") as HTMLButtonElement;

    startBtn.addEventListener("click", () => {
      startBtn.disabled = true;
      Lobby.requestFullscreen();
      this.options.onPlay("plane");
    });

    this.applyStyles();
  }

  show() {
    this.container.appendChild(this.el);
    requestAnimationFrame(() => {
      this.el.querySelector(".lobby-header")?.classList.add("visible");
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
        top: 24vh;
        left: 0; right: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
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
        width: 100%;
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

      .lobby-start {
        margin: 2.85rem 0 0;
        padding: 6px 8px;
        border: none;
        border-radius: 0;
        background: transparent;
        color: #ffffff;
        font-family: inherit;
        font-size: clamp(1rem, 4vw, 1.15rem);
        font-weight: 800;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        white-space: nowrap;
        transition: transform 0.15s ease;
        -webkit-tap-highlight-color: transparent;
      }
      /* Match HUD floating text (.hud-xp-popup) — lines hidden until hover / press / focus. */
      .lobby-start::before,
      .lobby-start::after {
        content: '';
        display: block;
        width: 48px;
        height: 2px;
        flex-shrink: 0;
        opacity: 0;
        transition: opacity 0.3s ease-out;
      }
      .lobby-start::before {
        background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.5));
      }
      .lobby-start::after {
        background: linear-gradient(90deg, rgba(255, 255, 255, 0.5), transparent);
      }
      .lobby-start:hover:not(:disabled)::before,
      .lobby-start:hover:not(:disabled)::after,
      .lobby-start:active:not(:disabled)::before,
      .lobby-start:active:not(:disabled)::after,
      .lobby-start:focus-visible:not(:disabled)::before,
      .lobby-start:focus-visible:not(:disabled)::after {
        opacity: 1;
      }
      .lobby-start:active:not(:disabled) {
        transform: scale(0.98);
      }
      .lobby-start:disabled {
        opacity: 0.45;
        cursor: default;
      }
      .lobby-start:disabled::before,
      .lobby-start:disabled::after {
        opacity: 0 !important;
      }

      @media (max-width: 480px) {
        .lobby-header { top: max(22vh, calc(env(safe-area-inset-top, 0px) + 16vh)); }
        .lobby-username { font-size: 1rem; }
        .lobby-edit-btn { padding: 8px 12px; min-width: 44px; min-height: 44px; }
        .lobby-start {
          margin-top: 2.6rem;
          padding: 10px 12px;
          min-height: 44px;
          font-size: 0.95rem;
          gap: 8px;
        }
        .lobby-start::before,
        .lobby-start::after { width: 32px; }
      }
    `;
    document.head.appendChild(style);
  }
}
