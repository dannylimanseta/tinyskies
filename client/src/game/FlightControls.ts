const TURN_SPEED = 1.2;

export interface ControlState {
  turnRate: number;
  forward: boolean;
  brake: boolean;
  elevate: boolean;
}

export class FlightControls {
  private keys = new Set<string>();
  private _enabled = true;

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
      return { turnRate: 0, forward: false, brake: false, elevate: false };
    }

    let turnRate = 0;

    if (this.keys.has("a") || this.keys.has("arrowleft")) turnRate += TURN_SPEED;
    if (this.keys.has("d") || this.keys.has("arrowright")) turnRate -= TURN_SPEED;

    const forward = this.keys.has("w") || this.keys.has("arrowup");
    const brake = this.keys.has("s") || this.keys.has("arrowdown");
    const elevate = this.keys.has(" ");

    return { turnRate, forward, brake, elevate };
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this._enabled) return;
    this.keys.add(e.key.toLowerCase());
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
