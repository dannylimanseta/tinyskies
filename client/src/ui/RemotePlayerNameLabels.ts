import { Vector3, type Camera } from "three";
import type { RemotePlaneManager } from "../game/RemotePlane";

/** World-space offset along globe “up” so the pill sits just above the craft (smaller = lower on screen). */
const LABEL_OFFSET_PLANE = 0.16;
const LABEL_OFFSET_BOAT = 0.11;
const LABEL_OFFSET_CARPET = 0.14;

/** Hide names when farther than this (world units; globe radius is ~5). */
const REMOTE_NAME_MAX_DISTANCE_SQ = 4 * 4;

/**
 * Glassy name pills above other players’ vehicles, matching HUD panel styling.
 */
export class RemotePlayerNameLabels {
  private container: HTMLDivElement;
  private labels = new Map<string, HTMLDivElement>();
  private anchor = new Vector3();
  private remoteWorld = new Vector3();
  private up = new Vector3();
  private toPoint = new Vector3();
  private forward = new Vector3();

  constructor(parent: HTMLElement) {
    this.container = document.createElement("div");
    this.container.className = "hud-remote-names";
    this.container.setAttribute("aria-hidden", "true");
    parent.appendChild(this.container);
    this.injectStyles();
  }

  setVisible(visible: boolean) {
    this.container.style.display = visible ? "" : "none";
  }

  private injectStyles() {
    if (document.getElementById("remote-player-name-styles")) return;
    const style = document.createElement("style");
    style.id = "remote-player-name-styles";
    style.textContent = `
      .hud-remote-names {
        position: fixed;
        inset: 0;
        z-index: 5;
        pointer-events: none;
        font-family: 'Domine', Georgia, serif;
      }
      .hud-remote-name-pill {
        position: absolute;
        left: 0;
        top: 0;
        transform: translate(-50%, -100%);
        margin-top: 2px;
        padding: 5px 12px;
        max-width: min(200px, 50vw);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 0.65rem;
        font-weight: 600;
        letter-spacing: 0.02em;
        color: rgba(255, 255, 255, 0.88);
        background: rgba(255, 255, 255, 0.06);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 14px;
        box-shadow: 0 2px 12px rgba(0, 0, 0, 0.25);
        opacity: 0;
        visibility: hidden;
        transition: opacity 0.12s ease-out;
      }
      .hud-remote-name-pill.hud-remote-name-pill--visible {
        opacity: 1;
        visibility: visible;
      }
      @media (max-width: 480px) {
        .hud-remote-name-pill {
          font-size: 0.6rem;
          padding: 4px 10px;
          max-width: min(160px, 45vw);
          backdrop-filter: none;
          -webkit-backdrop-filter: none;
        }
      }
    `;
    document.head.appendChild(style);
  }

  update(
    manager: RemotePlaneManager,
    camera: Camera,
    domElement: HTMLElement,
    localPlayerWorldPos: Vector3,
  ) {
    const seen = new Set<string>();
    manager.forEachRemote((player) => {
      seen.add(player.id);
      let el = this.labels.get(player.id);
      if (!el) {
        el = document.createElement("div");
        el.className = "hud-remote-name-pill";
        this.container.appendChild(el);
        this.labels.set(player.id, el);
      }
      el.textContent = player.name;

      player.group.updateMatrixWorld(true);
      this.remoteWorld.setFromMatrixPosition(player.group.matrixWorld);
      if (
        this.remoteWorld.distanceToSquared(localPlayerWorldPos) > REMOTE_NAME_MAX_DISTANCE_SQ
      ) {
        el.classList.remove("hud-remote-name-pill--visible");
        return;
      }

      const offset =
        player.vehicleType === "boat"
          ? LABEL_OFFSET_BOAT
          : player.vehicleType === "carpet"
            ? LABEL_OFFSET_CARPET
            : LABEL_OFFSET_PLANE;

      this.anchor.copy(this.remoteWorld);
      this.up.copy(this.anchor).normalize();
      this.anchor.addScaledVector(this.up, offset);

      camera.getWorldDirection(this.forward);
      this.toPoint.subVectors(this.anchor, camera.position);
      const inFront = this.toPoint.dot(this.forward) > 0.02;
      if (!inFront) {
        el.classList.remove("hud-remote-name-pill--visible");
        return;
      }

      this.anchor.project(camera);
      const w = domElement.clientWidth;
      const h = domElement.clientHeight;
      const margin = 0.08;
      const onScreen =
        this.anchor.z > -1 &&
        this.anchor.z < 1 &&
        this.anchor.x >= -1 - margin &&
        this.anchor.x <= 1 + margin &&
        this.anchor.y >= -1 - margin &&
        this.anchor.y <= 1 + margin;

      if (!onScreen) {
        el.classList.remove("hud-remote-name-pill--visible");
        return;
      }

      if (player.visibilityOpacity < 0.04) {
        el.classList.remove("hud-remote-name-pill--visible");
        return;
      }

      const x = (this.anchor.x * 0.5 + 0.5) * w;
      const y = (-this.anchor.y * 0.5 + 0.5) * h;
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.opacity = String(player.visibilityOpacity);
      el.classList.add("hud-remote-name-pill--visible");
    });

    for (const id of [...this.labels.keys()]) {
      if (!seen.has(id)) {
        this.labels.get(id)?.remove();
        this.labels.delete(id);
      }
    }
  }

  dispose() {
    this.container.remove();
    this.labels.clear();
  }
}
