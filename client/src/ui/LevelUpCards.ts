import type { UpgradeDefinition } from "../game/UpgradeManager";

const CSS = `
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
  transition: opacity 0.35s ease-out;
  font-family: 'Inter', system-ui, sans-serif;
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
  transition: background 0.2s, border-color 0.2s, transform 0.2s;
  user-select: none;
}
.levelup-card:hover {
  background: rgba(255, 255, 255, 0.15);
  border-color: rgba(255, 255, 255, 0.20);
  transform: translateY(-4px);
}
.levelup-card:active {
  background: rgba(255, 255, 255, 0.2);
}
.levelup-card--picked {
  transform: scale(1.06) !important;
  border-color: rgba(255, 255, 255, 0.45);
  background: rgba(255, 255, 255, 0.22);
  pointer-events: none;
}
.levelup-card-icon {
  font-size: 2rem;
  margin-bottom: 10px;
  line-height: 1;
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
  hull_reinforced: "🛡️",
  bountiful_hearts: "❤️",
  heart_orchard: "🫀",
  // Carpet
  silk_wind: "🪁",
  thermal_surge: "🌋",
  tight_tassels: "🌀",
  wide_portal: "🌀",
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

    for (const card of cards) {
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
        // Mark all cards as non-interactive immediately
        grid.querySelectorAll<HTMLElement>(".levelup-card").forEach((c) => {
          c.style.pointerEvents = "none";
          c.style.opacity = c === el ? "" : "0.3";
        });
        el.classList.add("levelup-card--picked");

        setTimeout(() => {
          this.hide(() => onPick(card.id));
        }, 200);
      });

      grid.appendChild(el);
    }

    document.body.appendChild(overlay);

    // Trigger entrance animation
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        overlay.classList.add("levelup-overlay--visible");
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
