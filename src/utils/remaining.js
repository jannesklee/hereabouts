/**
 * Time left until something stops, e.g. "2h 5min", "2h" or "15 min".
 * Whole minutes rounded up, so it says "1 min" until the very end.
 *
 * @param {number} seconds Seconds left
 * @return {string|null} null when no time is left
 */
export function formatRemaining(seconds) {
	if (!(seconds > 0)) return null
	const minutes = Math.ceil(seconds / 60)
	const h = Math.floor(minutes / 60)
	const m = minutes % 60
	if (h > 0) return m > 0 ? `${h}h ${m}min` : `${h}h`
	return `${m} min`
}
