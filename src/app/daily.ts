/**
 * The daily challenge: one seed per calendar day, the same for everyone who
 * plays it, so the powerups come in the same order and a score means the same
 * thing on every screen. The day is the player's local one - a challenge that
 * rolled over at midnight UTC would change in the middle of a German evening.
 */

/** `YYYY-MM-DD` in local time. */
export function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** The day before `key`, as a key. */
export function previousDay(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return dayKey(new Date(y ?? 1970, (m ?? 1) - 1, (d ?? 1) - 1));
}

/** FNV-1a over the key: stable across builds and browsers, and never 0. */
export function dailySeed(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0 || 1;
}
