<script lang="ts">
	// Deleghe permanenti (async·A): pre-autorizzi un verbo gated firmando una delega
	// con la TUA masterkey (client-side). Il gateway la verifica (firma vs cert CA) e
	// sblocca i gate che coprono lo scope — senza popup a runtime (es. backup notturno).
	import { onMount } from 'svelte';
	import { listDelegations, registerDelegation, revokeDelegation, type Delegation } from '$lib/api/client';
	import { signDelegation } from '$lib/auth/session';
	import { toastSuccess, toastError } from '$lib/stores/toasts';

	let items: Delegation[] = [];
	let loading = false;
	let busy = false;
	let fVerb = '';
	let fAgent = '';
	let fDays = 90;

	async function load() {
		loading = true;
		try {
			items = (await listDelegations()).delegations ?? [];
		} catch (e) {
			toastError('Deleghe', e instanceof Error ? e.message : String(e));
		} finally {
			loading = false;
		}
	}

	async function create() {
		const verb = fVerb.trim();
		if (!verb || busy) return;
		busy = true;
		try {
			const scope: { verb: string; agent?: string } = { verb };
			if (fAgent.trim()) scope.agent = fAgent.trim();
			const token = await signDelegation(scope, Math.max(1, fDays) * 24 * 3600);
			await registerDelegation(token);
			toastSuccess('Delega creata', verb);
			fVerb = ''; fAgent = '';
			await load();
		} catch (e) {
			toastError('Firma/registro delega', e instanceof Error ? e.message : String(e));
		} finally {
			busy = false;
		}
	}

	async function revoke(d: Delegation) {
		if (!confirm(`Revocare la delega di ${d.principal} su ${d.scope.verb}?`)) return;
		try {
			await revokeDelegation(d.principal, d.scope.verb);
			await load();
		} catch (e) {
			toastError('Revoca', e instanceof Error ? e.message : String(e));
		}
	}

	function fmtExp(exp: number): string {
		return new Date(exp * 1000).toLocaleDateString();
	}

	onMount(load);
</script>

<div class="deleg">
	<div class="deleg-head"><span class="deleg-title">🔑 Deleghe permanenti (gate async)</span></div>
	<p class="deleg-note">
		Pre-autorizza un verbo gated firmando con la tua masterkey: i gate che coprono lo
		scope si sbloccano senza popup a runtime (es. job notturni). La delega è
		<b>scoped</b> — tutto ciò che ne esce resta gated. Serve "Ricordami" attivo.
	</p>

	<div class="deleg-form">
		<input placeholder="verbo (es. settings.backup_run)" bind:value={fVerb} />
		<input placeholder="agent (opz.)" bind:value={fAgent} />
		<label class="days">giorni <input type="number" min="1" max="3650" bind:value={fDays} /></label>
		<button class="mini primary" on:click={create} disabled={busy || !fVerb.trim()}>{busy ? '…' : 'Firma e crea'}</button>
	</div>

	{#if loading}
		<p class="deleg-empty">Carico…</p>
	{:else if items.length === 0}
		<p class="deleg-empty">Nessuna delega attiva.</p>
	{:else}
		<ul class="deleg-list">
			{#each items as d}
				<li>
					<code class="d-verb">{d.scope.verb}</code>
					{#if d.scope.agent}<span class="d-agent">→ {d.scope.agent}</span>{/if}
					<span class="d-by">di {d.principal}</span>
					<span class="d-exp">scade {fmtExp(d.exp)}</span>
					<button class="mini danger" on:click={() => revoke(d)}>Revoca</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.deleg { border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; background: var(--card-bg); }
	.deleg-title { font-weight: 700; font-size: 14px; }
	.deleg-note { font-size: 12px; color: var(--fg-muted); margin: 6px 0 10px; }
	.deleg-form { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 10px; }
	.deleg-form input { background: rgba(0,0,0,.25); border: 1px solid var(--border); color: var(--fg); border-radius: 7px; padding: 6px 9px; font: inherit; font-size: 12px; }
	.deleg-form input[type="number"] { width: 64px; }
	.days { font-size: 11px; color: var(--fg-muted); display: inline-flex; align-items: center; gap: 4px; }
	.mini { font: inherit; font-size: 12px; padding: 4px 11px; border-radius: 8px; border: 1px solid var(--border); background: transparent; color: var(--fg); cursor: pointer; }
	.mini.primary { background: var(--accent); border-color: var(--accent); color: #1a1208; font-weight: 700; }
	.mini.danger:hover { border-color: var(--danger); color: var(--danger); }
	.mini:disabled { opacity: .5; }
	.deleg-empty { font-size: 12px; color: var(--fg-muted); }
	.deleg-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
	.deleg-list li { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12px; }
	.d-verb { font-family: var(--mono); background: rgba(0,0,0,.25); padding: 1px 6px; border-radius: 4px; }
	.d-agent { color: var(--accent); font-size: 11px; }
	.d-by, .d-exp { color: var(--fg-muted); font-size: 11px; }
	.d-exp { margin-left: auto; }
</style>
