"""Builds golden/ground_truth.json: the 10 planted dependencies + 3 decoys,
with the exact file and line where the evidence lives (line numbers are
computed from the files, so they never drift after edits)."""
import json
import os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")


def line_of(path, needle, nth=1):
    hits = [i + 1 for i, l in enumerate(open(os.path.join(ROOT, path)).read().split("\n")) if needle in l]
    if len(hits) < nth:
        raise SystemExit(f"evidence not found: {path}: {needle!r}")
    return hits[nth - 1]


def ev(path, needle, nth=1):
    n = line_of(path, needle, nth)
    text = open(os.path.join(ROOT, path)).read().split("\n")[n - 1].strip()
    return {"file": path, "line": n, "snippet": text}


DEPS = [
    ("D1", "LEASEBIL", "COOLFLAG.DAT", "reads", "LEASEBIL reads the thermal flag file and gives SLA credits from it",
     [ev("legacy/LEASEBIL.cbl", 'SELECT COOL-FLAG ASSIGN TO "COOLFLAG.DAT"'), ev("legacy/LEASEBIL.cbl", "IF WS-COOL = \"Y\" AND LR-SLA-PCT > 0")]),
    ("D2", "BMSEXP", "COOLFLAG.DAT", "writes", "The BMS export job writes the flag that billing reads",
     [ev("legacy/bms_config.json", '"writes": "FAC.BMS.COOLFLAG"'), ev("legacy/INVBATCH.jcl", "//COOLFLAG DD DSN=FAC.BMS.COOLFLAG")]),
    ("D3", "CAMCALC", "LEASECPY", "shares_layout", "Both programs compile the same record layout; changing it breaks both",
     [ev("legacy/CAMCALC.cbl", "COPY LEASECPY."), ev("legacy/LEASEBIL.cbl", "COPY LEASECPY.")]),
    ("D4", "LEASEBIL", "lease:NW0101", "code_vs_contract", "Code hardcodes base year 2019; Northwind amendment moved it to 2021",
     [ev("legacy/LEASEBIL.cbl", "WS-BASE-YEAR                PIC 9(4)   VALUE 2019."), ev("leases/northwind.txt", 'means calendar year 2021')]),
    ("D5", "work_orders", "badge:DC-HALL-A", "grants", "Inserting a work order silently grants the vendor 72h badge access to the data hall",
     [ev("legacy/schema.sql", "CREATE TRIGGER trg_wo_vendor_access"), ev("legacy/schema.sql", "SELECT v.badge_group, 'DC-HALL-A'")]),
    ("D6", "CHW-LOOP-1", "UPS-B", "powered_by", "Chilled water loop pumps run on UPS panel B",
     [ev("legacy/bms_config.json", '"pump_power": "UPS-B"')]),
    ("D7", "CRAH-4", "UPS-B", "powered_by", "CRAH-4 is also on UPS-B, so one panel event hits pumps, CH-1 controls and a CRAH",
     [ev("legacy/bms_config.json", '{"id": "CRAH-4", "hall": "A", "power": "UPS-B"}')]),
    ("D8", "door:DC-HALL-A", "BMS-SW-02", "network", "The data hall door controller sits on the BMS switch (which is on UPS-B)",
     [ev("legacy/access_export.csv", "DC-HALL-A,Data hall A,RDR-031,ACC-C7,BMS-SW-02")]),
    ("D9", "sla:AC0200", "CHW-LOOP-1", "contractual", "Acme Cloud's 99.99% SLA depends on the chilled water plant",
     [ev("leases/acme.txt", "99.99% of each calendar month"), ev("leases/acme.txt", "depends on the chilled water plant")]),
    ("D10", "INVBATCH", "BMSEXP", "schedule", "Billing runs at 01:00 but the flag is refreshed at 02:00, so invoices use yesterday's flag",
     [ev("legacy/INVBATCH.jcl", "AT 01:00 DAILY"), ev("legacy/bms_config.json", '"schedule": "02:00 daily"')]),
]
# CH-1 controls are also on UPS-B; used by the incident scenario (not counted as one of the 10)
EXTRA = [("X1", "CH-1", "UPS-B", "powered_by", "CH-1 control power on UPS-B (used by the incident script)",
          [ev("legacy/bms_config.json", '{"id": "CH-1", "tons": 400, "controls_power": "UPS-B"')])]

