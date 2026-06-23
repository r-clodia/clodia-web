<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { goto } from '$app/navigation';
	import AgentAvatar from './AgentAvatar.svelte';
	import AgentName from './AgentName.svelte';
	import StatusDot from './StatusDot.svelte';
	import { pauseAgent, resumeAgent, createOrOpenDm } from '$lib/api/client';
	import { toastSuccess, toastError } from '$lib/stores/toasts';
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
	// Etichetta: provider effettivo se collegato, altrimenti il preferito della lista.
	$: providerLabel = agent.provider ?? agent.providers?.[0] ?? null;
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
				<StatusDot state={cardState} withLabel={false} />
			</div>
			{#if agent.model}
				<div class="model" title="model">{agent.model}</div>
			{/if}
			{#if providerLabel}
				<div class="provider" class:off={disconnected} title="provider">
					{providerLabel}{#if disconnected} · non collegato{/if}
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
