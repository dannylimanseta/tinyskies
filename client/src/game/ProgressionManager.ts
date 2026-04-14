import type { Vehicle } from "@globefly/shared";
import { UpgradeManager } from "./UpgradeManager";

const STORAGE_KEY = "globefly_vehicle_progress";
const NAME_KEY = "globefly_player_name";
const UNLOCK_ACK_KEY = "globefly_unlocks_ack";
/** Campsite bookmark; cleared with `clearAll` for a full local reset. */
const CAMPSITE_KEY = "globefly_campsite";

/** Carpet unlocks when any vehicle has reached at least this level. */
export const UNLOCK_CARPET_MIN_MAX_LEVEL = 2;
/** Boat unlocks when plane or carpet reaches this level (boat’s own level does not count). */
export const UNLOCK_BOAT_PLANE_OR_CARPET_LEVEL = 4;

const LEVEL_THRESHOLDS = [0, 100, 300, 600, 1000, 1500, 2200, 3000, 4000, 5200, 6600, 8200];

export interface SavedVehicleProgress {
  xp: number;
  level: number;
  appliedUpgradeIds: string[];
  /** 0xRRGGBB hull / body color chosen for this vehicle. */
  vehicleColor?: number;
}

type AllVehicleProgress = Partial<Record<Vehicle, SavedVehicleProgress>>;

export class ProgressionManager {
  private xp = 0;
  private level = 1;
  private readonly vehicle: Vehicle;
  readonly upgrades = new UpgradeManager();

  onXPChanged: ((xp: number, xpForNext: number, xpForCurrent: number, level: number) => void) | null = null;
  onLevelUp: ((level: number) => void) | null = null;

  constructor(vehicle: Vehicle) {
    this.vehicle = vehicle;
  }

  /** Load saved progression from localStorage and replay upgrades. */
  restore() {
    const saved = ProgressionManager.loadVehicle(this.vehicle);
    if (!saved) return;
    this.xp = saved.xp;
    this.level = saved.level;
    this.upgrades.restoreUpgrades(saved.appliedUpgradeIds);
  }

  /**
   * Single entry point for all XP gains.
   * Recomputes level, fires callbacks, and auto-saves.
   */
  addXP(amount: number) {
    if (amount <= 0) return;
    const prevLevel = this.level;
    this.xp += amount;
    this.level = this.computeLevel();

    this.onXPChanged?.(this.xp, this.getXPForNextLevel(), this.getXPForCurrentLevel(), this.level);

    if (this.level > prevLevel) {
      this.save();
      this.onLevelUp?.(this.level);
    }
  }

  /** Persist current state to localStorage. */
  save() {
    const all = ProgressionManager.loadAll();
    const prev = all[this.vehicle];
    all[this.vehicle] = {
      xp: this.xp,
      level: this.level,
      appliedUpgradeIds: [...this.upgrades.appliedIds],
      vehicleColor: prev?.vehicleColor,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch { /* storage full or unavailable — silently degrade */ }
  }

  /** Save the vehicle's hull color so it persists across playthroughs. */
  saveVehicleColor(color: number) {
    const all = ProgressionManager.loadAll();
    const prev = all[this.vehicle] ?? { xp: 0, level: 1, appliedUpgradeIds: [] };
    prev.vehicleColor = color;
    all[this.vehicle] = prev;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch {}
  }

  /** Return the saved hull color, or undefined if none stored. */
  getSavedVehicleColor(): number | undefined {
    return ProgressionManager.loadVehicle(this.vehicle)?.vehicleColor;
  }

  getXP() { return this.xp; }
  getLevel() { return this.level; }

  getXPForNextLevel(): number {
    const idx = this.level;
    if (idx < LEVEL_THRESHOLDS.length) return LEVEL_THRESHOLDS[idx]!;
    return LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1]! + (idx - LEVEL_THRESHOLDS.length + 1) * 2000;
  }

  getXPForCurrentLevel(): number {
    const idx = this.level - 1;
    if (idx >= 0 && idx < LEVEL_THRESHOLDS.length) return LEVEL_THRESHOLDS[idx]!;
    return 0;
  }

  private computeLevel(): number {
    for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
      if (this.xp >= LEVEL_THRESHOLDS[i]!) return i + 1;
    }
    return 1;
  }

  // ── Static helpers ──

  static loadAll(): AllVehicleProgress {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw) as AllVehicleProgress;
    } catch { /* corrupt data — start fresh */ }
    return {};
  }

  static loadVehicle(vehicle: Vehicle): SavedVehicleProgress | undefined {
    return ProgressionManager.loadAll()[vehicle];
  }

  /** Max `level` among saved vehicles; missing slots count as 0. */
  static maxLevelAcrossSlots(all: AllVehicleProgress = ProgressionManager.loadAll()): number {
    return Math.max(
      0,
      all.plane?.level ?? 0,
      all.boat?.level ?? 0,
      all.carpet?.level ?? 0,
    );
  }

  static isVehicleUnlocked(
    vehicle: Vehicle,
    all: AllVehicleProgress = ProgressionManager.loadAll(),
  ): boolean {
    if (vehicle === "plane") return true;
    if (vehicle === "carpet") {
      return ProgressionManager.maxLevelAcrossSlots(all) >= UNLOCK_CARPET_MIN_MAX_LEVEL;
    }
    if (vehicle === "boat") {
      const pl = all.plane?.level ?? 0;
      const ca = all.carpet?.level ?? 0;
      return pl >= UNLOCK_BOAT_PLANE_OR_CARPET_LEVEL || ca >= UNLOCK_BOAT_PLANE_OR_CARPET_LEVEL;
    }
    return false;
  }

  /** Saved level for that vehicle, or `null` if never played (no save). */
  static savedLevelOrNull(vehicle: Vehicle): number | null {
    const s = ProgressionManager.loadAll()[vehicle];
    return s != null ? s.level : null;
  }

  // ── One-time unlock celebration (lobby popup) ──

  static getPendingUnlockCelebrations(): ("carpet" | "boat")[] {
    const all = ProgressionManager.loadAll();
    const ack = ProgressionManager.loadUnlockAck();
    const out: ("carpet" | "boat")[] = [];
    if (ProgressionManager.isVehicleUnlocked("carpet", all) && !ack.carpet) out.push("carpet");
    if (ProgressionManager.isVehicleUnlocked("boat", all) && !ack.boat) out.push("boat");
    return out;
  }

  static acknowledgeUnlockCelebration(vehicle: "carpet" | "boat") {
    const ack = ProgressionManager.loadUnlockAck();
    ack[vehicle] = true;
    try { localStorage.setItem(UNLOCK_ACK_KEY, JSON.stringify(ack)); } catch {}
  }

  static loadUnlockAck(): { carpet?: boolean; boat?: boolean } {
    try {
      const raw = localStorage.getItem(UNLOCK_ACK_KEY);
      if (raw) return JSON.parse(raw) as { carpet?: boolean; boat?: boolean };
    } catch {}
    return {};
  }

  static clearAll() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(NAME_KEY);
      localStorage.removeItem(UNLOCK_ACK_KEY);
      localStorage.removeItem(CAMPSITE_KEY);
    } catch {}
  }

  // ── Player name persistence ──

  static loadPlayerName(): string | null {
    try {
      return localStorage.getItem(NAME_KEY);
    } catch { return null; }
  }

  static savePlayerName(name: string) {
    try { localStorage.setItem(NAME_KEY, name); } catch {}
  }
}
