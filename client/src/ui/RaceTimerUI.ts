/**
 * Top-center countdown for the time-trial race.
 * Styling aligned with HUD / package progress (dark glass, tabular time).
 */
const STYLE_ID = "race-timer-ui-styles";

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .race-timer-ui {
      position: absolute;
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
      padding: 8px 18px;
      border-radius: 12px;
      background: rgba(12, 18, 28, 0.72);
      border: 1px solid rgba(255, 255, 255, 0.14);
      box-shadow: 0 4px 18px rgba(0, 0, 0, 0.35);
      color: rgba(255, 255, 255, 0.95);
      font-family: 'Domine', Georgia, serif;
      font-size: 1.15rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      letter-spacing: 0.04em;
      pointer-events: none;
      z-index: 14;
      opacity: 0;
      transition: opacity 0.2s ease, color 0.25s ease;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .race-timer-ui--warn {
      color: #ff6b6b;
      border-color: rgba(255, 100, 100, 0.35);
    }
    .rt-secs-wrapper {
      position: relative;
      display: inline-block;
      perspective: 300px;
      margin: 0 1px;
    }
    .rt-secs-placeholder {
      visibility: hidden;
    }
    .rt-sec-card {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      backface-visibility: hidden;
      transform-origin: center;
    }
    .rt-sec-card.flip-out {
      animation: rtFlipOut 0.15s ease-in forwards;
    }
    .rt-sec-card.flip-in {
      animation: rtFlipIn 0.15s ease-out 0.15s both;
    }
    @keyframes rtFlipOut {
      0% { transform: rotateX(0); }
      100% { transform: rotateX(-90deg); }
    }
    @keyframes rtFlipIn {
      0% { transform: rotateX(90deg); }
      100% { transform: rotateX(0); }
    }
    @media (max-width: 768px) {
      .race-timer-ui { font-size: 1rem; padding: 6px 14px; }
    }
  `;
  document.head.appendChild(style);
}

function formatTimeParts(sec: number) {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  const cs = Math.floor((r % 1) * 100);
  const whole = Math.floor(r);
  return {
    mins: `${m.toString().padStart(2, "0")}:`,
    secs: whole.toString().padStart(2, "0"),
    ms: `.${cs.toString().padStart(2, "0")}`,
  };
}

export class RaceTimerUI {
  private readonly el: HTMLDivElement;
  private readonly minsEl: HTMLSpanElement;
  private readonly secsWrapper: HTMLSpanElement;
  private readonly secsPlaceholder: HTMLSpanElement;
  private readonly msEl: HTMLSpanElement;
  private currentSecs = "";

  constructor(parent: HTMLElement) {
    ensureStyles();
    this.el = document.createElement("div");
    this.el.className = "race-timer-ui";
    this.el.setAttribute("aria-live", "polite");

    this.minsEl = document.createElement("span");
    this.minsEl.className = "rt-mins";

    this.secsWrapper = document.createElement("span");
    this.secsWrapper.className = "rt-secs-wrapper";

    this.secsPlaceholder = document.createElement("span");
    this.secsPlaceholder.className = "rt-secs-placeholder";
    this.secsPlaceholder.textContent = "00";

    this.secsWrapper.appendChild(this.secsPlaceholder);

    this.msEl = document.createElement("span");
    this.msEl.className = "rt-ms";

    this.el.append(this.minsEl, this.secsWrapper, this.msEl);
    parent.appendChild(this.el);
  }

  show() {
    this.el.style.opacity = "1";
  }

  hide() {
    this.el.style.opacity = "0";
    this.el.classList.remove("race-timer-ui--warn");
    this.currentSecs = "";
    this.secsWrapper.innerHTML = '<span class="rt-secs-placeholder">00</span>';
  }

  setTime(seconds: number) {
    const parts = formatTimeParts(seconds);

    this.minsEl.textContent = parts.mins;
    this.msEl.textContent = parts.ms;

    if (parts.secs !== this.currentSecs) {
      const isFirst = this.currentSecs === "";
      
      if (!isFirst) {
        const oldCards = this.secsWrapper.querySelectorAll(".rt-sec-card:not(.flip-out)");
        oldCards.forEach((oldCard) => {
          oldCard.classList.remove("flip-in");
          oldCard.classList.add("flip-out");
          setTimeout(() => oldCard.remove(), 300);
        });
      }

      const newCard = document.createElement("span");
      newCard.className = "rt-sec-card";
      if (!isFirst) newCard.classList.add("flip-in");
      newCard.textContent = parts.secs;
      this.secsWrapper.appendChild(newCard);

      this.currentSecs = parts.secs;
    }

    if (seconds < 10) {
      this.el.classList.add("race-timer-ui--warn");
    } else {
      this.el.classList.remove("race-timer-ui--warn");
    }
  }

  dispose() {
    this.el.remove();
  }
}
