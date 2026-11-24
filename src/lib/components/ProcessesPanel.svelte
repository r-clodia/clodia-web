<script lang="ts">
	// clodia-platform#738: the deterministic processes — courier, topic
	// indexer, logic jobs such as the backup — on the Jobs and Activity pages.
	// A spawn uses an LLM and is counted in tokens; a process has runs,
	// duration and failures. Admin only: on 403 the panel is not shown.
	import { onDestroy, onMount } from 'svelte';
	import { ApiError, getProcesses, runProcess, type ProcessRow } from '$lib/api/client';
	import { PROCESS_STATUS_LABEL, cadence, countersText, sortProcesses } from '$lib/processes.js';
	import { fmtDuration } from '$lib/topicUsage.js';

	/** `activity` shows the 24h/7d/4w windows; `jobs` the cadence and next run. */
	export let variant: 'activity' | 'jobs' = 'activity';

	let rows: ProcessRow[] = [];
	let err = '';
	let hidden = false;
	let loading = true;
	let win = '24h';
	let asked: Record<string, boolean> = {};
	let poll: ReturnType<typeof setInterval> | null = null;
	const WINDOWS = ['24h', '7d', '4w'];

	async function load() {
		try {
			rows = sortProcesses((await getProcesses()).processes);
			err = '';
		} catch (e) {
			if (e instanceof ApiError && (e.status === 401 || e.status === 403)) hidden = true;
			else err = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	async function runNow(p: ProcessRow) {
		asked = { ...asked, [p.name]: true };
		try {
			await runProcess(p.name);
			setTimeout(load, 3000);
		} catch (e) {
			err = e instanceof Error ? e.message : String(e);
		} finally {
			setTimeout(() => (asked = { ...asked, [p.name]: false }), 3000);
		}
	}

	function when(ts?: string | null): string {
		if (!ts) return '—';
		const d = new Date(ts);
		if (isNaN(d.getTime())) return ts;
		const same = d.toDateString() === new Date().toDateString();
		return same
			? d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
			: d.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
	}

	onMount(() => {
		void load();
		poll = setInterval(load, 10000);
	});
	onDestroy(() => {
		if (poll) clearInterval(poll);
	});
</script>

{#if !hidden}
	<section class="panel processes-panel" class:in-jobs={variant === 'jobs'}>
		<div class="panel-head">
			<h2>Processi</h2>
			{#if variant === 'activity'}
				<div class="seg" role="group" aria-label="Periodo">
					{#each WINDOWS as w}
						<button type="button" class:on={win === w} aria-pressed={win === w} on:click={() => (win = w)}>{w}</button>
					{/each}
				</div>
			{:else}
				<span class="panel-count">deterministici, senza modello</span>
			{/if}
		</div>
		{#if err}
			<p class="muted">Processi non disponibili: {err}</p>
		{:else if loading}
			<p class="muted">Caricamento…</p>
		{:else if rows.length === 0}
			<p class="muted">Nessun processo registrato.</p>
		{:else}
			<div class="table-wrap">
				<table class="tbl">
					<thead>
						<tr>
							<th>Processo</th><th>Stato</th><th>Ultimo giro</th>
							{#if variant === 'activity'}
								<th class="num">Giri</th><th class="num">Errori</th><th class="num">Tempo</th>
							{:else}
								<th>Cadenza</th><th>Prossimo</th>
							{/if}
							<th></th>
						</tr>
					</thead>
					<tbody>
						{#each rows as p (p.name)}
							{@const b = p.windows?.[win]}
							<tr>
								<td>
									<span class="pname">⚙︎ {p.label}</span>
									<span class="src">{p.source === 'job' ? 'job' : 'loop'}</span>
								</td>
								<td><span class="pstate {p.status}">{PROCESS_STATUS_LABEL[p.status] ?? p.status}</span></td>
								<td class="last">
									{when(p.last_started_at)}
									{#if p.last_duration_s != null}<span class="muted"> · {fmtDuration(p.last_duration_s)}</span>{/if}
									{#if p.last_error}
										<div class="perr" title={p.last_error}>{p.last_error}</div>
									{:else if countersText(p.last_counters)}
										<div class="muted small">{countersText(p.last_counters)}</div>
									{/if}
								</td>
								{#if variant === 'activity'}
									<td class="num">{b?.runs ?? 0}</td>
									<td class="num" class:bad={(b?.failures ?? 0) > 0}>{b?.failures ?? 0}</td>
									<td class="num">{fmtDuration(b?.seconds ?? 0)}</td>
								{:else}
									<td><span class="muted">{cadence(p)}</span></td>
									<td>{when(p.next_run_at)}</td>
								{/if}
								<td class="act">
									{#if p.source === 'job' && p.job_id != null}
										<a href={`/jobs/${p.job_id}`}>apri job</a>
									{:else if p.can_run_now}
										<button type="button" disabled={asked[p.name]} on:click={() => runNow(p)}>
											{asked[p.name] ? 'richiesto' : 'Esegui ora'}
										</button>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
{/if}

<style>
	.panel { min-height: 0; display: flex; flex-direction: column; border-top: 1px solid var(--border); padding-top: 12px; }
	.panel.in-jobs { margin-bottom: 18px; }
	.panel-head { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 8px; flex-wrap: wrap; }
	.panel h2 { margin: 0; font-size: 14px; line-height: 1.2; text-transform: uppercase; letter-spacing: 0.05em; }
	.panel-count, .muted { color: var(--fg-muted); }
	.panel-count { font-size: 12px; }
	.small { font-size: 11.5px; }
	.table-wrap { overflow-x: auto; }
	.tbl { width: 100%; border-collapse: collapse; font-size: 13px; }
	.tbl th { text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--fg-muted); padding: 6px 10px; border-bottom: 1px solid var(--border); }
	.tbl th.num, .tbl td.num { text-align: right; font-variant-numeric: tabular-nums; }
	.tbl td { padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.04); vertical-align: top; }
	.pname { font-weight: 500; }
	.src { margin-left: 6px; font-size: 10.5px; color: var(--fg-muted); border: 1px solid var(--border); border-radius: 999px; padding: 0 6px; }
	.pstate { font-size: 11.5px; padding: 1px 8px; border-radius: 999px; border: 1px solid var(--border); white-space: nowrap; }
	.pstate.running { color: var(--accent, #4aa3ff); border-color: currentColor; }
	.pstate.failed { color: var(--danger, #e5484d); border-color: currentColor; }
	.pstate.disabled { color: var(--fg-muted); }
	.perr { color: var(--danger, #e5484d); font-size: 11.5px; max-width: 360px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	td.bad { color: var(--danger, #e5484d); }
	.act { text-align: right; white-space: nowrap; }
	.act button { font-size: 12px; }
	.seg { display: inline-flex; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
	.seg button { border: 0; background: transparent; padding: 3px 10px; font-size: 12px; color: var(--fg-muted); cursor: pointer; }
	.seg button.on { background: var(--bg-elev, rgba(255,255,255,0.08)); color: inherit; }
</style>
