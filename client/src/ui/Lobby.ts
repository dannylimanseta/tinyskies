import type { Vehicle } from "@globefly/shared";

interface LobbyCallbacks {
  onCreateWorld: (name: string, texture: string) => void;
  onJoinWorld: (slug: string, playerName: string, vehicle: Vehicle) => void;
}

interface WorldListItem {
  slug: string;
  name: string;
  texture: string;
  playerCount: number;
  createdBy: string;
}

const TEXTURES = [
  { id: "earth", label: "Earth" },
  { id: "night", label: "Night Earth" },
  { id: "topology", label: "Topology" },
];

export class Lobby {
  private container: HTMLElement;
  private el: HTMLDivElement;
  private callbacks: LobbyCallbacks;
  private selectedVehicle: Vehicle = "plane";

  constructor(container: HTMLElement, callbacks: LobbyCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.el = document.createElement("div");
    this.el.id = "lobby";
    this.buildUI();
  }

  private buildUI() {
    this.el.innerHTML = `
      <div class="lobby-backdrop">
        <div class="lobby-card">
          <h1 class="lobby-title">GlobeFly</h1>
          <p class="lobby-subtitle">Fly around the world with friends</p>

          <div class="lobby-tabs">
            <button class="tab-btn active" data-tab="join">Join World</button>
            <button class="tab-btn" data-tab="create">Create World</button>
          </div>

          <div class="tab-content" id="tab-join">
            <div class="form-group">
              <label>Your Name</label>
              <input type="text" id="player-name" placeholder="Pilot" maxlength="24" />
            </div>
            <fieldset class="form-group vehicle-fieldset">
              <legend class="vehicle-legend">How do you want to travel?</legend>
              <div class="vehicle-seg" role="tablist" aria-label="Vehicle">
                <button type="button" class="vehicle-btn active" data-vehicle="plane" aria-pressed="true">Plane</button>
                <button type="button" class="vehicle-btn" data-vehicle="boat" aria-pressed="false">Boat</button>
                <button type="button" class="vehicle-btn" data-vehicle="carpet" aria-pressed="false">Carpet</button>
              </div>
              <p class="vehicle-hint">Boats stay on the ocean. Carpet hugs the terrain.</p>
            </fieldset>
            <div class="form-group">
              <label>World Code</label>
              <input type="text" id="world-slug" placeholder="Paste world code or URL" />
            </div>
            <button class="btn btn-primary" id="btn-join">Join</button>

            <div class="divider"><span>or browse worlds</span></div>
            <div id="world-list" class="world-list">
              <p class="world-list-empty">Loading worlds...</p>
            </div>
          </div>

          <div class="tab-content hidden" id="tab-create">
            <div class="form-group">
              <label>World Name</label>
              <input type="text" id="world-name" placeholder="My World" maxlength="64" />
            </div>
            <div class="form-group">
              <label>Globe Texture</label>
              <select id="world-texture">
                ${TEXTURES.map((t) => `<option value="${t.id}">${t.label}</option>`).join("")}
              </select>
            </div>
            <fieldset class="form-group vehicle-fieldset">
              <legend class="vehicle-legend">How do you want to travel?</legend>
              <div class="vehicle-seg vehicle-seg-create" role="tablist" aria-label="Vehicle">
                <button type="button" class="vehicle-btn active" data-vehicle="plane" aria-pressed="true">Plane</button>
                <button type="button" class="vehicle-btn" data-vehicle="boat" aria-pressed="false">Boat</button>
                <button type="button" class="vehicle-btn" data-vehicle="carpet" aria-pressed="false">Carpet</button>
              </div>
              <p class="vehicle-hint">Boats stay on the ocean. Carpet hugs the terrain.</p>
            </fieldset>
            <button class="btn btn-primary" id="btn-create">Create World</button>
          </div>

          <div id="lobby-share" class="lobby-share hidden">
            <p>World created! Share this code:</p>
            <div class="share-code">
              <input type="text" id="share-slug" readonly />
              <button class="btn btn-small" id="btn-copy">Copy</button>
            </div>
            <button class="btn btn-primary" id="btn-join-created">Join Your World</button>
          </div>

          <div id="lobby-error" class="lobby-error hidden"></div>
        </div>
      </div>
    `;

    this.el.querySelector(".lobby-tabs")!.addEventListener("click", (e) => {
      const target = (e.target as HTMLElement).dataset.tab;
      if (!target) return;
      this.el.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      (e.target as HTMLElement).classList.add("active");
      this.el.querySelectorAll(".tab-content").forEach((c) => c.classList.add("hidden"));
      this.el.querySelector(`#tab-${target}`)?.classList.remove("hidden");
      this.el.querySelector("#lobby-share")?.classList.add("hidden");
    });

    this.bindVehicleSegments();

    this.el.querySelector("#btn-join")!.addEventListener("click", () => {
      const slug = (this.el.querySelector("#world-slug") as HTMLInputElement).value.trim();
      const name = (this.el.querySelector("#player-name") as HTMLInputElement).value.trim();
      const extracted = this.extractSlug(slug);
      if (!extracted) return;
      this.callbacks.onJoinWorld(extracted, name || "Pilot", this.selectedVehicle);
    });

    this.el.querySelector("#btn-create")!.addEventListener("click", () => {
      const name = (this.el.querySelector("#world-name") as HTMLInputElement).value.trim();
      const texture = (this.el.querySelector("#world-texture") as HTMLSelectElement).value;
      if (!name) return;
      this.callbacks.onCreateWorld(name, texture);
    });

    this.el.querySelector("#btn-copy")!.addEventListener("click", () => {
      const slug = (this.el.querySelector("#share-slug") as HTMLInputElement).value;
      navigator.clipboard.writeText(slug);
    });

    this.el.querySelector("#btn-join-created")!.addEventListener("click", () => {
      const slug = (this.el.querySelector("#share-slug") as HTMLInputElement).value;
      const name = (this.el.querySelector("#player-name") as HTMLInputElement).value.trim();
      this.callbacks.onJoinWorld(slug, name || "Pilot", this.selectedVehicle);
    });

    this.applyStyles();
  }

