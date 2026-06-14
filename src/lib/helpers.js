// KALA — pure helper functions (no UI, easy to test)

export const WEEKS_PER_YEAR = 52;

export function weeksBetween(d1, d2) {
  return Math.floor((d2 - d1) / (1000 * 60 * 60 * 24 * 7));
}

export function fmt(n) {
  return n.toLocaleString("en-US");
}

// ISO-ish week key, e.g. "2026-W24"
export function currentWeekKey() {
  const d = new Date();
  const start = new Date(d.getFullYear(), 0, 1);
  const wk = Math.ceil(((d - start) / 86400000 + start.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(wk).padStart(2, "0")}`;
}
