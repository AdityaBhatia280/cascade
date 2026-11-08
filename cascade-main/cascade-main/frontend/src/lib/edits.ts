// Editing what feeds an entity, in the moves the server's patch language has: re-home a cord onto a
// spare circuit, or re-feed a panel from a spare breaker. Only moves the records can carry are offered,
// so every saved edit is one the server can verify.

import type { PatchOpDto } from "@cascade/core/contract";
import { cordsOf, kindOf, labelOf, ownerOf, type Site } from "./site";

/** One feed of the selected entity the editor can move. */
export interface Feed {
  /** The cord id, or the panel's own id for its input feeder. */
  key: string;
  /** "A" / "B" for a cord. */
  side: string | null;
  /** The circuit or breaker it hangs on today. */
  via: string;
  /** The drawn panel or source that owns `via`. */
  owner: string;
  /** Drawn entities with a spare the feed could move to, sorted. Empty: the feed is shown, not editable. */
  candidates: string[];
}

/** The side a cord is labelled with, from its id ("cord:E01/B" is "B"); the link's side is the traced one. */
export const cordSide = (cord: string) => cord.split("/")[1] ?? null;

const spare = (site: Site, id: string) => (site.kids.get(id) ?? []).length === 0;

function spares(site: Site, owner: string, kind: "circuit" | "breaker"): string[] {
  const num = (id: string) => Number(/(\d+)$/.exec(id)?.[1] ?? 0);
  return (site.kids.get(owner) ?? []).filter((k) => kindOf(k) === kind && spare(site, k)).sort((a, b) => num(a) - num(b));
}

/** Panels (or sources of `ownerKind`) that have a spare `kind`, other than `except`. */
function ownersWithSpare(site: Site, kind: "circuit" | "breaker", ownerKinds: readonly string[], except: string): string[] {
  return site.scene.nodes
    .filter((n) => ownerKinds.includes(n.kind) && n.id !== except && spares(site, n.id, kind).length > 0)
    .map((n) => n.id)
    .sort();
}

/** The feeds of an entity: a cabinet's cords, or a PDU's or RPP's input feeder. */
export function feedsOf(site: Site, id: string): Feed[] {
  const kind = kindOf(id);
  if (kind === "cabinet") {
    return cordsOf(site, id)
      .map((l) => {
        const owner = ownerOf(site, l.from);
        return { key: l.id, side: cordSide(l.id), via: l.from, owner, candidates: ownersWithSpare(site, "circuit", ["rpp", "pdu"], owner) };
      })
      .sort((a, b) => (a.side ?? "").localeCompare(b.side ?? ""));
  }
  if (kind === "rpp" || kind === "pdu") {
    const via = (site.pars.get(id) ?? []).find((p) => kindOf(p) === "breaker");
    if (!via) return [];
    const owner = ownerOf(site, via);
    return [{ key: id, side: null, via, owner, candidates: ownersWithSpare(site, "breaker", [kindOf(owner)], owner) }];
  }
  return [];
}

/**
 * The move that puts `feed` on `choice`, or null when `choice` is where it already is or has no spare
 * left. `taken`: spares other drafted or pending moves already use.
 */
export function moveFor(site: Site, feed: Feed, choice: string, taken: ReadonlySet<string> = new Set()): PatchOpDto | null {
  if (choice === feed.owner) return null;
  if (feed.key.startsWith("cord:")) {
    const to = spares(site, choice, "circuit").find((c) => !taken.has(c));
    return to ? { op: "rehome-cord", cord: feed.key, from: feed.via, to } : null;
  }
  const to = spares(site, choice, "breaker").find((b) => !taken.has(b));
  return to ? { op: "refeed", device: feed.key, from: feed.via, to } : null;
}

/** A move as the picture shows it: what changes, struck old feed, new feed, and the arc on the floor. */
export interface Change {
  subject: string;
  side: string | null;
  from: string | null;
  to: string;
  /** Drawn entities: the new source and what it now feeds. */
  arc: { from: string; to: string };
}

const tag = (id: string) => id.slice(id.indexOf(":") + 1);

export function changeOf(site: Site, op: PatchOpDto): Change {
  switch (op.op) {
    case "rehome-cord": {
      const cabinet = site.power.find((l) => l.id === op.cord)?.to ?? `cabinet:${tag(op.cord).split("/")[0]}`;
      return { subject: labelOf(site, cabinet), side: tag(op.cord).split("/")[1] ?? null, from: tag(op.from), to: tag(op.to), arc: { from: ownerOf(site, op.to), to: cabinet } };
    }
    case "add-cord":
      return { subject: labelOf(site, op.cabinet), side: op.side, from: null, to: tag(op.circuit), arc: { from: ownerOf(site, op.circuit), to: op.cabinet } };
    case "refeed":
      return {
        subject: labelOf(site, op.device),
        side: null,
        from: labelOf(site, ownerOf(site, op.from)),
        to: labelOf(site, ownerOf(site, op.to)),
        arc: { from: ownerOf(site, op.to), to: op.device },
      };
  }
}
