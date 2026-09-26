<script lang="ts">
	// Gate combinato (clodia-platform#396): le richieste aperte in un blocco solo,
	// con «approva tutte» o la scelta delle singole. Il componente sceglie e
	// chiede conferma; DECIDE chi lo usa, voce per voce, sull'endpoint di sempre —
	// il titolo a decidere resta quello di ogni singola richiesta.
	import { createEventDispatcher } from 'svelte';
	import { gateLabel } from '$lib/gateLabel';

	type Voce = { id: string; agent: string; instance: string; verb: string };
	export let voci: Voce[] = [];
	export let busy = false;

	const dispatch = createEventDispatcher<{ decide: { approve: boolean; voci: Voce[] } }>();
	let scelte = new Set<string>();
	let conferma = false;

	// Una scelta vale finché la richiesta esiste: quelle decise o scadute escono.
	$: {
		const vive = new Set(voci.map((v) => v.id));
		const tenute = [...scelte].filter((id) => vive.has(id));
		if (tenute.length !== scelte.size) scelte = new Set(tenute);
	}
	$: tutte = voci.length > 0 && voci.every((v) => scelte.has(v.id));
	$: if (!voci.length) conferma = false;

	function toggle(id: string) {
		const s = new Set(scelte);
		if (s.has(id)) s.delete(id); else s.add(id);
		scelte = s;
	}
	function toggleTutte() {
		scelte = tutte ? new Set() : new Set(voci.map((v) => v.id));
	}
	function decidi(approve: boolean, sole: Voce[]) {
		conferma = false;
		// Istantanea: si decide su ciò che è a schermo ORA.
		dispatch('decide', { approve, voci: [...sole] });
	}
	$: selezionate = voci.filter((v) => scelte.has(v.id));
</script>

{#if voci.length}
	<div class="gate-batch" role="group" aria-label="Richieste di gate in blocco">
		<div class="gb-head">
			<label class="gb-all">
				<input type="checkbox" checked={tutte} on:change={toggleTutte} disabled={busy} />
				🛡️ <b>{voci.length}</b> richieste di gate in attesa
			</label>
			<span class="gb-note">in blocco si approva solo per stavolta</span>
		</div>
		<ul class="gb-list">
			{#each voci as v (v.id)}
				<li>
					<label>
						<input type="checkbox" checked={scelte.has(v.id)} on:change={() => toggle(v.id)} disabled={busy} />
						<b>{v.agent}</b>{#if v.instance && v.instance !== '-'} <span class="gb-inst">({v.instance})</span>{/if}
						{gateLabel(v.verb).azione} <code>{gateLabel(v.verb).oggetto}</code>
					</label>
				</li>
			{/each}
		</ul>
		<div class="gb-actions">
			{#if conferma}
				<span class="gb-confirm">Approvi tutte e {voci.length} le richieste?</span>
				<button type="button" class="gb-ok" disabled={busy} on:click={() => decidi(true, voci)}>
					{busy ? '…' : `✓ Sì, approva ${voci.length}`}
				</button>
				<button type="button" class="gb-no" disabled={busy} on:click={() => (conferma = false)}>Annulla</button>
			{:else}
				<button type="button" class="gb-ok" disabled={busy} on:click={() => (conferma = true)}>
					✓ Approva tutte ({voci.length})
				</button>
				<button type="button" class="gb-ok" disabled={busy || !selezionate.length}
					on:click={() => decidi(true, selezionate)}>Approva selezionate ({selezionate.length})</button>
				<button type="button" class="gb-no" disabled={busy || !selezionate.length}
					on:click={() => decidi(false, selezionate)}>Nega selezionate</button>
			{/if}
		</div>
	</div>
{/if}

<style>
	.gate-batch { margin: 6px 0; padding: 8px 10px; border: 1px dashed color-mix(in srgb, var(--accent) 45%, var(--border)); border-radius: 10px; background: rgba(127,127,127,.05); font-size: 12px; }
	.gb-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px; }
	.gb-all { display: flex; align-items: center; gap: 6px; cursor: pointer; }
	.gb-note { opacity: .7; font-size: 11px; }
	.gb-list { list-style: none; margin: 6px 0; padding: 0; max-height: 160px; overflow-y: auto; }
	.gb-list li label { display: flex; align-items: baseline; gap: 6px; padding: 2px 0; cursor: pointer; flex-wrap: wrap; }
	.gb-inst { opacity: .7; }
	.gb-list code { overflow-wrap: anywhere; }
	.gb-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
	.gb-confirm { font-weight: 600; }
	.gb-ok, .gb-no { font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--card-bg); color: var(--fg); cursor: pointer; }
	.gb-ok { border-color: color-mix(in srgb, var(--accent) 55%, var(--border)); }
	.gb-ok:disabled, .gb-no:disabled { opacity: .5; cursor: default; }
</style>
