import type { LandmarkType } from "../game/Landmarks";

const TYPE_LABELS: Record<LandmarkType, string> = {
  village: "Village",
  peak: "Summit",
  forest: "Forest",
  coast: "Coast",
  island: "Island",
};

export class LandmarkHUD {
  private el: HTMLDivElement;
  private typeEl: HTMLSpanElement;
  private nameEl: HTMLSpanElement;
  private visible = false;

  constructor(parent: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "landmark-hud";

    this.typeEl = document.createElement("span");
    this.typeEl.className = "landmark-hud-type";

    this.nameEl = document.createElement("span");
    this.nameEl.className = "landmark-hud-name";

    this.el.appendChild(this.typeEl);
    this.el.appendChild(this.nameEl);
    parent.appendChild(this.el);

    this.applyStyles();
  }

  show(name: string, type: LandmarkType) {
    if (this.visible && this.nameEl.textContent === name) return;
    this.typeEl.textContent = TYPE_LABELS[type];
    this.nameEl.textContent = name;
    this.visible = true;
    this.el.style.opacity = "1";
    this.el.style.transform = "translate(-50%, 0)";
  }

  hide() {
    if (!this.visible) return;
    this.visible = false;
    this.el.style.opacity = "0";
    this.el.style.transform = "translate(-50%, -8px)";
  }

  private applyStyles() {
    if (document.getElementById("landmark-hud-styles")) return;
    const style = document.createElement("style");
    style.id = "landmark-hud-styles";
    style.textContent = `
      .landmark-hud {
        position: absolute;
        top: 80px;
        left: 50%;
        transform: translate(-50%, -8px);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        opacity: 0;
        transition: opacity 0.3s ease-in-out, transform 0.3s ease-in-out;
        pointer-events: none;
        z-index: 10;
      }
      .landmark-hud-type {
        font-size: 0.55rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.15em;
        color: rgba(180, 200, 255, 0.45);
      }
      .landmark-hud-name {
        font-size: 1.05rem;
        font-weight: 600;
        color: rgba(220, 235, 255, 0.85);
        text-shadow: 0 2px 12px rgba(0, 0, 0, 0.6);
        padding: 4px 16px;
        background: rgba(0, 0, 20, 0.35);
        border: 1px solid rgba(100, 140, 255, 0.1);
        border-radius: 20px;
        backdrop-filter: blur(6px);
      }
    `;
    document.head.appendChild(style);
  }

  dispose() {
    this.el.remove();
  }
}
