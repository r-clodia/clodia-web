<script lang="ts">
	/**
	 * WORKFLOWS — board dei workflow dichiarativi dei pack. Read-mostly:
	 * le card le muovono gli agenti (una colonna per lane); l'umano avvia un
	 * run e approva/respinge sui gate (waiting_approval). Feature `kanban`.
	 */
	import { onDestroy, onMount } from 'svelte';
	import {
		listWorkflows, startWorkflowRun, approveWorkflowRun, rejectWorkflowRun,
		type WorkflowDef, type WorkflowRun
	} from '$lib/api/client';

	let defs: Record<string, WorkflowDef> = {};
	let runs: WorkflowRun[] = [];
	let loading = true;
	let err = '';
	let busy: Record<string, boolean> = {};
	let poll: ReturnType<typeof setInterval> | null = null;

	async function refresh() {
		try {
			const r = await listWorkflows();
			defs = r.workflows;
			runs = r.runs;
			err = '';
		} catch (e) {
			err = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	async function start(key: string) {
		const d = defs[key];
		if (!d) return;
		const title = prompt(`Titolo della card per «${d.name}»:`, d.name);
		if (title === null) return;
		busy = { ...busy, [key]: true };
		try {
			await startWorkflowRun(d.plugin, d.name, { title: title || d.name });
			await refresh();
		} finally {
			busy = { ...busy, [key]: false };
		}
	}

	async function decide(run: WorkflowRun, ok: boolean) {
		const note = prompt(ok ? 'Nota di approvazione (opzionale):' : 'Motivo del rifiuto:') ?? '';
		busy = { ...busy, [run.id]: true };
		try {
			ok ? await approveWorkflowRun(run.id, note) : await rejectWorkflowRun(run.id, note);
			await refresh();
		} finally {
			busy = { ...busy, [run.id]: false };
		}
	}

	// Stato lane→classe per la card: done/current/pending/failed.
	function laneState(run: WorkflowRun, idx: number): string {
		if (run.status === 'rejected' && idx === run.current) return 'rejected';
		if (run.status === 'failed' && idx === run.current) return 'failed';
		if (idx < run.current || run.status === 'done') return 'done';
		if (idx === run.current) {
			if (run.status === 'waiting_approval') return 'gate';
			if (run.status === 'running') return 'running';
			return 'current';
		}
		return 'pending';
	}

	onMount(() => {
		refresh();
		poll = setInterval(() => { if (!document.hidden) refresh(); }, 15000);
	});
	onDestroy(() => poll && clearInterval(poll));
</script>

<header class="wf-head">
	<h1>Workflows</h1>
	<button type="button" on:click={refresh} disabled={loading}>
		{loading ? 'Loading…' : 'Reload'}
	</button>
</header>

{#if err}
	<p class="wf-err">⚠ {err}</p>
{/if}

<section class="wf-catalog">
	<h2>Disponibili</h2>
	{#if Object.keys(defs).length === 0}
		<p class="wf-empty">Nessun workflow dichiarato dai pack installati.</p>
	{:else}
		<div class="wf-defs">
			{#each Object.entries(defs) as [key, d] (key)}
				<div class="wf-def">
					<div class="wf-def-name">{d.name} <span class="wf-plugin">{d.plugin}</span></div>
					<div class="wf-def-lanes">{d.stages.map((s) => s.lane).join(' → ')}</div>
					<button type="button" class="wf-start" on:click={() => start(key)} disabled={busy[key]}>
						{busy[key] ? '…' : '+ Avvia'}
					</button>
				</div>
			{/each}
		</div>
	{/if}
</section>

<section class="wf-runs">
	<h2>Run</h2>
	{#if runs.length === 0}
		<p class="wf-empty">Nessun run. Avvia un workflow qui sopra.</p>
	{/if}
	{#each runs as run (run.id)}
		<article class="wf-run" class:done={run.status === 'done'} class:failed={run.status === 'failed'} class:rejected={run.status === 'rejected'}>
			<div class="wf-run-top">
				<strong>{run.title}</strong>
				<span class="wf-badge wf-{run.status}">{run.status}</span>
				<span class="wf-run-wf">{run.plugin}/{run.workflow}</span>
			</div>
			<div class="wf-board">
				{#each run.stages as st, i (st.lane)}
					{@const state = laneState(run, i)}
					{@const hist = run.history.filter((h) => h.lane === st.lane).at(-1)}
					<div class="wf-lane wf-lane-{state}">
						<div class="wf-lane-name">{st.lane}{#if st.human_gate}<span title="Gate umano"> 🔒</span>{/if}</div>
						<div class="wf-lane-skill">{st.skill}</div>
						{#if hist}
							<div class="wf-lane-agent">{hist.agent ?? '—'}</div>
							{#if hist.summary}<div class="wf-lane-summary">{hist.summary.slice(0, 220)}</div>{/if}
						{/if}
					</div>
				{/each}
			</div>
			{#if run.status === 'waiting_approval'}
				<div class="wf-gate">
					<span>In attesa di approvazione sulla lane «{run.stages[run.current]?.lane}»</span>
					<button type="button" class="wf-ok" on:click={() => decide(run, true)} disabled={busy[run.id]}>✓ Approva</button>
					<button type="button" class="wf-no" on:click={() => decide(run, false)} disabled={busy[run.id]}>✗ Respingi</button>
				</div>
			{/if}
		</article>
	{/each}
</section>

<style>
	.wf-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
	.wf-head h1 { font-size: 18px; margin: 0; }
	.wf-err { color: #ef4444; }
	.wf-empty { color: var(--fg-muted); font-size: 13px; }
	.wf-catalog, .wf-runs { margin: 16px 0; }
	.wf-catalog h2, .wf-runs h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--fg-muted); }
	.wf-defs { display: flex; flex-wrap: wrap; gap: 10px; }
	.wf-def { border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; min-width: 220px; }
	.wf-def-name { font-weight: 700; font-size: 13px; }
	.wf-plugin { font-weight: 400; font-size: 11px; color: var(--fg-muted); }
	.wf-def-lanes { font-size: 11px; color: var(--fg-muted); margin: 4px 0 8px; }
	.wf-start { font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 6px; border: 1px solid var(--accent); background: var(--accent); color: var(--accent-fg); cursor: pointer; }
	.wf-run { border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin: 10px 0; }
	.wf-run.done { opacity: 0.75; }
	.wf-run.failed, .wf-run.rejected { border-color: rgba(239,68,68,0.5); }
	.wf-run-top { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
	.wf-run-wf { font-size: 11px; color: var(--fg-muted); margin-left: auto; }
	.wf-badge { font-size: 10px; font-weight: 700; text-transform: uppercase; padding: 2px 7px; border-radius: 999px; background: rgba(120,144,156,0.16); }
	.wf-waiting_approval { background: rgba(199,154,46,0.2); color: #c79a2e; }
	.wf-running { background: rgba(96,165,250,0.18); color: #60a5fa; }
	.wf-done { background: rgba(52,199,89,0.18); color: #34c759; }
	.wf-failed, .wf-rejected { background: rgba(239,68,68,0.18); color: #ef4444; }
	.wf-board { display: flex; gap: 8px; overflow-x: auto; }
	.wf-lane { flex: 1 0 150px; border: 1px solid var(--border); border-radius: 7px; padding: 8px; background: var(--card-bg, transparent); }
	.wf-lane-name { font-weight: 700; font-size: 12px; }
	.wf-lane-skill { font-size: 10px; color: var(--fg-muted); }
	.wf-lane-agent { font-size: 11px; margin-top: 4px; }
	.wf-lane-summary { font-size: 10.5px; color: var(--fg-muted); margin-top: 4px; white-space: pre-wrap; }
	.wf-lane-done { border-color: rgba(52,199,89,0.5); }
	.wf-lane-running, .wf-lane-current { border-color: var(--accent); }
	.wf-lane-gate { border-color: rgba(199,154,46,0.6); }
	.wf-lane-failed, .wf-lane-rejected { border-color: rgba(239,68,68,0.6); }
	.wf-lane-pending { opacity: 0.55; }
	.wf-gate { display: flex; align-items: center; gap: 10px; margin-top: 10px; font-size: 12.5px; }
	.wf-ok { font: inherit; font-size: 12px; padding: 4px 12px; border-radius: 6px; border: 1px solid #34c759; background: rgba(52,199,89,0.15); color: #34c759; cursor: pointer; }
	.wf-no { font: inherit; font-size: 12px; padding: 4px 12px; border-radius: 6px; border: 1px solid #ef4444; background: rgba(239,68,68,0.12); color: #ef4444; cursor: pointer; }
</style>
