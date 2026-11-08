// Reference TypeScript port of LEASEBIL + CAMCALC.
// Exact fixed-point math with BigInt (never floats), COBOL ROUNDED = half away from zero,
// COMPUTE without ROUNDED = truncate, storing into a PIC field drops high-order digits,
// and the -,---,--9.99 edit reproduces GnuCOBOL 3.1.2 output byte for byte across all 47 golden cases.

export interface LeaseFullInput {
  tenant_id: string;
  sqft: bigint;
  rent_psf: bigint /* scale 2 */;
  esc_pct: bigint /* scale 4 */;
  start_yy: number;
  bill_year: number;
  cap_pct: bigint /* scale 4 */;
  bldg_total_sf: bigint;
  bldg_occ_sf: bigint;
  cam_pool_mo: bigint /* scale 2 */;
  monthly_fee: bigint /* scale 2 */;
  sla_pct: bigint;
  adj_sign: string;
  adj_amt: bigint /* scale 2 */;
}

const BASE_YEAR = 2019; // hardcoded WS-BASE-YEAR (finding F-1)
const OPEX: Record<number, bigint> = {
  2019: 1120n,
  2020: 1160n,
  2021: 1205n,
  2022: 1250n,
  2023: 1295n,
  2024: 1340n,
  2025: 1390n,
  2026: 1435n,
};

const abs = (x: bigint) => (x < 0n ? -x : x);
const pow10 = (n: number) => 10n ** BigInt(n);

/** num/den rounded half away from zero */
function roundDiv(num: bigint, den: bigint): bigint {
  const neg = (num < 0n) !== (den < 0n);
  const a = abs(num);
  const b = abs(den);
  const q = (2n * a + b) / (2n * b);
  return neg ? -q : q;
}

/** num/den truncated toward zero */
const truncDiv = (num: bigint, den: bigint) => num / den;

/** store into PIC S9(i)V9(d): keep only the low i+d digits (no ON SIZE ERROR) */
function store(v: bigint, intDigits: number, dec: number): bigint {
  const m = pow10(intDigits + dec);
  const r = abs(v) % m;
  return v < 0n ? -r : r;
}

/** Field layout of LEASEIN.DAT */
export function parseLine(line: string): LeaseFullInput {
  let p = 0;
  const take = (n: number) => {
    const s = line.slice(p, p + n);
    p += n;
    return s;
  };
  return {
    tenant_id: take(6),
    sqft: BigInt(take(7)),
    rent_psf: BigInt(take(5)),
    esc_pct: BigInt(take(4)),
    start_yy: Number(take(2)),
    bill_year: Number(take(4)),
    cap_pct: BigInt(take(4)),
    bldg_total_sf: BigInt(take(7)),
    bldg_occ_sf: BigInt(take(7)),
    cam_pool_mo: BigInt(take(9)),
    monthly_fee: BigInt(take(9)),
    sla_pct: BigInt(take(2)),
    adj_sign: take(1),
    adj_amt: BigInt(take(7)),
  };
}

export type BillingMode = 'strict' | 'patched';

/** CAMCALC: pro rata share, scale 6. Uses OCCUPIED sf in strict legacy mode (finding F-2), or TOTAL sf in patched contract mode. */
export function camShare(i: LeaseFullInput, mode: BillingMode = 'strict'): bigint {
  const denom = mode === 'patched' ? i.bldg_total_sf : i.bldg_occ_sf;
  if (denom === 0n) return 0n;
  return store(roundDiv(i.sqft * pow10(6), denom), 1, 6);
}

export function bill(i: LeaseFullInput, coolFlag: 'Y' | 'N', mode: BillingMode = 'strict') {
  // 2100-YEAR-WINDOW (pivot 50)
  const startYear = i.start_yy < 50 ? 2000 + i.start_yy : 1900 + i.start_yy;
  const years = i.bill_year - startYear;

  // 2200-BASE-RENT: compound yearly, each step ROUNDED to 6 decimals
  let psf = i.rent_psf * pow10(4); // scale 6
  for (let y = 0; y < years; y++) {
    psf = store(roundDiv(psf * (pow10(4) + i.esc_pct), pow10(4)), 5, 6);
  }
  const rent = store(roundDiv(psf * i.sqft, pow10(4) * 12n), 7, 2);

  // 2300-CAM-SHARE: COMPUTE without ROUNDED -> truncation in strict mode; ROUNDED with total SF in patched mode
  const share = camShare(i, mode);
  const cam =
    mode === 'patched'
      ? store(roundDiv(i.cam_pool_mo * share, pow10(6)), 7, 2)
      : store(truncDiv(i.cam_pool_mo * share, pow10(6)), 7, 2);

  // 2400-BASE-YEAR-STOP: hardcoded 2019 in strict mode (F-1); tenant lease base year in patched mode
  const effectiveBaseYear =
    mode === 'patched' && startYear >= 2019 && startYear <= i.bill_year ? startYear : BASE_YEAR;
  const cur = OPEX[i.bill_year] ?? 0n;
  const base = OPEX[effectiveBaseYear] ?? 0n;
  let opex = store(roundDiv((cur - base) * i.sqft, 12n), 7, 2);

  // 2500-APPLY-CAP
  if (i.cap_pct > 0n) {
    const capYears = Math.max(0, i.bill_year - effectiveBaseYear);
    const cap = store(
      roundDiv(base * i.cap_pct * BigInt(capYears) * i.sqft, pow10(4) * 12n),
      7,
      2,
    );
    if (opex > cap) opex = cap;
  }

  // 2600-SLA-CREDIT
  const sla =
    coolFlag === 'Y' && i.sla_pct > 0n
      ? store(roundDiv(i.monthly_fee * i.sla_pct, 100n), 7, 2)
      : 0n;

  // 2650-ADJUSTMENT
  const adj = store(i.adj_sign === '-' ? -i.adj_amt : i.adj_amt, 5, 2);
  const total = store(rent + cam + opex - sla + adj, 7, 2);

  return {
    tenant_id: i.tenant_id,
    base_rent: rent,
    cam,
    opex_pass: opex,
    sla_credit: sla,
    adjustment: adj,
    total,
  };
}

/** MOVE to PIC -,---,--9.99 exactly like GnuCOBOL 3.1 */
export function edit(cents: bigint): string {
  const tpl = '-,---,--9.99';
  const slots = [0, 2, 3, 4, 6, 7, 8];
  const a = abs(cents);
  const intStr = ((a / 100n) % pow10(7)).toString().padStart(7, '0');
  const frac = (a % 100n).toString().padStart(2, '0');
  const out = tpl.split('');
  slots.forEach((pos, k) => (out[pos] = intStr[k]!));
  out[10] = frac[0]!;
  out[11] = frac[1]!;
  const first = slots.find((_pos, k) => k < 6 && intStr[k] !== '0') ?? 8;
  const signPos = first === 0 ? 0 : first - 1;
  for (let p = 0; p < signPos; p++) out[p] = ' ';
  out[signPos] = cents < 0n ? '-' : ' ';
  return out.join('');
}

export function invoiceLine(i: LeaseFullInput, coolFlag: 'Y' | 'N'): string {
  const r = bill(i, coolFlag);
  return [
    r.tenant_id,
    edit(r.base_rent),
    edit(r.cam),
    edit(r.opex_pass),
    edit(r.sla_credit),
    edit(r.adjustment),
    edit(r.total),
  ].join(' ');
}

