<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { goto } from '$app/navigation';
	import AgentAvatar from './AgentAvatar.svelte';
	import AgentName from './AgentName.svelte';
	import MultiSpawnBadge from './MultiSpawnBadge.svelte';
	import StatusDot from './StatusDot.svelte';
	import { pauseAgent, resumeAgent, createOrOpenDm } from '$lib/api/client';
	import { toastSuccess, toastError } from '$lib/stores/toasts';
	import { riassumiPerTier, vaMostrata } from '$lib/providerPerTier';
	import type { Agent, AgentRunState } from '$lib/api/types';

	export let agent: Agent;
	export let runState: AgentRunState | 'unknown' = 'unknown';

	const dispatch = createEventDispatcher<{ changed: void }>();
	let toggling = false;
	let opening = false;

	// Apre un DM (canale a 2) con questo agent e naviga al canale. Le vecchie
	// chat libere sono state rimosse: la conversazione 1-1 è un canale DM.
	// preventDefault: il bottone è dentro il link della card.
	async function openChat(e: Event) {
		e.preventDefault();
		e.stopPropagation();
		if (opening) return;
		opening = true;
		try {
			const dm = await createOrOpenDm(agent.name);
			await goto(`/topics/${dm.tier}/${dm.name}`);
		} catch (err) {
			toastError(`Impossibile aprire il DM con ${title}.`, err instanceof Error ? err.message : String(err));
			opening = false;
		}
	}

	$: title = agent.display_name?.trim() || agent.name;
	$: href = `/agents/${encodeURIComponent(agent.name)}`;
	$: paused = agent.paused === true;
	// Provider non collegato → card 'disconnected' (dimmed). Col modello a lista
	// `provider_connected === false` significa: ci sono provider compatibili ma
	// nessuno è collegato (provider EFFETTIVO null). È il segnale autoritativo.
	$: disconnected = agent.provider_connected === false;
	// Etichetta: provider PREFERITO se collegato, altrimenti il primo della lista.
	// Non è «quello in uso»: dentro un topic decide il tier — vedi `perTier`.
	$: providerLabel = agent.provider ?? agent.providers?.[0] ?? null;
	// Il provider dipende dalla stanza (clodia-platform#306). Si mostra solo
	// quando cambia da un tier all'altro: se risponde sempre lo stesso, la riga
	// direbbe due volte la stessa cosa.
	$: perTier = vaMostrata(agent.provider_by_tier) ? riassumiPerTier(agent.provider_by_tier) : '';
	// E col provider cambia il MODELLO (clodia-platform#325): `provider_models`
	// abbina un modello a ciascun provider, quindi la riga qui sopra e questa
	// dicono le due metà dello stesso stack. La resa è la stessa perché la mappa
	// ha la stessa forma — `providerPerTier` lavora su `tier → valore`, non sui
	// provider in particolare, e una seconda resa divergerebbe alla prima
	// modifica. Stessa regola di rumore: solo se il modello cambia da un tier
	// all'altro; se è sempre lo stesso, lo dice già la riga del modello sopra.
	$: modelPerTier = vaMostrata(agent.model_by_tier) ? riassumiPerTier(agent.model_by_tier) : '';
	// Stato mostrato dal dot: 'disconnected' ha priorità sul runState.
	$: cardState = disconnected ? 'disconnected' : runState;

	async function togglePause(e: Event) {
		e.preventDefault();
		e.stopPropagation();
		if (toggling) return;
		toggling = true;
		try {
			if (paused) {
				const r = await resumeAgent(agent.name);
				toastSuccess(`${title} resumed`);
			} else {
				const r = await pauseAgent(agent.name);
				const cancelled = r.cancelled_tasks ?? 0;
				toastSuccess(`${title} paused`, cancelled > 0 ? `${cancelled} istanze in volo cancellate` : undefined);
			}
			dispatch('changed');
		} catch (err) {
			toastError('Toggle pause fallito', err instanceof Error ? err.message : String(err));
		} finally {
			toggling = false;
		}
	}
</script>

