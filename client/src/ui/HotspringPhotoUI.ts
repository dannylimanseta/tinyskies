import { CircularProgressRing } from "./CircularProgressRing";

const DEFAULT_SELFIE_URL = "/2D/capybara_hotspring.jpg";
const STARBURST_URL = "/2D/starburst.png";
const STYLE_ID = "hotspring-selfie-overlay-styles";

/** Visible hold before slide/fade exit (seconds). */
const SELFIE_HOLD_MS = 2400;
/** Exit animation duration (ms). */
const SELFIE_EXIT_MS = 900;

function ensureSelfieStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes hotspring-starburst-spin {
      from { transform: translate(-50%, -50%) rotate(0deg); }
      to { transform: translate(-50%, -50%) rotate(360deg); }
    }

    @keyframes hotspring-selfie-pop {
      0% {
        opacity: 0;
        transform: rotate(-4deg) translateY(22px) scale(0.82);
      }
      52% {
        opacity: 1;
        transform: rotate(-4deg) translateY(-10px) scale(1.05);
      }
      74% {
        transform: rotate(-4deg) translateY(5px) scale(0.97);
      }
      100% {
        opacity: 1;
        transform: rotate(-4deg) translateY(0) scale(1);
      }
    }

    .hotspring-selfie-overlay {
      position: fixed;
      left: 0;
      top: 0;
      right: 0;
      bottom: 0;
      width: 100%;
      height: 100%;
      min-height: 100dvh;
      min-height: -webkit-fill-available;
      z-index: 190;
      display: flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      padding: max(12px, env(safe-area-inset-top, 0px)) max(12px, env(safe-area-inset-right, 0px))
        max(12px, env(safe-area-inset-bottom, 0px)) max(12px, env(safe-area-inset-left, 0px));
      background: rgba(0, 0, 0, 0.55);
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.35s ease;
    }
    .hotspring-selfie-overlay--in {
      opacity: 1;
    }
    .hotspring-selfie-overlay--exit {
      opacity: 0;
    }

    .hotspring-selfie-stack {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      max-width: 100%;
      margin: 0 auto;
      transform-origin: center center;
      transition: transform ${SELFIE_EXIT_MS}ms cubic-bezier(0.4, 0, 0.2, 1),
        opacity ${SELFIE_EXIT_MS}ms ease;
    }
    .hotspring-selfie-overlay--exit .hotspring-selfie-stack {
      transform: translateY(-28px) scale(0.96);
      opacity: 0;
    }

    .hotspring-selfie-starburst {
      position: absolute;
      left: 50%;
      top: 50%;
      width: min(132vw, 960px);
      height: auto;
      z-index: 0;
      opacity: 0;
      pointer-events: none;
      user-select: none;
      animation: hotspring-starburst-spin 16s linear infinite;
      transition: opacity 0.35s ease 0.06s;
    }
    .hotspring-selfie-overlay--in .hotspring-selfie-starburst {
      opacity: 0.92;
    }

    .hotspring-selfie-img {
      position: relative;
      z-index: 1;
      display: block;
      max-width: min(92vw, 720px);
      max-height: min(78vh, 560px);
      width: auto;
      height: auto;
      object-fit: contain;
      border-radius: 12px;
      box-shadow: 0 12px 48px rgba(0, 0, 0, 0.45);
      opacity: 0;
      transform: rotate(-4deg) translateY(16px) scale(0.9);
    }
    .hotspring-selfie-overlay--in .hotspring-selfie-img {
      animation: hotspring-selfie-pop 0.72s cubic-bezier(0.34, 1.35, 0.42, 1) forwards;
    }
  `;
  document.head.appendChild(style);
}

export class HotspringPhotoUI {
  private readonly ring: CircularProgressRing;
  private overlayEl: HTMLDivElement | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private removeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(parent: HTMLElement) {
    ensureSelfieStyles();
    this.ring = new CircularProgressRing(parent);
  }

  setProgress(value: number) {
    this.ring.setProgress(value);
  }

  /**
   * Full-screen selfie card; auto-dismisses after a short beat + slide/fade.
   */
  showSelfie(imageUrl: string = DEFAULT_SELFIE_URL, alt = "Selfie") {
    if (this.overlayEl) return;

    const overlay = document.createElement("div");
    overlay.className = "hotspring-selfie-overlay";
    overlay.setAttribute("role", "presentation");

    const stack = document.createElement("div");
    stack.className = "hotspring-selfie-stack";

    const star = document.createElement("img");
    star.className = "hotspring-selfie-starburst";
    star.src = STARBURST_URL;
    star.alt = "";
    star.decoding = "async";
    star.draggable = false;

    const img = document.createElement("img");
    img.className = "hotspring-selfie-img";
    img.src = imageUrl;
    img.alt = alt;
    img.decoding = "async";

    stack.appendChild(star);
    stack.appendChild(img);
    overlay.appendChild(stack);
    document.body.appendChild(overlay);
    this.overlayEl = overlay;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => overlay.classList.add("hotspring-selfie-overlay--in"));
    });

    if (this.hideTimer) clearTimeout(this.hideTimer);
    if (this.removeTimer) clearTimeout(this.removeTimer);
    this.hideTimer = setTimeout(() => {
      overlay.classList.add("hotspring-selfie-overlay--exit");
      this.removeTimer = setTimeout(() => {
        overlay.remove();
        if (this.overlayEl === overlay) this.overlayEl = null;
        this.hideTimer = null;
        this.removeTimer = null;
      }, SELFIE_EXIT_MS + 80);
    }, SELFIE_HOLD_MS);
  }

  dispose() {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    if (this.removeTimer) {
      clearTimeout(this.removeTimer);
      this.removeTimer = null;
    }
    this.overlayEl?.remove();
    this.overlayEl = null;
    this.ring.dispose();
  }
}
