/**
 * Processes beside spawns (clodia-platform#738). A spawn uses an LLM; a
 * process is deterministic — the courier, the topic indexer, the logic jobs
 * such as the backup. Pure, in `.js` so the guard script can execute it.
 */

/** @typedef {{ runs: number, failures: number, seconds: number }} Bucket */
/** @typedef {{ name: string, label: string, source: 'loop' | 'job', status: string,
 *   job_id?: number, enabled: boolean, interval_s?: number, cron?: string,
 *   last_started_at?: string | null, last_duration_s?: number | null, last_ok?: boolean | null,
 *   last_error?: string | null, last_counters?: Record<string, number>,
 *   next_run_at?: string | null, can_run_now: boolean, windows: Record<string, Bucket> }} ProcessRow */

/** @type {Record<string, string>} */
export const PROCESS_STATUS_LABEL = {
	running: 'in esecuzione',
	idle: 'ok',
	failed: 'in errore',
	disabled: 'spento'
};

/** Counters of the last pass, in words. `{delivered: 3}` → `3 consegnate`.
 * @param {Record<string, number> | undefined} c */
export function countersText(c) {
	/** @type {Record<string, string>} */
	const NAMES = { delivered: 'consegnate', items: 'elementi', fetched: 'scaricate', sent: 'spedite', failed: 'fallite' };
	return Object.entries(c || {})
		.map(([k, v]) => `${v} ${NAMES[k] ?? k}`)
		.join(' · ');
}

/** Failed first (they are what needs a look), then running, ok, off; by label.
 * @template {{ status: string, label: string }} T
 * @param {T[]} rows
 * @returns {T[]} */
export function sortProcesses(rows) {
	/** @type {Record<string, number>} */
	const rank = { failed: 0, running: 1, idle: 2, disabled: 3 };
	return [...(rows || [])].sort((a, b) =>
		(rank[a.status] ?? 9) - (rank[b.status] ?? 9) || a.label.localeCompare(b.label));
}

/** `120` → `ogni 2m`; a job → its cron.
 * @param {ProcessRow} p */
export function cadence(p) {
	if (p.source === 'job') return p.cron ? `cron ${p.cron}` : '—';
	const s = p.interval_s || 0;
	if (!s) return '—';
	if (s % 3600 === 0) return `ogni ${s / 3600}h`;
	if (s % 60 === 0) return `ogni ${s / 60}m`;
	return `ogni ${s}s`;
}
