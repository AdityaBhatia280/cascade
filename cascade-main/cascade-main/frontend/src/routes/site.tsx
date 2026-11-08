// Site: this week's jobs on top, the floor, the card of the selected equipment, and the floating panel
// with what goes dark, whose, what it costs, and the way to a fix. Everything the screen shows is in the
// URL: job or switched-off equipment, selection, camera, chain, edit.

import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import type { PatchOpDto, RiskGrade } from "@cascade/core/contract";
import { useFloor, floorStore, RESTING, type FloorPaint, type Look } from "@/lib/floor";
import { impactOf, type Impact } from "@/lib/impact";
import { feedsOf, moveFor, changeOf } from "@/lib/edits";
import { useFindFix, useJobs, useProposals, useScenario, useSite, useSubmitMoves } from "@/lib/queries";
import { labelOf, SELECTABLE } from "@/lib/site";
import { span } from "@/lib/format";
import { useUi } from "@/lib/ui";
import { JobsStrip } from "@/components/site/JobsStrip";
import { InfoPanel } from "@/components/site/InfoPanel";
import { PendingBar } from "@/components/site/PendingBar";
import { Card, type EditState } from "@/components/site/Card";

export interface SiteSearch {
  job?: string | undefined;
  off?: string | undefined;
  sel?: string | undefined;
  cam?: "3d" | undefined;
  chain?: 1 | undefined;
  edit?: 1 | undefined;
  pick?: string | undefined;
}

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const flag = (v: unknown) => (v === 1 || v === "1" || v === true ? (1 as const) : undefined);

export function readSiteSearch(raw: Record<string, unknown>): SiteSearch {
  const s: SiteSearch = {};
  if (str(raw["job"])) s.job = str(raw["job"]);
  if (str(raw["off"])) s.off = str(raw["off"]);
  if (str(raw["sel"])) s.sel = str(raw["sel"]);
  if (raw["cam"] === "3d") s.cam = "3d";
  if (flag(raw["chain"])) s.chain = 1;
  if (flag(raw["edit"]) && s.sel) s.edit = 1;
  if (s.edit && str(raw["pick"])) s.pick = str(raw["pick"]);
  return s;
}

export const Route = createFileRoute("/site")({
  validateSearch: readSiteSearch,
  component: SiteView,
});

const INFO_W = 300 + 28 + 16;

/**
 * The job's grade comes from the as-built model; the numbers come from the planned one. Once approved
 * changes mean nobody goes dark (or nobody is hit), the panel's mark follows the numbers.
 */
function outranks(grade: RiskGrade, now: Impact["grade"] | undefined): boolean {
  if (!now) return false;
  return (grade === "highest" && now !== "red") || (grade === "high" && now === "gray");
}
const COMPANION_W = 392;

