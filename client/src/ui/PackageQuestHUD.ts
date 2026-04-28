import { getNpcPortraitUrl } from "../game/PackageDialogue";
import { CircularProgressRing } from "./CircularProgressRing";

/** Match phones / small tablets; CSS alone isn’t enough because showBubble sets inline `transform`. */
function isNarrowDialogueViewport(): boolean {
  if (typeof window === "undefined") return false;
  return window.innerWidth <= 768;
}

export class PackageQuestHUD {
  private progressRing: CircularProgressRing;
  private bubbleEl: HTMLDivElement;
  private bubbleIconEl: HTMLDivElement;
  private bubbleContentEl: HTMLDivElement;
  private bubbleNpcEl: HTMLSpanElement;
  private bubbleTextEl: HTMLSpanElement;
  private bannerEl: HTMLDivElement;
  private bannerNameEl: HTMLSpanElement;
  private bannerDistEl: HTMLSpanElement;
  private bubbleTimer: ReturnType<typeof setTimeout> | null = null;
  private whisperEl: HTMLDivElement;
  private whisperTimer: ReturnType<typeof setTimeout> | null = null;

  /** `npcName` is set when `visible` is true (dialogue bubble shown). */
  onVisibilityChange?: (visible: boolean, npcName?: string) => void;

  /**
   * True while an NPC bubble or stonehenge whisper is on-screen (timers active).
   * For HUD layout (e.g. hide quest tracker on mobile); does not drive dialogue SFX.
   */
  onDialogueBubbleOrWhisperChange?: (visible: boolean) => void;

  private lastDialogueOverlayForHud = false;

  constructor(parent: HTMLElement) {
    this.progressRing = new CircularProgressRing(parent, { centerIcon: "package" });

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

    this.whisperEl = document.createElement("div");
    this.whisperEl.className = "pkg-whisper";
    parent.appendChild(this.whisperEl);

    this.bannerEl = document.createElement("div");
    this.bannerEl.className = "pkg-banner";
    const lead = document.createElement("span");
    lead.className = "pkg-banner-lead";
    lead.textContent = "Deliver to ";
    this.bannerNameEl = document.createElement("span");
    this.bannerNameEl.className = "pkg-banner-name";
    this.bannerEl.appendChild(lead);
    this.bannerEl.appendChild(this.bannerNameEl);
    this.bannerDistEl = document.createElement("span");
    this.bannerDistEl.className = "pkg-banner-dist";
    this.bannerEl.appendChild(this.bannerDistEl);
    parent.appendChild(this.bannerEl);

    this.applyStyles();
  }

  private syncDialogueBubbleOverlayHud() {
    const open = this.bubbleTimer !== null || this.whisperTimer !== null;
    if (open === this.lastDialogueOverlayForHud) return;
    this.lastDialogueOverlayForHud = open;
    this.onDialogueBubbleOrWhisperChange?.(open);
  }

  /** True while the dialogue bubble is on-screen (timer running until fade-out completes). */
  get isBubbleShowing(): boolean {
    return this.bubbleTimer !== null;
  }

  /** True while a stonehenge whisper is on-screen. */
  get isWhisperShowing(): boolean {
    return this.whisperTimer !== null;
  }

  hideBubble() {
    if (this.bubbleTimer) {
      clearTimeout(this.bubbleTimer);
      this.bubbleTimer = null;
    }
    this.bubbleEl.style.opacity = "0";
    const narrow = isNarrowDialogueViewport();
    this.bubbleEl.style.transform = narrow ? "translate(0, -6px)" : "translate(-50%, -6px)";
    this.onVisibilityChange?.(false);
    this.syncDialogueBubbleOverlayHud();
  }

  hideWhisper() {
    if (this.whisperTimer) {
      clearTimeout(this.whisperTimer);
      this.whisperTimer = null;
    }
    this.whisperEl.style.opacity = "0";
    const narrow = isNarrowDialogueViewport();
    this.whisperEl.style.transform = narrow ? "translate(0, -6px)" : "translate(-50%, -6px)";
    this.syncDialogueBubbleOverlayHud();
  }

