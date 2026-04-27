import type { LandmarkType } from "../game/Landmarks";

const TYPE_LABELS: Record<LandmarkType, string> = {
  village: "Village",
  peak: "Summit",
  forest: "Forest",
  coast: "Coast",
  island: "Island",
  lighthouse: "Lighthouse",
  windmill: "Windmill",
  observatory: "Observatory",
  stonehenge: "Stone Circle",
  shrine: "Shrine",
  hotspring: "Hot Spring",
  mushroom: "Mushroom Grove",
  butterfly: "Butterfly Garden",
  pyramid: "Pyramid",
  statue: "Memorial Statue",
  race_banner: "Race Start",
};

export class LandmarkHUD {
  private el: HTMLDivElement;
  private typeEl: HTMLSpanElement;
  private nameEl: HTMLSpanElement;
  private visible = false;
  private forcedHidden = false;

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
    if (!this.forcedHidden) {
      this.el.style.opacity = "1";
      this.el.style.transform = "translate(-50%, 0)";
    }
  }

  hide() {
    if (!this.visible) return;
    this.visible = false;
    this.el.style.opacity = "0";
    this.el.style.transform = "translate(-50%, -8px)";
  }

  setHidden(hidden: boolean) {
    this.forcedHidden = hidden;
    if (hidden) {
      this.el.style.opacity = "0";
      this.el.style.transform = "translate(-50%, -8px)";
    } else if (this.visible) {
      this.el.style.opacity = "1";
      this.el.style.transform = "translate(-50%, 0)";
    }
  }

  private applyStyles() {
    if (document.getElementById("landmark-hud-styles")) return;
    const style = document.createElement("style");
    style.id = "landmark-hud-styles";
    style.textContent = `
      .landmark-hud {
        position: absolute;
        top: 90px;
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
        font-size: 0.65rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.15em;
        color: rgba(255, 255, 255, 0.4);
      }
      .landmark-hud-name {
        font-size: 1.4rem;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.85);
      }

      @media (max-width: 480px) {
        .landmark-hud {
          top: max(88px, calc(24px + env(safe-area-inset-top) + 52px));
        }
        .landmark-hud-type { font-size: 0.55rem; }
        .landmark-hud-name { font-size: 1.1rem; }
      }
    `;
    document.head.appendChild(style);
  }

  dispose() {
    this.el.remove();
  }
}
