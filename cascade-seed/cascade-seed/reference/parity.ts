// Runs the TypeScript port against every golden case captured from GnuCOBOL.
// node --experimental-strip-types reference/parity.ts
import { readFileSync } from "node:fs";
import { invoiceLine, parseLine } from "./leasebil.ts";

const g = JSON.parse(readFileSync(new URL("../golden/parity_cases.json", import.meta.url), "utf8"));
let pass = 0;
for (const c of g.cases) {
  const got = invoiceLine(parseLine(c.input_line), c.cool_flag);
  const ok = got === c.expected_output_line;
  if (ok) pass++;
  else console.log(`FAIL ${c.id} ${c.note}\n  expected: [${c.expected_output_line}]\n  got:      [${got}]`);
}
console.log(`parity: ${pass}/${g.cases.length} cases match GnuCOBOL byte for byte`);
process.exit(pass === g.cases.length ? 0 : 1);
