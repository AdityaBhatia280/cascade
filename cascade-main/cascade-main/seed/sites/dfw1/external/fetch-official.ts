// Re-downloads the official datasets DFW1's simulation is driven by. Run from the repo root:
//   npx tsx seed/sites/dfw1/external/fetch-official.ts
// NOAA needs no key. ERCOT needs PRIMARY_KEY, ERCOT_USERNAME and ERCOT_PASSWORD in .env.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
process.loadEnvFile(join(here, '../../../../.env'));

const FROM = '2026-06-01';
const TO = '2026-11-07';

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let quoted = false;
  for (const ch of line.replace(/\r$/, '')) {
    if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) { cells.push(cur); cur = ''; }
    else cur += ch;
  }
  cells.push(cur);
  return cells;
}

async function noaa(): Promise<void> {
  const url = `https://www.ncei.noaa.gov/access/services/data/v1?dataset=local-climatological-data-v2&stations=USW00003927&startDate=${FROM}&endDate=${TO}&format=csv`;
  const text = await (await fetch(url)).text();
  const [head, ...rows] = text.trim().split('\n').map(parseCsvLine);
  const col = (name: string) => head!.indexOf(name);
  const [iDate, iType, iTemp, iDew] = [col('DATE'), col('REPORT_TYPE'), col('HourlyDryBulbTemperature'), col('HourlyDewPointTemperature')];
  const out = [
    '# Source: NOAA NCEI Local Climatological Data v2, station USW00003927 DFW Airport TX, FM-15 METAR hourly, local standard time (LST). Temperatures in degrees C.',
    `# Retrieved ${new Date().toISOString().slice(0, 10)} via ${url}`,
    'timestamp_lst,dry_bulb_c,dew_point_c',
  ];
  for (const r of rows) {
    const t = r[iTemp]?.replace(/s$/, '');
    if (r[iType]?.trim() !== 'FM-15' || !t || Number.isNaN(Number(t))) continue;
    out.push(`${r[iDate]},${Number(t)},${r[iDew]?.replace(/s$/, '') ?? ''}`);
  }
  writeFileSync(join(here, `noaa_kdfw_lcd_${FROM}_${TO}.csv`), out.join('\n') + '\n');
  console.log(`NOAA: ${out.length - 3} hourly observations`);
}

async function ercotToken(): Promise<string> {
  const cid = 'fec253ea-0d06-4272-a5e6-b478baeecd70';
  const q = new URLSearchParams({
    username: process.env['ERCOT_USERNAME'] ?? '', password: process.env['ERCOT_PASSWORD'] ?? '',
    grant_type: 'password', scope: `openid ${cid} offline_access`, client_id: cid, response_type: 'id_token',
  });
  const res = await fetch(`https://ercotb2c.b2clogin.com/ercotb2c.onmicrosoft.com/B2C_1_PUBAPI-ROPC-FLOW/oauth2/v2.0/token?${q}`, { method: 'POST' });
  const body = (await res.json()) as { id_token?: string; error_description?: string };
  if (!body.id_token) throw new Error(`ERCOT sign-in failed: ${body.error_description ?? res.status}`);
  return body.id_token;
}

async function ercot(): Promise<void> {
  const token = await ercotToken();
  const headers = { 'Ocp-Apim-Subscription-Key': process.env['PRIMARY_KEY'] ?? '', Authorization: `Bearer ${token}` };
  const base = 'https://api.ercot.com/api/public-reports/np6-345-cd/act_sys_load_by_wzn';
  const out = [
    '# Source: ERCOT Public API, report NP6-345-CD "Actual System Load by Weather Zone", hourly MW, hour ending Central Prevailing Time. Dallas is in the North Central (northC) zone.',
    `# Retrieved ${new Date().toISOString().slice(0, 10)} via ${base}?operatingDayFrom=${FROM}&operatingDayTo=${TO}`,
    'operating_day,hour_ending,north_central_mw,ercot_total_mw,dst_flag',
  ];
  for (let page = 1; ; page++) {
    const url = `${base}?operatingDayFrom=${FROM}&operatingDayTo=${TO}&size=1000&page=${page}&sort=operatingDay&dir=asc`;
    const body = (await (await fetch(url, { headers })).json()) as { fields: { name: string }[]; data: unknown[][]; _meta?: { totalPages?: number } };
    const idx = (n: string) => body.fields.findIndex((f) => f.name === n);
    const [d, h, nc, tot, dst] = ['operatingDay', 'hourEnding', 'northC', 'total', 'DSTFlag'].map(idx);
    for (const r of body.data) out.push([r[d!], r[h!], r[nc!], r[tot!], r[dst!]].join(','));
    if (!body._meta?.totalPages || page >= body._meta.totalPages) break;
  }
  writeFileSync(join(here, `ercot_np6-345-cd_${FROM}_${TO}.csv`), out.join('\n') + '\n');
  console.log(`ERCOT: ${out.length - 3} hourly rows`);
}

void noaa().then(ercot);
