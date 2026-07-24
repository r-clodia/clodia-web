<script lang="ts">
	// Pannello "Hooks" (owner-only) di una chat: crea/revoca capability per
	// iniettare messaggi via webhook. Il segreto si vede UNA volta alla creazione.
	import { onMount } from 'svelte';
	import {
		API_BASE_URL, listHooks, createHook, revokeHook, deleteHook, type ChatHook
	} from '$lib/api/client';
	import { toastSuccess, toastError } from '$lib/stores/toasts';

	export let tier: string;
	export let name: string;
	export let agents: string[] = []; // partecipanti selezionabili come trigger

	let hooks: ChatHook[] = [];
	let loading = false;
	let creating = false;
	let showForm = false;
	let fLabel = '';
	let fTrigger = '';
	// segreto+url appena creati, mostrati una sola volta
	let fresh: { id: string; label: string; secret: string; url: string } | null = null;

	function hookUrl(id: string): string {
		return `${API_BASE_URL}/hooks/${id}`;
	}

	async function load() {
		loading = true;
		try {
			hooks = (await listHooks(tier, name)).hooks ?? [];
		} catch (e) {
			toastError('Hook', e instanceof Error ? e.message : String(e));
		} finally {
			loading = false;
		}
	}

	async function submit() {
		if (!fLabel.trim() || creating) return;
		creating = true;
		try {
			const r = await createHook(tier, name, {
				label: fLabel.trim(),
				trigger_agent: fTrigger || null
			});
			fresh = { id: r.hook.id, label: r.hook.label, secret: r.secret, url: hookUrl(r.hook.id) };
			fLabel = '';
			fTrigger = '';
			showForm = false;
			await load();
		} catch (e) {
			toastError('Creazione hook', e instanceof Error ? e.message : String(e));
		} finally {
			creating = false;
		}
	}

	async function revoke(h: ChatHook) {
		if (!confirm(`Revocare l'hook "${h.label}"? Le richieste col suo segreto saranno rifiutate.`)) return;
		try {
			await revokeHook(h.id);
			toastSuccess('Hook revocato', h.label);
			await load();
		} catch (e) {
			toastError('Revoca', e instanceof Error ? e.message : String(e));
		}
	}

	async function remove(h: ChatHook) {
		if (!confirm(`Eliminare definitivamente l'hook "${h.label}"?`)) return;
		try {
			await deleteHook(h.id);
			await load();
		} catch (e) {
			toastError('Eliminazione', e instanceof Error ? e.message : String(e));
		}
	}

	function copy(text: string) {
		navigator.clipboard?.writeText(text).then(
			() => toastSuccess('Copiato'),
			() => toastError('Copia non riuscita')
		);
	}

	function curlExample(url: string, secret: string): string {
		return `curl -X POST ${url} \\\n  -H 'X-Hook-Secret: ${secret}' \\\n  -d 'Il tuo messaggio'`;
	}

	onMount(load);
</script>

