<script lang="ts">
	/**
	 * One card for several gate requests (clodia-platform#489): consecutive
	 * gate messages in a chat, or the open requests of the global popup.
	 * Replaces the `GateBatchBar` (#396), which sat above the composer IN
	 * ADDITION to the N cards.
	 *
	 * The card CHOOSES and asks for confirmation; the host DECIDES, row by
	 * row, on the usual endpoint (`decideBatch`, sequential) — the right to
	 * decide stays that of each single request, and «approve all» is one-time,
	 * never a standing consent.
	 *
	 * Each row keeps its own state: decided rows show the outcome in place,
	 * closed rows say so, rows the viewer may not decide are shown but cannot be
	 * ticked. The per-request decision (the approval matrix, «Correggi» on a
	 * verb with editable arguments, «Nega») stays available: «Dettagli» opens the
	 * host's own single card for that row in the `detail` slot.
	 */
	import { createEventDispatcher } from 'svelte';
	import { gateLabel } from '$lib/gateLabel';
	import { gateDestination } from '$lib/gateCard';

	type Gate = { id: string; agent: string; instance: string; verb: string };
	type Riga = {
		/** Row identity: the MESSAGE id in a chat, the request id in the popup. */
		key: string;
		g: Gate;
		stato: 'decisa' | 'chiusa' | 'da-decidere';
		decided?: string;
		canDecide: boolean;
		info?: { decided_by?: string; decider_name?: string };
	};

	export let righe: Riga[] = [];
	export let busy = false;

	const dispatch = createEventDispatcher<{ decide: { approve: boolean; keys: string[] } }>();

	let scelte = new Set<string>();
	let conferma = false;
	let aperte = new Set<string>();

	/** Selectable = still to decide AND the viewer has the right to. */
	function selezionabile(r: Riga): boolean {
		return r.stato === 'da-decidere' && r.canDecide;
	}
	$: decidibili = righe.filter(selezionabile);
	// A choice lasts as long as the row can still be decided.
	$: {
		const vive = new Set(decidibili.map((r) => r.key));
		const tenute = [...scelte].filter((k) => vive.has(k));
		if (tenute.length !== scelte.size) scelte = new Set(tenute);
	}
	$: tutte = decidibili.length > 0 && decidibili.every((r) => scelte.has(r.key));
	$: if (!decidibili.length) conferma = false;
	$: fatte = righe.every((r) => r.stato !== 'da-decidere');
	$: selezionate = decidibili.filter((r) => scelte.has(r.key));

	function toggle(k: string) {
		const s = new Set(scelte);
		if (s.has(k)) s.delete(k); else s.add(k);
		scelte = s;
	}
	function toggleTutte() {
		scelte = tutte ? new Set() : new Set(decidibili.map((r) => r.key));
	}
	function toggleDettagli(k: string) {
		const s = new Set(aperte);
		if (s.has(k)) s.delete(k); else s.add(k);
		aperte = s;
	}
	function decidi(approve: boolean, sole: Riga[]) {
		conferma = false;
		// Snapshot: what is on screen NOW. A request that arrives later does not
		// enter an «approve all» pressed before it existed.
		dispatch('decide', { approve, keys: sole.map((r) => r.key) });
	}
	function cosa(g: Gate): string {
		const d = gateDestination(g.verb);
		if (d) return `${d.direzione === 'egress' ? 'vuole raggiungere' : 'vuole ricevere da'} ${d.dest} (${d.canale})`;
		return '';
	}
</script>

