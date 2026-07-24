<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { goto } from '$app/navigation';
	import AgentAvatar from './AgentAvatar.svelte';
	import AgentName from './AgentName.svelte';
	import { pauseAgent, resumeAgent, createOrOpenDm } from '$lib/api/client';
	import { toastSuccess, toastError } from '$lib/stores/toasts';
	import type { Agent, AgentRunState } from '$lib/api/types';

	export let agents: ReadonlyArray<Agent> = [];
	// Ancora accettato dalla pagina, ma lo Stato non è più una colonna: la pausa/
	// disconnessione si legge dall'opacità di riga e dal toggle azioni.
	export let runStateFor: (name: string) => AgentRunState | 'unknown' = () => 'unknown';
	runStateFor; // eslint: prop pubblica conservata per il contratto con la pagina

	const dispatch = createEventDispatcher<{ changed: void }>();
	let busy = ''; // nome agente con azione in corso

	const titleOf = (a: Agent) => a.display_name?.trim() || a.name;
	const isPaused = (a: Agent) => a.paused === true;
	const isDisconnected = (a: Agent) => a.provider_connected === false;
	const providerLabel = (a: Agent) => a.provider ?? a.providers?.[0] ?? null;

	// ─────────────────────────────────────────────────────────────────────────
	// Costo per 1M token (input / output), derivato dalla combinazione
	// MODELLO × PROVIDER effettivi. Prezzi di LISTINO in valuta nativa del
	// provider ($ Anthropic/Bedrock, € Scaleway). Fonti (verificate 17 lug 2026):
	//   • Anthropic API   → platform.claude.com/docs/en/about-claude/pricing
	//   • AWS Bedrock EU  → endpoint regionale = listino Anthropic globale +10%
	//   • Scaleway        → scaleway.com/en/pricing/model-as-a-service (regione Paris)
	//   • claude.ai/codex → abbonamento a canone fisso (Pro $20/mese, Max da $100)
	//
	// Comportamento:
	//   • Provider ad ABBONAMENTO (claude-pro-max, codex): costo marginale per
	//     token coperto dal canone → nessun prezzo a consumo ("abbonamento").
	//   • Provider ad API: prezzo di listino del modello nella valuta del provider.
	//
	// UNICO PUNTO DI MODIFICA: le mappe qui sotto. Il match è per sottostringa sul
	// model id, dal più specifico al più generico.
	// ─────────────────────────────────────────────────────────────────────────
	type Price = { key: string; in: number; out: number };

	// Anthropic — USD/1M, listino API first-party globale.
	// NB: Sonnet 5 è in promo introduttiva $2/$10 fino al 31 ago 2026 (poi $3/$15).
	const ANTHROPIC_USD: ReadonlyArray<Price> = [
		{ key: 'opus', in: 5, out: 25 },
		{ key: 'sonnet', in: 3, out: 15 },
		{ key: 'haiku', in: 1, out: 5 },
		{ key: 'fable', in: 10, out: 50 }
	];
	// Scaleway — EUR/1M, Generative APIs (regione Paris).
	const SCALEWAY_EUR: ReadonlyArray<Price> = [
		{ key: 'glm', in: 1.8, out: 5.5 },
		{ key: 'gpt-oss', in: 0.15, out: 0.6 },
		{ key: 'mistral-small', in: 0.15, out: 0.35 },
		{ key: 'mistral', in: 1.5, out: 7.5 },
		{ key: 'llama', in: 0.9, out: 0.9 }
	];
	// OpenAI — USD/1M. NON incluso nelle fonti richieste da Davide: valori STIMATI,
	// da verificare. Raggiunto solo se un agent usa provider 'openai-api' a consumo.
	const OPENAI_USD: ReadonlyArray<Price> = [
		{ key: 'nano', in: 0.1, out: 0.4 },
		{ key: 'mini', in: 0.4, out: 1.6 },
		{ key: 'gpt-5', in: 1.25, out: 10 },
		{ key: 'gpt-4o', in: 2.5, out: 10 },
		{ key: 'gpt-4', in: 2, out: 8 }
	];
	// Provider a canone fisso: costo marginale per token = 0.
	const SUBSCRIPTION_PROVIDERS = new Set(['claude-pro-max', 'codex']);
	// Endpoint regionale Bedrock (EU): +10% sul listino globale Anthropic.
	const BEDROCK_REGIONAL_MULT = 1.1;

	type Cost =
		| { kind: 'flat' }
		| { kind: 'metered'; cur: '$' | '€'; in: number; out: number }
		| { kind: 'unknown' };

	const round2 = (n: number) => Math.round(n * 100) / 100;
	const lookup = (table: ReadonlyArray<Price>, model: string) =>
		table.find((p) => model.includes(p.key)) ?? null;

	function costFor(a: Agent): Cost {
		const provider = providerLabel(a);
		if (!provider) return { kind: 'unknown' };
		if (SUBSCRIPTION_PROVIDERS.has(provider)) return { kind: 'flat' };
		const model = (a.model ?? '').toLowerCase();
		if (!model) return { kind: 'unknown' };

		if (provider === 'scaleway') {
			const p = lookup(SCALEWAY_EUR, model);
			return p ? { kind: 'metered', cur: '€', in: p.in, out: p.out } : { kind: 'unknown' };
		}
		if (provider === 'aws-region-eu') {
			const p = lookup(ANTHROPIC_USD, model);
			return p
				? { kind: 'metered', cur: '$', in: round2(p.in * BEDROCK_REGIONAL_MULT), out: round2(p.out * BEDROCK_REGIONAL_MULT) }
				: { kind: 'unknown' };
		}
		if (provider === 'openai-api') {
			const p = lookup(OPENAI_USD, model);
			return p ? { kind: 'metered', cur: '$', in: p.in, out: p.out } : { kind: 'unknown' };
		}
		// anthropic-api (e default per provider Claude non riconosciuti).
		const p = lookup(ANTHROPIC_USD, model);
		return p ? { kind: 'metered', cur: '$', in: p.in, out: p.out } : { kind: 'unknown' };
	}

	// "$5" / "€1.8" / "$27.5" — niente zeri superflui.
	const fmtCur = (cur: string, n: number) =>
		Number.isInteger(n) ? `${cur}${n}` : `${cur}${n.toFixed(2).replace(/0$/, '')}`;

	function openDetail(a: Agent) {
		void goto(`/agents/${encodeURIComponent(a.name)}`);
	}

	async function openChat(e: Event, a: Agent) {
		e.stopPropagation();
		if (busy) return;
		busy = a.name;
		try {
			const dm = await createOrOpenDm(a.name);
			await goto(`/topics/${dm.tier}/${dm.name}`);
		} catch (err) {
			toastError(`Impossibile aprire il DM con ${titleOf(a)}.`, err instanceof Error ? err.message : String(err));
		} finally {
			busy = '';
		}
	}

	async function togglePause(e: Event, a: Agent) {
		e.stopPropagation();
		if (busy) return;
		busy = a.name;
		try {
			if (isPaused(a)) {
				await resumeAgent(a.name);
				toastSuccess(`${titleOf(a)} resumed`);
			} else {
				const r = await pauseAgent(a.name);
				const cancelled = r.cancelled_tasks ?? 0;
				toastSuccess(`${titleOf(a)} paused`, cancelled > 0 ? `${cancelled} istanze in volo cancellate` : undefined);
			}
			dispatch('changed');
		} catch (err) {
			toastError('Toggle pause fallito', err instanceof Error ? err.message : String(err));
		} finally {
			busy = '';
		}
	}
