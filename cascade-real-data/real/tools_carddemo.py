"""Real-code dependency extraction over AWS CardDemo (Apache 2.0). Every edge cites file:line."""
import json, os, re, glob, collections
ROOT = "/home/claude/carddemo/app"
edges, nodes = [], {}
def node(i, t): nodes.setdefault(i, {"id": i, "type": t})
def add(f, t, kind, path, ln, text):
    edges.append({"from": f, "to": t, "kind": kind, "file": os.path.relpath(path, ROOT), "line": ln, "snippet": text.strip()[:120]})
cobol = sorted(glob.glob(f"{ROOT}/cbl/*.cbl") + glob.glob(f"{ROOT}/cbl/*.CBL"))
for p in cobol:
    prog = os.path.basename(p).split(".")[0].upper(); node(prog, "program")
    for i, l in enumerate(open(p, errors="ignore"), 1):
        if len(l) > 6 and l[6] in "*/": continue
        if m := re.search(r"\bCOPY\s+([A-Z0-9-]+)", l): node(m[1], "copybook"); add(prog, m[1], "copies", p, i, l)
        if m := re.search(r"SELECT\s+([A-Z0-9-]+)\s+ASSIGN\s+TO\s+([A-Z0-9-]+)", l): node("DD:" + m[2], "dataset"); add(prog, "DD:" + m[2], "file", p, i, l)
        if m := re.search(r"CALL\s+'([A-Z0-9]+)'", l): node(m[1], "program"); add(prog, m[1], "calls", p, i, l)
        if m := re.search(r"XCTL\s+PROGRAM\s*\(\s*'?([A-Z0-9-]+)", l): add(prog, m[1], "xctl", p, i, l)
        if m := re.search(r"(?:DATASET|FILE)\s*\(\s*'?([A-Z0-9-]+)", l): node("CICS:" + m[1], "cics_file"); add(prog, "CICS:" + m[1], "cics_io", p, i, l)
for p in sorted(glob.glob(f"{ROOT}/jcl/*")):
    job = os.path.basename(p).split(".")[0].upper(); node("JOB:" + job, "job")
    step_pgm = None; cur_dd = None
    for i, l in enumerate(open(p, errors="ignore"), 1):
        if l.startswith("//*"): continue
        if m := re.search(r"EXEC\s+PGM=([A-Z0-9]+)", l): step_pgm = m[1]; node(m[1], "program"); add("JOB:" + job, m[1], "runs", p, i, l)
        if m := re.match(r"^//([A-Z0-9#@$]+)\s+DD\b", l): cur_dd = m[1]
        if m := re.search(r"DSN=([A-Z0-9.&#@$-]+)", l):
            ds = m[1].replace("&&", "TEMP."); node("DSN:" + ds, "dataset_physical"); add("JOB:" + job, "DSN:" + ds, "dd:" + (cur_dd or "?"), p, i, l)
            if step_pgm and cur_dd: add("DD:" + cur_dd, "DSN:" + ds, "maps_to", p, i, l)
# shared datasets: written/read by multiple jobs = hidden coupling
by_ds = collections.defaultdict(set)
for e in edges:
    if e["kind"].startswith("dd:"): by_ds[e["to"]].add(e["from"])
shared = sorted(((ds, sorted(j)) for ds, j in by_ds.items() if len(j) > 2), key=lambda x: -len(x[1]))
by_cpy = collections.defaultdict(set)
for e in edges:
    if e["kind"] == "copies": by_cpy[e["to"]].add(e["from"])
hot_cpy = sorted(((c, sorted(p)) for c, p in by_cpy.items()), key=lambda x: -len(x[1]))[:10]
loc = sum(1 for p in cobol for _ in open(p, errors="ignore"))
out = {"source": "AWS CardDemo (github.com/aws-samples/aws-mainframe-modernization-carddemo), Apache-2.0",
       "stats": {"cobol_programs": len(cobol), "cobol_lines": loc, "copybooks": len(glob.glob(f"{ROOT}/cpy/*")), "jcl_jobs": len(glob.glob(f"{ROOT}/jcl/*")),
                 "nodes": len(nodes), "edges": len(edges), "by_kind": dict(collections.Counter(e["kind"].split(":")[0] for e in edges))},
       "most_shared_copybooks": [{"copybook": c, "used_by": p, "blast_radius": len(p)} for c, p in hot_cpy],
       "datasets_touched_by_many_jobs": [{"dataset": d, "jobs": j} for d, j in shared[:10]],
       "nodes": list(nodes.values()), "edges": edges}
json.dump(out, open("/home/claude/cascade/seed/real/carddemo_graph.json", "w"), indent=1)
print(json.dumps(out["stats"], indent=1)); print([ (x["copybook"], x["blast_radius"]) for x in out["most_shared_copybooks"]]); print([(x["dataset"], len(x["jobs"])) for x in out["datasets_touched_by_many_jobs"][:6]])
