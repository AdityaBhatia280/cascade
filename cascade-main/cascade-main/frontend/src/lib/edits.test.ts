import { describe, expect, it } from "vitest";
import type { EntityKind, SceneDto, SceneLinkDto, SceneNodeDto, Side } from "@cascade/core/contract";
import { buildSite } from "./site";
import { changeOf, feedsOf, moveFor } from "./edits";

const node = (id: string, kind: EntityKind): SceneNodeDto => ({
  id, kind, layer: "power", label: id.slice(id.indexOf(":") + 1), side: null, customer: null,
  pos3: [0, 0, 0], size3: [1, 1, 1], pos2: [0, 0], in2d: true, findings: [], placed: "documented",
});
const link = (from: string, to: string, id = `${from}->${to}`, side: Side | null = null): SceneLinkDto => ({ id, from, to, layer: "power", side, path3: [], path2: [] });

// Two PDUs, each with a feeder breaker to an RPP; PDU-3B has a spare breaker. RPP-3B has a spare circuit.
const scene: SceneDto = {
  revision: "r1",
  bounds3: { min: [0, 0, 0], max: [1, 1, 1] },
  bounds2: { min: [0, 0], max: [1, 1] },
  xray: {},
  nodes: [
    node("pdu:PDU-3A", "pdu"), node("pdu:PDU-3B", "pdu"),
    node("breaker:PDU-3A-SF-3", "breaker"), node("breaker:PDU-3B-SF-1", "breaker"), node("breaker:PDU-3B-SF-2", "breaker"),
    node("rpp:RPP-4A", "rpp"), node("rpp:RPP-4B", "rpp"), node("rpp:RPP-3B", "rpp"),
    node("circuit:RPP-4A/1", "circuit"), node("circuit:RPP-4B/1", "circuit"), node("circuit:RPP-3B/31", "circuit"), node("circuit:RPP-3B/13", "circuit"),
    node("cabinet:E01", "cabinet"),
  ],
  links: [
    link("pdu:PDU-3A", "breaker:PDU-3A-SF-3"), link("breaker:PDU-3A-SF-3", "rpp:RPP-4B"),
    link("pdu:PDU-3B", "breaker:PDU-3B-SF-1"), link("breaker:PDU-3B-SF-1", "rpp:RPP-3B"), link("pdu:PDU-3B", "breaker:PDU-3B-SF-2"),
    link("rpp:RPP-4A", "circuit:RPP-4A/1"), link("rpp:RPP-4B", "circuit:RPP-4B/1"),
    link("rpp:RPP-3B", "circuit:RPP-3B/31"), link("rpp:RPP-3B", "circuit:RPP-3B/13"),
    link("circuit:RPP-4A/1", "cabinet:E01", "cord:E01/A", "A"), link("circuit:RPP-4B/1", "cabinet:E01", "cord:E01/B", "B"),
  ],
};
const site = buildSite(scene, []);

describe("feedsOf", () => {
  it("lists a cabinet's cords with the panels that still have a spare circuit", () => {
    const feeds = feedsOf(site, "cabinet:E01");
    expect(feeds.map((f) => [f.key, f.side, f.owner])).toEqual([
      ["cord:E01/A", "A", "rpp:RPP-4A"],
      ["cord:E01/B", "B", "rpp:RPP-4B"],
    ]);
    expect(feeds[1]!.candidates).toEqual(["rpp:RPP-3B"]);
  });

  it("offers a panel's feeder only onto sources of the same kind with a spare breaker", () => {
    const [feed] = feedsOf(site, "rpp:RPP-4B");
    expect(feed).toMatchObject({ via: "breaker:PDU-3A-SF-3", owner: "pdu:PDU-3A", candidates: ["pdu:PDU-3B"] });
  });

  it("has nothing to edit on kinds the patch language cannot move", () => {
    expect(feedsOf(site, "circuit:RPP-4B/1")).toEqual([]);
  });
});

describe("moveFor", () => {
  it("re-homes a cord onto the lowest-numbered spare circuit of the chosen panel", () => {
    const [, b] = feedsOf(site, "cabinet:E01");
    expect(moveFor(site, b!, "rpp:RPP-3B")).toEqual({ op: "rehome-cord", cord: "cord:E01/B", from: "circuit:RPP-4B/1", to: "circuit:RPP-3B/13" });
  });

  it("skips spares another move already takes, and offers nothing once they are all taken", () => {
    const [, b] = feedsOf(site, "cabinet:E01");
    expect(moveFor(site, b!, "rpp:RPP-3B", new Set(["circuit:RPP-3B/13"]))).toMatchObject({ to: "circuit:RPP-3B/31" });
    expect(moveFor(site, b!, "rpp:RPP-3B", new Set(["circuit:RPP-3B/13", "circuit:RPP-3B/31"]))).toBeNull();
  });

  it("re-feeds a panel from the chosen source's spare breaker, and choosing the current source is no move", () => {
    const [feed] = feedsOf(site, "rpp:RPP-4B");
    expect(moveFor(site, feed!, "pdu:PDU-3B")).toEqual({ op: "refeed", device: "rpp:RPP-4B", from: "breaker:PDU-3A-SF-3", to: "breaker:PDU-3B-SF-2" });
    expect(moveFor(site, feed!, "pdu:PDU-3A")).toBeNull();
  });
});

describe("changeOf", () => {
  it("shows a re-feed by panel names and arcs from the new source to the panel", () => {
    expect(changeOf(site, { op: "refeed", device: "rpp:RPP-4B", from: "breaker:PDU-3A-SF-3", to: "breaker:PDU-3B-SF-2" })).toEqual({
      subject: "RPP-4B", side: null, from: "PDU-3A", to: "PDU-3B", arc: { from: "pdu:PDU-3B", to: "rpp:RPP-4B" },
    });
  });

  it("shows a cord move by circuit and arcs from the new panel to the cabinet", () => {
    expect(changeOf(site, { op: "rehome-cord", cord: "cord:E01/B", from: "circuit:RPP-4B/1", to: "circuit:RPP-3B/31" })).toEqual({
      subject: "E01", side: "B", from: "RPP-4B/1", to: "RPP-3B/31", arc: { from: "rpp:RPP-3B", to: "cabinet:E01" },
    });
  });
});
