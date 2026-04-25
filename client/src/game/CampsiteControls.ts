export interface CampsiteControlState {
  moveX: number;
  moveZ: number;
  takeOff: boolean;
  jump: boolean;
}

const JOYSTICK_RADIUS = 56;
const DEADZONE = 0.25;

export class CampsiteControls {
  private keys = new Set<string>();
  private _enabled = true;
  private takeOffQueued = false;
  private jumpQueued = false;

  /* ── Mobile touch overlay ──────────────────────────────── */
  private touchEl: HTMLDivElement | null = null;
  private joyBase: HTMLDivElement | null = null;
  private joyThumb: HTMLDivElement | null = null;
  private takeOffBtn: HTMLButtonElement | null = null;

  private jumpBtn: HTMLButtonElement | null = null;

  private joyTouchId: number | null = null;
  private joyCenterX = 0;
  private joyCenterY = 0;
  private joyDx = 0;
  private joyDy = 0;

  private mobile: boolean;

  constructor(container: HTMLElement, mobile: boolean) {
    this.mobile = mobile;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);

    if (mobile) this.createTouchUI(container);
  }

  get enabled() { return this._enabled; }
  set enabled(v: boolean) {
    this._enabled = v;
    if (!v) { this.keys.clear(); this.joyDx = 0; this.joyDy = 0; }
    if (this.touchEl) this.touchEl.style.display = v ? "" : "none";
  }

  getState(): CampsiteControlState {
    if (!this._enabled) return { moveX: 0, moveZ: 0, takeOff: false, jump: false };

    let moveX = 0;
    let moveZ = 0;

    if (this.mobile) {
      const mag = Math.sqrt(this.joyDx * this.joyDx + this.joyDy * this.joyDy);
      if (mag > DEADZONE) {
        moveX = this.joyDx / Math.max(mag, 1);
        moveZ = -this.joyDy / Math.max(mag, 1);
      }
    } else {
      if (this.keys.has("a") || this.keys.has("arrowleft")) moveX -= 1;
      if (this.keys.has("d") || this.keys.has("arrowright")) moveX += 1;
      if (this.keys.has("w") || this.keys.has("arrowup")) moveZ -= 1;
      if (this.keys.has("s") || this.keys.has("arrowdown")) moveZ += 1;

      const len = Math.sqrt(moveX * moveX + moveZ * moveZ);
      if (len > 1) { moveX /= len; moveZ /= len; }
    }

    const takeOff = this.takeOffQueued;
    this.takeOffQueued = false;
    const jump = this.jumpQueued;
    this.jumpQueued = false;
    return { moveX, moveZ, takeOff, jump };
  }

  /* ── Keyboard ──────────────────────────────────────────── */

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this._enabled) return;
    const key = e.key.toLowerCase();
    if (key === "f" && !e.repeat) this.takeOffQueued = true;
    if (e.key === " " && !e.repeat) { e.preventDefault(); this.jumpQueued = true; }
    this.keys.add(key);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.key.toLowerCase());
  };

  /* ── Mobile touch UI ───────────────────────────────────── */

  private createTouchUI(container: HTMLElement) {
    this.touchEl = document.createElement("div");
    Object.assign(this.touchEl.style, {
      position: "absolute",
      inset: "0",
      pointerEvents: "none",
      zIndex: "100",
    } as CSSStyleDeclaration);

    this.joyBase = document.createElement("div");
    Object.assign(this.joyBase.style, {
      position: "absolute",
      bottom: "80px",
      left: "40px",
      width: `${JOYSTICK_RADIUS * 2 + 16}px`,
      height: `${JOYSTICK_RADIUS * 2 + 16}px`,
      borderRadius: "50%",
      background: "rgba(255,255,255,0.15)",
      border: "2px solid rgba(255,255,255,0.25)",
      pointerEvents: "auto",
      touchAction: "none",
    } as CSSStyleDeclaration);

    this.joyThumb = document.createElement("div");
    Object.assign(this.joyThumb.style, {
      position: "absolute",
      width: "44px",
      height: "44px",
      borderRadius: "50%",
      background: "rgba(255,255,255,0.5)",
      top: "50%",
      left: "50%",
      transform: "translate(-50%,-50%)",
    } as CSSStyleDeclaration);
    this.joyBase.appendChild(this.joyThumb);
    this.touchEl.appendChild(this.joyBase);

    this.jumpBtn = document.createElement("button");
    this.jumpBtn.textContent = "↑";
    Object.assign(this.jumpBtn.style, {
      position: "absolute",
      bottom: "262px",
      right: "40px",
      width: "72px",
      height: "72px",
      borderRadius: "50%",
      border: "2px solid rgba(255,255,255,0.4)",
      background: "rgba(255,255,255,0.2)",
      color: "#fff",
      fontSize: "28px",
      pointerEvents: "auto",
      touchAction: "none",
    } as CSSStyleDeclaration);
    this.touchEl.appendChild(this.jumpBtn);

    this.takeOffBtn = document.createElement("button");
    this.takeOffBtn.textContent = "✈";
    Object.assign(this.takeOffBtn.style, {
      position: "absolute",
      bottom: "172px",
      right: "40px",
      width: "72px",
      height: "72px",
      borderRadius: "50%",
      border: "2px solid rgba(255,255,255,0.4)",
      background: "rgba(255,255,255,0.2)",
      color: "#fff",
      fontSize: "28px",
      pointerEvents: "auto",
      touchAction: "none",
    } as CSSStyleDeclaration);
    this.touchEl.appendChild(this.takeOffBtn);

    this.joyBase.addEventListener("touchstart", this.onJoyStart, { passive: false });
    this.joyBase.addEventListener("touchmove", this.onJoyMove, { passive: false });
    this.joyBase.addEventListener("touchend", this.onJoyEnd, { passive: false });
    this.joyBase.addEventListener("touchcancel", this.onJoyEnd, { passive: false });

    this.jumpBtn.addEventListener("touchstart", (e) => {
      e.preventDefault();
      this.jumpQueued = true;
    }, { passive: false });

    this.takeOffBtn.addEventListener("touchstart", (e) => {
      e.preventDefault();
      this.takeOffQueued = true;
    }, { passive: false });

    container.appendChild(this.touchEl);
  }

  private onJoyStart = (e: TouchEvent) => {
    e.preventDefault();
    if (this.joyTouchId !== null) return;
    const touch = e.changedTouches[0]!;
    this.joyTouchId = touch.identifier;
    const rect = this.joyBase!.getBoundingClientRect();
    this.joyCenterX = rect.left + rect.width / 2;
    this.joyCenterY = rect.top + rect.height / 2;
    this.updateJoy(touch.clientX, touch.clientY);
  };

  private onJoyMove = (e: TouchEvent) => {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i]!;
      if (t.identifier === this.joyTouchId) {
        this.updateJoy(t.clientX, t.clientY);
      }
    }
  };

  private onJoyEnd = (e: TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i]!.identifier === this.joyTouchId) {
        this.joyTouchId = null;
        this.joyDx = 0;
        this.joyDy = 0;
        if (this.joyThumb) {
          this.joyThumb.style.transform = "translate(-50%,-50%)";
        }
      }
    }
  };

  private updateJoy(cx: number, cy: number) {
    let dx = (cx - this.joyCenterX) / JOYSTICK_RADIUS;
    let dy = (cy - this.joyCenterY) / JOYSTICK_RADIUS;
    const mag = Math.sqrt(dx * dx + dy * dy);
    if (mag > 1) { dx /= mag; dy /= mag; }
    this.joyDx = dx;
    this.joyDy = dy;
    if (this.joyThumb) {
      const px = dx * JOYSTICK_RADIUS;
      const py = dy * JOYSTICK_RADIUS;
      this.joyThumb.style.transform = `translate(calc(-50% + ${px}px), calc(-50% + ${py}px))`;
    }
  }

  dispose() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.touchEl?.remove();
  }
}
