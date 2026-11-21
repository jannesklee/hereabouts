/** "Just now", "5 min ago", "2h ago" for a Unix timestamp in seconds. */
export function formatLastSeen(ts: number | null): string {
  if (ts === null) return 'No position';
  const age = Math.floor(Date.now() / 1000) - ts;
  if (age < 60) return 'Just now';
  if (age < 3600) return `${Math.floor(age / 60)} min ago`;
  return `${Math.floor(age / 3600)}h ago`;
}
