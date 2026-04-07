import type { ControlState } from "./FlightControls";
import type { Vehicle } from "@globefly/shared";

const TURN_SPEED = 1.2;
const JOYSTICK_RADIUS = 56;
const DEADZONE = 0.3;

export class TouchControls {
  private el: HTMLDivElement;

  private joyBase: HTMLDivElement;
  private joyThumb: HTMLDivElement;
  private actionBtn: HTMLButtonElement;

  private joyTouchId: number | null = null;
  private joyCenterX = 0;
  private joyCenterY = 0;
  private joyDx = 0;
  private joyDy = 0;

  private actionTouchId: number | null = null;
  private actionQueued = false;
  private actionHeld = false;

  private vehicle: Vehicle = "plane";
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

    this.actionBtn = document.createElement("button");
    this.actionBtn.className = "tc-action-btn";
    this.actionBtn.textContent = "E";
    this.el.appendChild(this.actionBtn);

    container.appendChild(this.el);
    this.applyStyles();

    this.joyBase.addEventListener("touchstart", this.onJoyStart, { passive: false });
    window.addEventListener("touchmove", this.onJoyMove, { passive: false });
    window.addEventListener("touchend", this.onJoyEnd);
    window.addEventListener("touchcancel", this.onJoyEnd);

    this.actionBtn.addEventListener("touchstart", this.onActionStart, { passive: false });
    window.addEventListener("touchend", this.onActionEnd);
    window.addEventListener("touchcancel", this.onActionEnd);
  }

  get enabled() { return this._enabled; }
  set enabled(v: boolean) {
    this._enabled = v;
    if (!v) this.resetAll();
  }

  setVehicle(vehicle: Vehicle) {
    this.vehicle = vehicle;
    if (vehicle === "plane") {
      this.actionBtn.textContent = "⟳";
      this.actionBtn.style.display = "";
    } else if (vehicle === "carpet") {
      this.actionBtn.textContent = "↑";
      this.actionBtn.style.display = "";
    } else {
      this.actionBtn.style.display = "none";
    }
  }

  getState(): ControlState {
    if (!this._enabled) {
      return { turnRate: 0, forward: false, brake: false, elevate: false, barrelRoll: false };
    }

    const nx = JOYSTICK_RADIUS > 0 ? this.joyDx / JOYSTICK_RADIUS : 0;
    const ny = JOYSTICK_RADIUS > 0 ? this.joyDy / JOYSTICK_RADIUS : 0;

    const turnRate = Math.abs(nx) > DEADZONE ? -nx * TURN_SPEED : 0;
    const forward = ny < -DEADZONE;
    const brake = ny > DEADZONE;

    let barrelRoll = false;
    let elevate = false;

    if (this.vehicle === "plane") {
      barrelRoll = this.actionQueued;
      this.actionQueued = false;
    } else if (this.vehicle === "carpet") {
      elevate = this.actionHeld;
    }

    return { turnRate, forward, brake, elevate, barrelRoll };
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

  /* ── Helpers ────────────────────────────────────────────── */

  private resetAll() {
    this.joyTouchId = null;
    this.joyDx = 0;
    this.joyDy = 0;
    this.joyThumb.style.transform = "translate(-50%, -50%)";
    this.actionTouchId = null;
    this.actionQueued = false;
    this.actionHeld = false;
    this.actionBtn.classList.remove("active");
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
        bottom: max(24px, calc(12px + env(safe-area-inset-bottom)));
        left: max(24px, env(safe-area-inset-left));
        width: 120px;
        height: 120px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.06);
        backdrop-filter: blur(8px);
        border: 1px solid rgba(255, 255, 255, 0.10);
        pointer-events: auto;
        touch-action: none;
      }
      .tc-joy-thumb {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 48px;
        height: 48px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.20);
        border: 1px solid rgba(255, 255, 255, 0.15);
        transition: background 0.1s;
      }
      .tc-action-btn {
        position: absolute;
        bottom: max(40px, calc(28px + env(safe-area-inset-bottom)));
        right: max(24px, env(safe-area-inset-right));
        width: 56px;
        height: 56px;
        border-radius: 50%;
        border: 1px solid rgba(255, 255, 255, 0.10);
        background: rgba(255, 255, 255, 0.06);
        backdrop-filter: blur(8px);
        color: rgba(255, 255, 255, 0.6);
        font-size: 1.2rem;
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
      }
      .tc-action-btn.active {
        background: rgba(255, 255, 255, 0.20);
      }
    `;
    document.head.appendChild(s);
  }

  dispose() {
    this.joyBase.removeEventListener("touchstart", this.onJoyStart);
    window.removeEventListener("touchmove", this.onJoyMove);
    window.removeEventListener("touchend", this.onJoyEnd);
    window.removeEventListener("touchcancel", this.onJoyEnd);
    this.actionBtn.removeEventListener("touchstart", this.onActionStart);
    window.removeEventListener("touchend", this.onActionEnd);
    window.removeEventListener("touchcancel", this.onActionEnd);
    this.el.remove();
    document.getElementById("touch-controls-styles")?.remove();
  }
}
