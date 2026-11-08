import { describe, expect, it } from "vitest";
import type { CustomerImpactDto, ScenarioResultDto } from "@cascade/core/contract";
import { impactOf } from "./impact";

const cause = { kind: "initiating", how: "fails" } as const;
const result = (over: Partial<ScenarioResultDto>): ScenarioResultDto => ({
  revision: "r1",
  events: [],
  timeline: [],
  moments: [],
  revenueExposedUsd: 0,
  ...over,
});
const hit = (customer: string, customerName: string, state: CustomerImpactDto["state"], cabinets: string[], cabinetsLabel: string, revenueExposedUsd: number): CustomerImpactDto => ({
  customer,
  customerName,
  cabinets,
  cabinetsLabel,
  state,
  revenueExposedUsd,
});

const TRINITY = ["customer:C1022", "Trinity Logistics Group"] as const;
const LONE_STAR = ["customer:C1183", "Lone Star Genomics"] as const;

// PDU-3A off: Trinity's D03 goes dark and its D01 only loses backup; Lone Star's E06 loses backup.
const pdu3a = result({
  timeline: [
    { tMin: 0, entity: "pdu:PDU-3A", state: "down", cause },
    { tMin: 0, entity: "cabinet:D01", state: "exposed", cause },
    { tMin: 0, entity: "cabinet:D03", state: "exposed", cause },
    { tMin: 0, entity: "cabinet:D03", state: "down", cause },
    { tMin: 0, entity: "cabinet:E06", state: "exposed", cause },
  ],
  moments: [
    {
      tMin: 0,
      customers: [
        hit(...TRINITY, "down", ["cabinet:D03"], "D03", 1350),
        hit(...TRINITY, "exposed", ["cabinet:D01"], "D01", 1350),
        hit(...LONE_STAR, "exposed", ["cabinet:E06"], "E06", 9275),
      ],
    },
  ],
  revenueExposedUsd: 11975,
});

describe("impactOf", () => {
  it("paints an entity red when it goes dark even if it was also reported losing backup", () => {
    const i = impactOf(pdu3a);
    expect(i.states.get("cabinet:D03")).toBe("dark");
    expect(i.states.get("cabinet:E06")).toBe("backup");
    expect(i.states.get("pdu:PDU-3A")).toBe("dark");
    expect(i.states.has("cabinet:E02")).toBe(false);
  });

  it("counts cabinets dark and losing backup, and keeps a customer's dark and backup revenue apart", () => {
    const i = impactOf(pdu3a);
    expect([i.darkCabinets, i.backupCabinets]).toEqual([1, 2]);
    expect(i.customers.map((c) => [c.name, c.state, c.dark?.label ?? null, c.backup?.label ?? null])).toEqual([
      ["Trinity Logistics Group", "dark", "D03", "D01"],
      ["Lone Star Genomics", "backup", null, "E06"],
    ]);
    expect([i.darkRevenue, i.backupRevenue]).toEqual([1350, 10625]);
    expect(i.grade).toBe("red");
  });

  it("is orange when cabinets only lose backup, gray when none is hit", () => {
    const backupOnly = result({
      timeline: [{ tMin: 0, entity: "cabinet:E06", state: "exposed", cause }],
      moments: [{ tMin: 0, customers: [hit(...LONE_STAR, "exposed", ["cabinet:E06"], "E06", 9275)] }],
    });
    expect(impactOf(backupOnly).grade).toBe("amber");
    const nothing = result({ timeline: [{ tMin: 0, entity: "crah:CRAH-5", state: "down", cause }], moments: [{ tMin: 0, customers: [] }] });
    expect(impactOf(nothing)).toMatchObject({ grade: "gray", darkCabinets: 0, backupCabinets: 0, darkRevenue: 0, backupRevenue: 0 });
  });

  it("reads the scenario at an earlier moment: only what has happened by then counts, priced as it was then", () => {
    const mesquite = ["customer:C1041", "Mesquite Cloud LLC"] as const;
    const battery = result({
      timeline: [
        { tMin: 0, entity: "ups:UPS-A", state: "exposed", cause },
        { tMin: 0, entity: "cabinet:A01", state: "exposed", cause },
        { tMin: 8, entity: "cabinet:A01", state: "down", cause },
      ],
      moments: [
        { tMin: 0, customers: [hit(...mesquite, "exposed", ["cabinet:A01"], "A01", 1210)] },
        { tMin: 8, customers: [hit(...mesquite, "down", ["cabinet:A01"], "A01", 1210)] },
      ],
    });
    expect(impactOf(battery).times).toEqual([0, 8]);
    expect(impactOf(battery, 0)).toMatchObject({ grade: "amber", darkRevenue: 0, backupRevenue: 1210 });
    expect(impactOf(battery)).toMatchObject({ grade: "red", darkRevenue: 1210, backupRevenue: 0 });
  });
});
