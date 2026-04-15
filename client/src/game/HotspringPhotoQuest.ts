import { Vector3 } from "three";

/** Same pacing as {@link PackageQuest} pickup/delivery fill & decay. */
const FILL_RATE = 1 / 1.5;
const DECAY_RATE = 0.3;
const ENTER_DOT = 0.995;

export const HOTSPRING_SELFIE_XP = 40;

/**
 * Carpet-only: stand near a hot spring (surface normal alignment) to fill a ring;
 * first visit per hotspring per world seed grants XP + selfie overlay (handled by game).
 */
export class HotspringPhotoQuest {
  private progress = 0;
  private activeChargeIndex: number | null = null;
  private completed: boolean[];

  onProgressChange: ((progress: number) => void) | null = null;
  onPhotoTaken: ((hotspringIndex: number) => void) | null = null;

  constructor(
    private readonly normals: readonly Vector3[],
    completedInitially: boolean[],
  ) {
    this.completed = [...completedInitially];
  }

  update(dt: number, playerNormal: Vector3, isCarpet: boolean) {
    if (!isCarpet) {
      if (this.progress > 0) {
        this.progress = 0;
        this.activeChargeIndex = null;
        this.onProgressChange?.(0);
      }
      return;
    }

    let bestIdx = -1;
    let bestDot = -1;
    for (let i = 0; i < this.normals.length; i++) {
      if (this.completed[i]) continue;
      const d = playerNormal.dot(this.normals[i]!);
      if (d > ENTER_DOT && d > bestDot) {
        bestDot = d;
        bestIdx = i;
      }
    }

    if (bestIdx < 0) {
      this.progress = Math.max(0, this.progress - DECAY_RATE * dt);
      if (this.progress === 0) this.activeChargeIndex = null;
      this.onProgressChange?.(this.progress);
      return;
    }

    if (this.activeChargeIndex !== null && this.activeChargeIndex !== bestIdx) {
      this.progress = 0;
    }
    this.activeChargeIndex = bestIdx;

    const next = Math.min(1, this.progress + FILL_RATE * dt);
    if (this.progress < 1 && next >= 1) {
      this.completed[bestIdx] = true;
      this.progress = 0;
      this.activeChargeIndex = null;
      this.onProgressChange?.(0);
      this.onPhotoTaken?.(bestIdx);
      return;
    }

    this.progress = next;
    this.onProgressChange?.(this.progress);
  }
}
