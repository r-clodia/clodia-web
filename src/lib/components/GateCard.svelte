<script lang="ts">
	/**
	 * Inline gate card of a channel message (M-gate), shared by the topic page
	 * and the helpdesk side widget (clodia-platform#702). Extracted from the
	 * topic page as it was: the markup, the rules and the vocabulary did not
	 * change — only where they live.
	 *
	 * The card RENDERS and EMITS; it does not call the gateway. Each host keeps
	 * its own `decideGate` (the endpoint, the `who`/`where` cell, the
	 * `arguments` of a correction, the outcome per MESSAGE id), so the state of
	 * a card is still computed once per message by the host with
	 * `$lib/gateCard` (`gateCardState` / `gateCardVisibile`) and passed in.
	 *
	 * What stays here because it belongs to ONE card: the «Correggi» draft
	 * (clodia-platform#448). Only CHANGED fields leave the card — the gateway
	 * re-judges the corrected call, and an unchanged field is not a correction.
	 */
	import { createEventDispatcher } from 'svelte';
	import { gateLabel } from '$lib/gateLabel';
	import { gateDestination } from '$lib/gateCard';
	import GateMatrix from './GateMatrix.svelte';

	type Gate = { id: string; agent: string; instance: string; verb: string };
	type Cell = { who: 'spawn' | 'seed' | 'all'; where?: 'chat' | 'global' };
	type GateInfo = { crosses?: string; decided_by?: string; decider_name?: string;
	                  scope?: string; asker_role?: string; asker_note?: string;
	                  editable?: Record<string, unknown>; remember?: Record<string, string> };

	export let g: Gate;
	/** From `gateCardState`, computed by the host for THIS message. */
	export let stato: 'decisa' | 'chiusa' | 'da-decidere';
	/** The outcome taken on this card, by message id (the host's `gateDecided[m.id]`). */
	export let decided: string | undefined = undefined;
	/** What the gateway says about the triple (`/api/gate/pending`). */
	export let info: GateInfo | undefined = undefined;
	/** The host's `canDecideGate(g.id)`. */
	export let canDecide = false;
	export let busy = false;
	export let isAdmin = false;
	/** The request comes from a room (always, for an inline card). */
	export let hasRoom = true;

	const dispatch = createEventDispatcher<{
		decide: { approve: boolean; cell?: Cell; corrections?: Record<string, unknown> };
	}>();

	$: gDest = gateDestination(g.verb);

	/** Un gate su una DESTINAZIONE (egress/ingress) si può ricordare; uno su
	 *  un'azione no. Sulla destinazione la destinazione È la domanda: correggerla
	 *  risponderebbe a un'altra. */
	function isDestinationGate(verb: string): boolean {
		return /^(egress|ingress):/.test(verb || '');
	}

	let editing = false;
	let draft: Record<string, string> = {};
	function startGateEdit() {
		const src = info?.editable ?? {};
		draft = Object.fromEntries(Object.entries(src).map(([k, v]) =>
			[k, Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v)]));
		editing = true;
	}
	function gateCorrections(): Record<string, unknown> | undefined {
		const src = info?.editable ?? {};
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(draft)) {
			const orig = src[k];
			const was = Array.isArray(orig) ? orig.join(', ') : orig == null ? '' : String(orig);
			if (v !== was) out[k] = Array.isArray(orig) ? v.split(',').map((x) => x.trim()).filter(Boolean) : v;
		}
		return Object.keys(out).length ? out : undefined;
	}
	// `draft` in the dependencies so the button follows the typing.
	$: corrections = editing && draft ? gateCorrections() : undefined;
</script>

