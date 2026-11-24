/**
 * «Consumo per topic» of the Activity page (clodia-platform#732). Pure, in
 * `.js` so the guard script can execute it.
 */

/** @typedef {{ runs: number, seconds: number, tokens_in: number, tokens_out: number }} Bucket */
/** @typedef {{ tier: string, name: string, title?: string, windows: Record<string, Bucket> }} TopicUsage */

/**
 * The rows of one window, sorted by the chosen measure (time, or tokens in +
 * out), topics without activity in that window left out.
 * @param {TopicUsage[]} topics
 * @param {string} win     `24h` | `7d` | `4w`
 * @param {'tempo' | 'token'} measure
 */
export function usageRows(topics, win, measure) {
	const val = (/** @type {Bucket} */ b) => (measure === 'tempo' ? b.seconds : b.tokens_in + b.tokens_out);
	return (topics || [])
		.map((t) => ({ ...t, b: (t.windows || {})[win] }))
		.filter((t) => t.b && t.b.runs > 0)
		.map((t) => ({ tier: t.tier, name: t.name, title: t.title || '', b: t.b, value: val(t.b) }))
		.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}

/** `5400` → `1h 30m`; `95` → `1m 35s`; `40` → `40s`.
 * @param {number} s */
export function fmtDuration(s) {
	const n = Math.max(0, Math.round(s || 0));
	const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), sec = n % 60;
	if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
	if (m) return `${m}m ${String(sec).padStart(2, '0')}s`;
	return `${sec}s`;
}
