/**
 * Circular progress ring (same look as package-quest progress), used for bird flock formation.
 */
export class FlockFormationHUD {
  private container: HTMLDivElement;
  private svgCircle: SVGCircleElement;
  private circumference: number;

  constructor(parent: HTMLElement) {
    this.container = document.createElement("div");
    this.container.className = "flock-progress";
    this.container.setAttribute("aria-hidden", "true");

    const size = 72;
    const stroke = 6;
    const radius = (size - stroke) / 2;
    this.circumference = 2 * Math.PI * radius;

    this.container.innerHTML = `
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <circle cx="${size / 2}" cy="${size / 2}" r="${radius}"
          fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="${stroke}" />
        <circle class="flock-progress-ring" cx="${size / 2}" cy="${size / 2}" r="${radius}"
          fill="none" stroke="rgba(255,255,255,1)" stroke-width="${stroke}"
          stroke-linecap="round"
          stroke-dasharray="${this.circumference}"
          stroke-dashoffset="${this.circumference}"
          transform="rotate(-90 ${size / 2} ${size / 2})" />
      </svg>
    `;
    parent.appendChild(this.container);
    this.svgCircle = this.container.querySelector(".flock-progress-ring")!;
    this.injectStyles();
    this.setProgress(0);
  }

  private injectStyles() {
    if (document.getElementById("flock-formation-hud-styles")) return;
    const style = document.createElement("style");
    style.id = "flock-formation-hud-styles";
    style.textContent = `
      .flock-progress {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, calc(-50% - 140px));
        opacity: 0;
        transition: opacity 0.15s ease;
        pointer-events: none;
        z-index: 13;
      }
      .flock-progress-ring {
        transition: stroke-dashoffset 0.08s linear;
      }
      @media (max-width: 768px) {
        .flock-progress {
          transform: translate(-50%, calc(-50% - 120px));
        }
      }
    `;
    document.head.appendChild(style);
  }

  setProgress(value: number) {
    const v = Math.max(0, Math.min(1, value));
    const offset = this.circumference * (1 - v);
    this.svgCircle.style.strokeDashoffset = `${offset}`;
    this.container.style.opacity = v > 0 ? "1" : "0";
  }

  dispose() {
    this.container.remove();
  }
}
