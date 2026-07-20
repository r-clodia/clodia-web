<script lang="ts">
	/**
	 * JOBS list — table view with full CRUD wired:
	 *   - "Crea job" button (opens JobFormDialog in `create` mode)
	 *   - per-row "Esegui" (POST /clodia/jobs/{id}/run)
	 *   - per-row "✏" (opens JobFormDialog in `edit` mode)
	 *   - per-row "🗑" (opens ConfirmDialog → DELETE /clodia/jobs/{id})
	 *
	 * State sync: subscribes to the shared `jobsStore` (7s polling, paused
	 * when the tab is hidden, throttled-refresh on `agent_activity` SSE
	 * events via the root layout). After each successful action we also
	 * fire `bumpJobs()` so the row state reflects reality immediately
	 * rather than after the next tick.
	 *
	 * Action buttons disable themselves while their own action is in flight
	 * (`runBusy[id]`, `deleteBusy[id]`) — but other rows stay interactive
	 * so two jobs can be triggered concurrently.
	 */
	import { onDestroy, onMount } from 'svelte';
	import { API_BASE_URL, ApiError, deleteJob, runJob, updateJob } from '$lib/api/client';
	import { session } from '$lib/auth/session';
	import { isAdmin } from '$lib/stores/capabilities';
	// owner-only (o admin): rispecchia _require_job_owner del backend, reattivo.
	$: canManageJob = (owner?: string | null) =>
		$isAdmin || (!!owner && owner === $session?.principal);
	import type { Job, JobStatus } from '$lib/api/types';
	import StatusDot from '$lib/components/StatusDot.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import JobFormDialog from '$lib/components/JobFormDialog.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import {
		jobsStore,
		refreshJobs,
		startJobsPolling,
		bumpJobs
	} from '$lib/stores/jobs';
	import { toastSuccess, toastError, toastInfo } from '$lib/stores/toasts';

	const JOBS_PATH = '/clodia/jobs';

	let releasePolling: (() => void) | null = null;

	// Form / dialog state ----------------------------------------------------
	let formOpen = false;
	let formMode: 'create' | 'edit' = 'create';
	let formInitial: Job | null = null;

	let confirmOpen = false;
	let confirmTarget: Job | null = null;
	let confirmBusy = false;

	let runBusy: Record<string, boolean> = {};
	let toggleBusy: Record<string, boolean> = {};
	let deleteBusy: Record<string, boolean> = {};

	onMount(() => {
		releasePolling = startJobsPolling();
	});

	onDestroy(() => {
		if (releasePolling) releasePolling();
		releasePolling = null;
	});

	function openCreate() {
		formMode = 'create';
		formInitial = null;
		formOpen = true;
	}

	function openEdit(job: Job) {
		formMode = 'edit';
		formInitial = job;
		formOpen = true;
	}

	function closeForm() {
		formOpen = false;
	}

	function onSaved(_e: CustomEvent<{ mode: 'create' | 'edit'; job?: Job }>) {
		// Either action invalidates the list — refresh now so we don't have
		// to wait for the next poll. The dialog itself dispatched 'close',
		// so we just trigger a refresh.
		bumpJobs();
	}

	async function onRun(job: Job) {
		if (runBusy[job.id]) return;
		runBusy = { ...runBusy, [job.id]: true };
		try {
			const ack = await runJob(job.id);
			const hint = ack.chat_id
				? `chat ${ack.chat_id}`
				: ack.run_id
				? `run ${ack.run_id}`
				: undefined;
			toastInfo(`Job "${job.nome || job.id}" avviato`, hint);
		} catch (err) {
			const msg =
				err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err);
			toastError('Run job fallito', msg);
		} finally {
			runBusy = { ...runBusy, [job.id]: false };
			bumpJobs();
		}
	}

	async function onTogglePaused(job: Job) {
		if (toggleBusy[job.id]) return;
		const nextEnabled = job.enabled === false;
		toggleBusy = { ...toggleBusy, [job.id]: true };
		try {
			await updateJob(job.id, { enabled: nextEnabled });
			toastSuccess(
				`Job "${job.nome || job.id}" ${nextEnabled ? 'ripreso' : 'messo in pausa'}`,
				nextEnabled
					? 'Lo scheduler potrà eseguirlo di nuovo'
					: 'Le prossime esecuzioni schedulate sono sospese'
			);
		} catch (err) {
			const msg =
				err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err);
			toastError('Toggle pausa job fallito', msg);
		} finally {
			toggleBusy = { ...toggleBusy, [job.id]: false };
			bumpJobs();
		}
	}

	function askDelete(job: Job) {
		confirmTarget = job;
		confirmOpen = true;
	}

	async function onConfirmDelete() {
		if (!confirmTarget || confirmBusy) return;
		confirmBusy = true;
		const target = confirmTarget;
		deleteBusy = { ...deleteBusy, [target.id]: true };
		try {
			await deleteJob(target.id);
			toastSuccess(`Job "${target.nome || target.id}" eliminato`);
			confirmOpen = false;
			confirmTarget = null;
		} catch (err) {
			const msg =
				err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err);
			toastError('Eliminazione job fallita', msg);
		} finally {
			deleteBusy = { ...deleteBusy, [target.id]: false };
			confirmBusy = false;
			bumpJobs();
		}
	}

	function onCancelDelete() {
		if (confirmBusy) return;
		confirmOpen = false;
		confirmTarget = null;
	}

	$: state = $jobsStore;
	$: jobs = state.data ?? [];
	$: loading = state.data === null && state.error === null;

	/** Stable sort: by nome (case-insensitive), then by id as a tiebreaker. */
	function sortJobs(j: ReadonlyArray<Job>): Job[] {
		return [...j].sort((a, b) => {
			const ln = (a.nome || '').toLowerCase();
			const rn = (b.nome || '').toLowerCase();
			if (ln !== rn) return ln.localeCompare(rn);
			return (a.id || '').localeCompare(b.id || '');
		});
	}

	function fmtTs(ts: string | null | undefined): string {
		if (!ts) return '—';
		try {
			const d = new Date(ts);
			if (Number.isNaN(d.getTime())) return ts;
			return d.toLocaleString(undefined, {
				year: 'numeric',
				month: '2-digit',
				day: '2-digit',
				hour: '2-digit',
				minute: '2-digit'
			});
		} catch {
			return ts;
		}
	}

	function fmtDuration(seconds: number | null | undefined): string {
		if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return '—';
		if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
		if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
		const m = Math.floor(seconds / 60);
		const s = Math.floor(seconds % 60);
		if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
		const h = Math.floor(m / 60);
		const rm = m % 60;
		return rm ? `${h}h ${rm}m` : `${h}h`;
	}

	function statoOf(j: Job): JobStatus | string {
		const s = (j.stato ?? '').toString().toLowerCase();
		return s || 'idle';
	}

	function isPaused(j: Job): boolean {
		return j.enabled === false;
	}

	function hrefFor(j: Job): string {
		return `/jobs/${encodeURIComponent(j.id)}`;
	}
