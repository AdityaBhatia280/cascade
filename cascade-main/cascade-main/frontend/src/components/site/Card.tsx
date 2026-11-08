// The equipment card: name, rating, load, a breaker handle that switches it off, and Edit / Chain.
// It floats beside its box on the floor, on whichever side hides the fewest lit boxes.

import { useEffect, useRef } from "react";
import type { PatchOpDto } from "@cascade/core/contract";
import { floorBus, type Insets, type Look } from "@/lib/floor";
import type { Impact } from "@/lib/impact";
import type { Feed } from "@/lib/edits";
import { changeOf, cordSide } from "@/lib/edits";
import { downCabinets, labelOf, visibleStep, type Site } from "@/lib/site";
import { factNumber, factOf, useCabinetLoads, useEntity } from "@/lib/queries";
import { LeftArrow } from "../Change";
import { Chain } from "./Chain";

export interface EditState {
  feeds: Feed[];
  /** Feed key → the panel or source it moves to. */
  draft: ReadonlyMap<string, string>;
  pick: string | null;
  saving: boolean;
  refused: string | null;
}

interface Props {
  site: Site;
  id: string;
  looks: ReadonlyMap<string, Look>;
  impact: Impact | null;
  off: boolean;
  canFlip: boolean;
  onFlip: () => void;
  chain: boolean;
  onChain: () => void;
  edit: EditState | null;
  editable: boolean;
  onEdit: () => void;
  onPick: (key: string | null) => void;
  onChoose: (key: string, owner: string) => void;
  onSave: () => void;
  onCancel: () => void;
  pending: readonly PatchOpDto[];
  onSelect: (id: string) => void;
  insets: Insets;
}

const COOLING = new Set(["crah", "chiller", "pump", "loop", "header"]);
const CHAIN_W = 836;
const CARD_W = 256;

function Load({ site, id, facts }: { site: Site; id: string; facts: { field: string; display: string | null }[] | undefined }) {
  const kind = site.node.get(id)?.kind ?? "";
  const own = factNumber(factOf(facts, kind === "cabinet" ? "measuredKw" : "capacityKw"));
  const below = kind === "cabinet" || COOLING.has(kind) ? [] : [...downCabinets(site, id)];
  const { kw } = useCabinetLoads(below);
  const value = Number.isFinite(own) ? own : kw;
  return <div className="kw">{value !== null && Number.isFinite(value) && <>{value.toLocaleString("en-US")}<small>kW</small></>}</div>;
}

