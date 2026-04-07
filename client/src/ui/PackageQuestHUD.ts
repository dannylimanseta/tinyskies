export class PackageQuestHUD {
  private progressEl: HTMLDivElement;
  private svgCircle: SVGCircleElement;
  private bubbleEl: HTMLDivElement;
  private bubbleNpcEl: HTMLSpanElement;
  private bubbleTextEl: HTMLSpanElement;
  private bannerEl: HTMLDivElement;
  private bannerNameEl: HTMLSpanElement;
  private bubbleTimer: ReturnType<typeof setTimeout> | null = null;
  private circumference: number;

  constructor(parent: HTMLElement) {
    this.progressEl = document.createElement("div");
    this.progressEl.className = "pkg-progress";

    const size = 72;
    const stroke = 4;
    const radius = (size - stroke) / 2;
    this.circumference = 2 * Math.PI * radius;

    this.progressEl.innerHTML = `
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <circle cx="${size / 2}" cy="${size / 2}" r="${radius}"
          fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="${stroke}" />
        <circle class="pkg-progress-ring" cx="${size / 2}" cy="${size / 2}" r="${radius}"
          fill="none" stroke="rgba(255,255,255,0.85)" stroke-width="${stroke}"
          stroke-linecap="round"
          stroke-dasharray="${this.circumference}"
          stroke-dashoffset="${this.circumference}"
          transform="rotate(-90 ${size / 2} ${size / 2})" />
      </svg>
    `;
    parent.appendChild(this.progressEl);
    this.svgCircle = this.progressEl.querySelector(".pkg-progress-ring")!;

    this.bubbleEl = document.createElement("div");
    this.bubbleEl.className = "pkg-bubble";
    this.bubbleNpcEl = document.createElement("span");
    this.bubbleNpcEl.className = "pkg-bubble-npc";
    this.bubbleTextEl = document.createElement("span");
    this.bubbleTextEl.className = "pkg-bubble-text";
    this.bubbleEl.appendChild(this.bubbleNpcEl);
    this.bubbleEl.appendChild(this.bubbleTextEl);
    parent.appendChild(this.bubbleEl);

    this.bannerEl = document.createElement("div");
    this.bannerEl.className = "pkg-banner";
    this.bannerNameEl = document.createElement("span");
    this.bannerNameEl.className = "pkg-banner-name";
    this.bannerEl.appendChild(document.createTextNode("Deliver to "));
    this.bannerEl.appendChild(this.bannerNameEl);
    parent.appendChild(this.bannerEl);

    this.applyStyles();
  }

  setProgress(value: number) {
    const offset = this.circumference * (1 - value);
    this.svgCircle.style.strokeDashoffset = `${offset}`;
    this.progressEl.style.opacity = value > 0 ? "1" : "0";
  }

  showBubble(npcName: string, text: string) {
    if (this.bubbleTimer) clearTimeout(this.bubbleTimer);
    this.bubbleNpcEl.textContent = npcName;
    this.bubbleTextEl.textContent = text;
    this.bubbleEl.style.opacity = "1";
    this.bubbleEl.style.transform = "translate(-50%, 0)";
    this.bubbleTimer = setTimeout(() => {
      this.bubbleEl.style.opacity = "0";
      this.bubbleEl.style.transform = "translate(-50%, -6px)";
    }, 4000);
  }

  showDeliveryTarget(villageName: string) {
    this.bannerNameEl.textContent = villageName;
    this.bannerEl.style.opacity = "1";
  }

  hideDeliveryTarget() {
    this.bannerEl.style.opacity = "0";
  }

  private applyStyles() {
    if (document.getElementById("pkg-quest-hud-styles")) return;
    const style = document.createElement("style");
    style.id = "pkg-quest-hud-styles";
    style.textContent = `
      .pkg-progress {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        opacity: 0;
        transition: opacity 0.2s ease;
        pointer-events: none;
        z-index: 12;
      }
      .pkg-progress-ring {
        transition: stroke-dashoffset 0.1s linear;
      }

      .pkg-bubble {
        position: absolute;
        top: 130px;
        left: 50%;
        transform: translate(-50%, -6px);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        max-width: 340px;
        text-align: center;
        opacity: 0;
        transition: opacity 0.3s ease-in-out, transform 0.3s ease-in-out;
        pointer-events: none;
        z-index: 11;
      }
      .pkg-bubble-npc {
        font-size: 0.6rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: rgba(255, 220, 120, 0.8);
      }
      .pkg-bubble-text {
        font-size: 0.85rem;
        font-weight: 500;
        color: rgba(230, 240, 255, 0.9);
        padding: 6px 16px;
        background: rgba(0, 0, 20, 0.5);
        border: 1px solid rgba(100, 140, 255, 0.12);
        border-radius: 14px;
        backdrop-filter: blur(6px);
        line-height: 1.35;
        text-shadow: 0 1px 6px rgba(0, 0, 0, 0.5);
      }

      .pkg-banner {
        position: absolute;
        top: 110px;
        left: 50%;
        transform: translateX(-50%);
        font-size: 0.72rem;
        font-weight: 600;
        color: rgba(180, 210, 255, 0.7);
        letter-spacing: 0.04em;
        opacity: 0;
        transition: opacity 0.3s ease-in-out;
        pointer-events: none;
        z-index: 11;
      }
      .pkg-banner-name {
        color: rgba(130, 200, 255, 0.95);
        font-weight: 700;
      }
    `;
    document.head.appendChild(style);
  }

  dispose() {
    if (this.bubbleTimer) clearTimeout(this.bubbleTimer);
    this.progressEl.remove();
    this.bubbleEl.remove();
    this.bannerEl.remove();
  }
}