</script>

<header class="head">
	<div>
		<h1>Jobs</h1>
		<p class="hint">
			GET <code>{API_BASE_URL}{JOBS_PATH}</code> · refresh ogni 7s
		</p>
	</div>
	<div class="head-actions">
		<button type="button" class="primary" on:click={openCreate}>+ Nuovo job</button>
		<button type="button" on:click={() => refreshJobs()} disabled={state.loading}>
			{state.loading ? 'Loading…' : 'Reload'}
		</button>
	</div>
</header>

{#if loading}
	<div class="table-wrap" aria-busy="true">
		<table class="jobs">
			<thead>
				<tr>
					<th>Nome</th>
					<th>Schedule</th>
					<th>Last run</th>
					<th>Durata</th>
					<th>Stato</th>
					<th class="actions-col">Azioni</th>
				</tr>
			</thead>
			<tbody>
				{#each Array(5) as _}
					<tr class="skel-row">
						<td><Skeleton width="60%" height="12px" /></td>
						<td><Skeleton width="45%" height="12px" /></td>
						<td><Skeleton width="40%" height="12px" /></td>
						<td><Skeleton width="50%" height="12px" /></td>
						<td><Skeleton width="30%" height="12px" /></td>
						<td><Skeleton width="50px" height="18px" radius="999px" /></td>
						<td><Skeleton width="120px" height="22px" radius="6px" /></td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{:else if state.error}
	<div class="status error">
		<strong>Failed to load jobs.</strong>
		<div class="error-msg">{state.error}</div>
		<div class="error-hint">
			Check that the agent-server is reachable at <code>{API_BASE_URL}</code>. Override via
			<code>PUBLIC_API_BASE_URL</code>.
		</div>
		<button class="retry" type="button" on:click={() => refreshJobs()}>Retry</button>
	</div>
{:else if jobs.length === 0}
	<div class="status empty">
		<strong>Nessun job configurato.</strong>
		<p class="hint">
			Crea il primo col bottone <em>+ Nuovo job</em>. Lo scheduler eseguirà il prompt secondo
			l'espressione cron impostata.
		</p>
		<button class="primary" type="button" on:click={openCreate}>+ Crea il primo job</button>
	</div>
{:else}
	<div class="table-wrap">
		<table class="jobs">
			<thead>
				<tr>
					<th>Nome</th>
					<th>Agent</th>
					<th>Schedule</th>
					<th>Last run</th>
					<th>Durata</th>
					<th>Stato</th>
					<th class="actions-col">Azioni</th>
				</tr>
			</thead>
			<tbody>
				{#each sortJobs(jobs) as job (job.id)}
					<tr class="row" class:paused={isPaused(job)}>
						<td>
							<a class="name-link" href={hrefFor(job)}>
								{job.nome || job.id}
							</a>
							{#if isPaused(job)}
								<span class="paused-badge">Pausato</span>
							{/if}
						</td>
						<td><span class="agent-badge">{job.agent ?? 'clodia'}</span></td>
						<td><code class="mono">{job.schedule ?? '—'}</code></td>
						<td><time class="mono ts" title={job.last_run ?? ''}>{fmtTs(job.last_run)}</time></td>
						<td class="mono dur">{fmtDuration(job.durata)}</td>
						<td><StatusDot state={statoOf(job)} /></td>
						<td class="actions-col">
							<div class="row-actions">
								{#if canManageJob(job.owner)}
								<button
									type="button"
									class="r-action run"
									title="Esegui adesso"
									on:click={() => onRun(job)}
									disabled={!!runBusy[job.id]}
								>
									{#if runBusy[job.id]}
										<span class="spinner" aria-hidden="true"></span>
									{:else}
										▶ Esegui
									{/if}
								</button>
								<button
									type="button"
									class="r-action pause"
									class:on={isPaused(job)}
									title={isPaused(job) ? 'Resume job schedulato' : 'Pausa job schedulato'}
									on:click={() => onTogglePaused(job)}
									aria-label={isPaused(job) ? 'Resume job' : 'Pausa job'}
									disabled={!!toggleBusy[job.id]}
								>
									{#if toggleBusy[job.id]}
										…
									{:else if isPaused(job)}
										▶ Resume
									{:else}
										⏸ Pausa
									{/if}
								</button>
								<button
									type="button"
									class="r-action edit"
									title="Modifica"
									on:click={() => openEdit(job)}
									aria-label="Modifica job"
								>
									✏
								</button>
								<button
									type="button"
									class="r-action del"
									title="Elimina"
									on:click={() => askDelete(job)}
									aria-label="Elimina job"
									disabled={!!deleteBusy[job.id]}
								>
									{deleteBusy[job.id] ? '…' : '🗑'}
								</button>
								{/if}
							</div>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	{#if state.errors && Object.keys(state.errors).length > 0}
		<details class="errs">
			<summary>Loader warnings ({Object.keys(state.errors).length})</summary>
			<pre>{JSON.stringify(state.errors, null, 2)}</pre>
		</details>
	{/if}
{/if}

<JobFormDialog
	open={formOpen}
	mode={formMode}
	initial={formInitial}
	on:close={closeForm}
	on:saved={onSaved}
/>

<ConfirmDialog
	open={confirmOpen}
	title="Eliminare job?"
	message={confirmTarget
		? `"${confirmTarget.nome || confirmTarget.id}" verrà rimosso dallo scheduler. L'azione non è reversibile.`
		: ''}
	confirmLabel="Elimina"
	destructive
	loading={confirmBusy}
	on:confirm={onConfirmDelete}
	on:cancel={onCancelDelete}
/>

<style>
	.head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 16px;
		margin-bottom: 22px;
		flex-wrap: wrap;
	}
	.head-actions {
		display: flex;
		gap: 8px;
	}
	.primary {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--accent-fg);
		font-weight: 700;
	}
	.primary:hover {
		background: #ff7e55;
	}
	.hint {
		margin: 4px 0 0;
		color: var(--fg-muted);
		font-size: 12px;
	}

	.table-wrap {
		background: var(--card-bg);
		border: 1px solid var(--border);
		border-radius: 10px;
		overflow: hidden;
	}

	table.jobs {
		width: 100%;
		border-collapse: collapse;
		font-size: 13px;
	}

	table.jobs th {
		text-align: left;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--fg-muted);
		font-weight: 600;
		padding: 12px 16px;
		border-bottom: 1px solid var(--border);
		background: rgba(255, 255, 255, 0.015);
	}

	table.jobs td {
		padding: 12px 16px;
		border-bottom: 1px solid var(--border);
		vertical-align: middle;
	}

	table.jobs tbody tr:last-child td {
		border-bottom: none;
	}

	.row {
		transition: background 0.12s ease;
	}
	.row:hover {
		background: rgba(255, 107, 61, 0.05);
	}
	.row.paused {
		background: rgba(255, 255, 255, 0.015);
	}

	.skel-row td {
		cursor: default;
	}

	.name-link {
		font-weight: 600;
		color: var(--fg);
		text-decoration: none;
	}
	.name-link:hover {
		color: var(--accent);
		text-decoration: underline;
	}
	.paused-badge {
		display: inline-flex;
		margin-left: 8px;
		padding: 1px 7px;
		border-radius: 999px;
		border: 1px solid rgba(255, 190, 96, 0.35);
		color: #ffbe60;
		background: rgba(255, 190, 96, 0.08);
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.agent-badge {
		display: inline-flex;
		padding: 1px 8px;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: rgba(255, 255, 255, 0.04);
		color: var(--fg-muted);
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.02em;
	}

	.mono {
		font-family: var(--mono);
		font-size: 12px;
	}
	.ts {
		color: var(--fg-muted);
	}
	.dur {
		color: var(--fg-muted);
		white-space: nowrap;
	}

	.actions-col {
		width: 0;
		white-space: nowrap;
	}
	.row-actions {
		display: inline-flex;
		gap: 4px;
		align-items: center;
	}
	.r-action {
		font-size: 12px;
		padding: 5px 9px;
		background: transparent;
		display: inline-flex;
		align-items: center;
		gap: 4px;
		min-width: 32px;
		justify-content: center;
	}
	.r-action:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.r-action.run {
		color: var(--success);
		border-color: rgba(92, 184, 138, 0.4);
	}
	.r-action.run:hover:not(:disabled) {
		background: rgba(92, 184, 138, 0.1);
		border-color: rgba(92, 184, 138, 0.7);
	}
	.r-action.pause {
		color: #ffbe60;
		border-color: rgba(255, 190, 96, 0.35);
	}
	.r-action.pause:hover:not(:disabled) {
		background: rgba(255, 190, 96, 0.08);
		border-color: rgba(255, 190, 96, 0.7);
	}
	.r-action.pause.on {
		color: var(--success);
		border-color: rgba(92, 184, 138, 0.4);
	}
	.r-action.edit:hover {
		background: rgba(255, 107, 61, 0.08);
		color: var(--accent);
		border-color: var(--accent);
	}
	.r-action.del {
		color: var(--fg-muted);
	}
	.r-action.del:hover:not(:disabled) {
		color: var(--danger);
		border-color: var(--danger);
		background: rgba(232, 93, 117, 0.08);
	}

	.spinner {
		width: 11px;
		height: 11px;
		border-radius: 50%;
		border: 2px solid currentColor;
		border-right-color: transparent;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.status {
		padding: 16px 18px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--card-bg);
	}
	.status.error {
		border-color: rgba(232, 93, 117, 0.6);
		background: rgba(232, 93, 117, 0.08);
	}
	.status.empty {
		border-style: dashed;
		text-align: center;
		padding: 40px 24px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		align-items: center;
	}
	.status.empty .hint {
		max-width: 480px;
	}
	.error-msg {
		margin-top: 8px;
		font-family: var(--mono);
		font-size: 12px;
		color: var(--danger);
		white-space: pre-wrap;
		word-break: break-word;
	}
	.error-hint {
		margin-top: 10px;
		font-size: 12px;
		color: var(--fg-muted);
	}
	.retry {
		margin-top: 12px;
	}

	.errs {
		margin-top: 18px;
		color: var(--fg-muted);
		font-size: 12px;
	}
	.errs summary {
		cursor: pointer;
		margin-bottom: 8px;
	}

	@media (max-width: 720px) {
		table.jobs th,
		table.jobs td {
			padding: 10px 10px;
		}
		table.jobs th:nth-child(2),
		table.jobs td:nth-child(2) {
			display: none;
		}
	}
</style>
