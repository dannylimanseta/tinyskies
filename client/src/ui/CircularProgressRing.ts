/**
 * Circular activity ring (same layout/CSS as package-quest pickup/delivery progress).
 * Shared by {@link PackageQuestHUD} and hotspring photo quest.
 */
const STYLE_ID = "circular-progress-ring-pkg-styles";

function ensurePkgProgressStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .pkg-progress {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, calc(-50% - 80px));
      opacity: 0;
      transition: opacity 0.2s ease;
      pointer-events: none;
      z-index: 12;
    }
    .pkg-progress-ring {
      transition: stroke-dashoffset 0.1s linear;
    }
  `;
  document.head.appendChild(style);
}

export class CircularProgressRing {
  readonly element: HTMLDivElement;
  private readonly svgCircle: SVGCircleElement;
  private readonly circumference: number;

  constructor(parent: HTMLElement) {
    ensurePkgProgressStyles();
    this.element = document.createElement("div");
    this.element.className = "pkg-progress";

    const size = 72;
    const stroke = 4;
    const radius = (size - stroke) / 2;
    this.circumference = 2 * Math.PI * radius;

    this.element.innerHTML = `
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <circle cx="${size / 2}" cy="${size / 2}" r="${radius}"
          fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="${stroke}" />
        <circle class="pkg-progress-ring" cx="${size / 2}" cy="${size / 2}" r="${radius}"
          fill="none" stroke="rgba(255,255,255,0.70)" stroke-width="${stroke}"
          stroke-linecap="round"
          stroke-dasharray="${this.circumference}"
          stroke-dashoffset="${this.circumference}"
          transform="rotate(-90 ${size / 2} ${size / 2})" />
      </svg>
    `;
    parent.appendChild(this.element);
    this.svgCircle = this.element.querySelector(".pkg-progress-ring")!;
  }

  setProgress(value: number) {
    const v = Math.max(0, Math.min(1, value));
    const offset = this.circumference * (1 - v);
    this.svgCircle.style.strokeDashoffset = `${offset}`;
    this.element.style.opacity = v > 0 ? "1" : "0";
  }

  dispose() {
    this.element.remove();
  }
}
