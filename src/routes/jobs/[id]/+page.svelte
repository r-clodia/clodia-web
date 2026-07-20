<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import {
		API_BASE_URL,
		ApiError,
		deleteJob,
		getJob,
		runJob,
		updateJob
	} from '$lib/api/client';
	import type { Job, JobDetail, JobRun, JobStatus } from '$lib/api/types';
	import StatusDot from '$lib/components/StatusDot.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import JobFormDialog from '$lib/components/JobFormDialog.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import { toastSuccess, toastError, toastInfo } from '$lib/stores/toasts';
	import { bumpJobs } from '$lib/stores/jobs';
	import { session } from '$lib/auth/session';
	import { isAdmin } from '$lib/stores/capabilities';
	// owner-only (o admin): rispecchia _require_job_owner del backend, reattivo.
	$: canManageJob = (owner?: string | null) =>
		$isAdmin || (!!owner && owner === $session?.principal);

	$: id = $page.params.id ?? '';

	type Tab = 'config' | 'runs';
	let tab: Tab = 'config';

	type DetailState =
		| { kind: 'idle' }
		| { kind: 'loading' }
		| { kind: 'ok'; job: JobDetail }
		| { kind: 'error'; message: string; status?: number };

	let detail: DetailState = { kind: 'idle' };

	// Write-action UI state. Each action owns its own busy flag so we don't
	// gate the others while one is in flight (e.g. you can edit while a
	// previous run-now ack is still being awaited).
	let editOpen = false;
	let confirmOpen = false;
	let confirmBusy = false;
	let runBusy = false;
	let toggleBusy = false;

	function jobsPath(jobId: string): string {
		return `/clodia/jobs/${encodeURIComponent(jobId)}`;
	}

	async function loadDetail(jobId: string) {
		detail = { kind: 'loading' };
		try {
			const data = await getJob(jobId);
			detail = { kind: 'ok', job: data };
		} catch (err) {
			if (err instanceof ApiError) {
				detail = { kind: 'error', message: err.message, status: err.status };
			} else if (err instanceof Error) {
				detail = { kind: 'error', message: err.message };
			} else {
				detail = { kind: 'error', message: String(err) };
			}
		}
	}

	async function reload() {
		if (id) await loadDetail(id);
	}

	async function onRunNow() {
		if (runBusy || !id) return;
		runBusy = true;
		try {
			const ack = await runJob(id);
			const hint = ack.chat_id
				? `chat ${ack.chat_id}`
				: ack.run_id
				? `run ${ack.run_id}`
				: undefined;
			toastInfo('Run avviata', hint);
		} catch (err) {
			const msg =
				err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err);
			toastError('Run job fallito', msg);
		} finally {
			runBusy = false;
			// Refresh: shows the new run row in the storico (after a moment).
			await reload();
			bumpJobs();
		}
	}

	async function onTogglePaused() {
		if (toggleBusy || !id || !job) return;
		const nextEnabled = job.enabled === false;
		toggleBusy = true;
		try {
			await updateJob(id, { enabled: nextEnabled });
			toastSuccess(
				`Job ${nextEnabled ? 'ripreso' : 'messo in pausa'}`,
				nextEnabled
					? 'Lo scheduler potrà eseguirlo di nuovo'
					: 'Le prossime esecuzioni schedulate sono sospese'
			);
		} catch (err) {
			const msg =
				err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err);
			toastError('Toggle pausa job fallito', msg);
		} finally {
			toggleBusy = false;
			await reload();
			bumpJobs();
		}
	}

	function onSaved(_e: CustomEvent<{ mode: 'create' | 'edit'; job?: Job }>) {
		// Refresh the detail + jobs list. The dialog handles its own close.
		void reload();
		bumpJobs();
	}

	async function onConfirmDelete() {
		if (confirmBusy || !id) return;
		confirmBusy = true;
		try {
			await deleteJob(id);
			toastSuccess('Job eliminato');
			confirmOpen = false;
			bumpJobs();
			// Navigate back to the list — the detail page has nothing to show now.
			goto('/jobs');
		} catch (err) {
			const msg =
				err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err);
			toastError('Eliminazione job fallita', msg);
		} finally {
			confirmBusy = false;
		}
	}

	$: if (id) {
		void loadDetail(id);
	}

	$: job = detail.kind === 'ok' ? detail.job : null;
	$: paused = job?.enabled === false;

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
				minute: '2-digit',
				second: '2-digit'
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

	function statoOf(s: string | null | undefined): JobStatus | string {
		return (s ?? '').toString().toLowerCase() || 'idle';
	}

	/** Sort runs newest-first by timestamp (defensive — server order varies). */
	function sortRuns(r: ReadonlyArray<JobRun>): JobRun[] {
		return [...r].sort((a, b) => {
			const ta = a.ts ? Date.parse(a.ts) : 0;
			const tb = b.ts ? Date.parse(b.ts) : 0;
			if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
			if (Number.isNaN(ta)) return 1;
			if (Number.isNaN(tb)) return -1;
			return tb - ta;
		});
	}

	/**
	 * Extract additional configuration keys we don't surface explicitly so the
	 * "altri campi" section can pretty-print them generically. We exclude the
	 * top-level fields rendered as their own rows + the runs array.
	 */
	const KNOWN_TOP_LEVEL = new Set([
		'id',
		'nome',
		'schedule',
		'last_run',
		'durata',
		'stato',
		'description',
		'command',
		'enabled',
		'timezone',
		'next_run',
		'config',
		'runs'
	]);

	function extraConfigEntries(j: JobDetail): Array<[string, unknown]> {
		const rec = j as unknown as Record<string, unknown>;
		const out: Array<[string, unknown]> = [];
		for (const k of Object.keys(rec)) {
			if (!KNOWN_TOP_LEVEL.has(k)) out.push([k, rec[k]]);
		}
		return out;
	}

	function configEntries(j: JobDetail): Array<[string, unknown]> {
		if (!j.config || typeof j.config !== 'object') return [];
		return Object.entries(j.config);
	}

	function fmtValue(v: unknown): string {
		if (v === null || v === undefined) return '—';
		if (typeof v === 'string') return v;
		if (typeof v === 'number' || typeof v === 'boolean') return String(v);
		try {
			return JSON.stringify(v, null, 2);
		} catch {
			return String(v);
		}
	}

	function isMultiline(s: string): boolean {
		return s.includes('\n') || s.length > 60;
	}

	$: runs = job?.runs ? sortRuns(job.runs) : [];