function SiteView() {
  const s = Route.useSearch();
  const navigate = Route.useNavigate();
  const { site } = useSite();
  const { jobs } = useJobs();
  const { pending } = useProposals();
  const { companionOpen, highlight } = useUi();
  const go = useCallback((patch: Partial<SiteSearch>, replace = false) => void navigate({ search: (prev: SiteSearch) => ({ ...prev, ...patch }), replace }), [navigate]);

  const job = jobs.find((j) => j.wonum === s.job) ?? null;
  const asset = s.off ?? job?.asset ?? null;
  const events = useMemo(() => (s.off ? [`fails:${s.off}@0`] : job ? job.scenario : null), [s.off, job]);
  const scenario = useScenario(events);
  const [at, setAt] = useState<number | undefined>(undefined);
  useEffect(() => setAt(undefined), [events]);
  const impact = useMemo(() => (events && scenario.data ? impactOf(scenario.data, at) : null), [events, scenario.data, at]);

  // Edit: which feed is being moved where. The pick is in the URL; the draft lives with the card.
  const [draft, setDraft] = useState<ReadonlyMap<string, string>>(new Map());
  const [refused, setRefused] = useState<string | null>(null);
  useEffect(() => {
    setDraft(new Map());
    setRefused(null);
  }, [s.sel, s.edit]);
  const submit = useSubmitMoves();
  const feeds = useMemo(() => (site && s.sel ? feedsOf(site, s.sel) : []), [site, s.sel]);
  const editable = feeds.some((f) => f.candidates.length > 0);
  const pendingOps = useMemo(() => pending.flatMap((p) => p.plan.ops), [pending]);
  // Each drafted move takes its own spare, never one a pending change already holds.
  const draftOps = useMemo(() => {
    if (!site) return [];
    const taken = new Set(pendingOps.flatMap((op) => (op.op === "rehome-cord" || op.op === "refeed" ? [op.to] : [op.circuit])));
    const out: PatchOpDto[] = [];
    for (const f of feeds) {
      const to = draft.get(f.key);
      const op = to ? moveFor(site, f, to, taken) : null;
      if (!op) continue;
      taken.add(op.op === "add-cord" ? op.circuit : op.to);
      out.push(op);
    }
    return out;
  }, [site, feeds, draft, pendingOps]);
  const pickFeed = s.edit && s.pick ? feeds.find((f) => f.key === s.pick) : undefined;

  const fix = useFindFix();
  useEffect(() => fix.reset(), [events, site?.revision]);

  useEffect(() => floorStore.setCam(s.cam === "3d" ? "3d" : "2d"), [s.cam]);
  useEffect(
    () =>
      floorStore.subscribe(() => {
        const cam = floorStore.get().cam;
        if ((cam === "3d") !== (s.cam === "3d")) go({ cam: cam === "3d" ? "3d" : undefined }, true);
      }),
    [s.cam, go],
  );

  const looks = useMemo(() => {
    const m = new Map<string, Look>();
    if (impact) for (const [id, tone] of impact.states) m.set(id, tone);
    if (asset && impact) m.set(asset, "serviced");
    return m;
  }, [impact, asset]);

  const paint = useMemo((): FloorPaint => {
    if (!site) return RESTING;
    const arcs = [...pendingOps, ...draftOps].map((op) => changeOf(site, op).arc);
    return {
      active: !!impact,
      looks,
      origin: asset,
      cables: !!impact,
      pulse: impact && asset ? [asset] : [],
      pulseTone: impact?.grade ?? "gray",
      selected: s.sel ?? null,
      candidates: pickFeed ? new Set(pickFeed.candidates) : null,
      highlight,
      arcs,
      dots: [],
    };
  }, [site, impact, looks, asset, s.sel, pickFeed, highlight, pendingOps, draftOps]);

  const select = useCallback(
    (id: string | null) => {
      if (pickFeed) {
        if (id && (pickFeed.candidates.includes(id) || id === pickFeed.owner)) {
          setDraft((d) => {
            const next = new Map(d);
            if (id === pickFeed.owner) next.delete(pickFeed.key);
            else next.set(pickFeed.key, id);
            return next;
          });
          setRefused(null);
          go({ pick: undefined });
        }
        return;
      }
      if (id && !SELECTABLE.has(site?.node.get(id)?.kind ?? "")) return;
      go({ sel: id && id !== s.sel ? id : undefined, edit: undefined, pick: undefined });
    },
    [pickFeed, site, s.sel, go],
  );
  const handlers = useMemo(() => ({ onPick: select }), [select]);
  const insets = useMemo(() => ({ top: 52, right: INFO_W + (companionOpen ? COMPANION_W : 0), bottom: 12, left: 12 }), [companionOpen]);
  useFloor(paint, handlers, insets);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || (e.target as HTMLElement | null)?.tagName === "INPUT") return;
      if (s.pick) go({ pick: undefined });
      else if (s.edit) go({ edit: undefined });
      else if (s.sel) go({ sel: undefined, chain: undefined });
      else go({ off: undefined, job: undefined });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [s, go]);

  if (!site) return null;

  const isOff = (id: string) => s.off === id || (!s.off && job?.asset === id);
  const dark = new Set([...(impact?.states ?? [])].filter(([id, t]) => t === "dark" && site.node.get(id)?.kind === "cabinet").map(([id]) => id));
  const fixState = fix.isPending
    ? { label: "Finding a fix", disabled: true }
    : fix.isError
      ? { label: "Try again", disabled: false }
      : fix.data === null
        ? { label: "No fix found", disabled: true }
        : { label: "Find a fix", disabled: dark.size === 0 || pending.length > 0 };

  const save = () => {
    setRefused(null);
    submit.mutate(
      { base: site.revision, ops: draftOps, rationale: `Edited on the floor: ${labelOf(site, s.sel ?? "")}` },
      { onSuccess: () => go({ edit: undefined, pick: undefined }), onError: (e) => setRefused(e.message) },
    );
  };
  const edit: EditState | null = s.edit ? { feeds, draft, pick: s.pick ?? null, saving: submit.isPending, refused } : null;
  const selKind = s.sel ? site.node.get(s.sel)?.kind : undefined;

  return (
    <>
      <JobsStrip site={site} jobs={jobs} active={s.off ? null : (s.job ?? null)} onPick={(w) => go({ job: s.job === w && !s.off ? undefined : w, off: undefined })} />
      <PendingBar site={site} pending={pending} insets={insets} />
      <InfoPanel
        site={site}
        impact={impact}
        name={asset ? labelOf(site, asset) : null}
        window={job && !s.off ? span(job.start, job.finish) : null}
        grade={job && !s.off && !outranks(job.grade, impact?.grade) ? job.grade : null}
        shift={companionOpen}
        onScrub={setAt}
        fix={{ ...fixState, run: () => fix.mutate({ dark, rationale: `Find a fix for ${asset ? labelOf(site, asset) : "the switched-off equipment"}` }) }}
      />
      {s.sel && site.node.get(s.sel) && (
        <Card
          key={s.sel}
          site={site}
          id={s.sel}
          looks={looks}
          impact={impact}
          off={isOff(s.sel)}
          canFlip={selKind !== "cabinet"}
          onFlip={() => (isOff(s.sel!) ? go({ off: undefined, job: undefined }) : go({ off: s.sel, job: undefined }))}
          chain={!!s.chain}
          onChain={() => go({ chain: s.chain ? undefined : 1 })}
          edit={edit}
          editable={editable}
          onEdit={() => go({ edit: 1, chain: undefined })}
          onPick={(key) => go({ pick: key ?? undefined })}
          onChoose={(key, owner) => {
            const f = feeds.find((x) => x.key === key);
            setDraft((d) => {
              const next = new Map(d);
              if (!f || owner === f.owner) next.delete(key);
              else next.set(key, owner);
              return next;
            });
            setRefused(null);
            go({ pick: undefined });
          }}
          onSave={save}
          onCancel={() => go({ edit: undefined, pick: undefined })}
          pending={pendingOps}
          onSelect={(id) => go({ sel: id })}
          insets={insets}
        />
      )}
      <div className="camtog">
        <button className={s.cam !== "3d" ? "on" : ""} onClick={() => go({ cam: undefined })}>
          2D
        </button>
        <button className={s.cam === "3d" ? "on" : ""} onClick={() => go({ cam: "3d" })}>
          3D
        </button>
      </div>
    </>
  );
}
