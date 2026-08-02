<script lang="ts">
	/**
	 * Albero degli spawn attivi dei participant multi-spawn del topic corrente
	 * (issue clodia-platform#99).
	 *
	 * **Presenza, non lavoro.** Ogni nodo mostra soltanto il nome dell'istanza
	 * (`fullstack-dev#2`) e il suo stato. Mai output, prompt, argomenti, nomi di
	 * file o messaggi d'errore: uno spawn puo' girare su un topic di classe
	 * superiore a quella di chi guarda, quindi lo stato `error` e' un colore e
	 * non uno stack trace. Il payload minimo e' garantito dal backend
	 * (`GET /clodia/channels/{tier}/{name}/spawns`), qui non si aggiunge nulla.
	 *
	 * **Scoping.** L'endpoint e' per-topic e riservato ai membri del canale: non
	 * esiste una lista globale degli spawn del gateway da filtrare lato client.
	 *
	 * **Accessibilita'.** Il colore non e' mai l'unico canale: `StatusDot`
	 * affianca sempre la label testuale al pallino, il toggle ha un testo per
	 * screen reader e ogni nodo ha un `title` con lo stato per esteso.
	 */
	import { onDestroy } from 'svelte';
	import { apiGet } from '$lib/api/client';
	import StatusDot from '$lib/components/StatusDot.svelte';

	/** Tier del topic corrente. */
	export let tier: string;
	/** Nome del topic corrente. */
	export let name: string;
	/** Intervallo di refresh in ms; 0 disattiva il polling (utile nei test). */
	export let pollMs: number = 5000;

	/**
	 * Uno spawn vivo del topic. Volutamente minimo: nome dell'istanza e stato.
	 * `instance` e' l'ordinale multi-spawn (`@agente#2` -> 2), null per i seed
	 * a istanza singola.
	 */
	type TopicSpawn = {
		agent: string;
		instance: number | null;
		label: string;
		state: 'running' | 'blocked' | 'error' | 'idle' | 'unknown' | string;
	};

	let spawns: TopicSpawn[] = [];
	// agent -> aperto/chiuso. Default chiuso: l'albero e' opt-in, un click per volta.
	let open: Record<string, boolean> = {};
	let timer: ReturnType<typeof setInterval> | null = null;
	let loadedKey = '';

	// Solo i seed che materializzano piu' istanze: un agente con un'unica
	// sessione senza ordinale e' gia' rappresentato dalla riga del participant.
	$: groups = Object.entries(
		spawns.reduce<Record<string, TopicSpawn[]>>((acc, s) => {
			(acc[s.agent] ??= []).push(s);
			return acc;
		}, {})
	)
		.filter(([, items]) => items.some((s) => s.instance !== null))
		.sort(([a], [b]) => a.localeCompare(b));

	async function load(t: string, n: string) {
		if (!t || !n) return;
		try {
			const d = await apiGet<{ spawns: TopicSpawn[] }>(
				`/clodia/channels/${encodeURIComponent(t)}/${encodeURIComponent(n)}/spawns`);
			spawns = d.spawns ?? [];
		} catch {
			// 403/404/offline: l'albero sparisce, il resto del pannello resta vivo.
			spawns = [];
		}
	}

	function toggle(agent: string) {
		open = { ...open, [agent]: !open[agent] };
	}

	// Etichetta estesa per tooltip/aria: il pallino non basta mai da solo.
	const STATE_LABEL: Record<string, string> = {
		running: 'in esecuzione',
		blocked: 'fermo',
		error: 'in errore',
		idle: 'in attesa',
		unknown: 'stato ignoto'
	};
	const titleOf = (s: TopicSpawn) => `${s.label}: ${STATE_LABEL[s.state] ?? s.state}`;

	// Cambio topic -> ricarica e azzera lo stato di apertura (l'albero e' del
	// topic che stai guardando, non dell'ultimo che hai aperto).
	$: if (tier && name && `${tier}/${name}` !== loadedKey) {
		loadedKey = `${tier}/${name}`;
		spawns = [];
		open = {};
		void load(tier, name);
	}

	// Gli spawn nascono e muoiono dentro il turno: i nodi terminati spariscono
	// da soli al refresh successivo, senza tombstone (anche "e' esistito" e'
	// metadato di presenza).
	$: if (pollMs > 0 && !timer) {
		timer = setInterval(() => void load(tier, name), pollMs);
	}
	onDestroy(() => {
		if (timer) clearInterval(timer);
	});
</script>

{#if groups.length}
	<div class="spawn-trees" aria-label="Spawn attivi nel topic">
		{#each groups as [agent, items] (agent)}
			<div class="spawn-group">
				<button
					type="button"
					class="spawn-toggle"
					aria-expanded={!!open[agent]}
					aria-controls={`spawn-tree-${agent}`}
					on:click={() => toggle(agent)}
				>
					<span class="caret" aria-hidden="true">{open[agent] ? '▾' : '▸'}</span>
					<span class="spawn-agent">{agent}</span>
					<span class="spawn-count">{items.length}</span>
					<span class="sr-only">
						{open[agent] ? 'Nascondi' : 'Mostra'} gli spawn attivi di {agent}
					</span>
				</button>
				{#if open[agent]}
					<ul class="spawn-tree" id={`spawn-tree-${agent}`} aria-label={`Spawn attivi di ${agent}`}>
						{#each items as s (s.label)}
							<li title={titleOf(s)}>
								<span class="spawn-label">{s.label}</span>
								<StatusDot state={s.state} />
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/each}
	</div>
{/if}

<style>
	.spawn-trees {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin-top: 8px;
		padding-top: 8px;
		border-top: 1px dashed var(--border);
	}
	.spawn-toggle {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		padding: 2px 0;
		background: transparent;
		border: none;
		color: var(--fg-muted);
		font: inherit;
		font-size: 11.5px;
		text-align: left;
		cursor: pointer;
	}
	.spawn-toggle:hover {
		color: var(--fg);
	}
	.caret {
		flex: none;
		width: 10px;
		font-size: 10px;
		line-height: 1;
	}
	.spawn-agent {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.spawn-count {
		margin-left: auto;
		padding: 0 5px;
		border: 1px solid var(--border);
		border-radius: 999px;
		font-size: 10px;
		font-variant-numeric: tabular-nums;
	}
	.spawn-tree {
		list-style: none;
		margin: 2px 0 4px 0;
		padding: 0 0 0 11px;
		border-left: 1px solid var(--border);
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.spawn-tree li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
		min-width: 0;
	}
	.spawn-label {
		color: var(--fg-muted);
		font-family: var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace);
		font-size: 11.5px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* L'affordance ▸/▾ da sola non e' annunciabile: il testo resta nel DOM. */
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
		border: 0;
	}
</style>
