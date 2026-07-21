<script lang="ts">
	// Popup di approvazione SUDO (M-sudo): mostra all'OWNER le richieste di
	// escalation dei sudoer (clodia/ophelia/sysadmin) e permette Approva/Nega.
	// Il backend (/api/sudo/pending) ritorna [] a chi non è approvatore → i
	// non-admin non vedono nulla.
	import { onMount, onDestroy } from 'svelte';
	import { apiGet, apiPost } from '$lib/api/client';
	import { toastSuccess, toastError } from '$lib/stores/toasts';

	type Req = { agent: string; instance: string; reason: string; minutes: number; human?: string; chat?: string; age_s: number };
	let requests: Req[] = [];
	let busy = '';
	let poll: ReturnType<typeof setInterval> | null = null;

	async function refresh() {
		try {
			const r = await apiGet<{ requests: Req[] }>('/api/sudo/pending');
			requests = r?.requests ?? [];
		} catch {
			requests = [];
		}
	}
	function keyOf(q: Req) { return `${q.agent}|${q.instance}`; }

	async function approve(q: Req) {
		busy = keyOf(q);
		try {
			await apiPost('/api/sudo/approve', { agent: q.agent, instance: q.instance, minutes: q.minutes, chat: q.chat });
			toastSuccess('Sudo concesso', `${q.agent} · ${q.minutes} min`);
			await refresh();
		} catch (e) {
			toastError('Approvazione fallita', e instanceof Error ? e.message : String(e));
		} finally { busy = ''; }
	}
	async function deny(q: Req) {
		busy = keyOf(q);
		try {
			await apiPost('/api/sudo/deny', { agent: q.agent, instance: q.instance, chat: q.chat });
			toastSuccess('Richiesta negata', q.agent);
			await refresh();
		} catch (e) {
			toastError('Rifiuto fallito', e instanceof Error ? e.message : String(e));
		} finally { busy = ''; }
	}

	onMount(() => { void refresh(); poll = setInterval(refresh, 5000); });
	onDestroy(() => { if (poll) clearInterval(poll); });
</script>

{#if requests.length}
	<div class="sudo-wrap" role="alertdialog" aria-label="Richieste sudo">
		{#each requests as q (keyOf(q))}
			<div class="sudo-card">
				<div class="sudo-head">🔐 <b>{q.agent}</b> chiede <b>sudo</b></div>
				<div class="sudo-reason">{q.reason || '(nessun motivo)'}</div>
				<div class="sudo-meta">
					{#if q.human}richiesto da <b>{q.human}</b> · {/if}durata {q.minutes} min
				</div>
				<div class="sudo-actions">
					<button class="btn deny" on:click={() => deny(q)} disabled={busy === keyOf(q)}>Nega</button>
					<button class="btn ok" on:click={() => approve(q)} disabled={busy === keyOf(q)}>
						{busy === keyOf(q) ? '…' : `Approva ${q.minutes}'`}
					</button>
				</div>
			</div>
		{/each}
	</div>
{/if}

<style>
	.sudo-wrap { position: fixed; right: 20px; top: 20px; z-index: 80; display: flex; flex-direction: column; gap: 10px; max-width: 340px; }
	.sudo-card { background: var(--card-bg); border: 1px solid var(--border); border-left: 4px solid #e0a800; border-radius: 12px; padding: 12px 14px; box-shadow: 0 12px 40px rgba(0,0,0,.4); }
	.sudo-head { font-size: 14px; margin-bottom: 4px; }
	.sudo-reason { font-size: 13px; color: var(--fg); margin: 4px 0 6px; }
	.sudo-meta { font-size: 11px; color: var(--fg-muted); margin-bottom: 10px; }
	.sudo-actions { display: flex; gap: 8px; justify-content: flex-end; }
	.btn { font: inherit; font-size: 12px; padding: 5px 12px; border-radius: 8px; cursor: pointer; border: 1px solid var(--border); background: transparent; color: var(--fg); }
	.btn.ok { background: #e0a800; border-color: #e0a800; color: #1a1208; font-weight: 700; }
	.btn.deny:hover { border-color: #dc2626; color: #dc2626; }
	.btn:disabled { opacity: .5; }
</style>