  private bindVehicleSegments() {
    const setVehicle = (v: Vehicle) => {
      this.selectedVehicle = v;
      this.el.querySelectorAll(".vehicle-btn").forEach((btn) => {
        const b = btn as HTMLButtonElement;
        const active = b.dataset.vehicle === v;
        b.classList.toggle("active", active);
        b.setAttribute("aria-pressed", active ? "true" : "false");
      });
    };

    this.el.querySelectorAll(".vehicle-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const v = (btn as HTMLButtonElement).dataset.vehicle as Vehicle;
        if (v === "plane" || v === "boat" || v === "carpet") setVehicle(v);
      });
    });
  }

  private extractSlug(input: string): string | null {
    if (!input) return null;
    const urlMatch = input.match(/\/w\/([a-zA-Z0-9_-]+)/);
    if (urlMatch) return urlMatch[1];
    return input.replace(/[^a-zA-Z0-9_-]/g, "");
  }

  show() {
    this.container.appendChild(this.el);
    this.checkUrlForSlug();
    this.loadWorldList();
  }

  hide() {
    this.el.remove();
  }

  showShareUrl(slug: string) {
    const shareEl = this.el.querySelector("#lobby-share")!;
    shareEl.classList.remove("hidden");
    (this.el.querySelector("#share-slug") as HTMLInputElement).value = slug;
    this.el.querySelector("#tab-create")?.classList.add("hidden");
  }

  showError(msg: string) {
    const errEl = this.el.querySelector("#lobby-error")!;
    errEl.textContent = msg;
    errEl.classList.remove("hidden");
    setTimeout(() => errEl.classList.add("hidden"), 5000);
  }

  private checkUrlForSlug() {
    const match = window.location.pathname.match(/\/w\/([a-zA-Z0-9_-]+)/);
    if (match) {
      (this.el.querySelector("#world-slug") as HTMLInputElement).value = match[1];
    }
  }

  private async loadWorldList() {
    const serverUrl = (import.meta as any).env?.VITE_SERVER_URL ?? "http://localhost:3001";
    const listEl = this.el.querySelector("#world-list")!;

    try {
      const res = await fetch(`${serverUrl}/api/worlds`);
      const worlds: WorldListItem[] = await res.json();

      if (worlds.length === 0) {
        listEl.innerHTML = '<p class="world-list-empty">No worlds yet. Create one!</p>';
        return;
      }

      listEl.innerHTML = worlds
        .map(
          (w) => `
        <div class="world-item" data-slug="${w.slug}">
          <div class="world-item-info">
            <span class="world-item-name">${w.name}</span>
            <span class="world-item-meta">${w.texture} &middot; by ${w.createdBy}</span>
          </div>
          <div class="world-item-players">${w.playerCount > 0 ? `${w.playerCount} playing` : "empty"}</div>
        </div>`,
        )
        .join("");

      listEl.querySelectorAll(".world-item").forEach((item) => {
        item.addEventListener("click", () => {
          const slug = (item as HTMLElement).dataset.slug!;
          (this.el.querySelector("#world-slug") as HTMLInputElement).value = slug;
        });
      });
    } catch {
      listEl.innerHTML = '<p class="world-list-empty">Could not load worlds</p>';
    }
  }

  private applyStyles() {
    if (document.getElementById("lobby-styles")) return;
    const style = document.createElement("style");
    style.id = "lobby-styles";
    style.textContent = `
      .lobby-backdrop {
        position: fixed; inset: 0; z-index: 1000;
        display: flex; align-items: center; justify-content: center;
        background: radial-gradient(ellipse at center, #0a0a2e 0%, #000010 100%);
        font-family: 'Inter', system-ui, sans-serif;
      }
      .lobby-card {
        background: rgba(15, 15, 40, 0.95);
        border: 1px solid rgba(100, 140, 255, 0.2);
        border-radius: 16px;
        padding: 40px;
        width: 420px;
        max-height: 90vh;
        overflow-y: auto;
        backdrop-filter: blur(20px);
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5), 0 0 40px rgba(60, 100, 255, 0.1);
      }
      .lobby-title {
        font-size: 2.2rem;
        font-weight: 700;
        background: linear-gradient(135deg, #4488ff 0%, #44ddff 100%);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        text-align: center;
        margin-bottom: 4px;
      }
      .lobby-subtitle {
        text-align: center;
        color: rgba(180, 200, 255, 0.6);
        font-size: 0.9rem;
        margin-bottom: 28px;
      }
      .lobby-tabs {
        display: flex; gap: 8px; margin-bottom: 24px;
      }
      .tab-btn {
        flex: 1; padding: 10px; border: 1px solid rgba(100, 140, 255, 0.15);
        background: transparent; color: rgba(180, 200, 255, 0.6);
        border-radius: 8px; cursor: pointer; font-size: 0.9rem;
        transition: all 0.2s;
      }
      .tab-btn.active {
        background: rgba(60, 100, 255, 0.15);
        color: #88bbff; border-color: rgba(100, 140, 255, 0.3);
      }
      .tab-btn:hover { border-color: rgba(100, 140, 255, 0.3); }
      .hidden { display: none !important; }
      .form-group { margin-bottom: 16px; }
      .form-group label {
        display: block; font-size: 0.8rem; color: rgba(180, 200, 255, 0.5);
        margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.05em;
      }
      .form-group input, .form-group select {
        width: 100%; padding: 10px 14px; border: 1px solid rgba(100, 140, 255, 0.15);
        background: rgba(0, 0, 20, 0.5); color: #dde;
        border-radius: 8px; font-size: 0.95rem; outline: none;
        transition: border-color 0.2s;
      }
      .form-group input:focus, .form-group select:focus {
        border-color: rgba(100, 140, 255, 0.4);
      }
      .form-group input::placeholder { color: rgba(140, 160, 200, 0.3); }
      .btn {
        padding: 12px 20px; border: none; border-radius: 8px;
        font-size: 0.95rem; cursor: pointer; transition: all 0.2s;
      }
      .btn-primary {
        width: 100%;
        background: linear-gradient(135deg, #3366cc 0%, #2255bb 100%);
        color: white; font-weight: 600;
      }
      .btn-primary:hover { background: linear-gradient(135deg, #4477dd 0%, #3366cc 100%); }
      .btn-small {
        padding: 8px 14px; font-size: 0.8rem;
        background: rgba(60, 100, 255, 0.2); color: #88bbff;
      }
      .divider {
        text-align: center; margin: 24px 0 16px;
        border-top: 1px solid rgba(100, 140, 255, 0.1);
        position: relative;
      }
      .divider span {
        background: rgba(15, 15, 40, 0.95);
        padding: 0 12px; position: relative; top: -10px;
        color: rgba(140, 160, 200, 0.4); font-size: 0.8rem;
      }
      .world-list {
        max-height: 200px; overflow-y: auto;
      }
      .world-list-empty {
        text-align: center; color: rgba(140, 160, 200, 0.3);
        font-size: 0.85rem; padding: 16px 0;
      }
      .world-item {
        display: flex; justify-content: space-between; align-items: center;
        padding: 10px 12px; border: 1px solid rgba(100, 140, 255, 0.08);
        border-radius: 8px; margin-bottom: 6px; cursor: pointer;
        transition: all 0.2s;
      }
      .world-item:hover {
        background: rgba(60, 100, 255, 0.08);
        border-color: rgba(100, 140, 255, 0.2);
      }
      .world-item-name {
        color: #bbe; font-weight: 500; font-size: 0.9rem;
        display: block;
      }
      .world-item-meta {
        color: rgba(140, 160, 200, 0.4); font-size: 0.75rem;
      }
      .world-item-players {
        color: rgba(100, 200, 150, 0.7); font-size: 0.8rem; white-space: nowrap;
      }
      .lobby-share {
        margin-top: 20px; text-align: center;
      }
      .lobby-share p {
        color: rgba(100, 200, 150, 0.8); margin-bottom: 12px; font-size: 0.9rem;
      }
      .share-code {
        display: flex; gap: 8px; margin-bottom: 16px;
      }
      .share-code input {
        flex: 1; padding: 10px 14px; border: 1px solid rgba(100, 200, 150, 0.2);
        background: rgba(0, 0, 20, 0.5); color: #aed; border-radius: 8px;
        font-family: monospace; font-size: 0.95rem;
      }
      .lobby-error {
        margin-top: 12px; padding: 10px 14px; border-radius: 8px;
        background: rgba(255, 60, 60, 0.1); border: 1px solid rgba(255, 60, 60, 0.2);
        color: #f88; font-size: 0.85rem; text-align: center;
      }
      .vehicle-fieldset {
        border: none; margin: 0; padding: 0;
      }
      .vehicle-legend {
        display: block; font-size: 0.8rem; color: rgba(180, 200, 255, 0.5);
        margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.05em;
      }
      .vehicle-seg {
        display: flex; gap: 0; width: 100%;
        border-radius: 8px; overflow: hidden;
        border: 1px solid rgba(100, 140, 255, 0.2);
      }
      .vehicle-btn {
        flex: 1; padding: 10px 12px; border: none; cursor: pointer;
        font-size: 0.9rem; font-weight: 500;
        background: rgba(0, 0, 30, 0.4);
        color: rgba(160, 180, 220, 0.65);
        transition: background 0.2s, color 0.2s;
      }
      .vehicle-btn + .vehicle-btn { border-left: 1px solid rgba(100, 140, 255, 0.15); }
      .vehicle-btn:hover { color: rgba(200, 220, 255, 0.9); }
      .vehicle-btn.active {
        background: rgba(60, 100, 255, 0.22);
        color: #c8ddff;
      }
      .vehicle-hint {
        margin: 8px 0 0; font-size: 0.78rem;
        color: rgba(120, 160, 200, 0.45);
      }
    `;
    document.head.appendChild(style);
  }
}
