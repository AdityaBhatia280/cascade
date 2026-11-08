"""Diff the engine's single-failure answers against the oracle's."""
import json, re
from pathlib import Path

H = Path(__file__).parent
e, o = json.load(open(H / "engine.json")), json.load(open(H / "oracle.json"))


def key(engine_key: str) -> str:  # "breaker:PDU-3A-SF-1" -> "PDU-3A-SF-1"; "crah:CRAH-1" -> "CRAH-1"
    return engine_key.split(":", 1)[1]


eng = {key(k): v for k, v in e["runs"].items()}
orc = {k: v["hit"] for k, v in o["runs"].items()}
only_engine = sorted(set(eng) - set(orc))
only_oracle = sorted(set(orc) - set(eng))
agree, disagree = 0, []
for x in sorted(set(eng) & set(orc)):
    if eng[x] == orc[x]:
        agree += 1
    else:
        diff = {c: (eng[x].get(c, "up"), orc[x].get(c, "up")) for c in sorted(set(eng[x]) | set(orc[x])) if eng[x].get(c) != orc[x].get(c)}
        disagree.append((x, diff, o["runs"][x]))
cord_diff = {c: (e["cords"].get(c), o["cords"][c]) for c in o["cords"] if (e["cords"].get(c) or [None])[0] != o["cords"][c]}

print(f"compared {agree + len(disagree)} components: {agree} agree, {len(disagree)} disagree")
print(f"cord landings that differ: {cord_diff or 'none'}")
print(f"in oracle, absent from engine graph: {only_oracle}")
print(f"in engine, absent from oracle: {only_engine}")
for x, diff, run in disagree:
    sample = dict(list(diff.items())[:6])
    print(f"\n{x}: {len(diff)} cabinets differ (engine, oracle) {sample}  oracle thermal={run['thermal']} tripped={run['tripped']}")