export function Card(p: Props) {
  const { site, id } = p;
  const ref = useRef<HTMLDivElement>(null);
  const entity = useEntity(id);
  const n = site.node.get(id);
  const wide = p.chain && !p.edit;

  // Placement: candidate spots around the box, scored by lit boxes covered and distance from the ideal.
  useEffect(() => {
    let fresh = true;
    const place = () => {
      const card = ref.current;
      const at = floorBus.project(id);
      if (!card || !at) return;
      const W = card.parentElement?.clientWidth ?? window.innerWidth;
      const H = card.parentElement?.clientHeight ?? window.innerHeight;
      const ins = p.insets;
      const cw = wide ? CHAIN_W : CARD_W;
      const ch = card.offsetHeight || 170;
      const gap = 22;
      const spots: [number, number][] = [
        [at.x - cw / 2, at.y + gap + 10], [at.x - cw / 2, at.y - ch - gap], [at.x + gap + 16, at.y - ch / 2], [at.x - cw - gap - 16, at.y - ch / 2],
        [at.x + gap, at.y + gap], [at.x - cw - gap, at.y + gap], [at.x + gap, at.y - ch - gap], [at.x - cw - gap, at.y - ch - gap],
        [at.x - cw / 2, H - ins.bottom - ch - 8], [at.x - cw * 0.15, H - ins.bottom - ch - 8], [at.x - cw * 0.85, H - ins.bottom - ch - 8], [at.x - cw / 2, ins.top + 8],
      ];
      const lit = floorBus.litPoints();
      const minX = ins.left + 8;
      const maxX = W - ins.right - cw - 8;
      const minY = ins.top + 8;
      const maxY = H - ins.bottom - ch - 8;
      const score = (x: number, y: number) => {
        let s = 0;
        if (at.x > x - 6 && at.x < x + cw + 6 && at.y > y - 6 && at.y < y + ch + 6) s += 5000;
        for (const q of lit) if (q.x > x && q.x < x + cw && q.y > y && q.y < y + ch) s += 60;
        return s;
      };
      let best: [number, number] = [minX, minY];
      let bs = Infinity;
      for (const [x0, y0] of spots) {
        const x = Math.max(minX, Math.min(maxX, x0));
        const y = Math.max(minY, Math.min(maxY, y0));
        const s = Math.abs(x - x0) + Math.abs(y - y0) + score(x, y);
        if (s < bs) {
          bs = s;
          best = [x, y];
        }
      }
      const prev = card.dataset["pos"]?.split(",").map(Number);
      // Keep a placement unless it is clearly worse, so the card does not jitter while the camera moves.
      if (!fresh && prev && prev.length === 2 && !floorBus.moving) {
        const [ox, oy] = prev as [number, number];
        if (ox >= minX - 1 && oy >= minY - 1 && ox <= maxX + 1 && oy <= maxY + 1 && score(ox, oy) <= bs + 120 && Math.hypot(ox - best[0], oy - best[1]) < 400) return;
      }
      const key = best.map(Math.round).join(",");
      if (card.dataset["pos"] !== key) {
        card.dataset["pos"] = key;
        card.style.left = `${best[0]}px`;
        card.style.top = `${best[1]}px`;
      }
      if (fresh) {
        fresh = false;
        requestAnimationFrame(() => card.classList.add("show"));
      }
    };
    floorBus.frame.add(place);
    return () => {
      floorBus.frame.delete(place);
    };
  }, [id, wide, p.insets]);

  if (!n) return null;
  const facts = entity.data?.facts;
  const owner = n.customer ? site.customers.get(n.customer) : undefined;
  const pendingFor = (key: string) => p.pending.find((op) => (op.op === "rehome-cord" ? op.cord === key : op.op === "refeed" ? op.device === key : false));
  const draftLabel = (f: Feed) => {
    const to = p.edit?.draft.get(f.key);
    if (!to) return f.key.startsWith("cord:") ? f.via.slice(f.via.indexOf(":") + 1) : labelOf(site, f.owner);
    return labelOf(site, to);
  };

  const feedRows = () => {
    if (p.edit) {
      return p.edit.feeds.map((f) => (
        <div key={f.key}>
          <div className="feed">
            {f.side && <span className="side">{f.side}</span>}
            <LeftArrow />
            {f.candidates.length ? (
              <button
                className={`pick${p.edit!.pick === f.key ? " active" : ""}${p.edit!.draft.has(f.key) ? " changed" : ""}${p.edit!.refused && p.edit!.draft.has(f.key) ? " bad" : ""}`}
                onClick={() => p.onPick(p.edit!.pick === f.key ? null : f.key)}
              >
                {draftLabel(f)}
                <span className="caret" />
              </button>
            ) : (
              <span>{draftLabel(f)}</span>
            )}
          </div>
          {p.edit!.pick === f.key && (
            <div className="cands">
              {[f.owner, ...f.candidates].sort().map((c) => (
                <button key={c} className={(p.edit!.draft.get(f.key) ?? f.owner) === c ? "cur" : ""} onClick={() => p.onChoose(f.key, c)}>
                  {labelOf(site, c)}
                </button>
              ))}
            </div>
          )}
        </div>
      ));
    }
    if (n.kind === "cabinet") {
      return site.power
        .filter((l) => l.to === id && l.id.startsWith("cord:"))
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((l) => {
          const pend = pendingFor(l.id);
          const c = pend ? changeOf(site, pend) : null;
          return (
            <div className="feed" key={l.id}>
              {cordSide(l.id) && <span className="side">{cordSide(l.id)}</span>}
              <LeftArrow />
              {c ? (
                <>
                  <s>{c.from}</s>
                  <span className="pend">{c.to}</span>
                </>
              ) : (
                <span>{l.from.slice(l.from.indexOf(":") + 1)}</span>
              )}
            </div>
          );
        });
    }
    const up = visibleStep(site, [id], -1);
    if (!up.length) return null;
    const pend = pendingFor(id);
    const c = pend ? changeOf(site, pend) : null;
    return (
      <div className="feed">
        <LeftArrow />
        {c ? (
          <>
            <s>{c.from}</s>
            <span className="pend">{c.to}</span>
          </>
        ) : (
          <span>{up.map((u) => labelOf(site, u)).join(" · ")}</span>
        )}
      </div>
    );
  };

  return (
    <div ref={ref} className={`card${wide ? " wide" : ""}`} onPointerDown={(e) => e.stopPropagation()}>
      <div className="body">
        <div className="top">
          <div>
            <div className="hd">
              <b>
                {n.label}
                {n.side && <span className="side">{n.side}</span>}
              </b>
              {owner ? (
                <span className="cust">
                  <i style={{ background: owner.tint[1] }} />
                  {owner.name}
                </span>
              ) : (
                <span className="rt">{factOf(facts, "rating") ?? " "}</span>
              )}
              <Load site={site} id={id} facts={facts} />
            </div>
            <div className="feeds">{feedRows()}</div>
            {p.edit ? (
              <div className="btns">
                <button className={`btn pri${p.edit.refused ? " refused" : ""}`} title={p.edit.refused ?? undefined} disabled={p.edit.saving || p.edit.draft.size === 0} onClick={p.onSave}>
                  Save
                </button>
                <button className="btn ghost" onClick={p.onCancel}>
                  Cancel
                </button>
              </div>
            ) : (
              <div className="btns">
                {p.editable && (
                  <button className="btn" onClick={p.onEdit}>
                    Edit
                  </button>
                )}
                <button className={`btn${p.chain ? " on" : ""}`} onClick={p.onChain}>
                  <svg width="16" height="10" viewBox="0 0 16 10" aria-hidden>
                    <circle cx="2.5" cy="5" r="2" fill="currentColor" />
                    <circle cx="13.5" cy="2" r="1.8" fill="currentColor" />
                    <circle cx="13.5" cy="8" r="1.8" fill="currentColor" />
                    <path d="M4 5C8 5 8 2 12 2M4 5c4 0 4 3 8 3" stroke="currentColor" strokeWidth="1.2" fill="none" />
                  </svg>
                  Chain
                </button>
              </div>
            )}
          </div>
          {p.canFlip && (
            <button className={`brk${p.off ? " off" : ""}`} aria-pressed={p.off} aria-label={p.off ? "Switch on" : "Switch off"} onClick={p.onFlip}>
              <em>ON</em>
              <em>OFF</em>
              <i />
            </button>
          )}
        </div>
        <div className="chainwrap">{wide && <Chain site={site} center={id} looks={p.looks} impact={p.impact} pending={p.pending} onSelect={p.onSelect} />}</div>
      </div>
    </div>
  );
}
