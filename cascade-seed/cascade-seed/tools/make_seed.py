"""Builds seed_portfolio.json: everything seedPortfolio (Leap Phase 1) needs in one file.
Tables match the blueprint: source_files, nodes, edges, lease_terms, telemetry_points,
ground_truth_edges, findings, parity_cases."""
import json
import os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
gt = json.load(open(os.path.join(ROOT, "golden", "ground_truth.json")))
parity = json.load(open(os.path.join(ROOT, "golden", "parity_cases.json")))

KIND = {".cbl": "cobol", ".cpy": "copybook", ".jcl": "jcl", ".sql": "sql", ".json": "bms", ".csv": "access", ".txt": "lease"}
source_files = []
for d in ("legacy", "leases"):
    for f in sorted(os.listdir(os.path.join(ROOT, d))):
        p = f"{d}/{f}"
        source_files.append({"id": p, "path": p, "kind": KIND[os.path.splitext(f)[1]], "content": open(os.path.join(ROOT, p)).read()})

properties = [
    {"id": "MESA-DC1", "name": "Mesa DC1", "kind": "data_center", "total_sf": 60000},
    {"id": "ALICE", "name": "Alice Tower", "kind": "office", "total_sf": 120000},
    {"id": "COPPER", "name": "Copper Plaza", "kind": "retail", "total_sf": 120000, "occupied_sf": 104000},
]


def n(id, type, name, **kw):
    return {"id": id, "type": type, "name": name, "aliases": kw.pop("aliases", []), "k_required": kw.pop("k", None),
            "n_total": kw.pop("n", None), "capacity_kw": kw.pop("kw", None), "monthly_fee_usd": kw.pop("fee", None),
            "sla_target_pct": kw.pop("sla", None), "property_id": kw.pop("prop", None), **kw}


nodes = [
    # systems / modules
    n("LEASEBIL", "module", "LEASEBIL (COBOL billing)", aliases=["lease billing"]),
    n("CAMCALC", "module", "CAMCALC (COBOL CAM share)"),
    n("LEASECPY", "module", "LEASECPY (copybook)"),
    n("INVBATCH", "system", "INVBATCH nightly job 01:00"),
    n("INVPOST", "module", "INVPOST (GL posting)"),
    n("BMSEXP", "system", "BMS export job 02:00"),
    n("COOLFLAG.DAT", "system", "COOLFLAG thermal flag file", aliases=["FAC.BMS.COOLFLAG"]),
    n("work_orders", "system", "work_orders table + trigger"),
    n("badge:DC-HALL-A", "system", "Badge access: Data Hall A"),
    n("door:DC-HALL-A", "system", "Door controller ACC-C7", prop="MESA-DC1"),
    n("BMS-SW-02", "utility", "BMS network switch 02", prop="MESA-DC1"),
    # power + cooling
    n("UPS-A", "utility", "UPS panel A", kw=400, prop="MESA-DC1"),
    n("UPS-B", "utility", "UPS panel B", kw=250, prop="MESA-DC1"),
    n("CH-1", "utility", "Chiller 1", prop="MESA-DC1"),
    n("CH-2", "utility", "Chiller 2", prop="MESA-DC1"),
    n("CH-3", "utility", "Chiller 3", prop="MESA-DC1"),
    n("CHW-PLANT", "utility", "Chiller plant (2 of 3 required)", k=2, n=3, prop="MESA-DC1"),
    n("CHW-LOOP-1", "utility", "Chilled water loop + pumps", prop="MESA-DC1"),
    n("CRAH-1", "utility", "CRAH-1", prop="MESA-DC1"), n("CRAH-2", "utility", "CRAH-2", prop="MESA-DC1"),
    n("CRAH-3", "utility", "CRAH-3", prop="MESA-DC1"), n("CRAH-4", "utility", "CRAH-4", prop="MESA-DC1"),
    n("HALL-A", "utility", "Data Hall A cooling (needs 3 of 4 CRAH)", k=3, n=4, kw=1800, prop="MESA-DC1"),
    # sensors
    n("HALL-A-INLET-T", "sensor", "Hall A inlet temp (stored x10 degC)", prop="MESA-DC1"),
    n("CHW-SUPPLY-T", "sensor", "Chilled water supply temp", prop="MESA-DC1"),
    # tenants, leases, SLA
    n("tenant:AC0200", "tenant", "Acme Cloud", fee=185000, prop="MESA-DC1"),
    n("sla:AC0200", "sla", "Acme Cloud 99.99% environmental SLA", sla=99.99, fee=185000, prop="MESA-DC1"),
    n("tenant:NW0101", "tenant", "Northwind Retail", prop="COPPER"),
    n("lease:NW0101", "lease", "Northwind lease + Amendment No. 2", prop="COPPER"),
    n("tenant:CB0105", "tenant", "Copper Bean Coffee", prop="COPPER"),
    n("tenant:KV0310", "tenant", "Kessler & Vance LLP", prop="ALICE"),
    n("tenant:SG0320", "tenant", "Saguaro Family Clinic", prop="ALICE"),
    n("tenant:LL0400", "tenant", "Ledgerline Fintech", prop="ALICE"),
]

