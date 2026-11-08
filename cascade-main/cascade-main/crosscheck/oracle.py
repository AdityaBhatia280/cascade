"""Independent oracle for DFW1 single-component failures.

Reads the raw seed documents (register, roster, BMS point list) with its own parsing and tag
normalization, builds its own AND/OR supply model, and answers, for every component failed alone
at steady state: which cabinets end down / exposed. Shares no code with core/.

Physics (stated so disagreements can be judged, not just counted):
  * series node: alive iff its feeder is alive.  ATS: alive iff either source is alive.
  * UPS output, steady state (battery spent): unit alive AND (input OR maintenance bypass).
  * capacity: each live cabinet's measured kW splits evenly over its live cords; a PDU/UPS whose
    load exceeds kVA * 0.95 trips (nameplate, not the 80% continuous derate); iterate to fixpoint.
  * cooling: IT heat (live cabinets' kW) must be <= min(live chiller tons on live headers,
    live pump capacity, live CRAH sensible kW), else every cabinet goes down thermally.
  * conflicts: BMS beats roster beats register (the README's precedence).
Cabinet result: 'down' if no live cord, 'exposed' if it has fewer live cords than at baseline.
"""
import csv, json, re, sys
from pathlib import Path

D = Path(__file__).resolve().parent.parent / "seed/sites/dfw1/docs"
PF, TON_KW = 0.95, 3.517


def norm(t: str) -> str:
    t = t.strip().upper().replace(" ", "-")
    t = re.sub(r"^(PDU|RPP|UPS|ATS|GEN|CH|CRAH|CHWP|UTIL)-?(\d+)", lambda m: f"{m[1]}-{m[2]}", t)
    t = re.sub(r"^CRAH-0*(\d)", r"CRAH-\1", t)
    t = re.sub(r"-CB-?(\d)", r"-CB-\1", t)
    return t


def num(s: str) -> float:
    m = re.search(r"[\d,]+(\.\d+)?", s.replace(" ", ""))
    return float(m[0].replace(",", "")) if m else 0.0


reg = {norm(r["tag"]): r for r in csv.DictReader(open(D / "equipment_register.csv")) if r["status"].strip() != "Retired"}
bms = json.load(open(D / "bms_points.json"))

# ── electrical topology: node -> ('series', feeder) | ('ats', normal, alt) | ('ups', input, bypass)
topo: dict[str, tuple] = {}
for tag, r in reg.items():
    cls, fed, alt = r["asset_class"].upper(), r["fed_from"], r["alt_source"]
    if "GENERATOR" in cls or "UTILITY" in cls:
        topo[tag] = ("source",)
    elif "TRANSFER" in cls or cls == "ATS":
        topo[tag] = ("ats", norm(fed), norm(alt))
    elif cls == "UPS":
        topo[tag] = ("ups", norm(fed), norm(alt))
    elif fed and r["status"].strip() == "Active" and any(k in cls for k in ("SWITCH", "BREAKER", "MCCB", "PDU", "POWER PANEL", "MOTOR", "TRANSFORMER")):
        f = fed.split("(")[0]
        f = f.split(" via ")[1] if " via " in f else f  # RPP-5B: SWGR-B CB-6 via XFMR-5B
        topo[tag] = ("series", norm(f))
# mechanical panels exist only in breaker notes: "MP-A mech panel: CRAH-01/03/05/07"
for side in "AB":
    topo[f"MP-{side}"] = ("series", f"SWGR-{side}-CB-4")


def feeder_of_mech(r) -> str:
    f = r["fed_from"]
    m = re.search(r"\((?:via )?(MCC-[AB]|MP-[AB])\)", f)
    return m[1] if m else norm(f.split("(")[0])


# ── capacities (BMS overrides register)
kva = {t: num(r["rating"]) for t, r in reg.items() if r["asset_class"] in ("PDU", "UPS")}
# The BMS point table states nameplates in point descriptions: "PDU 2B Output kW (225 kVA)".
for p in bms["points"]:
    m = re.search(r"\((\d+) kVA\)", p["description"] or "")
    if m and p["equipment_type"] in ("PDU", "UPS"):
        kva[norm(p["equipment"])] = float(m[1])

# ── cords: roster, then BMS branch-circuit monitoring overrides the landing
cabinets: dict[str, dict] = {}
for r in csv.DictReader(open(D / "circuit_roster.csv")):
    cab = r["cabinet"]
    c = cabinets.setdefault(cab, {"kw": float(r["cab_kw_meas"]), "cords": {}})
    c["cords"][r["cord"]] = f"{norm(r['panel'])}/{int(r['ckt'])}"
