<script lang="ts">
	/**
	 * Whitelist delle destinazioni in uscita, per agente e per tipo
	 * (clodia-platform#104 §7).
	 *
	 * SOLA LETTURA, e non per pigrizia: aggiungere una destinazione è più
	 * privilegiato del singolo invio, perché la rende silenziosa per sempre — e il
	 * posto giusto per concederla è il dialog che compare quando serve, dove
	 * l'informazione è completa («@clodia vuole scrivere a X»). Un campo di testo
	 * in una pagina di impostazioni è il posto in cui si incolla una lista senza
	 * guardarla.
	 *
	 * Qui si vede cosa è stato concesso e come — che è la domanda che un'ora di
	 * lavoro con la modalità di osservazione fa venire in mente.
	 */
	import { onMount } from 'svelte';
	import { getEgressWhitelist } from '$lib/api/client';

	let mode = 'unknown';
	let types: string[] = [];
	let agents: Record<string, Record<string, string[]>> = {};
	let loading = true;
	let err = '';

	const MODE_LABEL: Record<string, string> = {
		gate: 'chiede — una destinazione nuova passa da un’approvazione, e approvando resta',
		on: 'nega — una destinazione fuori whitelist è rifiutata senza chiedere',
		report: 'osserva — decide e registra, non blocca nulla',
		off: 'spento — nessun controllo sulle destinazioni',
		unknown: 'non leggibile dal gateway'
	};

	onMount(async () => {
		try {
			const r = await getEgressWhitelist();
			mode = r.mode ?? 'unknown';
			types = r.types ?? [];
			agents = r.agents ?? {};
		} catch (e) {
			err = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	});

	$: names = Object.keys(agents).sort();
</script>

<div class="card-h">
	<h2>Destinazioni consentite</h2>
	<span class="mode mode-{mode}">{mode}</span>
</div>
<p class="hint">{MODE_LABEL[mode] ?? mode}</p>

{#if loading}
	<p class="hint">caricamento…</p>
{:else if err}
	<p class="hint err">⚠ {err}</p>
{:else if !names.length}
	<p class="hint">
		Nessuna destinazione dichiarata. È il punto di partenza previsto: la lista si
		popola con l’uso — la prima volta che un agent scrive a un indirizzo nuovo ti
		viene chiesto, e approvando la destinazione resta.
	</p>
{:else}
	<ul class="agents">
		{#each names as a}
			<li>
				<strong>{a}</strong>
				<ul class="types">
					{#each Object.entries(agents[a]) as [t, rules]}
						<li>
							<span class="type">{t}</span>
							{#if !rules.length}
								<em class="muted">dichiarato vuoto — muto</em>
							{:else}
								{#each rules as r}
									<code class:wide={r === '*'}>{r}</code>
								{/each}
							{/if}
						</li>
					{/each}
				</ul>
			</li>
		{/each}
	</ul>
{/if}

<p class="hint dim">
	Un tipo <em>non elencato</em> per un agent nega: non è una dimenticanza che
	apre, è una regola. <code>*</code> apre l’intero tipo e va letto come tale.
	{#if types.length}<br />Tipi gestiti: {types.join(' · ')}.{/if}
</p>

<style>
	.card-h { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
	h2 { margin: 0; font-size: 15px; }
	.mode { font-family: ui-monospace, monospace; font-size: 11px; padding: 2px 8px; border: 1px solid var(--border); border-radius: 999px; color: var(--fg-muted); }
	.mode-gate { color: #d97706; border-color: #d97706; }
	.mode-off, .mode-report { color: var(--fg-muted); }
	.hint { font-size: 12px; color: var(--fg-muted); line-height: 1.5; margin: 6px 0 0; }
	.hint.err { color: var(--danger); }
	.hint.dim { opacity: .8; margin-top: 12px; }
	.agents { list-style: none; padding: 0; margin: 12px 0 0; display: flex; flex-direction: column; gap: 10px; }
	.agents > li { font-size: 13px; }
	.types { list-style: none; padding: 0; margin: 4px 0 0 10px; display: flex; flex-direction: column; gap: 3px; }
	.type { display: inline-block; min-width: 74px; font-size: 11px; color: var(--fg-muted); }
	code { font-size: 11px; padding: 1px 5px; margin-right: 4px; background: var(--code-bg, rgba(127,127,127,.12)); border-radius: 4px; }
	code.wide { color: #d97706; }
	.muted { font-size: 11px; color: var(--fg-muted); }
</style>