<a class="card" class:paused class:disconnected href={href} aria-label={`Open ${title}`}>
	<div class="head">
		<AgentAvatar name={agent.name} displayName={agent.display_name} color={agent.avatar_color} size={64} />
		<div class="text">
			<div class="title-row">
				<h3 class="title"><AgentName name={title} /></h3>
				{#if agent.multi_spawn}
					<MultiSpawnBadge name={agent.name} maxSpawns={agent.max_spawns ?? null} />
				{/if}
				<StatusDot state={cardState} withLabel={false} />
			</div>
			{#if agent.effective_model || agent.model}
				<!-- Modello dello stack PREFERITO (1 seed → N stack, issue#93). Non
				     «quello in uso»: dentro un topic il modello segue il provider che
				     regge il tier — vedi `modelPerTier` (clodia-platform#325). -->
				<div class="model" title="modello dello stack preferito, fuori da un topic">
					{agent.effective_model || agent.model}
				</div>
			{/if}
			{#if providerLabel}
				<div class="provider" class:off={disconnected} title="provider preferito, fuori da un topic">
					{providerLabel}{#if disconnected} · non collegato{/if}
					{#if agent.provider_seal && !disconnected}
						<span class="seal-chip" title="SEAL del provider preferito">{agent.provider_seal}</span>
					{/if}
				</div>
			{/if}
			{#if perTier}
				<div
					class="per-tier"
					title="Dentro un topic il provider è il meno costoso che regge il tier della stanza: lo stesso agente può girare su provider diversi. «—» = in quel tier non può prendere turni."
				>
					{perTier}
				</div>
			{/if}
			{#if modelPerTier}
				<div
					class="per-tier"
					title="Il modello segue il provider della stanza: con più stack, in tier diversi l'agente gira su modelli diversi. «—» = in quel tier non può prendere turni."
				>
					{modelPerTier}
				</div>
			{/if}
		</div>
		<div class="actions">
			<button
				type="button"
				class="icon-btn"
				disabled={opening || disconnected}
				on:click={openChat}
				title={disconnected
					? `Nessun provider compatibile collegato (${agent.providers?.join(', ') || providerLabel}) — collegane uno per usare ${title}`
					: `Apri una chat con ${title}`}
				aria-label={`Chat con ${title}`}
			>
				💬
			</button>
			<button
				type="button"
				class="icon-btn pause-toggle"
				class:on={paused}
				disabled={toggling}
				on:click={togglePause}
				title={paused ? 'Resume agent (riprende claim)' : 'Pause agent (cancella istanze running + skip claim)'}
				aria-label={paused ? 'Resume' : 'Pause'}
			>
				{#if paused}
					▶
				{:else}
					⏸
				{/if}
			</button>
		</div>
	</div>

	{#if agent.description}
		<p class="desc">{agent.description}</p>
	{/if}

	<div class="meta">
		{#if agent.skills && agent.skills.length}
			<span class="chip" title="Number of skills">
				<span class="chip-key">skills</span>
				<span class="chip-val">{agent.skills.length}</span>
			</span>
		{/if}
	</div>
</a>

<style>
	.card {
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: 18px;
		background: var(--card-bg);
		border: 1px solid var(--border);
		border-radius: 12px;
		text-decoration: none;
		color: inherit;
		transition:
			border-color 0.12s ease,
			transform 0.12s ease,
			background 0.12s ease;
		min-height: 154px;
	}
	.card:hover {
		border-color: var(--accent);
		background: rgba(255, 107, 61, 0.04);
		transform: translateY(-1px);
	}
	.card:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}

	.head {
		display: flex;
		gap: 12px;
		align-items: center;
	}

	.card.paused {
		opacity: 0.7;
		border-style: dashed;
		border-color: rgba(255, 107, 61, 0.35);
	}

	/* Provider non collegato: dimming + bordo ambra (status disconnected). */
	.card.disconnected {
		opacity: 0.55;
		border-style: dashed;
		border-color: rgba(214, 168, 90, 0.4);
	}
	.card.disconnected:hover {
		opacity: 0.75;
	}

	.actions {
		flex-shrink: 0;
		display: flex;
		gap: 6px;
	}
	.icon-btn {
		flex-shrink: 0;
		width: 28px;
		height: 28px;
		border-radius: 6px;
		border: 1px solid var(--border);
		background: transparent;
		color: var(--fg-muted);
		font-size: 12px;
		cursor: pointer;
		display: flex;
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
	.text {
		min-width: 0;
		flex: 1 1 auto;
	}
	.title-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.title {
		margin: 0;
		font-size: 15px;
		font-weight: 600;
		letter-spacing: -0.01em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.model {
		margin-top: 2px;
		font-family: var(--mono);
		font-size: 11px;
		color: var(--fg-muted);
	}
	.per-tier {
		font-size: 10px;
		color: var(--fg-muted);
		opacity: 0.85;
		line-height: 1.35;
		word-break: break-word;
	}
	.provider {
		margin-top: 1px;
		font-size: 10.5px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--fg-muted);
		opacity: 0.85;
	}
	.provider.off {
		color: #d6a85a;
		opacity: 1;
	}
	.seal-chip {
		display: inline-block;
		margin-left: 5px;
		padding: 0 5px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--accent) 18%, transparent);
		color: var(--accent);
		font-weight: 700;
		letter-spacing: 0;
	}

	.desc {
		margin: 0;
		font-size: 13px;
		line-height: 1.45;
		color: var(--fg-muted);
		/* Clamp to ~3 lines so cards stay even. */
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.meta {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
		margin-top: auto;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 2px 7px;
		border: 1px solid var(--border);
		border-radius: 4px;
		font-size: 11px;
		color: var(--fg-muted);
		background: rgba(255, 255, 255, 0.015);
	}
	.chip-key {
		text-transform: uppercase;
		letter-spacing: 0.06em;
		opacity: 0.7;
	}
	.chip-val {
		color: var(--fg);
		font-family: var(--mono);
	}
</style>