<div class="jobprop">
	{#if stato === 'decisa'}
		<!-- L'esito NON cancella la domanda: la richiesta resta leggibile accanto
		     alla risposta. Il testo del messaggio porta il motivo; qui restano chi
		     e cosa, che vengono dal marcatore e non dalla coda. -->
		<span class="jobprop-done">
			🛡️ <b>{g.agent}</b> · <code>{gateLabel(g.verb).oggetto}</code>
			— {decided}
		</span>
	{:else if stato === 'chiusa'}
		<!-- Già deciso, ma non da qui (o prima di un ricarico): la coda è stata
		     letta DOPO che questo messaggio è arrivato. Si dice, invece di
		     riproporre bottoni che il backend rifiuterebbe. -->
		<span class="jobprop-done">
			🛡️ <b>{g.agent}</b> · <code>{gateLabel(g.verb).oggetto}</code>
			— già deciso
		</span>
	{:else if canDecide}
		{#if gDest}
			<!-- La DESTINAZIONE, non solo il verbo: è l'unica cosa che serve sapere
			     per decidere. -->
			<span class="jobprop-q">
				🛡️ <b>{g.agent}</b> vuole {gDest.direzione === 'egress' ? 'raggiungere' : 'ricevere da'}
				<code>{gDest.dest}</code> ({gDest.canale}) — approvi?
			</span>
		{:else}
			<span class="jobprop-q">🛡️ <b>{g.agent}</b> {gateLabel(g.verb).azione} <code>{gateLabel(g.verb).oggetto}</code> — approvi?</span>
		{/if}
		<GateMatrix compact agent={g.agent} instance={g.instance} verb={g.verb}
			cells={info?.remember} {hasRoom} {isAdmin}
			{busy}
			on:decide={(e) => dispatch('decide', { approve: true, cell: e.detail })} />
		{#if !isDestinationGate(g.verb) && info?.editable}
			<!-- Approve WITH CORRECTIONS (clodia-platform#448): only on a verb gate,
			     and «per stavolta»: the cell is { who: 'spawn' }. -->
			{#if editing}
				<span class="gate-edit" data-testid="gate-edit">
					{#each Object.keys(draft) as campo (campo)}
						<label>{campo}
							{#if campo === 'body' || campo === 'text'}
								<textarea rows="4" bind:value={draft[campo]}></textarea>
							{:else}
								<input type="text" bind:value={draft[campo]} />
							{/if}
						</label>
					{/each}
					<button type="button" class="jobprop-ok" disabled={busy || !corrections}
						title="Esegue l'azione con i campi corretti; le regole di destinazione valutano la versione corretta"
						on:click={() => dispatch('decide', { approve: true, cell: { who: 'spawn' }, corrections: gateCorrections() })}>✓ Approva con modifiche</button>
					<button type="button" class="jobprop-no" on:click={() => (editing = false)}>Annulla</button>
				</span>
			{:else}
				<button type="button" class="jobprop-ok" disabled={busy}
					on:click={startGateEdit}>✎ Correggi</button>
			{/if}
		{/if}
		<button type="button" class="jobprop-no" disabled={busy}
			on:click={() => dispatch('decide', { approve: false })}>Nega</button>
	{:else}
		<span class="invite-note">
			{#if info?.decided_by === 'admin'}
				lo sblocca un admin della piattaforma
			{:else if info?.decider_name}
				lo sblocca <b>{info.decider_name}</b>, owner di questo topic
			{:else}
				solo l'owner può approvare
			{/if}
		</span>
	{/if}
	{#if info?.asker_note}
		<span class="gate-crosses">🔎 {info.asker_note}</span>
	{/if}
	{#if info?.crosses}
		<!-- Cosa si attraversa: senza, la richiesta è solo il nome di una
		     funzione, e chi decide non sa cosa sta decidendo. -->
		<span class="gate-crosses">↦ attraversa {info.crosses}</span>
	{/if}
</div>

<style>
	/* Same rules the topic page used for the inline card (the page keeps its
	   own `.jobprop*` for the job-proposal card, which is not a gate). */
	.invite-note { margin-left: auto; font-size: 11px; color: var(--fg-muted); font-style: italic; }
	.jobprop { margin-top: 8px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 10px; border: 1px dashed color-mix(in srgb, var(--accent) 45%, var(--border)); border-radius: 10px; background: rgba(127,127,127,.05); font-size: 12px; }
	.jobprop-q { flex: 1; }
	.jobprop-done { color: var(--fg-muted); font-style: italic; }
	.jobprop-ok { background: var(--accent); border: 1px solid var(--accent); color: var(--accent-fg); font: inherit; font-size: 12px; font-weight: 700; padding: 5px 12px; border-radius: 999px; cursor: pointer; }
	.jobprop-ok:disabled { opacity: .5; cursor: not-allowed; }
	.jobprop-no { background: transparent; border: 1px solid var(--border); color: var(--fg); font: inherit; font-size: 12px; padding: 5px 12px; border-radius: 999px; cursor: pointer; }
	.gate-crosses { display: block; font-size: 11px; opacity: .75; margin-top: 4px; }
	.gate-edit { display: flex; flex-direction: column; gap: 0.3rem; width: 100%; margin: 0.3rem 0; }
	.gate-edit label { display: flex; flex-direction: column; font-size: 0.8rem; gap: 0.15rem; }
	.gate-edit textarea, .gate-edit input { width: 100%; font: inherit; }
</style>
