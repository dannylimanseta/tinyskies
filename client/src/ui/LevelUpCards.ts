import type { UpgradeDefinition } from "../game/UpgradeManager";

const CSS = `
@keyframes luCardDrop {
  0%   { opacity: 0; transform: translateY(-48px) scale(0.88) rotate(-3deg); }
  65%  { opacity: 1; transform: translateY(6px)   scale(1.03) rotate(0.5deg); }
  80%  { transform: translateY(-3px) scale(0.99) rotate(-0.2deg); }
  100% { opacity: 1; transform: translateY(0)    scale(1)    rotate(0deg); }
}
@keyframes luTitleSlide {
  from { opacity: 0; transform: translateY(-18px) scale(0.95); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes luIconBounce {
  0%   { transform: scale(1); }
  40%  { transform: scale(1.35) rotate(8deg); }
  65%  { transform: scale(0.92) rotate(-4deg); }
  80%  { transform: scale(1.12) rotate(2deg); }
  100% { transform: scale(1) rotate(0deg); }
}
@keyframes luPickedPulse {
  0%   { box-shadow: 0 0 0 0 rgba(255,255,255,0.6); }
  60%  { box-shadow: 0 0 0 18px rgba(255,255,255,0); }
  100% { box-shadow: 0 0 0 18px rgba(255,255,255,0); }
}
.levelup-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  pointer-events: auto;
  opacity: 0;
  transition: opacity 0.3s ease-out;
  font-family: 'Domine', Georgia, serif;
  color: rgba(255, 255, 255, 0.85);
}
.levelup-overlay--visible {
  opacity: 1;
}
.levelup-title {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.7);
  text-transform: uppercase;
  margin-bottom: 20px;
  user-select: none;
  opacity: 0;
}
.levelup-title--in {
  animation: luTitleSlide 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) 0.05s both;
}
.levelup-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  max-width: 660px;
  padding: 0 24px;
  width: 100%;
  box-sizing: border-box;
}
.levelup-card {
  background: rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  padding: 28px 20px;
  cursor: pointer;
  pointer-events: auto;
  text-align: center;
  transition: background 0.18s, border-color 0.18s, transform 0.18s, box-shadow 0.18s;
  user-select: none;
  opacity: 0;
}
.levelup-card--in {
  animation: luCardDrop 0.55s cubic-bezier(0.22, 1, 0.36, 1) both;
}
.levelup-card:hover {
  background: rgba(255, 255, 255, 0.15);
  border-color: rgba(255, 255, 255, 0.24);
  transform: translateY(-6px) scale(1.02);
  box-shadow: 0 12px 32px rgba(0,0,0,0.35);
}
.levelup-card:hover .levelup-card-icon {
  display: inline-block;
  animation: luIconBounce 0.5s cubic-bezier(0.22, 1, 0.36, 1) both;
}
.levelup-card:active {
  transform: translateY(-2px) scale(0.98);
}
.levelup-card--picked {
  pointer-events: none;
}
.levelup-card-icon {
  font-size: 2.2rem;
  margin-bottom: 10px;
  line-height: 1;
  display: inline-block;
}
.levelup-card-name {
  font-size: 1.05rem;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.85);
  letter-spacing: 0.02em;
  margin-bottom: 10px;
}
.levelup-card-desc {
  font-size: 0.8rem;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.45);
  line-height: 1.4;
}
@media (max-width: 768px) {
  .levelup-grid {
    grid-template-columns: 1fr;
    max-width: 320px;
  }
  .levelup-card {
    padding: 20px 16px;
  }
}
@media (max-width: 480px) {
  .levelup-card {
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}
`;

const UPGRADE_ICONS: Record<string, string> = {
  // Shared
  prospector: "✨",
  diamond_sky: "💎",
  // Plane
  tailwind: "💨",
  afterburner: "🔥",
  nitro_tank: "⚡",
  tight_turn: "🌀",
  sharpshooter: "🎯",
  double_tap: "💥",
  long_shot: "🔭",
  hull_reinforced: "🛡️",
  bountiful_hearts: "❤️",
  heart_orchard: "🫀",
  // Carpet
  silk_wind: "🪁",
  tight_tassels: "🌀",
  leaf_flourish: "🍃",
  // Boat
  keel_cut: "⛵",
  steady_rudder: "🧭",
  wide_cast: "◎",
  quick_reel: "🎣",
  twin_lines: "〰️",
  fish_bounty: "🐟",
  foam_surge: "🌊",
  wake_rider: "💨",
};

