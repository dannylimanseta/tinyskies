import type { ControlState } from "./FlightControls";
import type { Vehicle } from "@globefly/shared";

const TURN_SPEED = 1.2;
const JOYSTICK_RADIUS = 36;
const DEADZONE = 0.3;

/** Portal-magic look: ring + center soft dot + crescent, uses currentColor. */
const PORTAL_BTN_SVG = `<svg class="tc-portal-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="1.35" opacity="0.92"/><circle cx="12" cy="12" r="2.1" fill="currentColor" opacity="0.32"/><path d="M4.2 12a7.8 7.8 0 0 1 4.1-6.5M20 12a7.8 7.8 0 0 1-4.1 6.5" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round" opacity="0.5"/></svg>`;

export class TouchControls {
  private el: HTMLDivElement;

  private joyBase: HTMLDivElement;
  private joyThumb: HTMLDivElement;
  private rightCol: HTMLDivElement;
  private rightStack: HTMLDivElement;
  private actionBtn: HTMLButtonElement;
  private elevateBtn: HTMLButtonElement;
  private descendBtn: HTMLButtonElement;

  private joyTouchId: number | null = null;
  private joyCenterX = 0;
  private joyCenterY = 0;
  private joyDx = 0;
  private joyDy = 0;

  private actionTouchId: number | null = null;
  private actionQueued = false;
  private actionHeld = false;

  private elevateTouchId: number | null = null;
  private elevateHeld = false;

  private descendTouchId: number | null = null;
  private descendHeld = false;

  private vehicle: Vehicle = "plane";
  /** Cosmic void (carpet): autofire, no on-screen right-hand actions. */
  private cosmicVoid = false;
  private _enabled = true;

  constructor(container: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "touch-controls";

    this.joyBase = document.createElement("div");
    this.joyBase.className = "tc-joy-base";
    this.joyThumb = document.createElement("div");
    this.joyThumb.className = "tc-joy-thumb";
    this.joyBase.appendChild(this.joyThumb);
    this.el.appendChild(this.joyBase);

    this.rightCol = document.createElement("div");
    this.rightCol.className = "tc-right-col";
    this.rightStack = document.createElement("div");
    this.rightStack.className = "tc-right-stack";

    this.elevateBtn = document.createElement("button");
    this.elevateBtn.className = "tc-elevate-btn";
    this.elevateBtn.type = "button";
    this.elevateBtn.textContent = "↑";

    this.actionBtn = document.createElement("button");
    this.actionBtn.className = "tc-action-btn";
    this.actionBtn.type = "button";
    this.actionBtn.textContent = "●";

    this.descendBtn = document.createElement("button");
    this.descendBtn.className = "tc-descend-btn";
    this.descendBtn.type = "button";
    this.descendBtn.textContent = "↓";
    this.descendBtn.style.display = "none";

    this.rightStack.append(this.elevateBtn, this.actionBtn, this.descendBtn);
    this.rightCol.append(this.rightStack);
    this.el.appendChild(this.rightCol);

    container.appendChild(this.el);
    this.applyStyles();

    this.joyBase.addEventListener("touchstart", this.onJoyStart, { passive: false });
    window.addEventListener("touchmove", this.onJoyMove, { passive: false });
    window.addEventListener("touchend", this.onJoyEnd);
    window.addEventListener("touchcancel", this.onJoyEnd);

    this.elevateBtn.addEventListener("touchstart", this.onElevateStart, { passive: false });
    window.addEventListener("touchend", this.onElevateEnd);
    window.addEventListener("touchcancel", this.onElevateEnd);

    this.descendBtn.addEventListener("touchstart", this.onDescendStart, { passive: false });
    window.addEventListener("touchend", this.onDescendEnd);
    window.addEventListener("touchcancel", this.onDescendEnd);

    this.actionBtn.addEventListener("touchstart", this.onActionStart, { passive: false });
    window.addEventListener("touchend", this.onActionEnd);
    window.addEventListener("touchcancel", this.onActionEnd);

    this.refreshActionLayout();
  }

  get enabled() { return this._enabled; }
  set enabled(v: boolean) {
    this._enabled = v;
    if (!v) this.resetAll();
  }

  setVehicle(vehicle: Vehicle) {
    this.vehicle = vehicle;
    this.clearRightControlTouches();
    this.refreshActionLayout();
  }

  setCosmicVoid(inside: boolean) {
    this.cosmicVoid = inside;
    this.clearRightControlTouches();
    this.refreshActionLayout();
  }

  private setActionButtonToPlane() {
    this.actionBtn.textContent = "●";
  }

  private setActionButtonToPortal() {
    this.actionBtn.innerHTML = PORTAL_BTN_SVG;
  }

  private clearRightControlTouches() {
    this.actionTouchId = null;
    this.actionQueued = false;
    this.actionHeld = false;
    this.actionBtn.classList.remove("active");
    this.elevateTouchId = null;
    this.elevateHeld = false;
    this.elevateBtn.classList.remove("active");
    this.descendTouchId = null;
    this.descendHeld = false;
    this.descendBtn.classList.remove("active");
  }

