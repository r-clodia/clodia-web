<script lang="ts">
	/**
	 * COLONY — Control Plane della Colonia di Agenti (CAP).
	 *
	 * Il backend (server/api/colony.py) serve da tempo l'intero control plane;
	 * fino ad oggi era raggiungibile solo dalla frontend interna dell'agent-
	 * server (/colony su :7842), non dalla webui v2. Questa pagina colma il gap:
	 *  - Pipelines: registry, stati, azioni di lifecycle, Strategy Agent
	 *  - Executions: ledger con drill-down (deliverable, retry chain, heartbeat)
	 *  - Audit: il trail di eventi (governance)
	 */
	import { onDestroy, onMount } from 'svelte';
	import {
		API_BASE_URL,
		ApiError,
		activatePipeline,
		colonySync,
		consumerPollNow,
		deprecatePipeline,
		getColonyEvents,
		getColonyExecution,
		getColonyExecutions,
		getPipelines,
		getPipelineVersions,
		pausePipeline,
		runStrategy,
		seedPipelineTask,
		validatePipeline
	} from '$lib/api/client';
	import type {
		ColonyEvent,
		ColonyExecution,
		ColonyExecutionDetail,
		Pipeline,
		PipelineVersion
	} from '$lib/api/types';
	import Modal from '$lib/components/Modal.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { toastError, toastInfo, toastSuccess } from '$lib/stores/toasts';

	type Tab = 'pipelines' | 'executions' | 'audit';
	let tab: Tab = 'pipelines';

	// ── helpers ──────────────────────────────────────────────────────────
	function errMsg(err: unknown): string {
		if (err instanceof ApiError) return err.message;
		if (err instanceof Error) return err.message;
		return String(err);
	}

	function fmtTs(ts?: string | null): string {
		if (!ts) return '—';
		const d = new Date(ts);
		if (Number.isNaN(d.getTime())) return ts;
		return d.toLocaleString('it-IT', {
			day: '2-digit',
			month: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
	}

	function shortId(id?: string | null): string {
		if (!id) return '—';
		return id.length > 10 ? `${id.slice(0, 8)}…` : id;
	}

	// Famiglie di colore per gli stati (pipeline + execution).
	function stateClass(s: string): string {
		const up = (s || '').toUpperCase();
		if (['ACTIVE', 'READY', 'DELIVERED', 'DONE'].includes(up)) return 'ok';
		if (['RUNNING', 'CLAIMED', 'VALIDATING'].includes(up)) return 'busy';
		if (['PAUSED', 'RETRY_PENDING', 'STALE'].includes(up)) return 'warn';
		if (['FAILED', 'FAILED_VALIDATION', 'ESCALATED'].includes(up)) return 'err';
		if (['DRAFT', 'DEPRECATED'].includes(up)) return 'muted';
		return 'muted';
	}

	// ── PIPELINES ────────────────────────────────────────────────────────
	type PipeState =
		| { kind: 'loading' }
		| { kind: 'ok'; items: ReadonlyArray<Pipeline> }
		| { kind: 'error'; message: string };
	let pipeState: PipeState = { kind: 'loading' };
	let expanded: Record<string, boolean> = {};
	let busyPipe: Record<string, boolean> = {};

	async function loadPipelines() {
		pipeState = { kind: 'loading' };
		try {
			pipeState = { kind: 'ok', items: await getPipelines() };
		} catch (err) {
			pipeState = { kind: 'error', message: errMsg(err) };
		}
	}

	async function pipeAction(
		name: string,
		fn: (n: string) => Promise<Pipeline>,
		label: string
	) {
		busyPipe = { ...busyPipe, [name]: true };
		try {
			await fn(name);
			toastSuccess(`Pipeline ${name}: ${label} ok.`);
			await loadPipelines();
		} catch (err) {
			toastError(`Pipeline ${name}: ${label} fallita.`, errMsg(err));
		} finally {
			busyPipe = { ...busyPipe, [name]: false };
		}
	}

	// Versioni storiche caricate on-demand quando si espande una pipeline.
	let versions: Record<string, ReadonlyArray<PipelineVersion>> = {};
	async function toggleExpand(name: string) {
		expanded = { ...expanded, [name]: !expanded[name] };
		if (expanded[name] && !versions[name]) {
			try {
				versions = { ...versions, [name]: await getPipelineVersions(name) };
			} catch {
				versions = { ...versions, [name]: [] };
			}
		}
	}

	// Seed task su una pipeline ACTIVE.
	let seedFor: Pipeline | null = null;
	let seedTitle = '';
	let seedDesc = '';
	let seeding = false;
	async function doSeed() {
		if (!seedFor || !seedTitle.trim()) return;
		seeding = true;
		try {
			await seedPipelineTask(seedFor.name, { title: seedTitle.trim(), desc: seedDesc.trim() });
			toastSuccess(`Card creata nella prima lane di ${seedFor.name}.`);
			seedFor = null;
			seedTitle = '';
			seedDesc = '';
		} catch (err) {
			toastError('Seed task fallito.', errMsg(err));
		} finally {
			seeding = false;
		}
	}

	// Strategy Agent → pipeline DRAFT.
	let strategyObjective = '';
	let strategyBusy = false;
	let strategyResult: Record<string, unknown> | null = null;
	async function doStrategy() {
		if (!strategyObjective.trim()) return;
		strategyBusy = true;
		strategyResult = null;
		try {
			strategyResult = await runStrategy(strategyObjective.trim());
			toastInfo('Strategy Agent ha prodotto una proposta.', 'Rivedi l’output qui sotto.');
		} catch (err) {
			toastError('Strategy Agent error.', errMsg(err));
		} finally {
			strategyBusy = false;
		}
	}

	// ── EXECUTIONS ───────────────────────────────────────────────────────
	type ExecState =
		| { kind: 'loading' }
		| { kind: 'ok'; items: ReadonlyArray<ColonyExecution> }
		| { kind: 'error'; message: string };
	let execState: ExecState = { kind: 'loading' };
	let execStatusFilter = '';

	async function loadExecutions() {
		execState = { kind: 'loading' };
		try {
			execState = { kind: 'ok', items: await getColonyExecutions(100) };
		} catch (err) {
			execState = { kind: 'error', message: errMsg(err) };
		}
	}

	$: execItems =
		execState.kind === 'ok'
			? execState.items.filter(
					(e) => !execStatusFilter || e.status === execStatusFilter
				)
			: [];

	// Detail drawer.
	let detail: ColonyExecutionDetail | null = null;
	let detailLoading = false;
	async function openDetail(id: string) {
		detailLoading = true;
		detail = null;
		try {
			detail = await getColonyExecution(id);
		} catch (err) {
			toastError('Dettaglio execution non disponibile.', errMsg(err));
			detailLoading = false;
			return;
		}
		detailLoading = false;
	}

	// ── AUDIT ────────────────────────────────────────────────────────────
	type AuditState =
		| { kind: 'loading' }
		| { kind: 'ok'; items: ReadonlyArray<ColonyEvent> }
		| { kind: 'error'; message: string };
	let auditState: AuditState = { kind: 'loading' };
	let auditActionFilter = '';

	async function loadAudit() {
		auditState = { kind: 'loading' };
		try {
			auditState = {
				kind: 'ok',
				items: await getColonyEvents({ limit: 200, action: auditActionFilter })
			};
		} catch (err) {
			auditState = { kind: 'error', message: errMsg(err) };
		}
	}

	// ── header actions ───────────────────────────────────────────────────
	let syncing = false;
	async function doSync() {
		syncing = true;
		try {
			const r = await colonySync();
			toastSuccess('Registry sincronizzato (filesystem→DB).', JSON.stringify(r));
			if (tab === 'pipelines') await loadPipelines();
		} catch (err) {
			toastError('Sync fallito.', errMsg(err));
		} finally {
			syncing = false;
		}
	}

	let polling = false;
	async function doPollNow() {
		polling = true;
		try {
			await consumerPollNow();
			toastSuccess('Poll-now inviato al consumer.');
		} catch (err) {
			toastError('Poll-now fallito.', errMsg(err));
		} finally {
			polling = false;
		}
	}

	// ── lifecycle ────────────────────────────────────────────────────────
	function loadTab(t: Tab) {
		if (t === 'pipelines') void loadPipelines();
		else if (t === 'executions') void loadExecutions();
		else void loadAudit();
	}
	$: loadTab(tab);

	// Auto-refresh leggero quando si è su executions (per cogliere RUNNING→DONE).
	let timer: ReturnType<typeof setInterval> | null = null;
	onMount(() => {
		timer = setInterval(() => {
			if (tab === 'executions' && execState.kind === 'ok' && !detail) void loadExecutions();
		}, 8000);
	});
	onDestroy(() => {
		if (timer) clearInterval(timer);
	});
</script>

<header class="head">
	<div>
		<h1>Colony · Control Plane</h1>
		<p class="hint">
			Pipelines, executions e audit della colonia · <code>{API_BASE_URL}/api/colony</code>
		</p>
	</div>
	<div class="head-actions">
		<button type="button" on:click={doPollNow} disabled={polling} title="Forza un giro di polling del consumer">
			{polling ? 'Poll…' : 'Poll now'}
		</button>
		<button type="button" on:click={doSync} disabled={syncing} title="Resync registry filesystem→DB">
			{syncing ? 'Sync…' : 'Sync registry'}
		</button>
	</div>
</header>

<nav class="tabs" aria-label="Control plane">
	<button class:active={tab === 'pipelines'} on:click={() => (tab = 'pipelines')}>Pipelines</button>
	<button class:active={tab === 'executions'} on:click={() => (tab = 'executions')}>Executions</button>
	<button class:active={tab === 'audit'} on:click={() => (tab = 'audit')}>Audit</button>
</nav>

{#if tab === 'pipelines'}
	<!-- Strategy Agent -->
	<section class="panel strategy">
		<h2>Strategy Agent</h2>
		<p class="hint">Da un obiettivo lo Strategy Agent propone una pipeline (DRAFT, non attiva nulla).</p>
		<div class="strategy-row">
			<input
				type="text"
				bind:value={strategyObjective}
				placeholder="Obiettivo (es. pubblicare un articolo blog su NIS2)…"
				on:keydown={(e) => e.key === 'Enter' && doStrategy()}
			/>
			<button class="primary" on:click={doStrategy} disabled={strategyBusy || !strategyObjective.trim()}>
				{strategyBusy ? 'Elaboro…' : 'Proponi'}
			</button>
		</div>
		{#if strategyResult}
			<pre class="json">{JSON.stringify(strategyResult, null, 2)}</pre>
		{/if}
	</section>

	{#if pipeState.kind === 'loading'}
		<div class="list" aria-busy="true">
			{#each Array(3) as _}
				<div class="row"><Skeleton width="180px" height="14px" /><Skeleton width="60px" height="18px" radius="999px" /></div>
			{/each}
		</div>
	{:else if pipeState.kind === 'error'}
		<div class="status error">
			<strong>Pipeline non caricabili.</strong>
			<div class="error-msg">{pipeState.message}</div>
			<button class="retry" on:click={loadPipelines}>Retry</button>
		</div>
	{:else if pipeState.items.length === 0}
		<div class="status empty"><strong>Nessuna pipeline nel registry.</strong></div>
	{:else}
		<div class="list">
			{#each pipeState.items as p (p.name)}
				<div class="pipe">
					<div class="pipe-head">
						<button class="expander" on:click={() => toggleExpand(p.name)} aria-expanded={expanded[p.name] ? 'true' : 'false'}>
							<span class="caret" class:open={expanded[p.name]}>▶</span>
							<span class="pname">{p.name}</span>
							<span class="badge {stateClass(p.status)}">{p.status}</span>
							<span class="ver">v{p.version}</span>
						</button>
						<div class="pipe-actions">
							{#if p.status === 'DRAFT' || p.status === 'FAILED_VALIDATION'}
								<button on:click={() => pipeAction(p.name, validatePipeline, 'validate')} disabled={busyPipe[p.name]}>Validate</button>
							{/if}
							{#if p.status === 'READY'}
								<button class="primary" on:click={() => pipeAction(p.name, activatePipeline, 'activate')} disabled={busyPipe[p.name]}>Activate</button>
							{/if}
							{#if p.status === 'ACTIVE'}
								<button on:click={() => (seedFor = p)} disabled={busyPipe[p.name]}>Seed task</button>
								<button on:click={() => pipeAction(p.name, pausePipeline, 'pause')} disabled={busyPipe[p.name]}>Pause</button>
							{/if}
							{#if p.status === 'PAUSED'}
								<button class="primary" on:click={() => pipeAction(p.name, activatePipeline, 'activate')} disabled={busyPipe[p.name]}>Resume</button>
							{/if}
							{#if p.status !== 'DEPRECATED'}
								<button class="danger" on:click={() => pipeAction(p.name, deprecatePipeline, 'deprecate')} disabled={busyPipe[p.name]}>Deprecate</button>
							{/if}
						</div>
					</div>
					{#if p.objective}<div class="pipe-obj">{p.objective}</div>{/if}
					{#if expanded[p.name]}
						<div class="pipe-body">
							<div class="steps">
								{#each p.steps as s, i}
									<span class="step">
										<span class="step-n">{i + 1}</span>
										<span class="step-name">{s.name}</span>
										{#if s.skill}<span class="step-skill">{s.skill}</span>{/if}
										{#if s.human || s.approval_gate}<span class="step-gate" title="Approval gate">⏸ gate</span>{/if}
									</span>
									{#if i < p.steps.length - 1}<span class="arrow">→</span>{/if}
								{/each}
							</div>
							<div class="meta-line">
								{#if p.board_id}<span>board: <code>{p.board_id}</code></span>{/if}
								<span>creata: {fmtTs(p.created_at)}</span>
								<span>aggiornata: {fmtTs(p.updated_at)}</span>
							</div>
							{#if versions[p.name]?.length}
								<details class="versions">
									<summary>Storico versioni ({versions[p.name].length})</summary>
									{#each versions[p.name] as v}
										<div class="vrow">
											<span class="ver">v{v.version}</span>
											<span class="vnote">{v.note || '—'}</span>
											<span class="vts">{fmtTs(v.created_at)}</span>
										</div>
									{/each}
								</details>
							{/if}
							{#if p.validation_report && Object.keys(p.validation_report).length}
								<details class="versions">
									<summary>Validation report</summary>
									<pre class="json">{JSON.stringify(p.validation_report, null, 2)}</pre>
								</details>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
{:else if tab === 'executions'}
	<div class="toolbar">
		<div class="segmented">
			<button class:active={execStatusFilter === ''} on:click={() => (execStatusFilter = '')}>Tutti</button>
			{#each ['RUNNING', 'CLAIMED', 'DELIVERED', 'FAILED', 'STALE', 'ESCALATED', 'DONE'] as s}
				<button class:active={execStatusFilter === s} on:click={() => (execStatusFilter = s)}>{s}</button>
			{/each}
		</div>
		<button on:click={loadExecutions} disabled={execState.kind === 'loading'}>
			{execState.kind === 'loading' ? 'Loading…' : 'Reload'}
		</button>
	</div>

	{#if execState.kind === 'loading'}
		<div class="list" aria-busy="true">
			{#each Array(6) as _}<div class="row"><Skeleton width="70%" height="13px" /></div>{/each}
		</div>
	{:else if execState.kind === 'error'}
		<div class="status error">
			<strong>Executions non caricabili.</strong>
			<div class="error-msg">{execState.message}</div>
			<button class="retry" on:click={loadExecutions}>Retry</button>
		</div>
	{:else if execItems.length === 0}
		<div class="status empty"><strong>Nessuna execution.</strong></div>
	{:else}
		<div class="table">
			<div class="thead">
				<span>Stato</span><span>Agent</span><span>Skill</span><span>Lane</span><span>Card</span><span>Avvio</span><span>Heartbeat</span><span></span>
			</div>
			{#each execItems as e (e.execution_id)}
				<button class="trow" on:click={() => openDetail(e.execution_id)}>
					<span><span class="badge {stateClass(e.status)}">{e.status}</span></span>
					<span class="mono">{e.agent || '—'}</span>
					<span class="mono">{e.skill || '—'}</span>
					<span class="ellip" title={e.lane}>{e.lane || '—'}</span>
					<span class="mono">{shortId(e.card_id)}</span>
					<span class="ts">{fmtTs(e.started_at)}</span>
					<span class="ts">{fmtTs(e.last_heartbeat_at)}</span>
					<span class="chev">›</span>
				</button>
			{/each}
		</div>
	{/if}
{:else}
	<div class="toolbar">
		<input type="search" bind:value={auditActionFilter} placeholder="Filtra per action…" on:keydown={(e) => e.key === 'Enter' && loadAudit()} />
		<button on:click={loadAudit} disabled={auditState.kind === 'loading'}>
			{auditState.kind === 'loading' ? 'Loading…' : 'Reload'}
		</button>
	</div>
	{#if auditState.kind === 'loading'}
		<div class="list" aria-busy="true">{#each Array(8) as _}<div class="row"><Skeleton width="80%" height="12px" /></div>{/each}</div>
	{:else if auditState.kind === 'error'}
		<div class="status error">
			<strong>Audit non caricabile.</strong>
			<div class="error-msg">{auditState.message}</div>
			<button class="retry" on:click={loadAudit}>Retry</button>
		</div>
	{:else if auditState.items.length === 0}
		<div class="status empty"><strong>Nessun evento di audit.</strong></div>
	{:else}
		<div class="table audit">
			<div class="thead"><span>Timestamp</span><span>Action</span><span>Agent</span><span>Execution</span><span>Payload</span></div>
			{#each auditState.items as ev (ev.id ?? `${ev.ts}-${ev.action}`)}
				<div class="trow static">
					<span class="ts">{fmtTs(ev.ts)}</span>
					<span class="mono action">{ev.action}</span>
					<span class="mono">{ev.agent || '—'}</span>
					<span class="mono">{shortId(ev.execution_id)}</span>
					<span class="payload" title={JSON.stringify(ev.payload)}>{ev.payload ? JSON.stringify(ev.payload) : '—'}</span>
				</div>
			{/each}
		</div>
	{/if}
{/if}

<!-- Seed task dialog -->
<Modal open={seedFor !== null} on:close={() => (seedFor = null)}>
	<h2 slot="title">Seed task · {seedFor?.name}</h2>
	<div class="form">
		<label>Titolo card<input type="text" bind:value={seedTitle} placeholder="Titolo della card iniziale" /></label>
		<label>Descrizione<textarea bind:value={seedDesc} rows="3" placeholder="Opzionale"></textarea></label>
	</div>
	<div slot="actions">
		<button on:click={() => (seedFor = null)}>Annulla</button>
		<button class="primary" on:click={doSeed} disabled={seeding || !seedTitle.trim()}>{seeding ? 'Creo…' : 'Crea card'}</button>
	</div>
</Modal>

<!-- Execution detail drawer -->
<Modal open={detail !== null || detailLoading} maxWidth={680} on:close={() => { detail = null; }}>
	<h2 slot="title">Execution {detail ? shortId(detail.execution_id) : ''}</h2>
	{#if detailLoading}
		<div class="loading-det"><Skeleton width="100%" height="16px" /><Skeleton width="80%" height="16px" /></div>
	{:else if detail}
		<div class="detail">
			<div class="dgrid">
				<dt>Execution ID</dt><dd class="mono">{detail.execution_id}</dd>
				<dt>Stato</dt><dd><span class="badge {stateClass(detail.status)}">{detail.status}</span></dd>
				<dt>Agent</dt><dd class="mono">{detail.agent || '—'}</dd>
				<dt>Skill</dt><dd class="mono">{detail.skill || '—'}</dd>
				<dt>Lane</dt><dd>{detail.lane || '—'}</dd>
				<dt>Card</dt><dd class="mono">{detail.card_id || '—'}</dd>
				<dt>Avvio</dt><dd>{fmtTs(detail.started_at)}</dd>
				<dt>Fine</dt><dd>{fmtTs(detail.finished_at)}</dd>
				<dt>Ultimo heartbeat</dt><dd>{fmtTs(detail.last_heartbeat_at)}</dd>
				{#if detail.retry_of}
					<dt>Retry di</dt>
					<dd><button class="link" on:click={() => detail && detail.retry_of && openDetail(detail.retry_of)}>{shortId(detail.retry_of)}</button></dd>
				{/if}
				{#if detail.workspace_path}<dt>Workspace</dt><dd class="mono small">{detail.workspace_path}</dd>{/if}
			</div>

			{#if detail.error}
				<div class="derr"><strong>Errore</strong><pre>{detail.error}</pre></div>
			{/if}

			<h3>Deliverables</h3>
			{#if detail.deliverables?.length}
				{#each detail.deliverables as d}
					<div class="deliv">
						<div class="deliv-head">
							<span class="badge muted">{d.result_type}</span>
							{#if d.status}<span class="dstatus">{d.status}</span>{/if}
							<span class="dts">{fmtTs(d.created_at)}</span>
						</div>
						{#if d.deliverables?.length}
							<pre class="json">{JSON.stringify(d.deliverables, null, 2)}</pre>
						{/if}
						{#if d.side_effects?.length}
							<div class="side"><strong>Side effects:</strong> <code>{JSON.stringify(d.side_effects)}</code></div>
						{/if}
					</div>
				{/each}
			{:else}
				<p class="hint">Nessun deliverable registrato per questa execution.</p>
			{/if}
		</div>
	{/if}
	<div slot="actions">
		<button on:click={() => { detail = null; }}>Chiudi</button>
	</div>
</Modal>

<style>
	.head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 16px;
		margin-bottom: 14px;
		flex-wrap: wrap;
	}
	.head-actions {
		display: flex;
		gap: 8px;
	}
	.hint {
		margin: 4px 0 0;
		color: var(--fg-muted);
		font-size: 12px;
	}
	.tabs {
		display: flex;
		gap: 4px;
		margin-bottom: 16px;
		border-bottom: 1px solid var(--border);
	}
	.tabs button {
		padding: 9px 14px;
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		color: var(--fg-muted);
		font-weight: 600;
		font-size: 13px;
		cursor: pointer;
	}
	.tabs button.active {
		color: var(--fg);
		border-bottom-color: var(--accent);
	}

	.panel {
		background: var(--card-bg);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 14px 16px;
		margin-bottom: 16px;
	}
	.panel h2 {
		margin: 0 0 2px;
		font-size: 14px;
	}
	.strategy-row {
		display: flex;
		gap: 8px;
		margin-top: 10px;
	}
	.strategy-row input {
		flex: 1 1 auto;
	}

	.toolbar {
		display: flex;
		gap: 10px;
		margin-bottom: 14px;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
	}
	input,
	textarea {
		padding: 9px 11px;
		border-radius: 6px;
		border: 1px solid var(--border);
		background: var(--card-bg);
		color: var(--fg);
		font: inherit;
	}
	.segmented {
		display: inline-flex;
		gap: 4px;
		flex-wrap: wrap;
	}
	.segmented button {
		padding: 6px 9px;
		font-size: 11px;
	}
	.segmented button.active {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--accent-fg);
		font-weight: 700;
	}

	.list {
		background: var(--card-bg);
		border: 1px solid var(--border);
		border-radius: 8px;
		overflow: hidden;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 13px 16px;
		border-bottom: 1px solid var(--border);
	}
	.row:last-child {
		border-bottom: none;
	}

	/* Pipelines */
	.pipe {
		border-bottom: 1px solid var(--border);
		padding: 12px 16px;
	}
	.pipe:last-child {
		border-bottom: none;
	}
	.pipe-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		flex-wrap: wrap;
	}
	.expander {
		display: flex;
		align-items: center;
		gap: 10px;
		background: transparent;
		border: none;
		cursor: pointer;
		color: inherit;
		padding: 0;
	}
	.caret {
		font-size: 10px;
		color: var(--fg-muted);
		transition: transform 0.12s ease;
	}
	.caret.open {
		transform: rotate(90deg);
	}
	.pname {
		font-family: var(--mono);
		font-weight: 700;
		font-size: 13px;
	}
	.ver {
		font-size: 11px;
		color: var(--fg-muted);
	}
	.pipe-actions {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}
	.pipe-actions button {
		padding: 5px 9px;
		font-size: 11px;
	}
	.pipe-obj {
		margin-top: 6px;
		color: var(--fg-muted);
		font-size: 12.5px;
	}
	.pipe-body {
		margin-top: 12px;
	}
	.steps {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}
	.step {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 4px 8px;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--bg);
		font-size: 11.5px;
	}
	.step-n {
		color: var(--fg-muted);
		font-size: 10px;
	}
	.step-name {
		font-weight: 600;
	}
	.step-skill {
		font-family: var(--mono);
		color: var(--accent);
		font-size: 10.5px;
	}
	.step-gate {
		color: var(--warn, #c79a2e);
		font-size: 10.5px;
	}
	.arrow {
		color: var(--fg-muted);
	}
	.meta-line {
		display: flex;
		gap: 14px;
		flex-wrap: wrap;
		margin-top: 10px;
		font-size: 11.5px;
		color: var(--fg-muted);
	}
	.versions {
		margin-top: 10px;
		font-size: 12px;
	}
	.versions summary {
		cursor: pointer;
		color: var(--fg-muted);
	}
	.vrow {
		display: flex;
		gap: 12px;
		padding: 4px 0;
	}
	.vnote {
		flex: 1 1 auto;
	}
	.vts {
		color: var(--fg-muted);
	}

	/* Tables (executions + audit) */
	.table {
		background: var(--card-bg);
		border: 1px solid var(--border);
		border-radius: 8px;
		overflow: hidden;
	}
	.thead,
	.trow {
		display: grid;
		grid-template-columns: 110px 90px 110px 1fr 90px 130px 130px 20px;
		gap: 10px;
		align-items: center;
		padding: 10px 14px;
	}
	.table.audit .thead,
	.table.audit .trow {
		grid-template-columns: 150px 160px 90px 90px 1fr;
	}
	.thead {
		font-size: 10.5px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--fg-muted);
		border-bottom: 1px solid var(--border);
		background: var(--bg);
	}
	.trow {
		width: 100%;
		text-align: left;
		background: transparent;
		border: none;
		border-bottom: 1px solid var(--border);
		color: inherit;
		font-size: 12px;
		cursor: pointer;
	}
	.trow.static {
		cursor: default;
	}
	.trow:last-child {
		border-bottom: none;
	}
	button.trow:hover {
		background: rgba(255, 107, 61, 0.06);
	}
	.chev,
	.chev {
		color: var(--fg-muted);
	}
	.ts {
		font-size: 11px;
		color: var(--fg-muted);
	}
	.ellip,
	.payload {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.action {
		color: var(--accent);
	}
	.payload {
		font-size: 11px;
		color: var(--fg-muted);
		font-family: var(--mono);
	}

	.mono {
		font-family: var(--mono);
		font-size: 11.5px;
	}
	.small {
		font-size: 10.5px;
		word-break: break-all;
	}

	/* Badges */
	.badge {
		display: inline-block;
		padding: 2px 8px;
		border-radius: 999px;
		font-size: 10.5px;
		font-weight: 700;
		letter-spacing: 0.02em;
	}
	.badge.ok {
		background: rgba(60, 170, 110, 0.16);
		color: #3caa6e;
	}
	.badge.busy {
		background: rgba(70, 130, 220, 0.16);
		color: #4682dc;
	}
	.badge.warn {
		background: rgba(199, 154, 46, 0.18);
		color: #c79a2e;
	}
	.badge.err {
		background: rgba(232, 93, 117, 0.16);
		color: var(--danger);
	}
	.badge.muted {
		background: rgba(140, 140, 140, 0.16);
		color: var(--fg-muted);
	}

	/* Detail drawer */
	.dgrid {
		display: grid;
		grid-template-columns: 130px 1fr;
		gap: 6px 12px;
		font-size: 12.5px;
	}
	.dgrid dt {
		color: var(--fg-muted);
	}
	.dgrid dd {
		margin: 0;
	}
	.detail h3 {
		margin: 16px 0 8px;
		font-size: 13px;
	}
	.deliv {
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 8px 10px;
		margin-bottom: 8px;
	}
	.deliv-head {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.dstatus {
		font-size: 11px;
		font-weight: 600;
	}
	.dts {
		margin-left: auto;
		font-size: 11px;
		color: var(--fg-muted);
	}
	.side {
		margin-top: 6px;
		font-size: 11.5px;
	}
	.derr {
		margin-top: 12px;
		padding: 8px 10px;
		border: 1px solid rgba(232, 93, 117, 0.5);
		border-radius: 6px;
		background: rgba(232, 93, 117, 0.07);
	}
	.derr pre,
	.json {
		margin: 6px 0 0;
		font-family: var(--mono);
		font-size: 11px;
		white-space: pre-wrap;
		word-break: break-word;
		max-height: 280px;
		overflow: auto;
	}
	.link {
		background: transparent;
		border: none;
		color: var(--accent);
		cursor: pointer;
		font-family: var(--mono);
		font-size: 11.5px;
		padding: 0;
		text-decoration: underline;
	}
	.form {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.form label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 12px;
		color: var(--fg-muted);
	}
	.loading-det {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	/* Buttons */
	button.primary {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--accent-fg);
		font-weight: 700;
	}
	button.danger:hover {
		border-color: var(--danger);
		color: var(--danger);
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
		text-align: center;
		padding: 36px 24px;
	}
	.error-msg {
		margin-top: 8px;
		font-family: var(--mono);
		font-size: 12px;
		color: var(--danger);
		white-space: pre-wrap;
	}
	.retry {
		margin-top: 12px;
	}
</style>
