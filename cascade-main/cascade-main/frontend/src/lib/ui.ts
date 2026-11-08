// Screen state that outlives a view: whether the companion is open and what it last pointed at.

import { useSyncExternalStore } from "react";

interface Ui {
  companionOpen: boolean;
  /** Entities the companion pointed at, pulsing calm on the floor until the next answer. */
  highlight: ReadonlySet<string>;
  /** The ring pulses once when the site's files have just been read. */
  greet: boolean;
}

const initialOpen = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("co") === "1";
let ui: Ui = { companionOpen: initialOpen, highlight: new Set(), greet: false };
const listeners = new Set<() => void>();

export const uiStore = {
  get: () => ui,
  set(patch: Partial<Ui>) {
    ui = { ...ui, ...patch };
    for (const l of listeners) l();
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  },
};

export const useUi = () => useSyncExternalStore(uiStore.subscribe, uiStore.get, uiStore.get);