</script>

<div class="table-wrap">
	<table class="agents">
		<thead>
			<tr>
				<th class="c-agent">Agente</th>
				<th class="c-model">Modello</th>
				<th class="c-provider">Provider</th>
				<th class="c-cost">Costo · in/out <span class="unit">/1M tok</span></th>
				<th class="c-desc">Descrizione</th>
				<th class="c-actions"><span class="sr-only">Azioni</span></th>
			</tr>
		</thead>
		<tbody>
			{#each agents as a (a.name)}
				{@const cost = costFor(a)}
				<tr
					class:paused={isPaused(a)}
					class:disconnected={isDisconnected(a)}
					on:click={() => openDetail(a)}
					on:keydown={(e) => (e.key === 'Enter' || e.key === ' ') && openDetail(a)}
					tabindex="0"
					aria-label={`Apri ${titleOf(a)}`}
				>
					<td class="c-agent">
						<span class="agent-cell">
							<AgentAvatar name={a.name} displayName={a.display_name} color={a.avatar_color} size={32} />
							<span class="agent-names">
								<span class="agent-title"><AgentName name={titleOf(a)} /></span>
								<code class="agent-name">{a.name}</code>
							</span>
						</span>
					</td>
					<td class="c-model"><code>{a.model || '—'}</code></td>
					<td class="c-provider">
						{#if providerLabel(a)}
							<span class="prov" class:off={isDisconnected(a)}>{providerLabel(a)}</span>
							{#if a.provider_seal && !isDisconnected(a)}
								<span class="seal-chip" title="SEAL del provider effettivo">{a.provider_seal}</span>
							{/if}
						{:else}
							—
						{/if}
					</td>
					<td class="c-cost">
						{#if cost.kind === 'flat'}
							<span class="cost-flat" title="Provider in abbonamento: costo marginale per token coperto dal canone fisso">abbonamento</span>
						{:else if cost.kind === 'metered'}
							<span class="cost-val" title={`Prezzo di listino per 1M token — input ${fmtCur(cost.cur, cost.in)} / output ${fmtCur(cost.cur, cost.out)}`}>
								<span class="cin">{fmtCur(cost.cur, cost.in)}</span>
								<span class="csep">/</span>
								<span class="cout">{fmtCur(cost.cur, cost.out)}</span>
							</span>
						{:else}
							<span class="cost-na" title="Prezzo non disponibile per questa combinazione modello/provider">—</span>
						{/if}
					</td>
					<td class="c-desc"><span class="desc" title={a.description || ''}>{a.description || ''}</span></td>
					<td class="c-actions">
						<span class="row-actions">
							<button
								type="button"
								class="icon-btn"
								disabled={busy === a.name || isDisconnected(a)}
								on:click={(e) => openChat(e, a)}
								title={isDisconnected(a)
									? `Nessun provider compatibile collegato — collegane uno per usare ${titleOf(a)}`
									: `Apri una chat con ${titleOf(a)}`}
								aria-label={`Chat con ${titleOf(a)}`}
							>💬</button>
							<button
								type="button"
								class="icon-btn pause-toggle"
								class:on={isPaused(a)}
								disabled={busy === a.name}
								on:click={(e) => togglePause(e, a)}
								title={isPaused(a) ? 'Resume agent (riprende claim)' : 'Pause agent (cancella istanze running + skip claim)'}
								aria-label={isPaused(a) ? 'Resume' : 'Pause'}
							>{isPaused(a) ? '▶' : '⏸'}</button>
						</span>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	.table-wrap {
		border: 1px solid var(--border);
		border-radius: 10px;
		overflow-x: auto;
		background: var(--card-bg);
	}
	table.agents {
		width: 100%;
		border-collapse: collapse;
		font-size: 12.5px;
	}
	thead th {
		text-align: left;
		font-size: 10.5px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		font-weight: 700;
		color: var(--fg-muted);
		padding: 10px 12px;
		border-bottom: 1px solid var(--border);
		white-space: nowrap;
	}
	thead th .unit {
		text-transform: none;
		letter-spacing: 0;
		font-weight: 600;
		opacity: 0.7;
	}
	tbody td {
		padding: 9px 12px;
		border-bottom: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
		vertical-align: middle;
	}
	tbody tr:last-child td {
		border-bottom: none;
	}
	tbody tr {
		cursor: pointer;
		transition: background 0.1s ease;
	}
	tbody tr:hover {
		background: rgba(255, 107, 61, 0.05);
	}
	tbody tr:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}
	tr.paused {
		opacity: 0.65;
	}
	tr.disconnected {
		opacity: 0.55;
	}
	tr.disconnected:hover {
		opacity: 0.8;
	}

	.agent-cell {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}
	.agent-names {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.agent-title {
		font-weight: 600;
		font-size: 13px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.agent-name {
		font-family: var(--mono);
		font-size: 10.5px;
		color: var(--fg-muted);
		background: transparent;
		padding: 0;
	}
	.c-agent { min-width: 170px; }
	.c-model code {
		font-family: var(--mono);
		font-size: 11px;
		color: var(--fg-muted);
		background: transparent;
		padding: 0;
		white-space: nowrap;
	}
	.prov {
		font-size: 10.5px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--fg-muted);
		white-space: nowrap;
	}
	.prov.off {
		color: #d6a85a;
	}
	.seal-chip {
		display: inline-block;
		margin-left: 5px;
		padding: 0 5px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--accent) 18%, transparent);
		color: var(--accent);
		font-weight: 700;
		font-size: 10.5px;
	}
	.c-cost {
		white-space: nowrap;
	}
	.cost-val {
		font-family: var(--mono);
		font-size: 11.5px;
		display: inline-flex;
		align-items: baseline;
		gap: 4px;
	}
	.cost-val .cin { color: var(--fg); }
	.cost-val .csep { color: var(--fg-muted); opacity: 0.6; }
	.cost-val .cout { color: var(--fg-muted); }
	.cost-flat {
		font-size: 10.5px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--fg-muted);
		padding: 1px 7px;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
	}
	.cost-na {
		color: var(--fg-muted);
		opacity: 0.6;
	}
	.c-desc {
		max-width: 340px;
	}
	.desc {
		color: var(--fg-muted);
		font-size: 12px;
		/* va a capo invece di allungare la riga oltre lo schermo; clampata a 2
		   righe (testo completo nel tooltip title). */
		white-space: normal;
		overflow-wrap: anywhere;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.row-actions {
		display: inline-flex;
		gap: 6px;
	}
	.icon-btn {
		width: 28px;
		height: 28px;
		border-radius: 6px;
		border: 1px solid var(--border);
		background: transparent;
		color: var(--fg-muted);
		font-size: 12px;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		transition: all 0.12s ease;
	}
	.icon-btn:hover:not(:disabled) {
		border-color: var(--accent);
		color: var(--accent);
	}
	.pause-toggle.on {
		background: rgba(255, 107, 61, 0.1);
		border-color: var(--accent);
		color: var(--accent);
	}
	.icon-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}
</style>
