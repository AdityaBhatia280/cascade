export const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** `cabinet:D06` → `D06`. */
export const tagOf = (id: string) => id.slice(id.indexOf(":") + 1);

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Site-local wall clock ("2026-11-10T14:00", no zone) → "Tue". */
export const dayOf = (t: string) => DAYS[new Date(`${t.slice(0, 10)}T00:00:00Z`).getUTCDay()]!;
/** → "14:00". */
export const hm = (t: string) => t.slice(11, 16);
/** → "Tue 14:00". */
export const when = (t: string) => `${dayOf(t)} ${hm(t)}`;
/** → "Tue 14:00–18:00". */
export const span = (start: string, finish: string | null) => `${when(start)}${finish ? `–${hm(finish)}` : ""}`;

/** Site-local "YYYY-MM-DDTHH:mm" for a browser Date (the server's clock runs at the site). */
export function localStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);