<div class="hooks">
	<div class="hooks-head">
		<span class="hooks-title">🪝 Hooks</span>
		<button class="mini" on:click={() => (showForm = !showForm)}>{showForm ? 'Annulla' : '+ Nuovo'}</button>
	</div>
	<p class="hooks-note">
		Un hook è un URL segreto che inietta un messaggio in questa chat (webhook). Il messaggio
		arriva come input <b>non fidato</b>: azioni fuori-topic restano da approvare.
	</p>

	{#if showForm}
		<div class="hook-form">
			<input placeholder="Etichetta (es. github-ci)" bind:value={fLabel} />
			<select bind:value={fTrigger} title="Agente da svegliare al messaggio (opzionale)">
				<option value="">— nessun trigger (solo iniezione) —</option>
				{#each agents as a}<option value={a}>@{a}</option>{/each}
			</select>
			<button class="mini primary" on:click={submit} disabled={creating || !fLabel.trim()}>
				{creating ? '…' : 'Crea'}
			</button>
		</div>
	{/if}

	{#if fresh}
		<div class="hook-fresh">
			<div class="fresh-row">
				<b>Hook «{fresh.label}» creato.</b> Copia il segreto ORA: non sarà più mostrato.
			</div>
			<label class="fresh-field">URL
				<code>{fresh.url}</code>
				<button class="mini" on:click={() => copy(fresh.url)}>Copia</button>
			</label>
			<label class="fresh-field">Segreto
				<code>{fresh.secret}</code>
				<button class="mini" on:click={() => copy(fresh.secret)}>Copia</button>
			</label>
			<pre class="fresh-curl">{curlExample(fresh.url, fresh.secret)}</pre>
			<button class="mini" on:click={() => copy(curlExample(fresh.url, fresh.secret))}>Copia curl</button>
			<button class="mini" on:click={() => (fresh = null)}>Chiudi</button>
		</div>
	{/if}

	{#if loading}
		<p class="hooks-empty">Carico…</p>
	{:else if hooks.length === 0}
		<p class="hooks-empty">Nessun hook. Creane uno per ricevere messaggi via webhook.</p>
	{:else}
		<ul class="hook-list">
			{#each hooks as h (h.id)}
				<li class="hook-item" class:disabled={!h.enabled}>
					<div class="hi-main">
						<span class="hi-label">{h.label}</span>
						{#if h.trigger_agent}<span class="hi-trig">→ @{h.trigger_agent}</span>{/if}
						{#if !h.enabled}<span class="hi-revoked">revocato</span>{/if}
					</div>
					<div class="hi-meta">
						<code class="hi-url">{hookUrl(h.id)}</code>
						<button class="mini" on:click={() => copy(hookUrl(h.id))}>Copia URL</button>
						<span class="hi-uses" title="Usi · ultima sorgente">{h.uses} usi{#if h.last_source} · {h.last_source}{/if}</span>
					</div>
					<div class="hi-actions">
						{#if h.enabled}<button class="mini" on:click={() => revoke(h)}>Revoca</button>{/if}
						<button class="mini danger" on:click={() => remove(h)}>Elimina</button>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.hooks { border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; background: var(--card-bg); margin-top: 10px; }
	.hooks-head { display: flex; align-items: center; justify-content: space-between; }
	.hooks-title { font-weight: 700; font-size: 13px; }
	.hooks-note { font-size: 11px; color: var(--fg-muted); margin: 4px 0 8px; }
	.mini { font: inherit; font-size: 11px; padding: 3px 8px; border-radius: 7px; border: 1px solid var(--border); background: transparent; color: var(--fg); cursor: pointer; }
	.mini.primary { background: var(--accent); border-color: var(--accent); color: #1a1208; font-weight: 700; }
	.mini.danger:hover { border-color: var(--danger); color: var(--danger); }
	.mini:disabled { opacity: .5; }
	.hook-form { display: flex; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; }
	.hook-form input, .hook-form select { flex: 1 1 120px; background: rgba(0,0,0,.25); border: 1px solid var(--border); color: var(--fg); border-radius: 7px; padding: 5px 8px; font: inherit; font-size: 12px; }
	.hook-fresh { border: 1px solid var(--accent); border-radius: 8px; padding: 8px 10px; margin-bottom: 8px; display: flex; flex-direction: column; gap: 6px; }
	.fresh-row { font-size: 12px; }
	.fresh-field { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--fg-muted); }
	.fresh-field code { font-family: var(--mono); font-size: 11px; background: rgba(0,0,0,.3); padding: 2px 6px; border-radius: 4px; overflow-wrap: anywhere; flex: 1 1 auto; }
	.fresh-curl { font-family: var(--mono); font-size: 11px; background: rgba(0,0,0,.3); padding: 6px 8px; border-radius: 6px; white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; }
	.hooks-empty { font-size: 12px; color: var(--fg-muted); }
	.hook-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
	.hook-item { border: 1px solid var(--border); border-radius: 8px; padding: 6px 8px; }
	.hook-item.disabled { opacity: .55; }
	.hi-main { display: flex; align-items: center; gap: 8px; }
	.hi-label { font-weight: 600; font-size: 12px; }
	.hi-trig { font-size: 11px; color: var(--accent); }
	.hi-revoked { font-size: 10px; color: var(--danger); border: 1px solid var(--danger); border-radius: 4px; padding: 0 4px; }
	.hi-meta { display: flex; align-items: center; gap: 6px; margin-top: 3px; flex-wrap: wrap; }
	.hi-url { font-family: var(--mono); font-size: 10.5px; color: var(--fg-muted); overflow-wrap: anywhere; }
	.hi-uses { font-size: 10.5px; color: var(--fg-muted); margin-left: auto; }
	.hi-actions { display: flex; gap: 6px; margin-top: 4px; }
</style>
