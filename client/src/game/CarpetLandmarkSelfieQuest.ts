import { Vector3 } from "three";

/** Same pacing as {@link PackageQuest} pickup/delivery fill & decay. */
const FILL_RATE = 1 / 1.5;
const DECAY_RATE = 0.3;
const ENTER_DOT = 0.995;

export const LANDMARK_SELFIE_XP = 40;
/** @deprecated use LANDMARK_SELFIE_XP */
export const HOTSPRING_SELFIE_XP = LANDMARK_SELFIE_XP;

export type LandmarkSelfieKind = "hotspring" | "shrine" | "mushroom" | "butterfly";

type Site = {
  kind: LandmarkSelfieKind;
  /** Index within that landmark type (for persistence). */
  kindIndex: number;
  normal: Vector3;
  completed: boolean;
};

/**
 * Carpet-only: align with landmark surface normal to fill a ring.
 * First visit per site per world seed grants XP + selfie (handled by game).
 */
export class CarpetLandmarkSelfieQuest {
  private progress = 0;
  private activeSiteIndex: number | null = null;
  private readonly sites: Site[];

  onProgressChange: ((progress: number) => void) | null = null;
  onPhotoTaken: ((payload: { kind: LandmarkSelfieKind; kindIndex: number }) => void) | null = null;

  constructor(
    hotspringNormals: readonly Vector3[],
    hotspringDone: boolean[],
    shrineNormals: readonly Vector3[],
    shrineDone: boolean[],
    mushroomNormals: readonly Vector3[],
    mushroomDone: boolean[],
    butterflyNormals: readonly Vector3[],
    butterflyDone: boolean[],
  ) {
    this.sites = [];
    for (let i = 0; i < hotspringNormals.length; i++) {
      this.sites.push({
        kind: "hotspring",
        kindIndex: i,
        normal: hotspringNormals[i]!.clone(),
        completed: !!hotspringDone[i],
      });
    }
    for (let i = 0; i < shrineNormals.length; i++) {
      this.sites.push({
        kind: "shrine",
        kindIndex: i,
        normal: shrineNormals[i]!.clone(),
        completed: !!shrineDone[i],
      });
    }
    for (let i = 0; i < mushroomNormals.length; i++) {
      this.sites.push({
        kind: "mushroom",
        kindIndex: i,
        normal: mushroomNormals[i]!.clone(),
        completed: !!mushroomDone[i],
      });
    }
    for (let i = 0; i < butterflyNormals.length; i++) {
      this.sites.push({
        kind: "butterfly",
        kindIndex: i,
        normal: butterflyNormals[i]!.clone(),
        completed: !!butterflyDone[i],
      });
    }
  }

  update(dt: number, playerNormal: Vector3, isCarpet: boolean) {
    if (!isCarpet) {
      if (this.progress > 0) {
        this.progress = 0;
        this.activeSiteIndex = null;
        this.onProgressChange?.(0);
      }
      return;
    }

    let bestIdx = -1;
    let bestDot = -1;
    for (let i = 0; i < this.sites.length; i++) {
      const s = this.sites[i]!;
      if (s.completed) continue;
      const d = playerNormal.dot(s.normal);
      if (d > ENTER_DOT && d > bestDot) {
        bestDot = d;
        bestIdx = i;
      }
    }

    if (bestIdx < 0) {
      this.progress = Math.max(0, this.progress - DECAY_RATE * dt);
      if (this.progress === 0) this.activeSiteIndex = null;
      this.onProgressChange?.(this.progress);
      return;
    }

    if (this.activeSiteIndex !== null && this.activeSiteIndex !== bestIdx) {
      this.progress = 0;
    }
    this.activeSiteIndex = bestIdx;

    const site = this.sites[bestIdx]!;
    const next = Math.min(1, this.progress + FILL_RATE * dt);
    if (this.progress < 1 && next >= 1) {
      site.completed = true;
      this.progress = 0;
      this.activeSiteIndex = null;
      this.onProgressChange?.(0);
      this.onPhotoTaken?.({ kind: site.kind, kindIndex: site.kindIndex });
      return;
    }

    this.progress = next;
    this.onProgressChange?.(this.progress);
  }
}