  setProgress(value: number) {
    this.progressRing.setProgress(value);
  }

  showBubble(npcName: string, text: string) {
    this.hideWhisper();
    if (this.bubbleTimer) clearTimeout(this.bubbleTimer);
    this.bubbleNpcEl.textContent = npcName;
    this.bubbleTextEl.textContent = text;
    const portraitUrl = getNpcPortraitUrl(npcName);
    if (portraitUrl) {
      this.bubbleIconEl.textContent = "";
      this.bubbleIconEl.style.backgroundImage = `url(${portraitUrl})`;
      this.bubbleIconEl.style.backgroundSize = "cover";
      this.bubbleIconEl.style.backgroundPosition = "center";
    } else {
      this.bubbleIconEl.style.backgroundImage = "";
      this.bubbleIconEl.textContent = npcName.charAt(0).toUpperCase();
    }
    const narrow = isNarrowDialogueViewport();
    this.bubbleEl.style.opacity = "1";
    // Narrow: fixed layout uses left:10vw + width:80vw — no translateX (-50% would break width).
    this.bubbleEl.style.transform = narrow ? "translate(0, 0)" : "translate(-50%, 0)";
    this.onVisibilityChange?.(true, npcName);
    this.bubbleTimer = setTimeout(() => {
      this.bubbleEl.style.opacity = "0";
      this.bubbleEl.style.transform = narrow ? "translate(0, -6px)" : "translate(-50%, -6px)";
      this.onVisibilityChange?.(false);
      this.bubbleTimer = null;
      this.syncDialogueBubbleOverlayHud();
    }, 4000);
    this.syncDialogueBubbleOverlayHud();
  }

  /** Show an ambient stonehenge whisper — no portrait, italic, same position as NPC bubble. */
  showWhisper(text: string) {
    this.hideBubble();
    if (this.whisperTimer) clearTimeout(this.whisperTimer);
    this.whisperEl.textContent = text;
    const narrow = isNarrowDialogueViewport();
    this.whisperEl.style.opacity = "1";
    this.whisperEl.style.transform = narrow ? "translate(0, 0)" : "translate(-50%, 0)";
    this.whisperTimer = setTimeout(() => {
      this.whisperEl.style.opacity = "0";
      this.whisperEl.style.transform = narrow ? "translate(0, -6px)" : "translate(-50%, -6px)";
      this.whisperTimer = null;
      this.syncDialogueBubbleOverlayHud();
    }, 5500);
    this.syncDialogueBubbleOverlayHud();
  }

  showDeliveryTarget(villageName: string) {
    this.bannerNameEl.textContent = villageName;
    this.bannerDistEl.textContent = "";
    this.bannerEl.style.opacity = "1";
  }

  setDeliveryDistanceMetres(m: number) {
    this.bannerDistEl.textContent = ` \u00a0· ${m}m`;
  }

  hideDeliveryTarget() {
    this.bannerEl.style.opacity = "0";
  }