DECOYS = [
    ("X-DEC1", "LEASEBIL", "COOLFLAG.BAK", "Only appears in a commented-out JCL step disabled in 2015",
     [ev("legacy/INVBATCH.jcl", "COOLFLAG.BAK")]),
    ("X-DEC2", "CH-3", "UPS-B", "Label says CH-3B on UPS-B, but that breaker is a spare; CH-3 runs on UPS-A",
     [ev("legacy/bms_config.json", "CH-3B (breaker on UPS-B is a spare")]),
    ("X-DEC3", "v_coolflag_history", "COOLFLAG.DAT", "View name mentions coolflag but only reads invoices; unused since 2019",
     [ev("legacy/schema.sql", "CREATE VIEW v_coolflag_history")]),
]

opex = {2019: 11.20, 2021: 12.05, 2024: 13.40}
code_pass = round((opex[2024] - opex[2019]) * 8200 / 12, 2)
lease_pass = round((opex[2024] - opex[2021]) * 8200 / 12, 2)
cam_code = 3784.60  # from golden case T01 (COBOL truncates, see F4)
cam_lease = round(48000 * 8200 / 120000, 2)
FINDINGS = [
    {"id": "F1", "kind": "billing_discrepancy", "tenant": "NW0101",
     "title": "Northwind billed against base year 2019; Amendment No. 2 says 2021",
     "code": ev("legacy/LEASEBIL.cbl", "VALUE 2019."), "contract": ev("leases/northwind.txt", "means calendar year 2021"),
     "per_month_code": code_pass, "per_month_lease": lease_pass,
     "overcharge_per_month": round(code_pass - lease_pass, 2), "usd_per_year": round((code_pass - lease_pass) * 12, 2),
     "golden_case": "T01 (opex_pass column = 1,503.33)"},
    {"id": "F2", "kind": "billing_discrepancy", "tenant": "NW0101",
     "title": "CAM share uses occupied SF; Northwind lease 5.4 says total building SF",
     "code": ev("legacy/CAMCALC.cbl", "LR-SQFT / LR-BLDG-OCC-SF"), "contract": ev("leases/northwind.txt", "TOTAL rentable area"),
     "per_month_code": cam_code, "per_month_lease": cam_lease,
     "overcharge_per_month": round(cam_code - cam_lease, 2), "usd_per_year": round((cam_code - cam_lease) * 12, 2),
     "note": "Copper Bean's lease has the same total-area language", "golden_case": "T01 (cam column = 3,784.60)"},
    {"id": "F3", "kind": "hardcoded_value", "title": "Invoice amount fields cannot print $1,000,000 or more",
     "code": ev("legacy/LEASEBIL.cbl", "O-TOTAL                 PIC -,---,--9.99."),
     "detail": "Floating minus edit leaves 6 integer digits; a 7-digit amount loses its leading digit (golden case E12 prints ',055,053.16')",
     "usd_per_year": None},
    {"id": "F4", "kind": "hardcoded_value", "title": "CAM charge is truncated, not rounded",
     "code": ev("legacy/LEASEBIL.cbl", "COMPUTE WS-CAM-CHG = LR-CAM-POOL-MO * WS-CAM-SHARE."),
     "detail": "COMPUTE without ROUNDED drops fractions of a cent (golden cases C01-C04)", "usd_per_year": None},
    {"id": "F5", "kind": "hardcoded_value", "title": "Two-digit year window pivots at 50",
     "code": ev("legacy/LEASEBIL.cbl", "IF LI-START-YY < 50"),
     "detail": "A lease starting in 2050 or later will be read as 1950s (golden cases E02, E03)", "usd_per_year": None},
]

out = {
    "dependencies": [dict(id=i, **{"from": f, "to": t}, kind=k, why=w, evidence=e) for i, f, t, k, w, e in DEPS],
    "extra_edges": [dict(id=i, **{"from": f, "to": t}, kind=k, why=w, evidence=e) for i, f, t, k, w, e in EXTRA],
    "decoys": [dict(id=i, **{"from": f, "to": t}, why_not=w, evidence=e) for i, f, t, w, e in DECOYS],
    "findings": FINDINGS,
}
json.dump(out, open(os.path.join(ROOT, "golden", "ground_truth.json"), "w"), indent=1)
for d in out["dependencies"]:
    print(d["id"], d["from"], "->", d["to"], "|", "; ".join(f"{e['file']}:{e['line']}" for e in d["evidence"]))
for f in FINDINGS:
    print(f["id"], f["title"], f.get("usd_per_year"))
