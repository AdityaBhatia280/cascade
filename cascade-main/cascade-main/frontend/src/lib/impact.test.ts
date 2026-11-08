import { describe, expect, it } from "vitest";
import type { ScenarioResultDto } from "@cascade/core/contract";
import { impactOf } from "./impact";

const cause = { kind: "initiating", how: "fails" } as const;
const result = (over: Partial<ScenarioResultDto>): ScenarioResultDto => ({
  revision: "r1",
  events: [],
  timeline: [],
  customers: [],
  revenueExposedUsd: 0,
  ...over,
});

// PDU-3A off, as the server reports it: E01 loses one cord, then both; E06 keeps one.
const pdu3a = result({
  timeline: [
    { tMin: 0, entity: "pdu:PDU-3A", state: "down", cause },
    { tMin: 0, entity: "cabinet:E01", state: "exposed", cause },
    { tMin: 0, entity: "cabinet:E01", state: "down", cause },
    { tMin: 0, entity: "cabinet:E06", state: "exposed", cause },
  ],
  customers: [
    { customer: "customer:C1183", customerName: "Lone Star Genomics", cabinets: ["cabinet:E06"], state: "exposed", revenueExposedUsd: 9275 },
    { customer: "customer:C1156", customerName: "Halcyon Health Partners", cabinets: ["cabinet:E01"], state: "down", revenueExposedUsd: 7850 },
  ],
  revenueExposedUsd: 17125,
});

describe("impactOf", () => {
  it("paints an entity red when it goes dark even if it was also reported losing backup", () => {
    const i = impactOf(pdu3a);
    expect(i.states.get("cabinet:E01")).toBe("dark");
    expect(i.states.get("cabinet:E06")).toBe("backup");
    expect(i.states.get("pdu:PDU-3A")).toBe("dark");
    expect(i.states.has("cabinet:E02")).toBe(false);
  });

  it("counts customers dark and losing backup, dark first, and splits the server's revenue between them", () => {
    const i = impactOf(pdu3a);
    expect(i.customers.map((c) => [c.name, c.state])).toEqual([
      ["Halcyon Health Partners", "dark"],
      ["Lone Star Genomics", "backup"],
    ]);
    expect([i.dark, i.backup]).toEqual([1, 1]);
    expect([i.darkRevenue, i.backupRevenue]).toEqual([7850, 9275]);
    expect(i.grade).toBe("red");
  });

  it("is orange when customers only lose backup, gray when nobody is hit", () => {
    const backupOnly = result({
      timeline: [{ tMin: 0, entity: "cabinet:E06", state: "exposed", cause }],
      customers: [{ customer: "customer:C1183", customerName: "Lone Star Genomics", cabinets: ["cabinet:E06"], state: "exposed", revenueExposedUsd: 9275 }],
    });
    expect(impactOf(backupOnly).grade).toBe("amber");
    const nothing = result({ timeline: [{ tMin: 0, entity: "crah:CRAH-5", state: "down", cause }] });
    expect(impactOf(nothing)).toMatchObject({ grade: "gray", dark: 0, backup: 0, darkRevenue: 0, backupRevenue: 0 });
  });

  it("reads the timeline at an earlier moment: only what has happened by then counts", () => {
    const battery = result({
      timeline: [
        { tMin: 0, entity: "ups:UPS-A", state: "exposed", cause },
        { tMin: 0, entity: "cabinet:A01", state: "exposed", cause },
        { tMin: 8, entity: "cabinet:A01", state: "down", cause },
      ],
      customers: [{ customer: "customer:C1041", customerName: "Mesquite Cloud LLC", cabinets: ["cabinet:A01"], state: "down", revenueExposedUsd: 1210 }],
    });
    expect(impactOf(battery).times).toEqual([0, 8]);
    expect(impactOf(battery, 0).customers[0]).toMatchObject({ state: "backup", risk: 1210 });
    expect(impactOf(battery, 0).grade).toBe("amber");
    expect(impactOf(battery).customers[0]?.state).toBe("dark");
  });
});
