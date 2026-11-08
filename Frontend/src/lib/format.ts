export const usd = (n: number, digits = 0) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
export const pct = (n: number, digits = 0) => `${(n * 100).toFixed(digits)}%`;
export const time = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
export const dateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
export const sentence = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : s);
