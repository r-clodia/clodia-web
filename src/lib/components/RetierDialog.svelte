<script lang="ts">
	// Riclassificazione del livello SEAL di un topic (clodia-platform#426).
	// Chi conferma se ne assume la responsabilità: motivazione e spunta sono
	// obbligatorie e finiscono nella cronologia del topic. I muri (egress/ingress)
	// NON cambiano: verificarli prima è compito dell'owner, e il dialog lo dice.
	import { createEventDispatcher } from 'svelte';
	import { previewTopicTier, setTopicTier, type TierImpact } from '$lib/api/client';

	export let tier: string;
	export let name: string;

	const LIVELLI = ['SEAL-0', 'SEAL-1', 'SEAL-2', 'SEAL-3', 'SEAL-4'];
	const dispatch = createEventDispatcher<{ close: void; done: { to: string } }>();

	let to = LIVELLI.find((l) => l !== tier) ?? '';
	let reason = '';
	let accept = false;
	let busy = false;
	let err = '';
	let impact: TierImpact | null = null;
	let impactErr = '';

	async function loadImpact(t: string) {
		impact = null;
		impactErr = '';
		if (!t || t === tier) return;
		try {
			impact = await previewTopicTier(tier, name, t);
		} catch (e) {
			impactErr = e instanceof Error ? e.message : String(e);
		}
	}
	$: void loadImpact(to);
	$: pronto = !!to && to !== tier && reason.trim().length > 0 && accept && !busy;

	async function conferma() {
		if (!pronto) return;
		busy = true;
		err = '';
		try {
			const r = await setTopicTier(tier, name, to, reason.trim());
			dispatch('done', { to: r.to || to });
		} catch (e) {
			err = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}
</script>

<div class="rt-overlay" role="dialog" aria-modal="true" aria-label="Riclassifica il livello del topic">
	<div class="rt-card">
		<div class="rt-head">🔒 <strong>Riclassifica il livello</strong> · <code>{tier}</code> → 
			<select bind:value={to} disabled={busy}>
				{#each LIVELLI.filter((l) => l !== tier) as l}<option value={l}>{l}</option>{/each}
			</select>
		</div>

		{#if impact}
			{#if impact.direction === 'down'}
				<p class="rt-warn">⚠️ Il livello <b>scende</b>: il contenuto del topic diventa leggibile da agenti e
					provider meno garantiti. È una declassificazione.</p>
			{/if}
			{#if impact.lose_access.length}
				<p>Perdono l'accesso: {#each impact.lose_access as p, i}<b>{p.name}</b>{i < impact.lose_access.length - 1 ? ', ' : ''}{/each}</p>
			{/if}
			{#if impact.gain_access.length}
				<p>Acquistano l'accesso: {#each impact.gain_access as p, i}<b>{p.name}</b>{i < impact.gain_access.length - 1 ? ', ' : ''}{/each}</p>
			{/if}
			{#if !impact.lose_access.length && !impact.gain_access.length}
				<p class="muted">Nessun partecipante cambia accesso.</p>
			{/if}
		{:else if impactErr}
			<p class="rt-err">Anteprima non disponibile: {impactErr}</p>
		{/if}

		<p class="muted">Egress e ingress del topic <b>non vengono modificati</b>: verificali prima di confermare.</p>

		<label class="rt-label">Motivazione (resta nella cronologia del topic)
			<textarea bind:value={reason} rows="3" disabled={busy}
				placeholder="Perché il topic cambia livello"></textarea>
		</label>
		<label class="rt-check">
			<input type="checkbox" bind:checked={accept} disabled={busy} />
			Mi assumo la responsabilità di questa riclassificazione
		</label>

		{#if err}<p class="rt-err" role="alert">{err}</p>{/if}
		<div class="rt-actions">
			<button type="button" class="rt-btn ghost" on:click={() => dispatch('close')} disabled={busy}>Annulla</button>
			<button type="button" class="rt-btn" on:click={conferma} disabled={!pronto}>
				{busy ? 'Riclassifico…' : `Riclassifica a ${to}`}
			</button>
		</div>
	</div>
</div>

<style>
	.rt-overlay { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.45); padding: 16px; }
	.rt-card { background: var(--card-bg); border: 1px solid var(--border); border-left: 4px solid var(--accent); border-radius: 12px; max-width: 480px; width: 100%; padding: 18px 20px; box-shadow: 0 12px 40px rgba(0,0,0,.35); display: flex; flex-direction: column; gap: 8px; font-size: 13px; }
	.rt-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
	.rt-warn { color: var(--warn, #e0a800); }
	.rt-err { color: var(--danger, #e5484d); }
	.rt-label { display: flex; flex-direction: column; gap: 4px; }
	.rt-label textarea { font: inherit; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg); color: var(--fg); }
	.rt-check { display: flex; align-items: center; gap: 6px; }
	.rt-actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
	.rt-btn { font: inherit; padding: 5px 12px; border-radius: 6px; border: 1px solid color-mix(in srgb, var(--accent) 55%, var(--border)); background: var(--card-bg); color: var(--fg); cursor: pointer; }
	.rt-btn.ghost { border-color: var(--border); }
	.rt-btn:disabled { opacity: .5; cursor: default; }
</style>
