"""Offline validation of Cascade's anomaly detector on REAL meter data (Building Data Genome 2, Fox site,
10 office buildings, hourly chilled water 2016-2017). Same rules as server/telemetry.ts: EWMA baseline,
|z|>3 for 3 consecutive samples, plus flatline = sensor fault (maintenance, not incident)."""
import pandas as pd, numpy as np, json
d = pd.read_csv("/home/claude/seance-data/out/hourly.csv", parse_dates=["timestamp"])
out = {"source": "Building Data Genome Project 2 (Miller et al., Scientific Data 2020), site Fox, chilled water kWh, hourly", "buildings": []}
for b, g in d.groupby("building_id"):
    x = g.sort_values("timestamp")[["timestamp", "chw_kwh"]].dropna().reset_index(drop=True)
    # hour-of-week seasonal baseline (real buildings have daily/weekly cycles), then EWMA on the residual
    x["how"] = x.timestamp.dt.dayofweek * 24 + x.timestamp.dt.hour
    x["resid"] = x.chw_kwh - x.groupby("how").chw_kwh.transform("median")
    mean, var, streak, alerts, faults, last = 0.0, 1.0, 0, [], [], []
    for i, r in x.iterrows():
        v = r.resid; sd = max(var, 1e-6) ** 0.5; z = (v - mean) / sd
        last = (last + [r.chw_kwh])[-6:]
        if len(last) == 6 and len(set(last)) == 1 and r.chw_kwh > 0:
            if not faults or (r.timestamp - pd.Timestamp(faults[-1]["start"])).total_seconds() > 86400:
                faults.append({"start": str(r.timestamp), "value": r.chw_kwh})
            continue
        streak = streak + 1 if (abs(z) > 3 and i > 48) else 0
        if streak == 3:   # sustained drift only: single-hour blips are ignored by design (anti-flapping)
            alerts.append({"ts": str(r.timestamp), "kwh": round(r.chw_kwh, 1), "z": round(z, 1), "rule": "spike" if streak != 3 else "sustained"})
        else:
            mean = 0.05 * v + 0.95 * mean; var = 0.05 * (v - mean) ** 2 + 0.95 * var
    out["buildings"].append({"building": b.replace("Fox_office_", ""), "hours": len(x), "alerts": len(alerts), "sensor_faults": len(faults),
                             "alert_rate_per_month": round(len(alerts) / (len(x) / 730), 2), "first_alerts": alerts[:3], "faults": faults[:3],
                             "caught_labor_day_2017": any(a["ts"].startswith("2017-09-04") or a["ts"].startswith("2017-09-05") for a in alerts)})
json.dump(out, open("seed/real/bdg2_detector_validation.json", "w"), indent=1)
for r in out["buildings"]: print(r["building"], r["hours"], "alerts", r["alerts"], "per_mo", r["alert_rate_per_month"], "faults", r["sensor_faults"], "laborday", r["caught_labor_day_2017"])
