/**
 * Circular activity ring (same layout/CSS as package-quest pickup/delivery progress).
 * Shared by {@link PackageQuestHUD}, jellyfish capture, hotspring photo quest, and race countdown.
 */
const STYLE_ID = "circular-progress-ring-pkg-styles";

export type CircularProgressRingCenter = "none" | "package" | "jellyfish" | "text";

const CENTER_ICON_SRC: Record<"package" | "jellyfish", string> = {
  package: "/2D/icon_package.svg",
  jellyfish: "/2D/icon_jellyfish.svg",
};

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
    .pkg-progress-wrap {
      position: relative;
      width: 72px;
      height: 72px;
    }
    .pkg-progress-icon {
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      width: 26px;
      height: 26px;
      object-fit: contain;
      pointer-events: none;
      user-select: none;
      opacity: 0.92;
    }
    .pkg-progress-text {
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      font-size: 22px;
      font-weight: 800;
      color: rgba(255,255,255,0.98);
      text-shadow: 0 1px 3px rgba(0,0,0,0.55);
      pointer-events: none;
      user-select: none;
      line-height: 1;
      font-variant-numeric: tabular-nums;
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
  private readonly textEl: HTMLSpanElement | null;

  constructor(
    parent: HTMLElement,
    options?: { centerIcon?: CircularProgressRingCenter },
  ) {
    ensurePkgProgressStyles();
    this.element = document.createElement("div");
    this.element.className = "pkg-progress";

    const size = 72;
    const stroke = 6;
    const radius = (size - stroke) / 2;
    this.circumference = 2 * Math.PI * radius;

    const center = options?.centerIcon ?? "none";
    let centerHtml = "";
    if (center === "text") {
      centerHtml = `<span class="pkg-progress-text" aria-hidden="true"></span>`;
    } else if (center === "package" || center === "jellyfish") {
      centerHtml = `<img class="pkg-progress-icon" src="${CENTER_ICON_SRC[center]}" alt="" draggable="false" />`;
    }

    this.element.innerHTML = `
      <div class="pkg-progress-wrap">
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
          <circle cx="${size / 2}" cy="${size / 2}" r="${radius}"
            fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="${stroke}" />
          <circle class="pkg-progress-ring" cx="${size / 2}" cy="${size / 2}" r="${radius}"
            fill="none" stroke="rgba(255,255,255,1)" stroke-width="${stroke}"
            stroke-linecap="round"
            stroke-dasharray="${this.circumference}"
            stroke-dashoffset="${this.circumference}"
            transform="rotate(-90 ${size / 2} ${size / 2})" />
        </svg>
        ${centerHtml}
      </div>
    `;
    parent.appendChild(this.element);
    this.svgCircle = this.element.querySelector(".pkg-progress-ring")!;
    this.textEl = center === "text" ? this.element.querySelector(".pkg-progress-text") : null;
  }

  setText(text: string) {
    if (this.textEl) this.textEl.textContent = text;
  }

  setProgress(value: number) {
    const v = Math.max(0, Math.min(1, value));
    const offset = this.circumference * (1 - v);
    this.svgCircle.style.strokeDashoffset = `${offset}`;
    this.element.style.opacity = v > 0 ? "1" : "0";
  }

  /** Full ring stroke without hiding (for countdown at progress 1). */
  setProgressVisualOnly(value: number) {
    const v = Math.max(0, Math.min(1, value));
    const offset = this.circumference * (1 - v);
    this.svgCircle.style.strokeDashoffset = `${offset}`;
  }

  setVisible(visible: boolean) {
    this.element.style.opacity = visible ? "1" : "0";
  }

  dispose() {
    this.element.remove();
  }
}