</script>

<header class="head">
	<div class="head-left">
		<a class="back" href="/jobs">← All jobs</a>
		<div class="title-row">
			<div class="title-text">
				<h1>{job?.nome?.trim() || id}</h1>
				<div class="sub">
					<code class="mono">{id}</code>
					{#if job?.schedule}
						<span class="dot-sep">·</span>
						<span class="mono" title="schedule">{job.schedule}</span>
					{/if}
					<span class="dot-sep">·</span>
					<StatusDot state={statoOf(job?.stato)} />
					{#if paused}
						<span class="paused-badge">Pausato</span>
					{/if}
				</div>
			</div>
		</div>
	</div>
	<div class="head-actions">
		{#if canManageJob(job?.owner)}
		<button
			type="button"
			class="action-run"
			on:click={onRunNow}
			disabled={runBusy || detail.kind !== 'ok'}
			title="POST /clodia/jobs/{id}/run"
		>
			{#if runBusy}
				<span class="spinner" aria-hidden="true"></span>
				Avvio…
			{:else}
				▶ Esegui ora
			{/if}
		</button>
		<button
			type="button"
			class="action-pause"
			class:on={paused}
			on:click={onTogglePaused}
			disabled={toggleBusy || detail.kind !== 'ok'}
			title={paused ? 'Resume job schedulato' : 'Pausa job schedulato'}
		>
			{#if toggleBusy}
				…
			{:else if paused}
				▶ Resume
			{:else}
				⏸ Pausa
			{/if}
		</button>
		<button
			type="button"
			class="action-edit"
			on:click={() => (editOpen = true)}
			disabled={detail.kind !== 'ok'}
		>
			Modifica
		</button>
		<button
			type="button"
			class="action-del"
			on:click={() => (confirmOpen = true)}
			disabled={detail.kind !== 'ok'}
		>
			Elimina
		</button>
		{/if}
		<button type="button" on:click={reload} disabled={detail.kind === 'loading'}>
			{detail.kind === 'loading' ? 'Loading…' : 'Reload'}
		</button>
	</div>
</header>

<div class="tabs" role="tablist" aria-label="Sections">
	<button
		role="tab"
		aria-selected={tab === 'config'}
		class:active={tab === 'config'}
		on:click={() => (tab = 'config')}
		type="button"
	>
		Configurazione
	</button>
	<button
		role="tab"
		aria-selected={tab === 'runs'}
		class:active={tab === 'runs'}
		on:click={() => (tab = 'runs')}
		type="button"
	>
		Storico run
		{#if runs.length}
			<span class="badge">{runs.length}</span>
		{/if}
	</button>
</div>

<!-- CONFIGURAZIONE -->
{#if tab === 'config'}
	<section class="panel">
		{#if detail.kind === 'loading' || detail.kind === 'idle'}
			<div class="grid-two">
				<div class="row"><Skeleton width="40%" height="12px" /></div>
				<div class="row"><Skeleton width="80%" height="12px" /></div>
				<div class="row"><Skeleton width="30%" height="12px" /></div>
				<div class="row"><Skeleton width="60%" height="12px" /></div>
				<div class="row"><Skeleton width="50%" height="12px" /></div>
				<div class="row"><Skeleton width="70%" height="12px" /></div>
			</div>
		{:else if detail.kind === 'error'}
			<div class="status error">
				<strong>Failed to load job{detail.status ? ` (HTTP ${detail.status})` : ''}.</strong>
				<div class="error-msg">{detail.message}</div>
				<div class="error-hint">
					Endpoint: <code>{API_BASE_URL}{jobsPath(id)}</code>
				</div>
				<button type="button" class="retry" on:click={reload}>Retry</button>
			</div>
		{:else if job}
			<dl class="def">
				<dt>ID</dt>
				<dd><code>{job.id}</code></dd>

				<dt>Nome</dt>
				<dd>{job.nome || '—'}</dd>

				{#if job.description}
					<dt>Description</dt>
					<dd>{job.description}</dd>
				{/if}

				<dt>Schedule</dt>
				<dd>{job.schedule ? `${job.schedule}` : '—'}</dd>

				{#if job.timezone}
					<dt>Timezone</dt>
					<dd><code>{job.timezone}</code></dd>
				{/if}

				{#if job.enabled !== undefined}
					<dt>Enabled</dt>
					<dd>{job.enabled ? 'yes' : 'no'}</dd>
				{/if}

				{#if job.command}
					<dt>Command</dt>
					<dd><code class="cmd">{job.command}</code></dd>
				{/if}

				<dt>Last run</dt>
				<dd><time class="mono" title={job.last_run ?? ''}>{fmtTs(job.last_run)}</time></dd>

				{#if job.next_run}
					<dt>Next run</dt>
					<dd><time class="mono" title={job.next_run}>{fmtTs(job.next_run)}</time></dd>
				{/if}

				<dt>Durata (last)</dt>
				<dd class="mono">{fmtDuration(job.durata)}</dd>

				<dt>Stato</dt>
				<dd><StatusDot state={statoOf(job.stato)} /></dd>

				{#if configEntries(job).length > 0}
					<dt>Config</dt>
					<dd>
						<dl class="sub-def">
							{#each configEntries(job) as [k, v] (k)}
								<dt>{k}</dt>
								<dd>
									{#if isMultiline(fmtValue(v))}
										<pre>{fmtValue(v)}</pre>
									{:else}
										<code>{fmtValue(v)}</code>
									{/if}
								</dd>
							{/each}
						</dl>
					</dd>
				{/if}

				{#if extraConfigEntries(job).length > 0}
					<dt>Altri campi</dt>
					<dd>
						<dl class="sub-def">
							{#each extraConfigEntries(job) as [k, v] (k)}
								<dt>{k}</dt>
								<dd>
									{#if isMultiline(fmtValue(v))}
										<pre>{fmtValue(v)}</pre>
									{:else}
										<code>{fmtValue(v)}</code>
									{/if}
								</dd>
							{/each}
						</dl>
					</dd>
				{/if}
			</dl>

			<details class="raw">
				<summary>Raw payload</summary>
				<pre>{JSON.stringify(job, null, 2)}</pre>
			</details>
		{/if}
	</section>
{/if}

<!-- STORICO RUN -->
{#if tab === 'runs'}
	<section class="panel">
		{#if detail.kind === 'loading' || detail.kind === 'idle'}
			<ul class="log-list">
				{#each Array(5) as _}
					<li class="log-row skel-row">
						<Skeleton width="160px" height="12px" />
						<Skeleton width="60px" height="12px" />
						<Skeleton width="50px" height="18px" radius="999px" />
						<Skeleton width="40%" height="12px" />
					</li>
				{/each}
			</ul>
		{:else if detail.kind === 'error'}
			<div class="status error">
				<strong>Failed to load runs.</strong>
				<div class="error-msg">{detail.message}</div>
				<button type="button" class="retry" on:click={reload}>Retry</button>
			</div>
		{:else if runs.length === 0}
			<div class="status">
				<strong>No runs recorded yet.</strong>
				<p class="hint">Executions for <code>{id}</code> will appear here.</p>
			</div>
		{:else}
			<div class="log-summary">
				<span><strong>{runs.length}</strong> runs</span>
				<span class="dot-sep">·</span>
				<span>showing newest first</span>
			</div>
			<ul class="log-list">
				{#each runs as run, idx (run.id ?? `${run.ts ?? 'run'}-${idx}`)}
					<li class="log-row">
						<time class="ts mono" title={run.ts ?? ''}>{fmtTs(run.ts)}</time>
						<span class="dur mono" title="duration">{fmtDuration(run.durata)}</span>
						<span class="state"><StatusDot state={statoOf(run.stato)} /></span>
						<span class="meta">
							{#if run.exit_code !== null && run.exit_code !== undefined}
								<span class="meta-chip"><span class="k">exit</span><code>{run.exit_code}</code></span>
							{/if}
							{#if run.log_url}
								<a class="log-link" href={run.log_url} target="_blank" rel="noopener">log →</a>
							{/if}
							{#if run.error}
								<span class="err-snippet" title={run.error}>{run.error}</span>
							{/if}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{/if}

<JobFormDialog
	open={editOpen}
	mode="edit"
	initial={detail.kind === 'ok' ? detail.job : null}
	on:close={() => (editOpen = false)}
	on:saved={onSaved}
/>

<ConfirmDialog
	open={confirmOpen}
	title="Eliminare job?"
	message={detail.kind === 'ok'
		? `"${detail.job.nome || detail.job.id}" verrà rimosso dallo scheduler. L'azione non è reversibile.`
		: ''}
	confirmLabel="Elimina"
	destructive
	loading={confirmBusy}
	on:confirm={onConfirmDelete}
	on:cancel={() => (confirmOpen = false)}
/>

<style>
	.head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 16px;
		margin-bottom: 18px;
		flex-wrap: wrap;
	}
	.head-left {
		min-width: 0;
		flex: 1 1 auto;
	}
	.head-actions {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		align-items: center;
	}
	.head-actions button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.action-run {
		color: var(--success);
		border-color: rgba(92, 184, 138, 0.4);
		background: transparent;
	}
	.action-run:hover:not(:disabled) {
		background: rgba(92, 184, 138, 0.1);
		border-color: rgba(92, 184, 138, 0.7);
	}
	.action-edit {
		background: transparent;
	}
	.action-edit:hover:not(:disabled) {
		background: rgba(255, 107, 61, 0.08);
		color: var(--accent);
		border-color: var(--accent);
	}
	.action-del {
		background: transparent;
		color: var(--fg-muted);
	}
	.action-del:hover:not(:disabled) {
		color: var(--danger);
		border-color: var(--danger);
		background: rgba(232, 93, 117, 0.08);
	}
	.action-pause {
		background: transparent;
		color: #ffbe60;
		border-color: rgba(255, 190, 96, 0.35);
		font-weight: 700;
	}
	.action-pause:hover:not(:disabled) {
		background: rgba(255, 190, 96, 0.08);
		border-color: rgba(255, 190, 96, 0.7);
	}
	.action-pause.on {
		color: var(--success);
		border-color: rgba(92, 184, 138, 0.4);
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
	.back {
		display: inline-block;
		margin-bottom: 10px;
		font-size: 12px;
		color: var(--fg-muted);
	}
	.back:hover {
		color: var(--fg);
	}
	.title-row {
		display: flex;
		gap: 14px;
		align-items: center;
	}
	.title-text {
		min-width: 0;
	}
	.title-text h1 {
		margin: 0;
	}
	.sub {
		margin-top: 4px;
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
		color: var(--fg-muted);
		font-size: 12px;
	}
	.mono {
		font-family: var(--mono);
	}
	.dot-sep {
		opacity: 0.5;
	}

	.tabs {
		display: flex;
		gap: 6px;
		border-bottom: 1px solid var(--border);
		margin-bottom: 18px;
	}
	.tabs button {
		border: none;
		background: transparent;
		color: var(--fg-muted);
		padding: 10px 14px;
		border-radius: 6px 6px 0 0;
		border-bottom: 2px solid transparent;
		font-size: 12px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		cursor: pointer;
	}
	.tabs button:hover {
		color: var(--fg);
		background: rgba(255, 255, 255, 0.02);
	}
	.tabs button.active {
		color: var(--fg);
		border-bottom-color: var(--accent);
		font-weight: 700;
	}
	.badge {
		display: inline-block;
		margin-left: 6px;
		font-size: 10px;
		padding: 1px 6px;
		border-radius: 10px;
		background: var(--border);
		color: var(--fg-muted);
		font-weight: 600;
		letter-spacing: 0;
	}
	.paused-badge {
		display: inline-flex;
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

	.panel {
		background: var(--card-bg);
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 20px 22px;
	}

	.def {
		display: grid;
		grid-template-columns: 200px 1fr;
		gap: 10px 22px;
		margin: 0;
	}
	.def dt {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--fg-muted);
		padding-top: 4px;
	}
	.def dd {
		margin: 0;
		font-size: 13px;
		line-height: 1.5;
	}

	.sub-def {
		display: grid;
		grid-template-columns: 140px 1fr;
		gap: 4px 14px;
		margin: 0;
	}
	.sub-def dt {
		font-size: 10.5px;
		text-transform: none;
		letter-spacing: 0;
		color: var(--fg-muted);
		font-family: var(--mono);
		padding-top: 2px;
	}
	.sub-def dd {
		margin: 0;
		font-size: 12.5px;
	}
	.sub-def pre {
		margin: 2px 0 0;
		font-size: 11.5px;
	}

	.cmd {
		font-size: 11.5px;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.raw {
		margin-top: 18px;
		color: var(--fg-muted);
		font-size: 12px;
	}
	.raw summary {
		cursor: pointer;
		margin-bottom: 8px;
	}

	.log-summary {
		font-size: 12px;
		color: var(--fg-muted);
		margin-bottom: 10px;
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.log-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0;
		border-top: 1px solid var(--border);
	}
	.log-row {
		display: grid;
		grid-template-columns: 200px 90px 110px 1fr;
		gap: 14px;
		padding: 9px 4px;
		align-items: center;
		border-bottom: 1px solid var(--border);
		font-size: 12.5px;
	}
	.log-row .ts {
		color: var(--fg-muted);
		font-size: 11.5px;
		white-space: nowrap;
	}
	.log-row .dur {
		color: var(--fg-muted);
		font-size: 11.5px;
		white-space: nowrap;
	}
	.log-row .state {
		justify-self: start;
	}
	.log-row .meta {
		display: flex;
		gap: 10px;
		align-items: center;
		flex-wrap: wrap;
		color: var(--fg-muted);
		font-size: 11.5px;
	}
	.meta-chip {
		display: inline-flex;
		gap: 4px;
		align-items: baseline;
	}
	.meta-chip .k {
		text-transform: uppercase;
		font-size: 10px;
		letter-spacing: 0.06em;
		opacity: 0.7;
	}
	.log-link {
		color: #6fb6ff;
	}
	.log-link:hover {
		text-decoration: underline;
	}
	.err-snippet {
		color: var(--danger);
		font-family: var(--mono);
		font-size: 11px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 320px;
	}
	.skel-row {
		grid-template-columns: 200px 90px 110px 1fr;
	}

	.status {
		padding: 14px 16px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.02);
	}
	.status.error {
		border-color: rgba(232, 93, 117, 0.6);
		background: rgba(232, 93, 117, 0.08);
	}
	.error-msg {
		margin-top: 6px;
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
		margin-top: 10px;
	}

	@media (max-width: 720px) {
		.def {
			grid-template-columns: 1fr;
			gap: 4px 0;
		}
		.def dd {
			margin-bottom: 12px;
		}
		.sub-def {
			grid-template-columns: 1fr;
		}
		.log-row {
			grid-template-columns: 1fr;
			gap: 4px;
		}
	}
</style>
