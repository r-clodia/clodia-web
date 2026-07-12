<script lang="ts">
	/**
	 * WORKFLOW DETAIL — /workflows/{plugin}/{name}.
	 * In alto: la card con la pipeline (definizione degli stadi).
	 * Sotto: la lista dei run di QUESTO workflow, ognuno con lo step corrente
	 * evidenziato + l'interazione inline (domanda/gate) quando serve.
	 * Lo start è un trigger; qui c'è il bottone, ma un run può nascere anche
	 * da una pill in un topic o da un job.
	 */
	import { onDestroy, onMount } from 'svelte';
	import { page } from '$app/stores';
	import {
		listWorkflows, startWorkflowRun, answerWorkflowRun, cancelWorkflowRun, deleteWorkflowRun,
		type WorkflowDef, type WorkflowRun
	} from '$lib/api/client';

	$: plugin = decodeURIComponent($page.params.plugin ?? '');
	$: name = decodeURIComponent($page.params.name ?? '');

	let def: WorkflowDef | null = null;
	let runs: WorkflowRun[] = [];
	let loading = true;
	let err = '';
	let busy: Record<string, boolean> = {};
	let answerText: Record<string, string> = {};
	let openStep: Record<string, number | null> = {};   // run.id → indice step ispezionato
	let poll: ReturnType<typeof setInterval> | null = null;

	// ultima entry di history relativa a uno step (per indice), o null
	function entryFor(run: WorkflowRun, idx: number) {
		const es = (run.history ?? []).filter((h) => h.stage_idx === idx);
		return es.length ? es[es.length - 1] : null;
	}
	function toggleStep(run: WorkflowRun, idx: number) {
		openStep = { ...openStep, [run.id]: openStep[run.id] === idx ? null : idx };
	}

	async function refresh() {
		try {
			const r = await listWorkflows();
			def = r.workflows[`${plugin}/${name}`] ?? null;
			runs = r.runs
				.filter((x) => x.plugin === plugin && x.workflow === name)
				.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
			err = '';
		} catch (e) {
			err = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	async function start() {
		// Vuoto → il backend assegna il nome automatico «{workflow} #N».
		const title = prompt(`Nome del run per «${name}» (vuoto = «${name} #N» automatico):`, '');
		if (title === null) return;
		busy = { ...busy, __start: true };
		try {
			await startWorkflowRun(plugin, name, { title });
			await refresh();
		} finally {
			busy = { ...busy, __start: false };
		}
	}

	async function answer(run: WorkflowRun, text: string) {
		const t = (text ?? '').trim();
		if (!t) return;
		busy = { ...busy, [run.id]: true };
		try {
			await answerWorkflowRun(run.id, t);
			answerText = { ...answerText, [run.id]: '' };
			await refresh();
		} finally {
			busy = { ...busy, [run.id]: false };
		}
	}

	async function stop(run: WorkflowRun) {
		if (!confirm(`Interrompere il run «${run.title}»?`)) return;
		busy = { ...busy, [run.id]: true };
		try {
			await cancelWorkflowRun(run.id, '');
			await refresh();
		} finally {
			busy = { ...busy, [run.id]: false };
		}
	}

	async function del(run: WorkflowRun) {
		const active = !['done', 'failed', 'cancelled'].includes(run.status);
		const msg = active
			? `Il run «${run.title}» è ancora attivo: verrà annullato ed eliminato. Procedere?`
			: `Eliminare il run «${run.title}» dalla lista?`;
		if (!confirm(msg)) return;
		busy = { ...busy, [run.id]: true };
		try {
			await deleteWorkflowRun(run.id);
			await refresh();
		} finally {
			busy = { ...busy, [run.id]: false };
		}
	}

	// datetime compatta (locale) per inizio/fine run
	function fmtDt(s: string | null | undefined): string {
		if (!s) return '—';
		const d = new Date(s);
		if (isNaN(d.getTime())) return '—';
		return d.toLocaleString('it-IT', {
			day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
		});
	}

	// classe di uno step nella mini-pipeline di un run
	function stepState(run: WorkflowRun, idx: number): string {
		if (run.status === 'failed' && idx === run.current) return 'failed';
		if (run.status === 'cancelled' && idx === run.current) return 'cancelled';
		if (idx < run.current || run.status === 'done') return 'done';
		if (idx === run.current) {
			if (run.status === 'await') return run.gate_pending ? 'gate' : 'await';
			if (run.status === 'running') return 'running';
			return 'current';
		}
		return 'pending';
	}

	onMount(() => {
		refresh();
		poll = setInterval(() => { if (!document.hidden) refresh(); }, 10000);
	});
	onDestroy(() => poll && clearInterval(poll));
</script>

<header class="wf-head">
	<div>
		<a class="wf-back" href="/workflows">← Workflows</a>
		<h1>{name} <span class="wf-plugin">{plugin}</span></h1>
	</div>
	<button type="button" class="wf-start" on:click={start} disabled={busy.__start || !def}>+ Avvia run</button>
</header>

{#if err}<p class="wf-err">⚠ {err}</p>{/if}

{#if def}
	<!-- Pipeline (definizione) -->
	<section class="wf-pipeline">
		<h2>Pipeline</h2>
		<div class="wf-stages">
			{#each def.stages as st, i (st.lane)}
				<div class="wf-stage">
					<div class="wf-stage-name">{st.lane}{#if st.human_gate}<span title="Gate umano"> 🔒</span>{/if}</div>
					<div class="wf-stage-skill">{st.skill}</div>
				</div>
				{#if i < def.stages.length - 1}<span class="wf-arrow">→</span>{/if}
			{/each}
		</div>
	</section>

	<!-- Run di questo workflow -->
	<section class="wf-runs">
		<h2>Run</h2>
		{#if runs.length === 0}
			<p class="wf-empty">Nessun run. Avvia il workflow qui sopra.</p>
		{/if}
		{#each runs as run (run.id)}
			<article class="wf-run" class:done={run.status === 'done'} class:failed={run.status === 'failed' || run.status === 'cancelled'}>
				<div class="wf-run-top">
					<strong>{run.title}</strong>
					<span class="wf-badge wf-{run.status}">{run.status}</span>
					{#if !['done', 'failed', 'cancelled'].includes(run.status)}
						<span class="wf-cur">▶ {run.stages[run.current]?.lane}</span>
						<button type="button" class="wf-stop" on:click={() => stop(run)} disabled={busy[run.id]} title="Interrompi">■</button>
					{/if}
					<button type="button" class="wf-del" on:click={() => del(run)} disabled={busy[run.id]} title="Elimina run">✕</button>
				</div>
				<div class="wf-when">
					<span title="inizio">▷ {fmtDt(run.started_at ?? run.created_at)}</span>
					{#if run.ended_at}
						<span title="fine">◼ {fmtDt(run.ended_at)}</span>
					{/if}
				</div>
				<div class="wf-track">
					{#each run.stages as st, i (st.lane)}
						<button
							type="button"
							class="wf-dot wf-dot-{stepState(run, i)}"
							class:sel={openStep[run.id] === i}
							title="{st.lane} — {stepState(run, i)}"
							on:click={() => toggleStep(run, i)}
						></button>
					{/each}
				</div>

				{#if openStep[run.id] != null}
					{@const idx = openStep[run.id] ?? 0}
					{@const st = run.stages[idx]}
					{@const e = entryFor(run, idx)}
					<div class="wf-step">
						<div class="wf-step-head">
							<strong>{idx + 1}. {st?.lane}</strong>
							<span class="wf-badge wf-{e?.status ?? stepState(run, idx)}">{e?.status ?? stepState(run, idx)}</span>
							{#if st?.human_gate}<span title="Gate umano">🔒</span>{/if}
							<button type="button" class="wf-step-x" on:click={() => toggleStep(run, idx)} title="Chiudi">×</button>
						</div>
						<div class="wf-step-meta">
							<span>skill: {st?.skill}</span>
							{#if e?.agent}<span>agente: {e.agent}</span>{/if}
							<span>▷ {fmtDt(e?.started_at)}</span>
							{#if e?.finished_at}<span>◼ {fmtDt(e.finished_at)}</span>{/if}
						</div>
						{#if !e}
							<p class="wf-step-empty">Step non ancora eseguito.</p>
						{:else}
							{#if e.artefatto}
								<div class="wf-step-art">Artefatto: <code>{e.artefatto}</code></div>
							{/if}
							<details class="wf-step-io">
								<summary>Input</summary>
								<pre>{e.input || '—'}</pre>
							</details>
							<details class="wf-step-io" open>
								<summary>Output{e.status === 'running' ? ' (in corso…)' : e.status === 'await' ? ' (parziale — in attesa)' : ''}</summary>
								<pre>{e.summary || (e.status === 'running' ? 'in esecuzione…' : '—')}</pre>
							</details>
						{/if}
					</div>
				{/if}
				{#if run.status === 'await' && run.question}
					<div class="wf-ask" class:gate={run.question.gate}>
						<div class="wf-ask-lane">{run.stages[run.current]?.lane}{run.question.gate ? ' · gate' : ''}</div>
						<div class="wf-ask-text">{run.question.text}</div>
						{#if run.question.choices.length}
							<div class="wf-pills">
								{#each run.question.choices as c (c)}
									<button type="button" class="wf-pill" on:click={() => answer(run, c)} disabled={busy[run.id]}>{c}</button>
								{/each}
							</div>
						{:else}
							<div class="wf-answer-row">
								<input type="text" placeholder="La tua risposta…" bind:value={answerText[run.id]}
									on:keydown={(e) => e.key === 'Enter' && answer(run, answerText[run.id])} disabled={busy[run.id]} />
								<button type="button" class="wf-send" on:click={() => answer(run, answerText[run.id])} disabled={busy[run.id]}>Invia</button>
							</div>
						{/if}
					</div>
				{/if}
			</article>
		{/each}
	</section>
{:else if !loading}
	<p class="wf-empty">Workflow «{plugin}/{name}» non trovato.</p>
{/if}

<style>
	.wf-head { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 14px; }
	.wf-head h1 { font-size: 18px; margin: 4px 0 0; }
	.wf-back { font-size: 12px; color: var(--fg-muted); text-decoration: none; }
	.wf-plugin { font-size: 12px; font-weight: 400; color: var(--fg-muted); }
	.wf-err { color: #ef4444; }
	.wf-empty { color: var(--fg-muted); font-size: 13px; }
	.wf-start { font: inherit; font-size: 12.5px; font-weight: 700; padding: 7px 13px; border-radius: 7px; border: 1px solid var(--accent); background: var(--accent); color: var(--accent-fg); cursor: pointer; }
	.wf-pipeline, .wf-runs { margin: 18px 0; }
	.wf-pipeline h2, .wf-runs h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--fg-muted); }
	.wf-stages { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 12px; border: 1px solid var(--border); border-radius: 10px; }
	.wf-stage { border: 1px solid var(--border); border-radius: 8px; padding: 7px 10px; min-width: 110px; }
	.wf-stage-name { font-weight: 700; font-size: 12.5px; }
	.wf-stage-skill { font-size: 10px; color: var(--fg-muted); }
	.wf-arrow { opacity: 0.45; }
	.wf-run { border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin: 10px 0; }
	.wf-when { display: flex; gap: 14px; font-size: 11px; opacity: 0.6; margin: 2px 0 6px; }
	.wf-run.done { opacity: 0.7; }
	.wf-run.failed { border-color: rgba(239,68,68,0.5); }
	.wf-run-top { display: flex; align-items: center; gap: 10px; }
	.wf-badge { font-size: 10px; font-weight: 700; text-transform: uppercase; padding: 2px 7px; border-radius: 999px; background: rgba(120,144,156,0.16); }
	.wf-await { background: rgba(199,154,46,0.2); color: #c79a2e; }
	.wf-running { background: rgba(96,165,250,0.18); color: #60a5fa; }
	.wf-done { background: rgba(52,199,89,0.18); color: #34c759; }
	.wf-failed, .wf-cancelled { background: rgba(239,68,68,0.18); color: #ef4444; }
	.wf-cur { font-size: 11px; color: var(--fg-muted); }
	.wf-stop { margin-left: auto; font: inherit; font-size: 11px; padding: 2px 8px; border-radius: 6px; border: 1px solid rgba(239,68,68,0.5); background: rgba(239,68,68,0.1); color: #ef4444; cursor: pointer; }
	.wf-del { margin-left: auto; font: inherit; font-size: 12px; line-height: 1; padding: 3px 7px; border-radius: 6px; border: 1px solid var(--border); background: transparent; color: var(--fg-muted); cursor: pointer; }
	.wf-del:hover { border-color: #ef4444; color: #ef4444; }
	.wf-track { display: flex; gap: 5px; margin: 8px 0; }
	.wf-dot { width: 13px; height: 13px; padding: 0; border-radius: 50%; border: 1px solid var(--border); background: transparent; cursor: pointer; transition: transform 0.1s; }
	.wf-dot:hover { transform: scale(1.25); }
	.wf-dot.sel { box-shadow: 0 0 0 2px var(--accent); }
	.wf-dot-done { background: #34c759; border-color: #34c759; }
	.wf-dot-running { background: #60a5fa; border-color: #60a5fa; }
	.wf-dot-await, .wf-dot-gate { background: #c79a2e; border-color: #c79a2e; }
	.wf-dot-failed, .wf-dot-cancelled { background: #ef4444; border-color: #ef4444; }

	.wf-step { margin: 8px 0 4px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; background: rgba(120,144,156,0.06); }
	.wf-step-head { display: flex; align-items: center; gap: 8px; }
	.wf-step-head strong { font-size: 13px; }
	.wf-step-x { margin-left: auto; border: none; background: transparent; font-size: 16px; line-height: 1; cursor: pointer; color: var(--fg-muted); }
	.wf-step-meta { display: flex; flex-wrap: wrap; gap: 10px; font-size: 11px; color: var(--fg-muted); margin: 6px 0; }
	.wf-step-empty { font-size: 12px; color: var(--fg-muted); }
	.wf-step-art { font-size: 11.5px; margin: 4px 0; }
	.wf-step-art code { font-size: 11px; word-break: break-all; }
	.wf-step-io { margin: 4px 0; }
	.wf-step-io summary { font-size: 11.5px; font-weight: 700; cursor: pointer; color: var(--fg-muted); }
	.wf-step-io pre { margin: 6px 0 0; padding: 8px; max-height: 260px; overflow: auto; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; font-size: 11px; white-space: pre-wrap; word-break: break-word; }
	.wf-ask { margin-top: 10px; padding: 10px 12px; border-radius: 8px; border: 1px solid rgba(199,154,46,0.5); background: rgba(199,154,46,0.08); }
	.wf-ask.gate { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, transparent); }
	.wf-ask-lane { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--fg-muted); margin-bottom: 4px; }
	.wf-ask-text { font-size: 13px; white-space: pre-wrap; margin-bottom: 8px; }
	.wf-pills { display: flex; flex-wrap: wrap; gap: 6px; }
	.wf-pill { font: inherit; font-size: 12px; padding: 5px 12px; border-radius: 999px; border: 1px solid var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent); color: inherit; cursor: pointer; }
	.wf-pill:hover { background: color-mix(in srgb, var(--accent) 26%, transparent); }
	.wf-answer-row { display: flex; gap: 8px; }
	.wf-answer-row input { flex: 1; font: inherit; font-size: 13px; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--card-bg, transparent); color: var(--fg); }
	.wf-send { font: inherit; font-size: 12px; padding: 6px 14px; border-radius: 6px; border: 1px solid var(--accent); background: var(--accent); color: var(--accent-fg); cursor: pointer; }
</style>
