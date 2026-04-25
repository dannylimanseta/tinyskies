import type { Vehicle } from "@globefly/shared";
import { ProgressionManager } from "../game/ProgressionManager";
import { VehicleUnlockPreview } from "./VehicleUnlockPreview";

const VEHICLE_ORDER: Vehicle[] = ["plane", "carpet", "boat"];

const LOCK_ICON_SRC = "/2D/icon_lock.svg";

const SHORT_LABELS: Record<Vehicle, string> = {
  plane: "Biplane",
  boat: "Boat",
  carpet: "Carpet",
};

/** Vehicle silhouettes from `client/public/2D/` (black art → inverted to match lobby `currentColor`). */
const VEHICLE_ICON_SRC: Record<Vehicle, string> = {
  plane: "/2D/icon_biplane.svg",
  carpet: "/2D/icon_carpet.svg",
  boat: "/2D/icon_boat.svg",
};

const LOBBY_DISPLAY_TITLE = "Tiny Skies";

/** Per-letter spans for staggered entrance; `aria-label` on h1 carries the accessible name. */
function lobbyTitleLettersHtml(): string {
  let letterIndex = 0;
  return [...LOBBY_DISPLAY_TITLE]
    .map((ch) => {
      if (ch === " ") {
        return '<span class="lobby-title__space" aria-hidden="true"> </span>';
      }
      const i = letterIndex++;
      return `<span class="lobby-title__char" style="--title-char-i:${i}" aria-hidden="true">${ch}</span>`;
    })
    .join("");
}

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
  /** API base (e.g. `http://localhost:3001`) for the save feed. */
  serverUrl: string;
  playerName: string;
  mobile?: boolean;
  onPlay: (vehicle: Vehicle, options?: PlayOptions) => void;
  onNameChange?: (name: string) => void;
}

export class Lobby {
  private container: HTMLElement;
  private el: HTMLDivElement;
  private options: LobbyOptions;
  private selectedVehicle: Vehicle = "plane";
  private unlockQueue: ("worldSaved" | "carpet" | "boat")[] = [];
  private unlockPreview: VehicleUnlockPreview | null = null;

  constructor(container: HTMLElement, options: LobbyOptions) {
    this.container = container;
    this.options = options;
    this.el = document.createElement("div");
    this.el.id = "lobby";
    this.buildUI();
  }

