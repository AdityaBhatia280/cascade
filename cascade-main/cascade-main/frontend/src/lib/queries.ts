// Server reads and commands the views share. Every read is keyed by its route first, so GET /events
// (model-changed, proposal-changed) refreshes what it touches; numbers always come from the server.

import { useMemo } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PatchOpDto, ProposalDto, RiskGrade, WorkAssessmentDto } from "@cascade/core/contract";
import { api, apiQuery, newIntent } from "./api";
import { buildSite, type Site } from "./site";

export function useSite(): { site: Site | null; error: Error | null } {
  const scene = useQuery({ ...apiQuery("GET /scene"), staleTime: Infinity });
  const exposure = useQuery({ ...apiQuery("GET /exposure"), staleTime: Infinity });
  const site = useMemo(() => (scene.data && exposure.data ? buildSite(scene.data, exposure.data) : null), [scene.data, exposure.data]);
  return { site, error: scene.error ?? exposure.error };
}

/** A scheduled job the engine could assess, on the equipment it takes out. */
export interface Job {
  wonum: string;
  asset: string;
  grade: RiskGrade;
  start: string;
  finish: string | null;
  /** The work as what-if events for GET /scenario. */
  scenario: string[];
  assessment: Extract<WorkAssessmentDto, { assessed: true }>;
}

export function jobsOf(list: readonly WorkAssessmentDto[]): Job[] {
  const out: Job[] = [];
  for (const a of list) {
    const w = a.workOrder;
    if (!a.assessed || !w.asset?.resolved || !w.scheduledStart) continue;
    out.push({ wonum: w.wonum, asset: w.asset.entity, grade: a.grade, start: w.scheduledStart, finish: w.scheduledFinish, scenario: a.scenario, assessment: a });
  }
  return out;
}

export function useJobs() {
  const q = useQuery({ ...apiQuery("GET /work-orders/assessment"), staleTime: 60_000 });
  const jobs = useMemo(() => (q.data ? jobsOf(q.data) : []), [q.data]);
  return { jobs, all: q.data ?? [], error: q.error, loading: q.isPending };
}

export function useScenario(events: readonly string[] | null) {
  return useQuery({
    ...apiQuery("GET /scenario", { query: { e: [...(events ?? [])] } }),
    enabled: !!events && events.length > 0,
    staleTime: Infinity,
  });
}

export function useProposals() {
  const q = useQuery({ ...apiQuery("GET /proposals"), staleTime: Infinity });
  const proposals = useMemo(() => q.data ?? [], [q.data]);
  const pending = useMemo(() => proposals.filter((p) => p.status === "pending"), [proposals]);
  return { proposals, pending };
}

export function useEntity(id: string | null) {
  return useQuery({ ...apiQuery("GET /entities/:id", { params: { id: id ?? "" } }), enabled: !!id, staleTime: Infinity });
}

const factNumber = (display: string | null | undefined) => (display ? Number.parseFloat(display) : NaN);

/** Measured kW of each cabinet, read from its entity facts (fetched only when asked for). */
export function useCabinetLoads(cabinets: readonly string[]): { kw: number | null } {
  const qs = useQueries({
    queries: cabinets.map((id) => ({ ...apiQuery("GET /entities/:id", { params: { id } }), staleTime: Infinity })),
  });
  if (!cabinets.length || qs.some((q) => !q.data)) return { kw: null };
  let s = 0;
  for (const q of qs) {
    const v = factNumber(q.data!.facts.find((f) => f.field === "measuredKw")?.display);
    if (Number.isFinite(v)) s += v;
  }
  return { kw: Math.round(s * 10) / 10 };
}

export const factOf = (facts: readonly { field: string; display: string | null }[] | undefined, field: string) => facts?.find((f) => f.field === field)?.display ?? null;
export { factNumber };

/**
 * Approve / discard (reject) / complete proposals, one after another so each approval re-verifies on
 * the model the previous one produced. Every click is its own intent. Stops at the first refusal.
 */
export function useDecide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, type }: { ids: readonly string[]; type: "approve" | "reject" | "complete" }) => {
      for (const id of ids) {
        await api("POST /proposals/:id/decision", {
          params: { id },
          body: type === "reject" ? { type, reason: "Discarded on the floor" } : { type },
          intent: newIntent(),
        });
      }
    },
    onSettled: () => qc.invalidateQueries(),
  });
}

/** Saves moves as a proposal waiting for approval. */
export function useSubmitMoves() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ base, ops, rationale }: { base: string; ops: PatchOpDto[]; rationale: string }) =>
      api("POST /proposals", { body: { base, ops, rationale }, intent: newIntent() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["GET /proposals"] }),
  });
}

const FIXABLE = new Set(["single-corded", "ab-convergence", "failover-overload"]);

/**
 * Find a fix: the planner's best plan for every fixable finding behind a cabinet the scenario takes
 * dark, submitted as a proposal. Resolves to the proposal, or null when no plan exists.
 */
export function useFindFix() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ dark, rationale }: { dark: ReadonlySet<string>; rationale: string }): Promise<ProposalDto | null> => {
      const audit = await qc.fetchQuery({ ...apiQuery("GET /audit"), staleTime: 0 });
      const clear = audit.findings.filter((f) => FIXABLE.has(f.rule) && f.affected.some((i) => i.cabinets.some((c) => dark.has(c)))).map((f) => f.id);
      if (!clear.length) return null;
      const outcome = await api("POST /plans", { body: { clear, maxMoves: 6, alternatives: 1 }, intent: newIntent() });
      const plan = outcome.plans[0];
      if (!plan) return null;
      return api("POST /proposals", { body: { base: plan.base, ops: plan.ops, rationale }, intent: newIntent() });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["GET /proposals"] }),
  });
}
