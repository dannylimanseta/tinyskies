const TURN_SPEED = 1.2;

export interface ControlState {
  turnRate: number;
  forward: boolean;
  brake: boolean;
  elevate: boolean;
  barrelRoll: boolean;
}

export class FlightControls {
  private keys = new Set<string>();
  private _enabled = true;
  private barrelRollQueued = false;

  constructor(element: HTMLElement) {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    element.addEventListener("blur", this.reset);
  }

  get enabled() {
    return this._enabled;
  }

  set enabled(v: boolean) {
    this._enabled = v;
    if (!v) this.keys.clear();
  }

  getState(): ControlState {
    if (!this._enabled) {
      return { turnRate: 0, forward: false, brake: false, elevate: false, barrelRoll: false };
    }

    let turnRate = 0;

    if (this.keys.has("a") || this.keys.has("arrowleft")) turnRate += TURN_SPEED;
    if (this.keys.has("d") || this.keys.has("arrowright")) turnRate -= TURN_SPEED;

    const forward = this.keys.has("w") || this.keys.has("arrowup");
    const brake = this.keys.has("s") || this.keys.has("arrowdown");
    const elevate = this.keys.has(" ");
    const barrelRoll = this.barrelRollQueued;
    this.barrelRollQueued = false;

    return { turnRate, forward, brake, elevate, barrelRoll };
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this._enabled) return;
    const key = e.key.toLowerCase();
    if (key === "e" && !e.repeat) {
      this.barrelRollQueued = true;
    }
    this.keys.add(key);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.key.toLowerCase());
  };

  private reset = () => {
    this.keys.clear();
  };

  dispose() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
  }
}