  private refreshActionLayout() {
    const v = this.vehicle;
    const isCarpetVoid = v === "carpet" && this.cosmicVoid;

    if (v === "boat" || isCarpetVoid) {
      this.rightCol.style.display = "none";
      return;
    }

    this.rightCol.style.display = "";
    this.descendBtn.style.display = "none";

    if (v === "plane") {
      this.elevateBtn.style.display = "";
      this.elevateBtn.setAttribute("aria-label", "Climb");
      this.setActionButtonToPlane();
      this.actionBtn.style.display = "";
      this.actionBtn.setAttribute("aria-label", "Shoot paintball");
    } else {
      this.elevateBtn.style.display = "none";
      this.setActionButtonToPortal();
      this.actionBtn.style.display = "";
      this.actionBtn.setAttribute("aria-label", "Place magic portal");
    }
  }

  getState(): ControlState {
    if (!this._enabled) {
      return {
        turnRate: 0,
        forward: false,
        brake: false,
        elevate: false,
        descend: false,
        paintball: false,
        specialAction: false,
        interact: false,
      };
    }

    const nx = JOYSTICK_RADIUS > 0 ? this.joyDx / JOYSTICK_RADIUS : 0;
    const ny = JOYSTICK_RADIUS > 0 ? this.joyDy / JOYSTICK_RADIUS : 0;

    const turnRate = Math.abs(nx) > DEADZONE ? -nx * TURN_SPEED : 0;
    const forward = ny < -DEADZONE;
    const brake = ny > DEADZONE;

    const elevate = this.vehicle === "plane" && this.elevateHeld;
    const descend = this.descendHeld;
    let paintball = false;
    let specialAction = false;

    if (this.vehicle === "plane") {
      paintball = this.actionQueued;
      this.actionQueued = false;
    } else if (this.vehicle === "carpet" && !this.cosmicVoid) {
      specialAction = this.actionQueued;
      this.actionQueued = false;
    }

    return {
      turnRate,
      forward,
      brake,
      elevate,
      descend,
      paintball,
      specialAction,
      interact: false,
    };
  }

  /* ── Joystick touch handling ─────────────────────────────── */

  private onJoyStart = (e: TouchEvent) => {
    e.preventDefault();
    if (this.joyTouchId !== null) return;
    const t = e.changedTouches[0];
    this.joyTouchId = t.identifier;
    const rect = this.joyBase.getBoundingClientRect();
    this.joyCenterX = rect.left + rect.width / 2;
    this.joyCenterY = rect.top + rect.height / 2;
    this.updateJoy(t.clientX, t.clientY);
  };

