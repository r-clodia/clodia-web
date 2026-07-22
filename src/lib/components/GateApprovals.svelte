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
	};
	let requests: Req[] = [];
	let busy = '';
	let poll: ReturnType<typeof setInterval> | null = null;

	async function refresh() {
		try {
			const r = await apiGet<{ requests: Req[] }>('/api/gate/pending');
			requests = r?.requests ?? [];
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
	.gate-meta { font-size: 11px; color: var(--fg-muted); margin-bottom: 10px; }
	.gate-actions { display: flex; gap: 8px; justify-content: flex-end; }
	.btn { font: inherit; font-size: 12px; padding: 5px 12px; border-radius: 8px; cursor: pointer; border: 1px solid var(--border); background: transparent; color: var(--fg); }
	.btn.ok { background: #2563eb; border-color: #2563eb; color: #fff; font-weight: 700; }
	.btn.deny:hover { border-color: #dc2626; color: #dc2626; }
	.btn:disabled { opacity: .5; }
</style>
