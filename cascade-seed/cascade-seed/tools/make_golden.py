"""Builds the golden parity table by running the REAL GnuCOBOL-compiled LEASEBIL.

Usage (needs GnuCOBOL: `apt install gnucobol` or Docker):
    python tools/make_golden.py
Writes golden/parity_cases.json and golden/parity_cases.csv.
Every expected_output below came out of the compiled COBOL, not from Python math.
"""
import csv
import json
import os
import random
import subprocess
import tempfile
from decimal import Decimal

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
LEG = os.path.join(ROOT, "legacy")
OUT = os.path.join(ROOT, "golden")

# fixed-width layout of LEASEIN.DAT (matches FD LEASE-IN in LEASEBIL.cbl)
LAYOUT = [  # name, kind, int digits, dec digits
    ("tenant_id", "x", 6, 0), ("sqft", "9", 7, 0), ("rent_psf", "9", 3, 2), ("esc_pct", "9", 0, 4),
    ("start_yy", "9", 2, 0), ("bill_year", "9", 4, 0), ("cap_pct", "9", 0, 4),
    ("bldg_total_sf", "9", 7, 0), ("bldg_occ_sf", "9", 7, 0), ("cam_pool_mo", "9", 7, 2),
    ("monthly_fee", "9", 7, 2), ("sla_pct", "9", 2, 0), ("adj_sign", "x", 1, 0), ("adj_amt", "9", 5, 2),
]


def to_line(c):
    s = ""
    for name, kind, i, d in LAYOUT:
        v = c[name]
        if kind == "x":
            s += str(v).ljust(i)[:i]
        else:
            n = int((Decimal(str(v)) * (10 ** d)).to_integral_value())
            s += str(n).zfill(i + d)[-(i + d):]
    return s


def run_cobol(cases, cool_flag):
    exe = os.path.join(tempfile.mkdtemp(), "leasebil")
    subprocess.run(["cobc", "-x", "-I", LEG, "-o", exe, os.path.join(LEG, "LEASEBIL.cbl"),
                    os.path.join(LEG, "CAMCALC.cbl")], check=True, capture_output=True)
    wd = tempfile.mkdtemp()
    with open(os.path.join(wd, "LEASEIN.DAT"), "w") as f:
        f.write("\n".join(to_line(c) for c in cases) + "\n")
    with open(os.path.join(wd, "COOLFLAG.DAT"), "w") as f:
        f.write(cool_flag + "\n")
    subprocess.run([exe], cwd=wd, check=True)
    return open(os.path.join(wd, "INVOICE.DAT")).read().rstrip("\n").split("\n")


def base(**kw):
    c = dict(tenant_id="XX0000", sqft=10000, rent_psf=30.00, esc_pct=0.03, start_yy=19, bill_year=2024, cap_pct=0,
             bldg_total_sf=120000, bldg_occ_sf=104000, cam_pool_mo=48000.00, monthly_fee=0, sla_pct=0,
             adj_sign="+", adj_amt=0)
    c.update(kw)
    return c


random.seed(42)
cases = []
def add(cid, note, cool="N", **kw):
    cases.append({"id": cid, "note": note, "cool_flag": cool, "input": base(**kw)})

# --- the six real tenants (as billed today) ---
add("T01", "Northwind Retail: lease amendment says base year 2021, code uses 2019 (the $6,970/yr finding)",
    tenant_id="NW0101", sqft=8200, rent_psf=32.00, start_yy=19)
add("T02", "Acme Cloud data center, normal month", tenant_id="AC0200", sqft=24000, rent_psf=48.50, esc_pct=0.025,
    start_yy=16, monthly_fee=185000.00, sla_pct=10)
add("T03", "Acme Cloud data center, COOLFLAG=Y so the SLA credit applies", cool="Y", tenant_id="AC0200", sqft=24000,
    rent_psf=48.50, esc_pct=0.025, start_yy=16, monthly_fee=185000.00, sla_pct=10)
add("T04", "Kessler & Vance LLP, cap binds", tenant_id="KV0310", sqft=14500, rent_psf=36.25, esc_pct=0.03,
    start_yy=18, cap_pct=0.0300)
add("T05", "Saguaro Family Clinic", tenant_id="SG0320", sqft=9800, rent_psf=29.75, esc_pct=0.0275, start_yy=20)
add("T06", "Ledgerline Fintech, negative adjustment (move-in credit)", tenant_id="LL0400", sqft=21000, rent_psf=38.00,
    esc_pct=0.03, start_yy=21, adj_sign="-", adj_amt=12500.00)
add("T07", "Copper Bean Coffee, small retail", tenant_id="CB0105", sqft=1450, rent_psf=41.00, esc_pct=0.035, start_yy=22)

# --- edge cases ---
add("E01", "two-digit year 98 -> 1998 (26 years of escalation)", tenant_id="ED0001", start_yy=98, bill_year=2024)
add("E02", "two-digit year 49 -> 2049, bill year before start (no escalation)", tenant_id="ED0002", start_yy=49)
add("E03", "two-digit year 50 -> 1950 (pivot boundary)", tenant_id="ED0003", start_yy=50, esc_pct=0.01)
add("E04", "zero square feet", tenant_id="ED0004", sqft=0)
add("E05", "zero occupied SF (CAMCALC divide guard)", tenant_id="ED0005", bldg_occ_sf=0)
add("E06", "bill year 2019 = base year, zero opex pass-through", tenant_id="ED0006", bill_year=2019)
add("E07", "bill year 2026, last row in OPEX table", tenant_id="ED0007", bill_year=2026)
add("E08", "bill year 2027 not in OPEX table -> current opex 0, negative pass-through", tenant_id="ED0008",
    bill_year=2027)
