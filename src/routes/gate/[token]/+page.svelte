<script lang="ts">
	/**
	 * GATE DECISION — /gate/{token}. Pagina SENZA login: il token firmato
	 * one-time (dalla notifica Telegram/email) autorizza la sola decisione di
	 * questo gate. Mostra artefatto + riepilogo + pills go/nogo + campo commento.
	 */
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { API_BASE_URL } from '$lib/api/client';

	$: token = $page.params.token ?? '';

	type GateData = {
		title: string; workflow: string; lane: string;
		summary: string; artefatto: string | null; choices: string[];
	};
	let data: GateData | null = null;
	let loading = true;
	let err = '';
	let comment = '';
	let done: string | null = null;
	let busy = false;

	async function load() {
		try {
			const res = await fetch(`${API_BASE_URL}/gate/${encodeURIComponent(token)}`, { cache: 'no-store' });
			if (!res.ok) {
				err = res.status === 403 ? 'Link non valido, scaduto o già usato.'
					: res.status === 409 ? 'Questo gate non è più in attesa di decisione.'
					: `Errore (${res.status})`;
				return;
			}
			data = await res.json();
		} catch (e) {
			err = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	async function decide(choice: string) {
		busy = true;
		try {
			const res = await fetch(`${API_BASE_URL}/gate/${encodeURIComponent(token)}/decide`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ choice, comment })
			});
			if (!res.ok) {
				err = res.status === 403 ? 'Link già usato o scaduto.' : `Errore (${res.status})`;
				return;
			}
			const r = await res.json();
			done = r.outcome ?? 'registrato';
		} catch (e) {
			err = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	onMount(load);
</script>

<div class="gate-wrap">
	<div class="gate-card">
		{#if loading}
			<p class="muted">Caricamento…</p>
		{:else if done}
			<div class="gate-head"><span class="mark">✓</span><h1>Decisione registrata</h1></div>
			<p>Esito: <strong>{done}</strong>. Puoi chiudere questa pagina.</p>
		{:else if err}
			<div class="gate-head"><span class="mark err">✕</span><h1>Non disponibile</h1></div>
			<p class="muted">{err}</p>
		{:else if data}
			<div class="gate-head"><span class="mark">🔔</span><h1>Decisione richiesta</h1></div>
			<p class="wf">{data.workflow} — <strong>{data.title}</strong></p>
			<p class="lane">Stadio: <strong>{data.lane}</strong></p>
			{#if data.artefatto}
				<p class="art">Da valutare: <a href={data.artefatto} target="_blank" rel="noopener">{data.artefatto}</a></p>
			{/if}
			{#if data.summary}
				<pre class="summary">{data.summary.slice(0, 1200)}</pre>
			{/if}
			<textarea bind:value={comment} placeholder="Commento (opzionale — obbligatorio se rimandi)…" rows="3"></textarea>
			<div class="pills">
				{#each data.choices as c (c)}
					<button type="button" class="pill" class:primary={c.startsWith('Approva')} class:danger={c.startsWith('Annulla')}
						on:click={() => decide(c)} disabled={busy}>{c}</button>
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	.gate-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; background: #0b0e14; color: #e6e6e6; }
	.gate-card { width: 100%; max-width: 560px; border: 1px solid #2a2f3a; border-radius: 14px; padding: 24px; background: #12161f; }
	.gate-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
	.gate-head h1 { font-size: 18px; margin: 0; }
	.mark { font-size: 20px; }
	.mark.err { color: #ef4444; }
	.muted { color: #94a3b8; }
	.wf { font-size: 13px; color: #94a3b8; margin: 6px 0 2px; }
	.lane { margin: 2px 0 10px; }
	.art a { color: #60a5fa; word-break: break-all; }
	.summary { white-space: pre-wrap; font-size: 12.5px; background: #0b0e14; border: 1px solid #2a2f3a; border-radius: 8px; padding: 10px; max-height: 240px; overflow: auto; }
	textarea { width: 100%; margin: 12px 0; font: inherit; font-size: 13px; padding: 8px 10px; border-radius: 8px; border: 1px solid #2a2f3a; background: #0b0e14; color: #e6e6e6; box-sizing: border-box; }
	.pills { display: flex; flex-wrap: wrap; gap: 8px; }
	.pill { font: inherit; font-size: 13px; padding: 8px 16px; border-radius: 999px; border: 1px solid #2a2f3a; background: #1a1f2b; color: #e6e6e6; cursor: pointer; }
	.pill.primary { border-color: #34c759; background: rgba(52,199,89,0.15); color: #34c759; }
	.pill.danger { border-color: #ef4444; background: rgba(239,68,68,0.12); color: #ef4444; }
	.pill:disabled { opacity: 0.5; }
</style>