edges = []
for d in gt["dependencies"] + gt["extra_edges"]:
    e = d["evidence"][0]
    edges.append({"id": d["id"], "from": d["from"], "to": d["to"], "kind": d["kind"], "delay_min": 0, "weight": 1,
                  "confidence": 1.0, "evidence_file": e["file"], "evidence_line": e["line"], "verified": True,
                  "planted": d["id"].startswith("D"), "why": d["why"]})
# physical cascade edges with delays (documented topology the simulator needs; not part of the "hidden 10")
for i, (f, t, k, delay, why) in enumerate([
    ("UPS-B", "CH-1", "powers", 0, "CH-1 controls on UPS-B"), ("UPS-A", "CH-2", "powers", 0, ""), ("UPS-A", "CH-3", "powers", 0, ""),
    ("CH-1", "CHW-PLANT", "feeds", 0, ""), ("CH-2", "CHW-PLANT", "feeds", 0, ""), ("CH-3", "CHW-PLANT", "feeds", 0, ""),
    ("CHW-PLANT", "CHW-LOOP-1", "feeds", 1, ""), ("UPS-B", "CHW-LOOP-1", "powers", 0, "pumps on UPS-B (D6)"),
    ("CHW-LOOP-1", "CRAH-1", "cools", 2, ""), ("CHW-LOOP-1", "CRAH-2", "cools", 2, ""), ("CHW-LOOP-1", "CRAH-3", "cools", 2, ""),
    ("CHW-LOOP-1", "CRAH-4", "cools", 2, ""), ("UPS-B", "CRAH-4", "powers", 0, "D7"),
    ("CRAH-1", "HALL-A", "cools", 1, ""), ("CRAH-2", "HALL-A", "cools", 1, ""), ("CRAH-3", "HALL-A", "cools", 1, ""), ("CRAH-4", "HALL-A", "cools", 1, ""),
    ("HALL-A", "HALL-A-INLET-T", "measured_by", 0, ""), ("HALL-A", "sla:AC0200", "contractual", 3, "thermal limit 27.0 C"),
    ("sla:AC0200", "tenant:AC0200", "bills", 0, ""), ("HALL-A-INLET-T", "BMSEXP", "feeds", 0, "flag rule"),
    ("COOLFLAG.DAT", "LEASEBIL", "feeds", 0, "read at 1000-READ-COOL-FLAG"), ("LEASEBIL", "CAMCALC", "calls", 0, ""),
    ("INVBATCH", "LEASEBIL", "runs", 0, ""), ("INVBATCH", "INVPOST", "runs", 0, ""), ("UPS-B", "BMS-SW-02", "powers", 0, "bms_config switches"),
    ("lease:NW0101", "tenant:NW0101", "bills", 0, ""),
], 1):
    edges.append({"id": f"P{i:02d}", "from": f, "to": t, "kind": k, "delay_min": delay, "weight": 1, "confidence": 1.0,
                  "evidence_file": "legacy/bms_config.json" if k in ("powers", "feeds", "cools") else None, "evidence_line": None,
                  "verified": True, "planted": False, "why": why})