add("E09", "bill year 2018 not in table and before base", tenant_id="ED0009", bill_year=2018, start_yy=15)
add("E10", "negative adjustment bigger than rent", tenant_id="ED0010", sqft=500, adj_sign="-", adj_amt=99999.99)
add("E11", "positive adjustment", tenant_id="ED0011", adj_sign="+", adj_amt=1234.56)
add("E12", "overflow: monthly rent exceeds PIC S9(7)V99, no ON SIZE ERROR", tenant_id="ED0012", sqft=9999999,
    rent_psf=999.99, esc_pct=0.05, start_yy=10)
add("E13", "SLA credit at max 99 pct with COOLFLAG=Y", cool="Y", tenant_id="ED0013", monthly_fee=9999999.99, sla_pct=99)
add("E14", "SLA pct set but COOLFLAG=N, no credit", tenant_id="ED0014", monthly_fee=50000, sla_pct=30)
add("E15", "cap set with bill year = base year (cap amount 0 clamps pass-through)", tenant_id="ED0015",
    bill_year=2019, cap_pct=0.05)
add("E16", "occupied SF greater than total (data error)", tenant_id="ED0016", bldg_occ_sf=130000)
add("E17", "tenant SF equals occupied SF (share = 1.000000)", tenant_id="ED0017", sqft=104000)
add("E18", "max escalation 9.99 pct over 30 years", tenant_id="ED0018", esc_pct=0.0999, start_yy=94)

# --- rounding boundaries: rent*sqft/12 lands exactly on a half cent ---
r = 0
for psf, sqft in [(0.06, 1), (1.26, 1), (12.18, 5), (25.02, 3), (7.86, 7), (100.02, 9)]:
    r += 1
    add(f"R{r:02d}", f"half-cent boundary on base rent: {psf} x {sqft} / 12", tenant_id=f"RB{r:04d}", sqft=sqft,
        rent_psf=psf, esc_pct=0, start_yy=24, cam_pool_mo=0)
# CAM truncation (COMPUTE without ROUNDED): pool * share has a third decimal
for i, (pool, sqft, occ) in enumerate([(1000.00, 1, 3), (99999.99, 7, 11), (12345.67, 333, 1000), (5.55, 1, 2)], 1):
    add(f"C{i:02d}", f"CAM truncation: {pool} x {sqft}/{occ}", tenant_id=f"CT{i:04d}", sqft=sqft, bldg_occ_sf=occ,
        cam_pool_mo=pool, rent_psf=0, esc_pct=0)
# random fuzz
for i in range(1, 13):
    add(f"F{i:02d}", "random", tenant_id=f"FZ{i:04d}", sqft=random.randint(200, 60000),
        rent_psf=round(random.uniform(8, 120), 2), esc_pct=round(random.choice([0, .015, .02, .025, .03, .0325, .04]), 4),
        start_yy=random.choice([95, 99, 5, 12, 18, 21, 23]), bill_year=random.choice([2021, 2022, 2023, 2024, 2025]),
        cap_pct=random.choice([0, 0, .03, .05]), bldg_occ_sf=random.randint(80000, 120000),
        cam_pool_mo=round(random.uniform(10000, 90000), 2), adj_sign=random.choice("+-"),
        adj_amt=round(random.uniform(0, 3000), 2), cool=random.choice("NY"),
        monthly_fee=random.choice([0, 25000, 140000.50]), sla_pct=random.choice([0, 5, 15, 30]))

FIELDS = ["tenant_id", "base_rent", "cam", "opex_pass", "sla_credit", "adjustment", "total"]
results = {}
for flag in ("N", "Y"):
    group = [c for c in cases if c["cool_flag"] == flag]
    for c, line in zip(group, run_cobol([c["input"] for c in group], flag)):
        results[c["id"]] = line
for c in cases:
    line = results[c["id"]]
    c["input_line"] = to_line(c["input"])
    c["expected_output_line"] = line
    parts = [line[0:6]] + [line[7 + 13 * k: 7 + 13 * k + 12] for k in range(6)]
    c["expected"] = dict(zip(FIELDS, [p.strip() for p in parts]))

os.makedirs(OUT, exist_ok=True)
json.dump({"generated_by": "GnuCOBOL " + subprocess.run(["cobc", "--version"], capture_output=True, text=True).stdout.split("\n")[0],
           "layout": [{"field": n, "pic": ("X" if k == "x" else "9") + f"({i})" + (f"V9({d})" if d else "")} for n, k, i, d in LAYOUT],
           "output_format": "tenant(6) then 6 fields of PIC -,---,--9.99 separated by one space",
           "cases": cases}, open(os.path.join(OUT, "parity_cases.json"), "w"), indent=1)
with open(os.path.join(OUT, "parity_cases.csv"), "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["id", "note", "cool_flag", "input_line", "expected_output_line"] + FIELDS)
    for c in cases:
        w.writerow([c["id"], c["note"], c["cool_flag"], c["input_line"], c["expected_output_line"]] + [c["expected"][k] for k in FIELDS])
print(len(cases), "cases")
for c in cases[:8] + [x for x in cases if x["id"] in ("E12", "R01", "R02", "C01", "C04", "E10")]:
    print(c["id"], "|", c["expected_output_line"])
