// The supply chain of one entity: feeders to the left, what it feeds to the right, out to the customers
// as circles sized by monthly revenue. Coloured by the same looks as the floor.

import type { PatchOpDto } from "@cascade/core/contract";
import type { Look } from "@/lib/floor";
import type { Impact } from "@/lib/impact";
import { directCabinets, downCabinets, labelOf, ownerOf, SELECTABLE, visibleStep, type Site } from "@/lib/site";
import { usd } from "@/lib/format";

const CW = 560;
const CH = 262;
const RED = "#d93a2b";
const AMBER = "#e3940b";
const INK = "#1c2228";
const CALM = "#3a6ea5";

interface Props {
  site: Site;
  center: string;
  looks: ReadonlyMap<string, Look>;
  impact: Impact | null;
  pending: readonly PatchOpDto[];
  onSelect: (id: string) => void;
}

export function Chain({ site, center, looks, impact, pending, onSelect }: Props) {
  const st = (id: string) => looks.get(id);
  const dark = impact?.grade === "red";
  const cy = CH / 2 - 4;
  const kind = (id: string) => site.node.get(id)?.kind;
  const fedFrom = visibleStep(site, [center], -1);

  const up: string[][] = [];
  const P = new Set([center]);
  let lvl = [center];
  for (let i = 0; i < 4; i++) {
    const nx = (i === 0 ? fedFrom : visibleStep(site, lvl, -1)).filter((x) => !P.has(x) && kind(x) !== "cabinet").slice(0, 4);
    if (!nx.length) break;
    up.push(nx);
    nx.forEach((x) => P.add(x));
    lvl = nx;
  }
  const rank = (s: Look | undefined) => (s === "dark" || s === "serviced" ? 0 : s === "backup" ? 1 : 2);
  const dn: string[][] = [];
  lvl = [center];
  for (let i = 0; i < 2; i++) {
    let nx = visibleStep(site, lvl, 1).filter((x) => kind(x) !== "cabinet" && kind(x) !== "hall" && !P.has(x));
    if (!nx.length) break;
    nx.sort((a, b) => rank(st(a)) - rank(st(b)));
    nx = nx.slice(0, 6).sort((a, b) => site.node.get(a)!.pos2[1] - site.node.get(b)!.pos2[1]);
    dn.push(nx);
    nx.forEach((x) => P.add(x));
    lvl = nx;
    if (nx.length > 2) break;
  }
  // A pending re-feed onto this entity shows as a dashed extra child.
  const reFed = pending.flatMap((op) => (op.op === "refeed" ? [{ device: op.device, to: ownerOf(site, op.to) }] : []));
  for (const r of reFed) {
    if (r.to === center && !P.has(r.device)) {
      (dn[0] ??= []).push(r.device);
      P.add(r.device);
    }
  }
  const cabs = kind(center) === "cabinet" ? new Set([center]) : new Set([...downCabinets(site, center), ...reFed.filter((r) => r.to === center).flatMap((r) => [...downCabinets(site, r.device)])]);
  const byCustomer = new Map<string, string[]>();
  for (const c of cabs) {
    const owner = site.node.get(c)?.customer;
    if (owner) byCustomer.set(owner, [...(byCustomer.get(owner) ?? []), c]);
  }
  const custs = site.customerOrder.filter((c) => byCustomer.has(c));

  const custX = CW - 190;
  const cols = up.length + 1 + dn.length;
  const spanX = custX - 60 - 26;
  const stepX = Math.min(110, spanX / Math.max(1, cols - 1));
  const cx = 26 + stepX * up.length + Math.max(0, (spanX - stepX * (cols - 1)) / 2);
  const pos = new Map<string, { x: number; y: number }>([[center, { x: cx, y: cy }]]);
  const place = (ids: string[], x: number) => {
    const gap = Math.min(58, (CH - 46) / Math.max(1, ids.length));
    ids.forEach((id, i) => pos.set(id, { x, y: cy + (i - (ids.length - 1) / 2) * gap }));
  };
  up.forEach((ids, i) => place(ids, cx - stepX * (i + 1)));
  dn.forEach((ids, i) => place(ids, cx + stepX * (i + 1)));
  const cgap = Math.min(54, (CH - 30) / Math.max(1, custs.length));
  custs.forEach((id, i) => pos.set(id, { x: custX, y: CH / 2 + (i - (custs.length - 1) / 2) * cgap }));

  const custState = (c: string): Look | undefined => {
    const ss = byCustomer.get(c)!.map(st);
    return ss.includes("dark") ? "dark" : ss.includes("backup") ? "backup" : undefined;
  };
  const colOf = (s: Look | undefined) => (s === "dark" || (s === "serviced" && dark) ? RED : s === "serviced" || s === "backup" ? AMBER : null);
  const curve = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const mx = (a.x + b.x) / 2;
    return `M${a.x},${a.y}C${mx},${a.y} ${mx},${b.y} ${b.x},${b.y}`;
  };

  const links: { key: string; d: string; color: string | null; delay: number; dashed: boolean }[] = [];
  const link = (a: string, b: string, s: Look | undefined, delay: number, dashed = false) => {
    const pa = pos.get(a);
    const pb = pos.get(b);
    if (pa && pb) links.push({ key: `${a}>${b}`, d: curve(pa, pb), color: dashed ? CALM : colOf(s), delay, dashed });
  };
  const chainIn = [[center], ...up];
  for (let i = 1; i < chainIn.length; i++)
    for (const a of chainIn[i]!)
      for (const b of chainIn[i - 1]!) if (i === 1 ? fedFrom.includes(a) : visibleStep(site, [a], 1).includes(b)) link(a, b, undefined, 0);
  const chainOut = [[center], ...dn];
  for (let i = 1; i < chainOut.length; i++)
    for (const b of chainOut[i]!)
      for (const a of chainOut[i - 1]!) {
        const pf = i === 1 && reFed.some((r) => r.device === b && r.to === center);
        const movedAway = i === 1 && reFed.some((r) => r.device === b && r.to !== a);
        if (pf || (visibleStep(site, [a], 1).includes(b) && !movedAway)) link(a, b, st(b), i * 90, pf);
      }
  const lastCol = chainOut[chainOut.length - 1]!;
  for (const c of custs)
    chainOut.forEach((col, li) => {
      for (const a of col) {
        const reach = col === lastCol || kind(center) === "cabinet" ? (kind(a) === "cabinet" ? [a] : [...downCabinets(site, a)]) : [...directCabinets(site, a)];
        const mine = reach.filter((x) => site.node.get(x)?.customer === c);
        if (mine.length) link(a, c, mine.some((x) => st(x)) ? custState(c) : undefined, (li + 1) * 90);
      }
    });

  const maxRev = Math.max(...[...site.customers.values()].map((c) => c.monthly), 1);
  const node = (id: string, r: number, delay: number) => {
    const p = pos.get(id)!;
    const s = st(id);
    const col = colOf(s);
    const pend = reFed.some((x) => x.device === id);
    return (
      <g
        key={id}
        className={`fi${SELECTABLE.has(kind(id) ?? "") ? " hot" : ""}`}
        style={{ animationDelay: `${delay}ms` }}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(id);
        }}
      >
        <title>{labelOf(site, id)}</title>
        <circle cx={p.x} cy={p.y} r={r} fill="#fff" stroke={s === "serviced" ? INK : pend ? CALM : (col ?? "#c9ced4")} strokeWidth={col || s === "serviced" || pend ? 3 : 1.5} />
        {s === "dark" && <circle cx={p.x} cy={p.y} r={r - 4.5} fill={RED} />}
        <text x={p.x} y={p.y + r + 14} textAnchor="middle" style={{ fontSize: 10.5, fontWeight: s || pend ? 650 : 500, fill: pend ? CALM : s ? INK : "#5a646e" }}>
          {labelOf(site, id)}
        </text>
      </g>
    );
  };
  const serviced = st(center) === "serviced";
  return (
    <svg viewBox={`0 0 ${CW} ${CH}`}>
      <g>
        {links.map((l) => (
          <path
            key={l.key}
            d={l.d}
            fill="none"
            stroke={l.color ?? "#d3d8dd"}
            strokeWidth={l.color ? 2 : 1.2}
            strokeOpacity={l.color ? 0.8 : 1}
            className={l.dashed ? "" : "draw"}
            strokeDasharray={l.dashed ? "4 4" : undefined}
            style={l.dashed ? undefined : { animationDelay: `${l.delay}ms` }}
          />
        ))}
      </g>
      <g>
        <circle cx={cx} cy={cy} r={30} fill="#eceff2" />
        <circle cx={cx} cy={cy} r={15} fill="#fff" stroke={serviced ? (dark ? RED : AMBER) : INK} strokeWidth={4} />
        <circle cx={cx} cy={cy} r={5} fill={INK} />
        <text x={cx} y={cy + 44} textAnchor="middle" style={{ fontSize: 12.5, fontWeight: 700, fill: INK }}>
          {labelOf(site, center)}
        </text>
        {up.flat().map((id) => node(id, 8, 0))}
        {dn.map((ids, i) => ids.map((id) => node(id, 9, i * 90 + 120)))}
        {custs.map((id, i) => {
          const p = pos.get(id)!;
          const c = site.customers.get(id)!;
          const s = custState(id);
          const col = colOf(s);
          const r = 7 + 15 * Math.sqrt(c.monthly / maxRev);
          const risk = impact?.customers.find((x) => x.id === id)?.risk;
          return (
            <g key={id} className="fi" style={{ animationDelay: `${chainOut.length * 90 + 140 + i * 50}ms` }}>
              <title>{`${c.name} ${usd(c.monthly)}`}</title>
              <circle cx={p.x} cy={p.y} r={r} fill={col ? (s === "dark" ? "#fbe4e1" : "#fcefd6") : "#f3f4f6"} stroke={col ?? "#c9ced4"} strokeWidth={col ? 3 : 1.5} />
              <text x={p.x + 30} y={p.y - 2} style={{ fontSize: 12.5, fontWeight: 600, fill: col ? INK : "#5a646e" }}>
                {c.name}
              </text>
              <text x={p.x + 30} y={p.y + 13} style={{ fontSize: 11, fontWeight: 600, fontVariantNumeric: "tabular-nums", fill: col ?? "#9099a3" }}>
                {usd(risk ?? c.monthly)}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
