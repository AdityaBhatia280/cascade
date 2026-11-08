// The one floor canvas stays mounted under every view. A view says what the floor shows (a paint) and
// what a click on it means (handlers); the floor publishes where things are on screen each frame (bus)
// so floating cards can stay beside the equipment they describe.

import { useEffect, useSyncExternalStore } from "react";

/** How one entity is drawn. `serviced`: under work (ink). `lit`: in focus without a supply state. */
export type Look = "dark" | "backup" | "serviced" | "lit";

export interface FloorPaint {
  /** False: the resting picture, cabinets in customer tints. */
  active: boolean;
  looks: ReadonlyMap<string, Look>;
  /** Supply origin, for the ripple from the switched-off equipment outward. */
  origin: string | null;
  /** Entities whose supply links draw as cables. */
  cables: boolean;
  /** Pulsing rings around these, in the headline color. */
  pulse: readonly string[];
  pulseTone: "red" | "amber" | "gray";
  selected: string | null;
  /** Edit mode: these light up as places a feed can move to; everything else fades. */
  candidates: ReadonlySet<string> | null;
  highlight: ReadonlySet<string>;
  /** Calm arcs from a new source to what it would feed. */
  arcs: readonly { from: string; to: string }[];
  /** Status dots above equipment (handoff alarms). */
  dots: readonly { id: string; tone: "red" | "amber" }[];
}

export const RESTING: FloorPaint = {
  active: false,
  looks: new Map(),
  origin: null,
  cables: false,
  pulse: [],
  pulseTone: "gray",
  selected: null,
  candidates: null,
  highlight: new Set(),
  arcs: [],
  dots: [],
};

export interface FloorHandlers {
  /** A click on an entity (null: on empty floor). */
  onPick?: (id: string | null) => void;
}

/** Screen space the floor frames itself inside, past the floating panels of the current view. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type CameraMode = "2d" | "3d";

interface FloorState {
  paint: FloorPaint;
  handlers: FloorHandlers;
  insets: Insets;
  cam: CameraMode;
}

let state: FloorState = { paint: RESTING, handlers: {}, insets: { top: 0, right: 0, bottom: 0, left: 0 }, cam: "2d" };
const listeners = new Set<() => void>();
const set = (patch: Partial<FloorState>) => {
  state = { ...state, ...patch };
  for (const l of listeners) l();
};

export const floorStore = {
  get: () => state,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  },
  setCam: (cam: CameraMode) => set({ cam }),
};

export function useFloorState(): FloorState {
  return useSyncExternalStore(floorStore.subscribe, floorStore.get, floorStore.get);
}

/** A view's claim on the floor while it is mounted. */
export function useFloor(paint: FloorPaint, handlers: FloorHandlers, insets: Insets): void {
  useEffect(() => set({ paint }), [paint]);
  useEffect(() => set({ handlers }), [handlers]);
  const { top, right, bottom, left } = insets;
  useEffect(() => set({ insets: { top, right, bottom, left } }), [top, right, bottom, left]);
}

export interface ScreenPoint {
  x: number;
  y: number;
}

/** Written by the floor every frame; read by overlays in their own frame callbacks. */
export const floorBus = {
  /** Screen position of an entity's box centre (or top), null before the floor knows it. */
  project: (_id: string, _top?: boolean): ScreenPoint | null => null,
  /** Screen points of every lit box, for placing cards where they hide the least. */
  litPoints: (): ScreenPoint[] => [],
  /** True while the camera is flying. */
  moving: false,
  frame: new Set<() => void>(),
};