{#if righe.length}
	<div class="gate-group" class:done={fatte} role="group" aria-label="Richieste di gate raggruppate"
		data-testid="gate-group">
		<div class="gg-head">
			{#if decidibili.length}
				<label class="gg-all">
					<input type="checkbox" checked={tutte} on:change={toggleTutte} disabled={busy} />
					🛡️ <b>{righe.length}</b> richieste
				</label>
				<span class="gg-note">in blocco si approva solo per stavolta</span>
			{:else}
				<span class="gg-all">🛡️ <b>{righe.length}</b> richieste{fatte ? ' — tutte decise' : ''}</span>
			{/if}
		</div>
		<ul class="gg-list">
			{#each righe as r (r.key)}
				{@const sel = selezionabile(r)}
				{@const dest = cosa(r.g)}
				<li class:off={!sel}>
					<div class="gg-row">
						<label class="gg-label">
							<input type="checkbox" checked={scelte.has(r.key)} disabled={busy || !sel}
								on:change={() => toggle(r.key)} />
							<span>
								<b>{r.g.agent}</b>{#if r.g.instance && r.g.instance !== '-'} <span class="gg-inst">({r.g.instance})</span>{/if}
								{#if dest}{dest}{:else}{gateLabel(r.g.verb).azione} <code>{gateLabel(r.g.verb).oggetto}</code>{/if}
							</span>
						</label>
						<span class="gg-state">
							{#if r.stato === 'decisa'}
								— {r.decided}
							{:else if r.stato === 'chiusa'}
								— già deciso
							{:else if !r.canDecide}
								{#if r.info?.decided_by === 'admin'}lo sblocca un admin
								{:else if r.info?.decider_name}lo sblocca {r.info.decider_name}
								{:else}solo l'owner può approvare{/if}
							{/if}
						</span>
						{#if $$slots.detail && r.stato === 'da-decidere'}
							<button type="button" class="gg-more" aria-expanded={aperte.has(r.key)}
								title="Decidi questa richiesta da sola: casella della matrice, correzioni, rifiuto"
								on:click={() => toggleDettagli(r.key)}>{aperte.has(r.key) ? 'Chiudi' : 'Dettagli'}</button>
						{/if}
					</div>
					{#if aperte.has(r.key) && r.stato === 'da-decidere'}
						<div class="gg-detail"><slot name="detail" riga={r} /></div>
					{/if}
				</li>
			{/each}
		</ul>
		{#if decidibili.length}
			<div class="gg-actions">
				{#if conferma}
					<span class="gg-confirm">Approvi tutte e {decidibili.length} le richieste?</span>
					<button type="button" class="gg-ok" disabled={busy} on:click={() => decidi(true, decidibili)}>
						{busy ? '…' : `✓ Sì, approva ${decidibili.length}`}
					</button>
					<button type="button" class="gg-no" disabled={busy} on:click={() => (conferma = false)}>Annulla</button>
				{:else}
					<button type="button" class="gg-ok" disabled={busy} on:click={() => (conferma = true)}>
						✓ Approva tutte ({decidibili.length})
					</button>
					<button type="button" class="gg-ok" disabled={busy || !selezionate.length}
						on:click={() => decidi(true, selezionate)}>Approva selezionate ({selezionate.length})</button>
					<button type="button" class="gg-no" disabled={busy || !selezionate.length}
						on:click={() => decidi(false, selezionate)}>Nega selezionate</button>
				{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	.gate-group { margin-top: 8px; padding: 8px 10px; border: 1px dashed color-mix(in srgb, var(--accent) 45%, var(--border)); border-radius: 10px; background: rgba(127,127,127,.05); font-size: 12px; }
	.gate-group.done { opacity: .85; }
	.gg-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px; }
	.gg-all { display: flex; align-items: center; gap: 6px; cursor: pointer; }
	.gg-note { opacity: .7; font-size: 11px; }
	.gg-list { list-style: none; margin: 6px 0; padding: 0; }
	.gg-list li { padding: 3px 0; border-top: 1px solid color-mix(in srgb, var(--border) 60%, transparent); }
	.gg-list li:first-child { border-top: 0; }
	.gg-row { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; }
	.gg-label { display: flex; align-items: baseline; gap: 6px; flex: 1; min-width: 0; cursor: pointer; }
	.gg-label code { overflow-wrap: anywhere; }
	.off .gg-label { cursor: default; }
	.gg-inst { opacity: .7; }
	.gg-state { color: var(--fg-muted); font-style: italic; font-size: 11px; }
	.gg-more { font: inherit; font-size: 11px; padding: 1px 8px; border-radius: 999px; border: 1px solid var(--border); background: transparent; color: var(--fg); cursor: pointer; }
	.gg-detail { margin: 2px 0 4px 22px; }
	.gg-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
	.gg-confirm { font-weight: 600; }
	.gg-ok, .gg-no { font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--card-bg); color: var(--fg); cursor: pointer; }
	.gg-ok { border-color: color-mix(in srgb, var(--accent) 55%, var(--border)); }
	.gg-ok:disabled, .gg-no:disabled { opacity: .5; cursor: default; }
</style>
