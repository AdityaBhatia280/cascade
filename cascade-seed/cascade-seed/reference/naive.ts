// What a typical "just translate it" port looks like: floats + toFixed rounding.
// Kept on purpose to show the parity check catching it. Do NOT ship this one.
import { readFileSync } from "node:fs";
const g = JSON.parse(readFileSync(new URL("../golden/parity_cases.json", import.meta.url), "utf8"));
const OPEX: Record<number, number> = { 2019: 11.2, 2020: 11.6, 2021: 12.05, 2022: 12.5, 2023: 12.95, 2024: 13.4, 2025: 13.9, 2026: 14.35 };
const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(12);
let pass = 0, fails: string[] = [];
for (const c of g.cases) {
  const i = c.input, start = i.start_yy < 50 ? 2000 + i.start_yy : 1900 + i.start_yy;
  const psf = i.rent_psf * Math.pow(1 + i.esc_pct, Math.max(0, i.bill_year - start));
  const rent = +(psf * i.sqft / 12).toFixed(2);
  const cam = i.bldg_occ_sf ? +(i.cam_pool_mo * i.sqft / i.bldg_occ_sf).toFixed(2) : 0;
  let opex = +(((OPEX[i.bill_year] ?? 0) - OPEX[2019]) * i.sqft / 12).toFixed(2);
  if (i.cap_pct > 0) opex = Math.min(opex, +(OPEX[2019] * i.cap_pct * (i.bill_year - 2019) * i.sqft / 12).toFixed(2));
  const sla = c.cool_flag === "Y" && i.sla_pct > 0 ? +(i.monthly_fee * i.sla_pct / 100).toFixed(2) : 0;
  const adj = i.adj_sign === "-" ? -i.adj_amt : i.adj_amt;
  const line = [i.tenant_id, fmt(rent), fmt(cam), fmt(opex), fmt(sla), fmt(adj), fmt(rent + cam + opex - sla + adj)].join(" ");
  if (line === c.expected_output_line) pass++; else fails.push(c.id);
}
console.log(`naive float port: ${pass}/${g.cases.length} match. Failing: ${fails.join(", ")}`);
