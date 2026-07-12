<script lang="ts">
	/**
	 * WORKFLOWS — catalogo dei workflow dichiarati dai pack. Ogni workflow è
	 * navigabile → /workflows/{plugin}/{name} (pipeline + run). Lo start di un
	 * run è un trigger (da qui, da una pill in un topic, da un job): questa
	 * pagina è il catalogo + monitor, non una chat. Feature `workflows`.
	 */
	import { onDestroy, onMount } from 'svelte';
	import { listWorkflows, type WorkflowDef, type WorkflowRun } from '$lib/api/client';

	let defs: Record<string, WorkflowDef> = {};
	let runs: WorkflowRun[] = [];
	let loading = true;
	let err = '';
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

	// run attivi (non terminali) per workflow → badge sul catalogo
	function activeRuns(plugin: string, name: string): number {
		return runs.filter(
			(r) => r.plugin === plugin && r.workflow === name &&
				!['done', 'failed', 'cancelled'].includes(r.status)
		).length;
	}

	onMount(() => {
		refresh();
		poll = setInterval(() => { if (!document.hidden) refresh(); }, 15000);
	});
	onDestroy(() => poll && clearInterval(poll));
</script>

<header class="wf-head">
	<h1>Workflows</h1>
	<button type="button" on:click={refresh} disabled={loading}>{loading ? 'Loading…' : 'Reload'}</button>
</header>

{#if err}<p class="wf-err">⚠ {err}</p>{/if}

{#if Object.keys(defs).length === 0}
	<p class="wf-empty">Nessun workflow dichiarato dai pack installati.</p>
{:else}
	<div class="wf-cards">
		{#each Object.entries(defs) as [key, d] (key)}
			{@const active = activeRuns(d.plugin, d.name)}
			<a class="wf-card" href={`/workflows/${encodeURIComponent(d.plugin)}/${encodeURIComponent(d.name)}`}>
				<div class="wf-card-top">
					<strong>{d.name}</strong>
					<span class="wf-plugin">{d.plugin}</span>
					{#if active}<span class="wf-active">{active} attiv{active > 1 ? 'i' : 'o'}</span>{/if}
				</div>
				<div class="wf-card-lanes">
					{#each d.stages as st, i (st.lane)}<span class="wf-mini">{st.lane}{#if st.human_gate}🔒{/if}</span>{#if i < d.stages.length - 1}<span class="wf-arrow">→</span>{/if}{/each}
				</div>
			</a>
		{/each}
	</div>
{/if}

<style>
	.wf-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
	.wf-head h1 { font-size: 18px; margin: 0; }
	.wf-err { color: #ef4444; }
	.wf-empty { color: var(--fg-muted); font-size: 13px; }
	.wf-cards { display: flex; flex-direction: column; gap: 10px; }
	.wf-card { display: block; border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; text-decoration: none; color: inherit; }
	.wf-card:hover { border-color: var(--accent); }
	.wf-card-top { display: flex; align-items: center; gap: 10px; }
	.wf-plugin { font-size: 11px; color: var(--fg-muted); }
	.wf-active { margin-left: auto; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: rgba(96,165,250,0.16); color: #60a5fa; }
	.wf-card-lanes { margin-top: 8px; display: flex; flex-wrap: wrap; align-items: center; gap: 4px; font-size: 11px; color: var(--fg-muted); }
	.wf-mini { padding: 2px 7px; border-radius: 6px; border: 1px solid var(--border); }
	.wf-arrow { opacity: 0.5; }
</style>