let styleInjected = false;
function injectStyles() {
  if (styleInjected) return;
  styleInjected = true;
  const tag = document.createElement("style");
  tag.textContent = CSS;
  document.head.appendChild(tag);
}

export class LevelUpCards {
  private overlay: HTMLElement | null = null;

  show(cards: UpgradeDefinition[], onPick: (id: string) => void) {
    injectStyles();
    this.dispose();

    const overlay = document.createElement("div");
    overlay.className = "levelup-overlay";
    this.overlay = overlay;

    const title = document.createElement("div");
    title.className = "levelup-title";
    title.textContent = "Choose an upgrade";
    overlay.appendChild(title);

    const grid = document.createElement("div");
    grid.className = "levelup-grid";
    overlay.appendChild(grid);

    for (let ci = 0; ci < cards.length; ci++) {
      const card = cards[ci]!;
      const el = document.createElement("div");
      el.className = "levelup-card";

      const icon = document.createElement("div");
      icon.className = "levelup-card-icon";
      icon.textContent = UPGRADE_ICONS[card.id] ?? "🎁";

      const name = document.createElement("div");
      name.className = "levelup-card-name";
      name.textContent = card.name;

      const desc = document.createElement("div");
      desc.className = "levelup-card-desc";
      desc.textContent = card.description;

      el.appendChild(icon);
      el.appendChild(name);
      el.appendChild(desc);

      el.addEventListener("click", () => {
        const allCards = Array.from(grid.querySelectorAll<HTMLElement>(".levelup-card"));
        const pickedIdx = allCards.indexOf(el);
        allCards.forEach((c) => { c.style.pointerEvents = "none"; });

        // Unchosen cards slide out to their nearest edge and fade.
        allCards.forEach((c, i) => {
          if (c === el) return;
          const dir = i < pickedIdx ? -1 : 1;
          c.style.transition = "opacity 0.28s ease, transform 0.28s cubic-bezier(0.4,0,1,1)";
          requestAnimationFrame(() => {
            c.style.opacity = "0";
            c.style.transform = `translateX(${dir * 90}px) scale(0.85)`;
          });
        });

        // Picked card: flash highlight, then grow + fade after unchosen have left.
        el.style.transition = "background 0.12s ease, border-color 0.12s ease, transform 0.12s ease";
        el.style.background = "rgba(255,255,255,0.28)";
        el.style.borderColor = "rgba(255,255,255,0.55)";
        el.style.transform = "scale(1.06)";

        // Icon bounce
        const iconEl = el.querySelector<HTMLElement>(".levelup-card-icon");
        if (iconEl) {
          iconEl.style.animation = "luIconBounce 0.5s cubic-bezier(0.22,1,0.36,1) both";
        }

        // After unchosen have cleared, grow and fade the picked card out.
        setTimeout(() => {
          el.style.transition = "opacity 0.38s ease, transform 0.38s ease";
          el.style.opacity = "0";
          el.style.transform = "scale(1.18)";
        }, 220);

        setTimeout(() => {
          this.hide(() => onPick(card.id));
        }, 560);
      });

      grid.appendChild(el);
    }

    document.body.appendChild(overlay);

    // Fade in overlay then stagger-drop each card.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        overlay.classList.add("levelup-overlay--visible");
        title.classList.add("levelup-title--in");

        const cardEls = grid.querySelectorAll<HTMLElement>(".levelup-card");
        cardEls.forEach((c, i) => {
          c.style.animationDelay = `${0.12 + i * 0.1}s`;
          c.classList.add("levelup-card--in");
        });
      });
    });
  }

  private hide(onDone: () => void) {
    const overlay = this.overlay;
    if (!overlay) {
      onDone();
      return;
    }
    overlay.classList.remove("levelup-overlay--visible");
    overlay.addEventListener(
      "transitionend",
      () => {
        overlay.remove();
        if (this.overlay === overlay) this.overlay = null;
        onDone();
      },
      { once: true },
    );
  }

  dispose() {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }
}