lease_terms = [
    {"tenant_id": "NW0101", "base_year": 2021, "base_year_in_code": 2019, "cap_type": "none", "cap_pct": 0, "pro_rata_basis": "total_sf",
     "pro_rata_pct": round(8200 / 120000 * 100, 4), "gross_up": False, "sla_credit_schedule": None, "amendment_ref": "Amendment No. 2 (2021-06-15)"},
    {"tenant_id": "AC0200", "base_year": None, "cap_type": None, "cap_pct": None, "pro_rata_basis": None, "pro_rata_pct": None, "gross_up": False,
     "sla_target_pct": 99.99, "monthly_fee_usd": 185000,
     "sla_credit_schedule": [{"over_min": 0, "pct": 10}, {"over_min": 60, "pct": 20}, {"over_min": 240, "pct": 30}],
     "sla_cap": "one month's fee", "thermal_limit_c": 27.0, "amendment_ref": None},
    {"tenant_id": "KV0310", "base_year": 2019, "cap_type": "non-cumulative", "cap_pct": 3.0, "pro_rata_basis": "occupied_sf", "gross_up": False},
    {"tenant_id": "SG0320", "base_year": 2019, "cap_type": "none", "cap_pct": 0, "pro_rata_basis": "occupied_sf", "gross_up": False,
     "hvac_band_f": [68, 76]},
    {"tenant_id": "LL0400", "base_year": 2019, "cap_type": "none", "cap_pct": 0, "pro_rata_basis": "occupied_sf", "gross_up": False,
     "credit": "12,500 move-in credit first invoice each lease year 2021-2025"},
    {"tenant_id": "CB0105", "base_year": 2019, "cap_type": "none", "cap_pct": 0, "pro_rata_basis": "total_sf", "gross_up": False},
]

bms = json.load(open(os.path.join(ROOT, "legacy", "bms_config.json")))
telemetry_points = [{"id": p["id"], "node_id": {"CHW-SUPPLY-T": "CHW-SUPPLY-T", "CHW-LOOP-FLOW": "CHW-LOOP-1", "HALL-A-INLET-T": "HALL-A-INLET-T",
                                               "HALL-A-RETURN-T": "HALL-A", "UPS-B-LOAD": "UPS-B"}[p["id"]],
                     "name": p["id"], "unit": p["unit"], "scale": p["scale"], "expected_min": p["expected"][0], "expected_max": p["expected"][1],
                     "note": p.get("note", "")} for p in bms["points"]]

scenario = {
    "name": "UPS-B power event during CH-2 outage",
    "steps": [
        {"t_s": 0, "event": "normal", "note": "40 s of normal readings"},
        {"t_s": 40, "event": "trip", "node": "CH-2", "note": "2 of 3 chillers left, k=2 still met: DEGRADED, no cascade"},
        {"t_s": 90, "event": "power_event", "node": "UPS-B", "note": "trips CH-1 controls, loop pumps (D6) and CRAH-4 (D7): 1 of 3 chillers, below k=2"},
        {"t_s": 92, "event": "anomaly_expected", "point": "CHW-SUPPLY-T", "note": "detector should fire here and start the agent"},
    ],
    "sensor_fault_traps": [
        {"point": "HALL-A-INLET-T", "trap": "stored x10: raw 245 means 24.5 C, not 245 C"},
        {"point": "HALL-A-RETURN-T", "trap": "in degF while every other temp is degC"},
    ],
    "thermal_assumption": "Illustrative: about 3 minutes from total cooling loss to shutdown for a 5 kW cabinet (Data Center Knowledge, Rackspace outage writeup); scale faster for higher kW",
}

seed = {
    "properties": properties, "source_files": source_files, "nodes": nodes, "edges": edges, "lease_terms": lease_terms,
    "opex_psf_by_year": {"2019": 11.20, "2020": 11.60, "2021": 12.05, "2022": 12.50, "2023": 12.95, "2024": 13.40, "2025": 13.90, "2026": 14.35},
    "telemetry_points": telemetry_points, "incident_scenario": scenario,
    "ground_truth_edges": [{"id": d["id"], "from": d["from"], "to": d["to"], "kind": d["kind"]} for d in gt["dependencies"]],
    "decoys": gt["decoys"], "findings": gt["findings"],
    "parity_cases": [{"id": c["id"], "note": c["note"], "cool_flag": c["cool_flag"], "input": c["input_line"],
                      "expected_output": c["expected_output_line"]} for c in parity["cases"]],
}
json.dump(seed, open(os.path.join(ROOT, "seed_portfolio.json"), "w"), indent=1)
print("nodes", len(nodes), "edges", len(edges), "files", len(source_files), "parity", len(seed["parity_cases"]),
      "KB", os.path.getsize(os.path.join(ROOT, "seed_portfolio.json")) // 1024)
missing = {e["from"] for e in edges} | {e["to"] for e in edges}
print("edge endpoints without a node:", sorted(missing - {x["id"] for x in nodes}))
