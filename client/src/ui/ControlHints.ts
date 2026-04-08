import type { Vehicle } from "@globefly/shared";

type Row = { keys: string[]; label: string };

function rowsForVehicle(vehicle: Vehicle): Row[] {
  const base: Row[] = [
    { keys: ["W", "↑"], label: "Throttle" },
    { keys: ["S", "↓"], label: "Slow" },
    { keys: ["A", "D", "←", "→"], label: "Turn" },
  ];
  if (vehicle === "boat") return base;
  base.push({ keys: ["Space"], label: "Climb" });
  if (vehicle === "plane") {
    base.push({ keys: ["E"], label: "Barrel roll" });
  }
  return base;
}

function injectStyles() {
  if (document.getElementById("control-hints-styles")) return;
  const style = document.createElement("style");
  style.id = "control-hints-styles";
  style.textContent = `
    .control-hints {
      position: absolute;
      bottom: 24px;
      right: 24px;
      z-index: 1;
      pointer-events: none;
      font-family: 'Inter', system-ui, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 0;
    }
    .control-hints-title {
      font-size: 0.62rem;
      font-weight: 700;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: rgba(255, 255, 255, 0.45);
      margin-bottom: 10px;
    }
    .control-hints-row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 9px;
      font-size: 0.78rem;
      font-weight: 500;
      color: rgba(255, 255, 255, 0.92);
    }
    .control-hints-title + .control-hints-row { margin-top: 0; }
    .control-hints-keys {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
      max-width: 120px;
    }
    .control-hints-keys kbd {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.65rem;
      font-weight: 600;
      padding: 3px 6px;
      min-width: 1.25rem;
      text-align: center;
      border: 1px solid rgba(255, 255, 255, 0.5);
      border-radius: 6px;
      color: #fff;
      background: transparent;
      line-height: 1.2;
    }
    .control-hints-label {
      flex: 0 1 auto;
      min-width: 0;
      letter-spacing: 0.02em;
    }
    @media (max-width: 520px) {
      .control-hints { display: none; }
    }
  `;
  document.head.appendChild(style);
}

const TITLES: Record<Vehicle, string> = {
  plane: "Biplane",
  boat: "Boat",
  carpet: "Carpet",
};

/**
 * Desktop-only keyboard hints for the current vehicle. Hidden on narrow viewports.
 */
export function mountControlHints(parent: HTMLElement, vehicle: Vehicle, desktop: boolean): void {
  if (!desktop) return;
  injectStyles();

  const wrap = document.createElement("div");
  wrap.className = "control-hints";
  wrap.setAttribute("aria-label", `Keyboard controls (${TITLES[vehicle]})`);

  const title = document.createElement("div");
  title.className = "control-hints-title";
  title.textContent = "Controls";
  wrap.appendChild(title);

  for (const row of rowsForVehicle(vehicle)) {
    const line = document.createElement("div");
    line.className = "control-hints-row";

    const keys = document.createElement("span");
    keys.className = "control-hints-keys";
    for (const k of row.keys) {
      const el = document.createElement("kbd");
      el.textContent = k;
      keys.appendChild(el);
    }

    const label = document.createElement("span");
    label.className = "control-hints-label";
    label.textContent = row.label;

    line.appendChild(keys);
    line.appendChild(label);
    wrap.appendChild(line);
  }

  parent.appendChild(wrap);
}
