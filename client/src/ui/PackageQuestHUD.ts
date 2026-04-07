export class PackageQuestHUD {
  private progressEl: HTMLDivElement;
  private svgCircle: SVGCircleElement;
  private bubbleEl: HTMLDivElement;
  private bubbleIconEl: HTMLDivElement;
  private bubbleContentEl: HTMLDivElement;
  private bubbleNpcEl: HTMLSpanElement;
  private bubbleTextEl: HTMLSpanElement;
  private bannerEl: HTMLDivElement;
  private bannerNameEl: HTMLSpanElement;
  private bubbleTimer: ReturnType<typeof setTimeout> | null = null;
  private circumference: number;

  onVisibilityChange?: (visible: boolean) => void;

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
          fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="${stroke}" />
        <circle class="pkg-progress-ring" cx="${size / 2}" cy="${size / 2}" r="${radius}"
          fill="none" stroke="rgba(255,255,255,0.70)" stroke-width="${stroke}"
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

    this.bubbleIconEl = document.createElement("div");
    this.bubbleIconEl.className = "pkg-bubble-icon";

    this.bubbleContentEl = document.createElement("div");
    this.bubbleContentEl.className = "pkg-bubble-content";

    this.bubbleNpcEl = document.createElement("span");
    this.bubbleNpcEl.className = "pkg-bubble-npc";
    this.bubbleTextEl = document.createElement("span");
    this.bubbleTextEl.className = "pkg-bubble-text";

    this.bubbleContentEl.appendChild(this.bubbleNpcEl);
    this.bubbleContentEl.appendChild(this.bubbleTextEl);
    this.bubbleEl.appendChild(this.bubbleIconEl);
    this.bubbleEl.appendChild(this.bubbleContentEl);
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
    this.bubbleIconEl.textContent = npcName.charAt(0).toUpperCase();
    this.bubbleEl.style.opacity = "1";
    this.bubbleEl.style.transform = "translate(-50%, 0)";
    this.onVisibilityChange?.(true);
    this.bubbleTimer = setTimeout(() => {
      this.bubbleEl.style.opacity = "0";
      this.bubbleEl.style.transform = "translate(-50%, -6px)";
      this.onVisibilityChange?.(false);
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
        top: 80px;
        left: 50%;
        transform: translate(-50%, -6px);
        display: flex;
        flex-direction: row;
        align-items: flex-start;
        gap: 10px;
        max-width: 400px;
        opacity: 0;
        transition: opacity 0.3s ease-in-out, transform 0.3s ease-in-out;
        pointer-events: none;
        z-index: 11;
      }
      .pkg-bubble-icon {
        width: 34px;
        height: 34px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.10);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.8rem;
        font-weight: 700;
        color: rgba(255, 255, 255, 0.6);
        flex-shrink: 0;
        margin-top: 16px;
      }
      .pkg-bubble-content {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .pkg-bubble-npc {
        font-size: 0.7rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: rgba(255, 255, 255, 0.5);
      }
      .pkg-bubble-text {
        font-size: 1.0rem;
        font-weight: 500;
        color: rgba(255, 255, 255, 0.85);
        padding: 10px 16px;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 4px 14px 14px 14px;
        backdrop-filter: blur(12px);
        line-height: 1.4;
      }

      .pkg-banner {
        position: absolute;
        top: 20px;
        right: 24px;
        font-size: 0.95rem;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.5);
        letter-spacing: 0.04em;
        opacity: 0;
        transition: opacity 0.3s ease-in-out;
        pointer-events: none;
        z-index: 11;
        white-space: nowrap;
      }
      .pkg-banner-name {
        color: rgba(255, 255, 255, 0.85);
        font-weight: 700;
      }

      @media (max-width: 480px) {
        .pkg-bubble {
          top: max(48px, calc(40px + env(safe-area-inset-top)));
          max-width: calc(100% - 48px);
        }
        .pkg-bubble-icon { width: 28px; height: 28px; font-size: 0.7rem; }
        .pkg-bubble-npc { font-size: 0.6rem; }
        .pkg-bubble-text { font-size: 0.85rem; padding: 8px 12px; }
        .pkg-banner {
          top: max(12px, env(safe-area-inset-top));
          right: max(12px, env(safe-area-inset-right));
          font-size: 0.8rem;
        }
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