  private onJoyMove = (e: TouchEvent) => {
    if (this.joyTouchId === null) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === this.joyTouchId) {
        e.preventDefault();
        this.updateJoy(t.clientX, t.clientY);
        return;
      }
    }
  };

  private onJoyEnd = (e: TouchEvent) => {
    if (this.joyTouchId === null) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === this.joyTouchId) {
        this.joyTouchId = null;
        this.joyDx = 0;
        this.joyDy = 0;
        this.joyThumb.style.transform = "translate(-50%, -50%)";
        return;
      }
    }
  };

  private updateJoy(cx: number, cy: number) {
    let dx = cx - this.joyCenterX;
    let dy = cy - this.joyCenterY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > JOYSTICK_RADIUS) {
      dx = (dx / dist) * JOYSTICK_RADIUS;
      dy = (dy / dist) * JOYSTICK_RADIUS;
    }
    this.joyDx = dx;
    this.joyDy = dy;
    this.joyThumb.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  /* ── Action button touch handling ───────────────────────── */

  private onActionStart = (e: TouchEvent) => {
    e.preventDefault();
    if (this.actionTouchId !== null) return;
    const t = e.changedTouches[0];
    this.actionTouchId = t.identifier;
    this.actionQueued = true;
    this.actionHeld = true;
    this.actionBtn.classList.add("active");
  };

  private onActionEnd = (e: TouchEvent) => {
    if (this.actionTouchId === null) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === this.actionTouchId) {
        this.actionTouchId = null;
        this.actionHeld = false;
        this.actionBtn.classList.remove("active");
        return;
      }
    }
  };

  /* ── Elevate button touch handling ────────────────────── */

  private onElevateStart = (e: TouchEvent) => {
    e.preventDefault();
    if (this.elevateTouchId !== null) return;
    const t = e.changedTouches[0];
    this.elevateTouchId = t.identifier;
    this.elevateHeld = true;
    this.elevateBtn.classList.add("active");
  };

  private onElevateEnd = (e: TouchEvent) => {
    if (this.elevateTouchId === null) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === this.elevateTouchId) {
        this.elevateTouchId = null;
        this.elevateHeld = false;
        this.elevateBtn.classList.remove("active");
        return;
      }
    }
  };

  /* ── Descend button touch handling ─────────────────────── */

  private onDescendStart = (e: TouchEvent) => {
    e.preventDefault();
    if (this.descendTouchId !== null) return;
    const t = e.changedTouches[0];
    this.descendTouchId = t.identifier;
    this.descendHeld = true;
    this.descendBtn.classList.add("active");
  };

  private onDescendEnd = (e: TouchEvent) => {
    if (this.descendTouchId === null) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === this.descendTouchId) {
        this.descendTouchId = null;
        this.descendHeld = false;
        this.descendBtn.classList.remove("active");
        return;
      }
    }
  };

  /* ── Helpers ────────────────────────────────────────────── */

  private resetAll() {
    this.joyTouchId = null;
    this.joyDx = 0;
    this.joyDy = 0;
    this.joyThumb.style.transform = "translate(-50%, -50%)";
    this.clearRightControlTouches();
  }

  private applyStyles() {
    if (document.getElementById("touch-controls-styles")) return;
    const s = document.createElement("style");
    s.id = "touch-controls-styles";
    s.textContent = `
      .touch-controls {
        position: fixed;
        inset: 0;
        z-index: 110;
        pointer-events: none;
        touch-action: none;
      }
      .tc-joy-base {
        position: absolute;
        bottom: max(20px, env(safe-area-inset-bottom));
        left: max(14px, calc(10px + env(safe-area-inset-left)));
        width: 110px;
        height: 110px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.07);
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.12);
        pointer-events: auto;
        touch-action: none;
        box-shadow: 0 4px 20px rgba(0,0,0,0.2);
      }
      .tc-joy-thumb {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 44px;
        height: 44px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.22);
        border: 1px solid rgba(255, 255, 255, 0.16);
        transition: background 0.1s;
      }
      .tc-right-col {
        position: absolute;
        right: max(12px, calc(8px + env(safe-area-inset-right)));
        /* sit above Vibe Jam / other bottom-rail UI */
        bottom: max(50px, calc(22px + env(safe-area-inset-bottom)));
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 10px;
        max-width: min(168px, 46vw);
        pointer-events: none;
      }
      .tc-right-stack {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 9px;
        pointer-events: auto;
      }
      .tc-elevate-btn,
      .tc-descend-btn,
      .tc-action-btn {
        position: relative;
        right: auto;
        bottom: auto;
        width: 52px;
        height: 52px;
        min-width: 52px;
        min-height: 52px;
        border-radius: 50%;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.08);
        backdrop-filter: blur(10px);
        color: rgba(255, 255, 255, 0.72);
        font-size: 1.05rem;
        font-weight: 700;
        font-family: inherit;
        pointer-events: auto;
        touch-action: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.1s;
        -webkit-user-select: none;
        user-select: none;
        box-shadow: 0 2px 14px rgba(0,0,0,0.18);
        padding: 0;
      }
      .tc-action-btn .tc-portal-icon {
        width: 1.4rem;
        height: 1.4rem;
        max-width: 68%;
        max-height: 68%;
        display: block;
        flex-shrink: 0;
      }
      .tc-elevate-btn.active,
      .tc-descend-btn.active,
      .tc-action-btn.active {
        background: rgba(255, 255, 255, 0.24);
      }
      @media (max-width: 480px) {
        .tc-joy-base,
        .tc-elevate-btn,
        .tc-descend-btn,
        .tc-action-btn {
          backdrop-filter: none;
        }
        .tc-joy-base { width: 100px; height: 100px; }
        .tc-joy-thumb { width: 40px; height: 40px; }
        .tc-elevate-btn,
        .tc-descend-btn,
        .tc-action-btn {
          width: 48px;
          height: 48px;
          min-width: 48px;
          min-height: 48px;
          font-size: 1rem;
        }
        .tc-action-btn .tc-portal-icon {
          width: 1.25rem;
          height: 1.25rem;
        }
      }
    `;
    document.head.appendChild(s);
  }

  dispose() {
    this.joyBase.removeEventListener("touchstart", this.onJoyStart);
    window.removeEventListener("touchmove", this.onJoyMove);
    window.removeEventListener("touchend", this.onJoyEnd);
    window.removeEventListener("touchcancel", this.onJoyEnd);
    this.elevateBtn.removeEventListener("touchstart", this.onElevateStart);
    window.removeEventListener("touchend", this.onElevateEnd);
    window.removeEventListener("touchcancel", this.onElevateEnd);
    this.descendBtn.removeEventListener("touchstart", this.onDescendStart);
    window.removeEventListener("touchend", this.onDescendEnd);
    window.removeEventListener("touchcancel", this.onDescendEnd);
    this.actionBtn.removeEventListener("touchstart", this.onActionStart);
    window.removeEventListener("touchend", this.onActionEnd);
    window.removeEventListener("touchcancel", this.onActionEnd);
    this.el.remove();
    document.getElementById("touch-controls-styles")?.remove();
  }
}