  private static requestFullscreen(): void {
    const el = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void>;
    };
    const req =
      el.requestFullscreen?.bind(el) ??
      el.webkitRequestFullscreen?.bind(el);
    if (req) void Promise.resolve(req()).catch(() => {});
  }

  private levelLine(level: number | null): string {
    const n = Math.max(1, level ?? 1);
    return `Level ${n}`;
  }

  private buildVehicleButtonsHTML(): string {
    return VEHICLE_ORDER.map((v) => {
      const unlocked = ProgressionManager.isVehicleUnlocked(v);
      const level = ProgressionManager.savedLevelOrNull(v);
      const isSel = unlocked && v === this.selectedVehicle;
      const cls = `lobby-vbtn${isSel && unlocked ? " active" : ""}${unlocked ? "" : " locked"}`;
      if (!unlocked) {
        return `
        <button type="button" class="${cls}"
          data-vehicle="${v}"
          disabled
          role="radio"
          aria-checked="false"
          aria-disabled="true"
          aria-label="Locked vehicle">
          <span class="lobby-vicon lobby-vicon--lock" aria-hidden="true"><img class="lobby-vicon-asset lobby-vicon-asset--lock" src="${LOCK_ICON_SRC}" alt="" width="28" height="28" decoding="async" /></span>
        </button>`;
      }
      return `
        <button type="button" class="${cls}"
          data-vehicle="${v}"
          role="radio"
          aria-checked="${isSel ? "true" : "false"}"
          aria-disabled="false">
          <span class="lobby-vicon" aria-hidden="true"><img class="lobby-vicon-asset" src="${VEHICLE_ICON_SRC[v]}" alt="" width="24" height="24" decoding="async" /></span>
          <span class="lobby-vlabel">${SHORT_LABELS[v]}</span>
          <span class="lobby-vmeta">${this.levelLine(level)}</span>
        </button>`;
    }).join("");
  }

  private buildUI() {
    this.el.innerHTML = `
      <div class="lobby-overlay">
        <div class="lobby-header">
          <div class="lobby-title-block">
            <p class="lobby-tagline">A Cosy Exploration Game</p>
            <h1 class="lobby-title" aria-label="${LOBBY_DISPLAY_TITLE}">${lobbyTitleLettersHtml()}</h1>
          </div>
          <div class="lobby-username">
            <div class="lobby-greeting-row">
              <span class="lobby-greeting-hi">Hello, </span>
              <span class="lobby-name-wrap">
                <span class="lobby-name" contenteditable="true" spellcheck="false">${this.options.playerName}</span>
                <button type="button" class="lobby-edit-btn" aria-label="Edit name"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg></button>
              </span>
            </div>
          </div>
          <div class="lobby-bar">
            <div class="lobby-vehicles" role="radiogroup" aria-label="Vehicle">
              ${this.buildVehicleButtonsHTML()}
            </div>
            <button type="button" class="lobby-fly" id="btn-fly">GO!</button>
          </div>
          <div class="lobby-save-feed" id="lobby-save-feed" hidden>
            <div class="lobby-save-feed-head" aria-hidden="true">
              <span class="lobby-save-feed-deco"></span>
              <svg class="lobby-save-feed-crown" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
                <path fill="currentColor" d="M3 20h18v-2H3v2zm0-3V9.5L6 6l2.2 2.1L12 2l3.8 6.1L18 6l3 3.5V17H3z"/>
              </svg>
              <span class="lobby-save-feed-deco"></span>
            </div>
            <ul class="lobby-save-feed-list" aria-label="Recent world saves"></ul>
            <p class="lobby-save-feed-empty" hidden aria-live="polite">No one has saved the world yet.</p>
          </div>
        </div>
        <div class="lobby-unlock-modal" id="lobby-unlock-modal" aria-hidden="true">
          <div class="lobby-unlock-backdrop"></div>
          <div class="lobby-unlock-panel" role="dialog" aria-modal="true" aria-labelledby="lobby-unlock-title">
            <div class="lobby-unlock-preview-canvas" id="lobby-unlock-preview" aria-hidden="true"></div>
            <h2 class="lobby-unlock-title" id="lobby-unlock-title"></h2>
            <p class="lobby-unlock-body"></p>
            <button type="button" class="lobby-unlock-ok" id="btn-unlock-ok">Got it</button>
          </div>
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

    const flyBtn = this.el.querySelector("#btn-fly") as HTMLButtonElement;
    const vehiclesEl = this.el.querySelector(".lobby-vehicles") as HTMLElement;
    const unlockModal = this.el.querySelector("#lobby-unlock-modal") as HTMLElement;
    const unlockTitle = unlockModal.querySelector(".lobby-unlock-title") as HTMLElement;
    const unlockBody = unlockModal.querySelector(".lobby-unlock-body") as HTMLElement;
    const unlockPreviewHost = this.el.querySelector("#lobby-unlock-preview") as HTMLElement;
    const unlockOk = this.el.querySelector("#btn-unlock-ok") as HTMLButtonElement;

    const setSelectedVehicle = (v: Vehicle) => {
      if (!ProgressionManager.isVehicleUnlocked(v)) return;
      this.selectedVehicle = v;
      vehiclesEl.querySelectorAll(".lobby-vbtn").forEach((btn) => {
        const el = btn as HTMLButtonElement;
        if (el.classList.contains("locked")) {
          el.setAttribute("aria-checked", "false");
          return;
        }
        const veh = el.dataset.vehicle as Vehicle;
        const on = veh === v;
        el.classList.toggle("active", on);
        el.setAttribute("aria-checked", on ? "true" : "false");
      });
    };

    vehiclesEl.querySelectorAll(".lobby-vbtn:not(.locked)").forEach((btn) => {
      btn.addEventListener("click", () => {
        const veh = (btn as HTMLButtonElement).dataset.vehicle as Vehicle;
        setSelectedVehicle(veh);
      });
    });

    this.unlockQueue = [];
    if (ProgressionManager.loadPlayerWorldState().pendingEternalVictoryCelebration) {
      this.unlockQueue.push("worldSaved");
    }
    this.unlockQueue.push(...ProgressionManager.getPendingUnlockCelebrations());

    const showNextUnlockModal = () => {
      if (this.unlockQueue.length === 0) {
        this.unlockPreview?.hide();
        unlockModal.classList.remove("open");
        unlockModal.classList.remove("lobby-unlock-modal--epilogue");
        unlockModal.setAttribute("aria-hidden", "true");
        flyBtn.disabled = false;
        return;
      }
      const kind = this.unlockQueue[0]!;
      if (kind === "worldSaved") {
        this.unlockPreview?.hide();
        unlockModal.classList.add("lobby-unlock-modal--epilogue");
        unlockTitle.textContent = "The world is safe";
        unlockBody.textContent =
          "All five braziers now hold Eternal Flame. The moon will not fall on this world again. Whenever you play Tiny Skies, you can wander the sky without that last threat closing in. Thank you for flying for us all.";
      } else {
        unlockModal.classList.remove("lobby-unlock-modal--epilogue");
        if (!this.unlockPreview) {
          this.unlockPreview = new VehicleUnlockPreview(unlockPreviewHost);
        }
        this.unlockPreview?.show(kind);
        if (kind === "carpet") {
          unlockTitle.textContent = "Magic Carpet unlocked";
          unlockBody.textContent =
            "You reached level 2 on a run. Take to the skies as a sightseeing capybara on a magic carpet!";
        } else {
          unlockTitle.textContent = "Boat unlocked";
          unlockBody.textContent =
            "You reached level 4 with the biplane or carpet. The ocean is yours to sail.";
        }
      }
      unlockModal.classList.add("open");
      unlockModal.setAttribute("aria-hidden", "false");
      flyBtn.disabled = true;
      requestAnimationFrame(() => unlockOk.focus());
    };

    unlockOk.addEventListener("click", () => {
      if (this.unlockQueue.length === 0) return;
      const kind = this.unlockQueue.shift()!;
      if (kind === "worldSaved") {
        const ws = ProgressionManager.loadPlayerWorldState();
        ProgressionManager.savePlayerWorldState({
          ...ws,
          pendingEternalVictoryCelebration: false,
        });
      } else {
        ProgressionManager.acknowledgeUnlockCelebration(kind);
      }
      showNextUnlockModal();
    });

    flyBtn.addEventListener("click", () => {
      if (!ProgressionManager.isVehicleUnlocked(this.selectedVehicle)) return;
      flyBtn.disabled = true;
      Lobby.requestFullscreen();
      this.options.onPlay(this.selectedVehicle);
    });

    if (this.unlockQueue.length > 0) {
      flyBtn.disabled = true;
      showNextUnlockModal();
    }

    this.applyStyles();
  }

  private loadSaveFeed() {
    const host = this.options.serverUrl.replace(/\/$/, "");
    const wrap = this.el.querySelector("#lobby-save-feed") as HTMLElement | null;
    const list = wrap?.querySelector(".lobby-save-feed-list") as HTMLUListElement | null;
    const emptyEl = wrap?.querySelector(".lobby-save-feed-empty") as HTMLElement | null;
    if (!wrap || !list || !emptyEl) return;

    const showFeedBlock = (hasEntries: boolean) => {
      if (hasEntries) {
        emptyEl.hidden = true;
        list.removeAttribute("aria-hidden");
      } else {
        list.replaceChildren();
        list.setAttribute("aria-hidden", "true");
        emptyEl.hidden = false;
      }
      wrap.hidden = false;
      requestAnimationFrame(() => {
        wrap.classList.add("visible");
      });
    };

    void fetch(`${host}/api/save-feed?limit=5`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("save-feed"))))
      .then((data: { entries?: { playerName: string; worldName: string }[] }) => {
        const entries = data.entries ?? [];
        if (entries.length === 0) {
          showFeedBlock(false);
          return;
        }
        list.replaceChildren(
          ...entries.map((e) => {
            const li = document.createElement("li");
            li.className = "lobby-save-feed-item";
            li.textContent = `${e.playerName} saved ${e.worldName}.`;
            return li;
          }),
        );
        showFeedBlock(true);
      })
      .catch(() => {
        showFeedBlock(false);
      });
  }

  show() {
    this.container.appendChild(this.el);
    this.loadSaveFeed();
    requestAnimationFrame(() => {
      this.unlockPreview?.resize();
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
    this.unlockPreview?.dispose();
    this.unlockPreview = null;
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

      .lobby-header {
        position: fixed;
        top: 28vh;
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
      /* Negative margin on the tagline shrinks this block's height; padding-bottom restores
         space before .lobby-username so the greeting doesn't ride up with the title pair. */
      .lobby-title-block {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0;
        padding-bottom: clamp(0.28rem, 0.9vw, 0.5rem);
      }
      .lobby-tagline {
        font-family: 'Darumadrop One', 'Inter', system-ui, sans-serif;
        font-size: clamp(1.05rem, 3.3vw, 1.32rem);
        font-weight: 400;
        margin: 0 0 -0.24em;
        line-height: 1.1;
        letter-spacing: 0.08em;
        color: rgba(255, 255, 255, 0.88);
        text-shadow: none;
      }
      .lobby-title {
        font-family: 'Darumadrop One', 'Inter', system-ui, sans-serif;
        font-size: clamp(3.5rem, 14vw, 8.4rem);
        font-weight: 800;
        margin: 0;
        line-height: 1;
        color: white;
        text-shadow: none;
        display: inline-flex;
        flex-wrap: wrap;
        justify-content: center;
        max-width: 100%;
      }
      .lobby-title__char {
        display: inline-block;
        opacity: 0;
        transform: translate3d(0, 0.52em, 0);
        will-change: transform, opacity;
      }
      .lobby-header.visible .lobby-title__char {
        animation: lobby-title-char-in 0.68s cubic-bezier(0.28, 1.25, 0.55, 1) forwards;
        animation-delay: calc(0.38s + var(--title-char-i) * 0.058s);
      }
      @keyframes lobby-title-char-in {
        0% {
          opacity: 0;
          transform: translate3d(0, 0.52em, 0);
        }
        58% {
          opacity: 1;
          transform: translate3d(0, -0.06em, 0);
        }
        78% {
          transform: translate3d(0, 0.03em, 0);
        }
        100% {
          opacity: 1;
          transform: translate3d(0, 0, 0);
        }
      }
      .lobby-title__space {
        display: inline-block;
        white-space: pre;
      }
      @media (prefers-reduced-motion: reduce) {
        .lobby-title__char {
          animation: none !important;
          opacity: 1 !important;
          transform: none !important;
        }
      }
      .lobby-username {
        margin: 8px 0 0;
        width: 100%;
        padding: 0 40px;
        box-sizing: border-box;
        font-size: 1.2rem;
        font-weight: 400;
        color: rgba(255, 255, 255, 1.0);
        display: flex;
        justify-content: center;
        align-items: center;
      }
      .lobby-greeting-row {
        display: inline-flex;
        align-items: baseline;
        flex-wrap: nowrap;
        max-width: calc(100% - 48px);
      }
      .lobby-greeting-hi { flex-shrink: 0; white-space: nowrap; }
      .lobby-name-wrap {
        position: relative;
        display: inline-block;
        min-width: 40px;
      }
      .lobby-name {
        font-weight: 600;
        color: rgba(255, 255, 255, 1.0);
        outline: none;
        border-bottom: 2px dashed rgba(255, 255, 255, 0.5);
        padding: 0 2px;
        min-width: 32px;
        cursor: text;
        transition: border-color 0.2s;
      }
      .lobby-name:focus { border-bottom-color: rgba(255, 255, 255, 0.7); }
      .lobby-edit-btn {
        position: absolute;
        left: 100%;
        top: 50%;
        transform: translateY(-50%);
        margin-left: 6px;
        background: none;
        border: none;
        color: rgba(255, 255, 255, 0.4);
        cursor: pointer;
        padding: 4px 6px;
        transition: color 0.2s;
        line-height: 1;
        display: inline-flex;
        align-items: center;
      }
      .lobby-edit-btn:hover { color: rgba(255, 255, 255, 0.8); }

      .lobby-bar {
        position: relative;
        align-self: center;
        margin-top: 40px;
        width: min(520px, calc(100% - 80px));
        padding: 10px 12px;
        display: flex;
        align-items: stretch;
        gap: 10px;
        background: rgba(255, 255, 255, 0.1);
        backdrop-filter: blur(32px) saturate(120%);
        -webkit-backdrop-filter: blur(32px) saturate(120%) brightness(0.85);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 16px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
        pointer-events: auto;
        opacity: 0;
        transform: translateY(28px);
        transition: opacity 0.6s ease-out, transform 0.6s ease-out;
        transition-delay: 0.55s;
        z-index: 101;
        box-sizing: border-box;
      }
      .lobby-bar.visible {
        opacity: 1;
        transform: translateY(0);
      }
      .lobby-overlay.fade-out .lobby-bar {
        transform: translateY(16px);
      }

      .lobby-vehicles {
        display: flex;
        gap: 4px;
        flex: 1;
        min-width: 0;
      }
      .lobby-vbtn {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 2px;
        padding: 8px 6px 10px;
        min-height: 72px;
        min-width: 0;
        border: 2px solid transparent;
        border-radius: 10px;
        background: transparent;
        color: #ffffff;
        cursor: pointer;
        transition: background 0.2s, color 0.2s, box-shadow 0.2s, border-color 0.2s, opacity 0.2s;
        font-family: inherit;
      }
      .lobby-vbtn:hover:not(.locked):not(.active) {
        background: rgba(255, 255, 255, 0.12);
      }
      .lobby-vbtn.active {
        background: rgba(255, 255, 255, 1.0);
        color: rgba(20, 30, 50, 0.92);
      }
      .lobby-vbtn.active .lobby-vmeta { color: rgba(20, 30, 50, 0.75); }
      .lobby-vbtn.locked {
        opacity: 0.55;
        cursor: not-allowed;
        gap: 0;
      }
      .lobby-vbtn.locked .lobby-vicon--lock {
        opacity: 0.9;
      }
      .lobby-vicon {
        display: flex;
        align-items: center;
        justify-content: center;
        line-height: 0;
      }
      .lobby-vicon-asset {
        width: 24px;
        height: 24px;
        flex-shrink: 0;
        display: block;
        filter: brightness(0) invert(1);
      }
      .lobby-vbtn.active .lobby-vicon-asset {
        filter: none;
      }
      .lobby-vicon-asset--lock { width: 28px; height: 28px; }
      .lobby-vlabel {
        font-size: 0.8rem;
        font-weight: 600;
        letter-spacing: 0.03em;
      }
      .lobby-vmeta {
        font-size: 0.68rem;
        font-weight: 600;
        line-height: 1.25;
        text-align: center;
        max-width: 100%;
        padding: 0 2px;
        opacity: 0.92;
        letter-spacing: 0.02em;
      }

      .lobby-fly {
        align-self: stretch;
        padding: 0 28px;
        border: none;
        border-radius: 10px;
        background: #000000;
        color: #ffffff;
        font-family: 'Darumadrop One', 'Inter', system-ui, sans-serif;
        font-size: 1.5rem;
        font-weight: 700;
        letter-spacing: 0.06em;
        cursor: pointer;
        transition: background 0.2s, transform 0.15s, opacity 0.2s;
        flex-shrink: 0;
      }
      .lobby-fly:hover:not(:disabled) {
        background: #1a1a1a;
        transform: scale(1.03);
      }
      .lobby-fly:active:not(:disabled) { transform: scale(0.97); }
      .lobby-fly:disabled {
        opacity: 0.52;
        cursor: default;
        transform: none;
      }

      .lobby-save-feed {
        position: relative;
        align-self: center;
        margin-top: 40px;
        width: min(520px, calc(100% - 80px));
        box-sizing: border-box;
        padding: 0 4px;
        pointer-events: none;
        max-height: 0;
        opacity: 0;
        overflow: hidden;
        transform: translateY(8px);
        transition: opacity 0.45s ease-out, transform 0.45s ease-out, max-height 0.45s ease-out;
        transition-delay: 0.62s;
      }
      .lobby-save-feed[hidden] { display: none; }
      .lobby-save-feed:not([hidden]) {
        max-height: 220px;
      }
      .lobby-save-feed.visible {
        opacity: 1;
        transform: translateY(0);
      }
      .lobby-save-feed-head {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        margin-bottom: 12px;
        color: #ffffff;
      }
      .lobby-save-feed-deco {
        flex: 1;
        min-width: 1.5rem;
        max-width: 5.5rem;
        height: 2px;
        border: none;
        border-radius: 1px;
      }
      .lobby-save-feed-deco:first-child {
        background: linear-gradient(
          to right,
          rgba(255, 255, 255, 0) 0%,
          rgba(255, 255, 255, 0.5) 100%
        );
      }
      .lobby-save-feed-deco:last-child {
        background: linear-gradient(
          to left,
          rgba(255, 255, 255, 0) 0%,
          rgba(255, 255, 255, 0.5) 100%
        );
      }
      .lobby-save-feed-crown {
        flex-shrink: 0;
        display: block;
        width: 22px;
        height: 22px;
        filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.25));
      }
      .lobby-save-feed-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.4em;
        text-align: center;
        font-size: 0.78rem;
        font-weight: 450;
        line-height: 1.4;
        letter-spacing: 0.02em;
        color: #ffffff;
        text-shadow: 0 1px 1px rgba(0, 0, 0, 0.35);
      }
      .lobby-save-feed-item { margin: 0; }
      .lobby-save-feed-empty {
        margin: 0;
        text-align: center;
        font-size: 0.78rem;
        font-weight: 450;
        line-height: 1.4;
        letter-spacing: 0.02em;
        color: #ffffff;
        text-shadow: 0 1px 1px rgba(0, 0, 0, 0.35);
      }
      .lobby-save-feed-empty[hidden] { display: none !important; }

      .lobby-unlock-modal {
        position: fixed;
        inset: 0;
        z-index: 110;
        display: none;
        align-items: center;
        justify-content: center;
        font-family: 'Inter', system-ui, sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      .lobby-unlock-modal.open {
        display: flex;
        pointer-events: auto;
      }
      .lobby-unlock-backdrop {
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(10px) saturate(110%);
        -webkit-backdrop-filter: blur(10px) saturate(110%);
      }
      .lobby-unlock-panel {
        position: relative;
        z-index: 1;
        width: min(25rem, calc(100% - 48px));
        max-width: 100%;
        margin: 0 24px;
        padding: 22px 22px 20px;
        text-align: center;
        color: #ffffff;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 16px;
        overflow: hidden;
        background: rgba(255, 255, 255, 0.1);
        backdrop-filter: blur(32px) saturate(120%);
        -webkit-backdrop-filter: blur(32px) saturate(120%) brightness(0.85);
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
        box-sizing: border-box;
      }
      /* Bleed to panel edges (no inner frame); WebGL sits on the glass card. */
      .lobby-unlock-preview-canvas {
        width: calc(100% + 44px);
        margin: -22px -22px 18px -22px;
        height: clamp(170px, 32vw, 220px);
        border-radius: 16px 16px 0 0;
        overflow: hidden;
        pointer-events: none;
      }
      .lobby-unlock-preview-canvas canvas {
        width: 100%;
        height: 100%;
        display: block;
      }
      #lobby-unlock-modal.lobby-unlock-modal--epilogue .lobby-unlock-preview-canvas {
        display: none;
      }
      .lobby-unlock-title {
        font-size: clamp(1.05rem, 3.6vw, 1.25rem);
        font-weight: 800;
        margin: 0 0 10px;
        letter-spacing: 0.02em;
        color: #ffffff;
        text-shadow: none;
      }
      .lobby-unlock-body {
        font-size: 0.94rem;
        font-weight: 400;
        line-height: 1.55;
        margin: 0 0 20px;
        opacity: 0.92;
        color: rgba(255, 255, 255, 0.95);
      }
      .lobby-unlock-ok {
        width: 100%;
        padding: 12px 24px;
        min-height: 48px;
        border: none;
        border-radius: 10px;
        background: #000000;
        color: #ffffff;
        font-family: inherit;
        font-size: 0.95rem;
        font-weight: 700;
        letter-spacing: 0.06em;
        cursor: pointer;
        transition: background 0.2s, transform 0.15s, box-shadow 0.3s;
        box-shadow: 0 0 10px rgba(0, 0, 0, 0.35);
      }
      .lobby-unlock-ok:hover {
        background: #1a1a1a;
        transform: scale(1.02);
        box-shadow: 0 0 18px rgba(0, 0, 0, 0.45);
      }
      .lobby-unlock-ok:active { transform: scale(0.98); }

      @media (max-width: 480px) {
        .lobby-header { top: max(14vh, calc(env(safe-area-inset-top, 0px) + 10vh)); }
        .lobby-username { font-size: 1rem; padding: 0 20px; }
        .lobby-edit-btn { padding: 8px 12px; min-width: 44px; min-height: 44px; }
        .lobby-bar {
          margin-top: 36px;
          width: min(520px, calc(100% - 40px));
          padding: 8px 8px;
          gap: 6px;
        }
        .lobby-vbtn { padding: 8px 4px 10px; min-height: 80px; }
        .lobby-vicon-asset { width: 22px; height: 22px; }
        .lobby-vicon-asset--lock { width: 26px; height: 26px; }
        .lobby-vlabel { font-size: 0.75rem; }
        .lobby-vmeta { font-size: 0.58rem; }
        .lobby-fly { padding: 0 18px; font-size: 0.9rem; min-width: 52px; min-height: 44px; }
        .lobby-save-feed {
          width: min(520px, calc(100% - 40px));
          margin-top: 32px;
        }
        .lobby-save-feed-head { gap: 10px; margin-bottom: 10px; }
        .lobby-save-feed-crown { width: 20px; height: 20px; }
        .lobby-save-feed-list { font-size: 0.72rem; }
        .lobby-save-feed-empty { font-size: 0.72rem; }
        .lobby-unlock-panel {
          width: min(22rem, calc(100% - 32px));
          margin: 0 16px;
          padding: 18px 18px 16px;
        }
        .lobby-unlock-preview-canvas {
          width: calc(100% + 36px);
          margin: -18px -18px 16px -18px;
          height: clamp(150px, 42vw, 190px);
          border-radius: 16px 16px 0 0;
        }
        .lobby-unlock-body { font-size: 0.9rem; }
      }
    `;
    document.head.appendChild(style);
  }
}
