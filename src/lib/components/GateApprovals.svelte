<script lang="ts">
	// Popup di approvazione GATE (M-gate): mostra all'utente loggato AUTORIZZATO
	// le richieste di conferma su verbi *gated* innescate dagli agenti, con
	// Approva/Nega. Il backend (/api/gate/pending) ritorna [] a chi non è
	// autorizzato → i non-admin non vedono nulla. La conferma NON concede tool:
	// autorizza l'uso (già permesso) di un verbo gated, una tantum.
	import { onMount, onDestroy } from 'svelte';
	import { apiGet, apiPost } from '$lib/api/client';
	import { toastSuccess, toastError } from '$lib/stores/toasts';

	type Req = {
		id: string; agent: string; instance: string; verb: string;
		context?: string; human?: string; chat?: string; mode?: string;
		reason?: string; age_s: number;
		/** Cosa attraversa questa azione, e chi ha titolo a sbloccarla. Arrivano
		 *  dal backend da UNA sola regola (`_standing`), la stessa che poi
		 *  applica il controllo: ricalcolarli qui a partire dalla classe
		 *  significherebbe una seconda copia della regola, e la copia che
		 *  diverge è sempre quella che spiega — si finirebbe a scrivere «decide
		 *  un admin» su un gate che solo l'owner può sbloccare. */
		crosses?: string; decided_by?: string; decider_name?: string; scope?: string;
	};
	let requests: Req[] = [];
	let busy = '';
	let poll: ReturnType<typeof setInterval> | null = null;

	async function refresh() {
		try {
			const r = await apiGet<{ requests: Req[] }>('/api/gate/pending');
			// FALLBACK popup: solo i gate SENZA contesto-canale. Quelli innescati da
			// un'azione in un topic (chat=chan:…) sono resi come card INLINE nella
			// conversazione (marker <!-- gate=… -->), non nel popup.
			requests = (r?.requests ?? []).filter((q) => !(q.chat || '').startsWith('chan:'));
		} catch {
			requests = [];
		}
	}

	async function approve(q: Req) {
		busy = q.id;
		try {
			await apiPost('/api/gate/approve', {
				agent: q.agent, instance: q.instance, verb: q.verb, chat: q.chat
			});
			toastSuccess('Gate approvato', `${q.agent} · ${q.verb}`);
			await refresh();
		} catch (e) {
			toastError('Approvazione fallita', e instanceof Error ? e.message : String(e));
		} finally {
			busy = '';
		}
	}
	async function deny(q: Req) {
		busy = q.id;
		try {
			await apiPost('/api/gate/deny', {
				agent: q.agent, instance: q.instance, verb: q.verb, chat: q.chat
			});
			toastSuccess('Gate negato', `${q.agent} · ${q.verb}`);
			await refresh();
		} catch (e) {
			toastError('Rifiuto fallito', e instanceof Error ? e.message : String(e));
		} finally {
			busy = '';
		}
	}

	onMount(() => { void refresh(); poll = setInterval(refresh, 5000); });
	onDestroy(() => { if (poll) clearInterval(poll); });
</script>

{#if requests.length}
	<div class="gate-wrap" role="alertdialog" aria-label="Richieste gate">
		{#each requests as q (q.id)}
			<div class="gate-card">
				{#if q.verb.startsWith('topic-access:')}
					<div class="gate-head">🛡️ <b>{q.agent}</b> vuole accedere al topic <code>{q.verb.slice('topic-access:'.length)}</code> (non è partecipante)</div>
				{:else}
					<div class="gate-head">🛡️ <b>{q.agent}</b> vuole usare <code>{q.verb}</code></div>
				{/if}
				{#if q.reason}<div class="gate-reason">{q.reason}</div>{/if}
				{#if q.crosses}
					<!-- Cosa si sta per attraversare. Un gate non è una proprietà del
					     verbo: è ciò che accade quando un'azione supera un confine, e
					     senza dire QUALE la richiesta è solo un nome di funzione. -->
					<div class="gate-crosses">
						↦ attraversa {q.crosses}{#if q.scope} · <code>{q.scope}</code>{/if}
					</div>
				{/if}
				{#if q.decided_by}
					<div class="gate-who">
						{#if q.decided_by.startsWith('owner:')}
							decide l'<b>owner</b>{#if q.decider_name}: <b>{q.decider_name}</b>{/if}
						{:else}
							decide un <b>admin</b>
						{/if}
					</div>
				{/if}
				<div class="gate-meta">
					verbo sotto supervisione umana{#if q.human} · nel contesto di <b>{q.human}</b>{/if}
				</div>
				<div class="gate-actions">
					<button class="btn deny" on:click={() => deny(q)} disabled={busy === q.id}>Nega</button>
					<button class="btn ok" on:click={() => approve(q)} disabled={busy === q.id}>
						{busy === q.id ? '…' : 'Approva'}
					</button>
				</div>
			</div>
		{/each}
	</div>
{/if}

<style>
	.gate-wrap { position: fixed; right: 20px; top: 20px; z-index: 80; display: flex; flex-direction: column; gap: 10px; max-width: 340px; }
	.gate-card { background: var(--card-bg); border: 1px solid var(--border); border-left: 4px solid #2563eb; border-radius: 12px; padding: 12px 14px; box-shadow: 0 12px 40px rgba(0,0,0,.4); }
	.gate-head { font-size: 14px; margin-bottom: 4px; }
	.gate-head code { font-family: var(--mono); font-size: 12px; }
	.gate-reason { font-size: 13px; color: var(--fg); margin: 4px 0 6px; }
	.gate-crosses { font-size: 12px; margin: 2px 0; }
	.gate-crosses code { font-family: var(--mono); font-size: 11px; }
	.gate-who { font-size: 12px; margin: 0 0 4px; }
	.gate-meta { font-size: 11px; color: var(--fg-muted); margin-bottom: 10px; }
	.gate-actions { display: flex; gap: 8px; justify-content: flex-end; }
	.btn { font: inherit; font-size: 12px; padding: 5px 12px; border-radius: 8px; cursor: pointer; border: 1px solid var(--border); background: transparent; color: var(--fg); }
	.btn.ok { background: #2563eb; border-color: #2563eb; color: #fff; font-weight: 700; }
	.btn.deny:hover { border-color: #dc2626; color: #dc2626; }
	.btn:disabled { opacity: .5; }
</style>