  private applyStyles() {
    if (document.getElementById("pkg-quest-hud-styles")) return;
    const style = document.createElement("style");
    style.id = "pkg-quest-hud-styles";
    style.textContent = `
      .pkg-bubble {
        position: absolute;
        top: 90px;
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
        width: 68px;
        height: 68px;
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
        flex: 1;
        min-width: 0;
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
        padding: 12px 18px;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 4px 14px 14px 14px;
        backdrop-filter: blur(12px);
        line-height: 1.4;
        box-sizing: border-box;
        width: 100%;
        max-width: 100%;
      }

      .pkg-banner {
        position: absolute;
        top: 32px;
        left: 10px;
        right: calc(var(--hud-top-right-reserved, 120px) + 12px);
        display: flex;
        flex-direction: row;
        flex-wrap: nowrap;
        /* Match .hud-top-right button row: 36px-tall controls at top: 32px */
        min-height: 36px;
        align-items: center;
        justify-content: flex-end;
        min-width: 0;
        box-sizing: border-box;
        font-size: 0.95rem;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.5);
        letter-spacing: 0.04em;
        line-height: 1.2;
        opacity: 0;
        transition: opacity 0.3s ease-in-out;
        pointer-events: none;
        z-index: 11;
        gap: 0.12em;
        /* Optical nudge: text was sitting slightly above icon vertical center */
        padding-top: 1px;
      }
      .pkg-banner-lead {
        flex-shrink: 0;
        white-space: nowrap;
        color: rgba(255, 255, 255, 0.5);
        font-weight: 600;
      }
      .pkg-banner-name {
        /* Intrinisc width + ellipsis — do not flex-grow or "Deliver to …" pins to the left of the full bar */
        flex: 0 1 auto;
        min-width: 0;
        max-width: min(58vw, 24rem);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: rgba(255, 255, 255, 0.85);
        font-weight: 700;
      }
      .pkg-banner-dist {
        flex-shrink: 0;
        white-space: nowrap;
        color: rgba(255, 255, 255, 0.65);
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }

      .pkg-whisper {
        position: absolute;
        top: 90px;
        left: 50%;
        transform: translate(-50%, -6px);
        max-width: 400px;
        width: max-content;
        text-align: left;
        font-style: normal;
        font-size: 1.0rem;
        font-weight: 400;
        color: rgba(255, 255, 255, 0.80);
        letter-spacing: 0.01em;
        line-height: 1.4;
        padding: 12px 18px;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 14px;
        backdrop-filter: blur(12px);
        opacity: 0;
        pointer-events: none;
        z-index: 11;
        transition: opacity 0.3s ease-in-out, transform 0.3s ease-in-out;
      }
      @media (max-width: 768px) {
        .pkg-whisper {
          position: fixed;
          top: max(88px, calc(24px + env(safe-area-inset-top) + 52px));
          left: 10vw;
          right: auto;
          width: 80vw;
          max-width: 80vw;
          transform: translateY(-6px);
          font-size: 0.9rem;
          padding: 12px 16px;
          backdrop-filter: none;
          box-sizing: border-box;
        }
      }

      /*
       * Phones / narrow tablets: fixed to viewport so width isn’t tied to containing block.
       * showBubble() uses translate(0,*) here — not translate(-50%,*) — see isNarrowDialogueViewport.
       */
      @media (max-width: 768px) {
        .pkg-bubble {
          position: fixed;
          top: max(88px, calc(24px + env(safe-area-inset-top) + 52px));
          left: 10vw;
          right: auto;
          width: 80vw;
          max-width: 80vw;
          box-sizing: border-box;
          gap: 8px;
        }
        .pkg-bubble-icon { width: 52px; height: 52px; font-size: 0.7rem; margin-top: 12px; }
        .pkg-bubble-npc { font-size: 0.6rem; }
        .pkg-bubble-text {
          font-size: 0.9rem;
          padding: 12px 16px;
          backdrop-filter: none;
        }
        .pkg-banner {
          top: max(24px, calc(14px + env(safe-area-inset-top)));
          left: 8px;
          right: calc(var(--hud-top-right-reserved, 120px) + 8px);
          font-size: 0.8rem;
          min-height: 36px;
          padding-top: 2px;
        }
        .pkg-banner-name {
          max-width: min(50vw, 18rem);
        }
      }
    `;
    document.head.appendChild(style);
  }

  dispose() {
    if (this.bubbleTimer) {
      clearTimeout(this.bubbleTimer);
      this.bubbleTimer = null;
    }
    if (this.whisperTimer) {
      clearTimeout(this.whisperTimer);
      this.whisperTimer = null;
    }
    if (this.lastDialogueOverlayForHud) {
      this.lastDialogueOverlayForHud = false;
      this.onDialogueBubbleOrWhisperChange?.(false);
    }
    this.progressRing.dispose();
    this.bubbleEl.remove();
    this.bannerEl.remove();
  }
}