# "RPP-3A CB26 kW - Cab D03 Cord B - 30A/208V/3P"; spares say "SPARE" instead of a cabinet.
for p in bms["points"]:
    m = re.match(r"(\S+) CB(\d+) kW - Cab (\w+) Cord ([AB])\b", p["description"] or "")
    if m:
        cabinets[m[3]]["cords"][m[4]] = f"{norm(m[1])}/{int(m[2])}"

# ── cooling: ratings, headers and feeds from the register (the BMS no longer states them)
cls = lambda c: [(t, r) for t, r in reg.items() if r["asset_class"] == c and r["status"].strip() == "Active"]
chillers = {t: (num(r["rating"]) * TON_KW, feeder_of_mech(r), norm(r["system"])) for t, r in cls("Chiller")}
pumps = {t: (num(re.search(r"sized for (\d+) kW", r["notes"])[1]), feeder_of_mech(r)) for t, r in cls("Pump")}
crahs = {t: (num(r["rating"]), feeder_of_mech(r)) for t, r in cls("CRAH")}
headers = {"CHWS-HDR-1": "CHW-LOOP-1", "CHWS-HDR-2": "CHW-LOOP-1"}


def simulate(failed: str | None):
    tripped: set[str] = set()
    while True:
        dead = {failed, *tripped} - {None}
        memo: dict[str, bool] = {}

        def alive(n: str) -> bool:
            if n in memo:
                return memo[n]
            memo[n] = False  # cycle guard
            if n in dead:
                return False
            t = topo.get(n, ("source",)) if not n.count("/") else ("series", n.split("/")[0])
            v = {"source": lambda: True, "series": lambda: alive(t[1]), "ats": lambda: alive(t[1]) or alive(t[2]),
                 "ups": lambda: alive(t[1]) or alive(t[2])}[t[0]]()
            memo[n] = v
            return v

        live = {cab: [s for s, ckt in c["cords"].items() if alive(ckt)] for cab, c in cabinets.items()}
        # capacity: attribute load up the chain of each live cord
        load: dict[str, float] = {}
        for cab, sides in live.items():
            for s in sides:
                n = cabinets[cab]["cords"][s].split("/")[0]
                seen = set()
                while n and n not in seen:
                    seen.add(n)
                    load[n] = load.get(n, 0) + cabinets[cab]["kw"] / len(sides)
                    t = topo.get(n, ("source",))
                    n = t[1] if t[0] == "series" else (t[1] if t[0] == "ups" and alive(t[1]) else (t[2] if t[0] == "ups" else None))
        over = {n for n, kw in load.items() if n in kva and kw > kva[n] * PF and n not in tripped}
        if over:
            tripped |= over
            continue
        heat = sum(cabinets[c]["kw"] for c, s in live.items() if s)
        hdr_ok = {h for h, loop in headers.items() if h not in dead and loop not in dead}
        chill = sum(kw for t, (kw, fed, h) in chillers.items() if t not in dead and alive(fed) and h in hdr_ok)
        pump = sum(kw for t, (kw, fed) in pumps.items() if t not in dead and alive(fed)) if "CHW-LOOP-1" not in dead else 0
        air = sum(kw for t, (kw, fed) in crahs.items() if t not in dead and alive(fed)) if "CHW-LOOP-1" not in dead else 0
        thermal = heat > min(chill, pump, air)
        return live, thermal, tripped


base, base_thermal, _ = simulate(None)
assert not base_thermal
components = sorted({*topo, *chillers, *pumps, *crahs, *headers, "CHW-LOOP-1",
                     *{ckt for c in cabinets.values() for ckt in c["cords"].values()}})
out = {}
for x in components:
    live, thermal, tripped = simulate(x)
    hit = {}
    for cab in cabinets:
        if thermal or not live[cab]:
            hit[cab] = "down"
        elif len(live[cab]) < len(base[cab]):
            hit[cab] = "exposed"
    out[x] = {"hit": hit, "thermal": thermal, "tripped": sorted(tripped)}
json.dump({"runs": out, "cords": {f"{k}/{s}": v for k, c in cabinets.items() for s, v in c["cords"].items()}},
          open(Path(__file__).parent / "oracle.json", "w"), indent=1)
print(f"oracle: {len(components)} components, {len(cabinets)} cabinets, heat {sum(c['kw'] for c in cabinets.values()):.1f} kW")
