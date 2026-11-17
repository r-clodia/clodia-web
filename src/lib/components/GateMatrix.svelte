<script lang="ts">
	/**
	 * Approval matrix of a gate (clodia-platform#693): WHO (this spawn · this
	 * seed · every agent) × WHERE (this room · the whole instance). «Solo
	 * <spawn>» is today's consent; the other cells write a rule. Which cells a
	 * gate has comes from the gateway (`remember`, an empty reason = applies);
	 * the approver's title is the page's: the room column needs a room, the
	 * instance column an admin. A gate with no rule to remember shows a plain
	 * «Approva». «Tutti gli agenti · globale» asks a second confirmation.
	 */
	import { createEventDispatcher } from 'svelte';

	export let agent: string;
	export let instance: string;
	export let verb: string;
	/** `{"seed:chat": "", "all:global": "<why not>", …}` from the gateway. */
	export let cells: Record<string, string> | undefined = undefined;
	/** The room the gate came from is known (an inline card in a channel). */
	export let hasRoom = false;
	export let isAdmin = false;
	export let busy = false;
	/** Shorter labels for the inline channel card. */
	export let compact = false;

	type Who = 'spawn' | 'seed' | 'all';
	type Where = 'chat' | 'global';
	const dispatch = createEventDispatcher<{ decide: { who: Who; where?: Where } }>();

	const NOTHING = 'questo gate non diventa una regola: vale solo per questo spawn';
	const DEST_SEED = 'una destinazione della lista vale per tutti gli agenti';

	/** An older gateway sends no cells: destinations as before, nothing else. */
	function fallback(v: string): Record<string, string> {
		const dest = /^(egress|ingress):/.test(v || '');
		return {
			'seed:chat': dest ? DEST_SEED : NOTHING,
			'seed:global': dest ? DEST_SEED : NOTHING,
			'all:chat': dest ? '' : NOTHING,
			'all:global': dest ? '' : NOTHING
		};
	}
	$: c = cells ?? fallback(verb);
	$: rememberable = Object.values(c).some((r) => r === '');

	function reason(who: 'seed' | 'all', where: Where): string {
		const own = c[`${who}:${where}`];
		if (own) return own;
		if (where === 'chat' && !hasRoom) return 'la richiesta non viene da una stanza';
		if (where === 'global' && !isAdmin) return "vale in tutte le stanze: lo decide un admin della piattaforma";
		return '';
	}

	let confirmAll = false;
	function pick(who: Who, where?: Where) {
		if (who === 'all' && where === 'global' && !confirmAll) {
			confirmAll = true;
			return;
		}
		confirmAll = false;
		dispatch('decide', { who, where });
	}

	$: spawnLabel = instance && instance !== '-' ? `solo ${instance}` : 'solo stavolta';
	const ROWS: Array<{ who: 'seed' | 'all'; label: (a: string) => string }> = [
		{ who: 'seed', label: (a) => a },
		{ who: 'all', label: () => 'tutti gli agenti' }
	];
	const TITLES: Record<string, string> = {
		'seed:chat': "Ricorda per {a} in questa stanza: la stessa richiesta non verrà più chiesta qui",
		'seed:global': "Ricorda per {a} in tutte le stanze",
		'all:chat': "Ricorda per tutti gli agenti di questa stanza",
		'all:global': "Ricorda per tutti gli agenti in tutte le stanze"
	};
</script>

{#if !rememberable}
	<button type="button" class="m-btn ok" disabled={busy}
		on:click={() => pick('spawn')}>{busy ? '…' : compact ? '✓ Approva' : 'Approva'}</button>
{:else}
	<div class="matrix" role="group" aria-label="Approva per">
		<span class="hd"></span>
		<span class="hd">questa chat</span>
		<span class="hd">globale</span>

		<span class="who">{instance && instance !== '-' ? instance : 'questa volta'}</span>
		<button type="button" class="m-btn ok span2" disabled={busy}
			title="Solo questo spawn, finché resta attivo: nessuna regola viene scritta"
			on:click={() => pick('spawn')}>{busy ? '…' : `✓ ${spawnLabel}`}</button>

		{#each ROWS as row (row.who)}
			<span class="who">{row.label(agent)}</span>
			{#each ['chat', 'global'] as where (where)}
				{@const why = reason(row.who, where === 'chat' ? 'chat' : 'global')}
				<button type="button" class="m-btn"
					class:ok={!why}
					class:warn={row.who === 'all' && where === 'global' && confirmAll}
					disabled={busy || !!why}
					title={why || TITLES[`${row.who}:${where}`].replace('{a}', agent)}
					on:click={() => pick(row.who, where === 'chat' ? 'chat' : 'global')}>
					{#if row.who === 'all' && where === 'global' && confirmAll}
						Sicuro? ogni agente, ogni stanza
					{:else}
						✓ sempre
					{/if}
				</button>
			{/each}
		{/each}
	</div>
	{#if confirmAll}
		<p class="m-note" role="alert">
			Vale per ogni agente in ogni stanza: premi di nuovo per confermare.
			<button type="button" class="m-link" on:click={() => (confirmAll = false)}>annulla</button>
		</p>
	{/if}
{/if}

<style>
	.matrix {
		display: grid;
		grid-template-columns: auto 1fr 1fr;
		gap: 4px 6px;
		align-items: center;
		font-size: 12px;
		min-width: 0;
	}
	.hd { font-size: 10px; color: var(--fg-muted); text-transform: uppercase; letter-spacing: .02em; text-align: center; }
	.who { font-size: 11px; color: var(--fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 120px; }
	.span2 { grid-column: span 2; }
	.m-btn {
		font: inherit; font-size: 11px; padding: 3px 8px; border-radius: 6px; cursor: pointer;
		border: 1px solid var(--border); background: transparent; color: var(--fg); white-space: nowrap;
	}
	.m-btn.ok { background: #2563eb; border-color: #2563eb; color: #fff; font-weight: 600; }
	.m-btn.warn { background: #dc2626; border-color: #dc2626; color: #fff; }
	.m-btn:disabled { opacity: .4; cursor: not-allowed; }
	.m-note { font-size: 11px; color: #dc2626; margin: 4px 0 0; }
	.m-link { font: inherit; font-size: 11px; background: none; border: none; color: var(--accent); cursor: pointer; padding: 0 2px; }
</style>
