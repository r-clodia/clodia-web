<script lang="ts">
	// Pannello "Hook" (owner-only) di una chat: UN SOLO hook per topic. Crea/rigenera/
	// elimina la capability webhook per iniettare messaggi. Il segreto si vede UNA
	// volta (alla creazione/rigenerazione). L'URL è assoluto (host:port navigabile).
	import { onMount } from 'svelte';
	import {
		API_BASE_URL, listHooks, createHook, deleteHook, type ChatHook
	} from '$lib/api/client';
	import { toastSuccess, toastError } from '$lib/stores/toasts';

	export let tier: string;
	export let name: string;
	export let agents: string[] = []; // partecipanti selezionabili come trigger

	let hook: ChatHook | null = null;
	let loading = false;
	let busy = false;
	let fTrigger = '';
	// segreto+url appena creati, mostrati una sola volta
	let fresh: { secret: string; url: string } | null = null;

	// Base assoluta: se PUBLIC_API_BASE_URL è assoluto usalo, altrimenti l'origin
	// del browser (l'ingress /hooks è proxato allo stesso origin della webui).
	function base(): string {
		if (/^https?:\/\//i.test(API_BASE_URL)) return API_BASE_URL;
		return typeof window !== 'undefined' ? window.location.origin : '';
	}
	function hookUrl(id: string): string {
		return `${base()}/hooks/${id}`;
	}

	async function load() {
		loading = true;
		try {
			hook = (await listHooks(tier, name)).hooks?.[0] ?? null;
			fTrigger = hook?.trigger_agent ?? '';
		} catch (e) {
			toastError('Hook', e instanceof Error ? e.message : String(e));
		} finally {
			loading = false;
		}
	}

	async function createOrRotate() {
		if (busy) return;
		busy = true;
		try {
			const r = await createHook(tier, name, { label: name, trigger_agent: fTrigger || null });
			fresh = { secret: r.secret, url: hookUrl(r.hook.id) };
			await load();
		} catch (e) {
			toastError('Hook', e instanceof Error ? e.message : String(e));
		} finally {
			busy = false;
		}
	}

	async function remove() {
		if (!hook || !confirm('Eliminare il webhook di questo topic?')) return;
		busy = true;
		try {
			await deleteHook(hook.id);
			fresh = null;
			await load();
		} catch (e) {
			toastError('Eliminazione', e instanceof Error ? e.message : String(e));
		} finally {
			busy = false;
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
	<div class="hooks-head"><span class="hooks-title">🪝 Webhook del topic</span></div>
	<p class="hooks-note">
		Un URL segreto per iniettare un messaggio in questo topic dall'esterno. Il messaggio
		arriva come input <b>non fidato</b>: le azioni fuori-topic restano da approvare.
	</p>

	{#if loading}
		<p class="hooks-empty">Carico…</p>
	{:else if hook}
		<div class="hook-card" class:disabled={!hook.enabled}>
			<label class="fresh-field">URL
				<code>{hookUrl(hook.id)}</code>
				<button class="mini" on:click={() => copy(hookUrl(hook.id))}>Copia</button>
			</label>
			<div class="hook-row">
				<label class="trig-inline">Trigger
					<select bind:value={fTrigger} on:change={createOrRotate} title="Agente svegliato al messaggio">
						<option value="">— nessuno (solo iniezione) —</option>
						{#each agents as a}<option value={a}>@{a}</option>{/each}
					</select>
				</label>
				<span class="hi-uses">{hook.uses} usi{#if hook.last_source} · da {hook.last_source}{/if}</span>
			</div>
			<div class="hi-actions">
				<button class="mini" on:click={createOrRotate} disabled={busy} title="Genera un nuovo segreto (invalida il precedente)">Rigenera segreto</button>
				<button class="mini danger" on:click={remove} disabled={busy}>Elimina</button>
			</div>
		</div>
	{:else}
		<div class="hook-form">
			<label class="trig-inline">Trigger
				<select bind:value={fTrigger} title="Agente da svegliare al messaggio (opzionale)">
					<option value="">— nessuno (solo iniezione) —</option>
					{#each agents as a}<option value={a}>@{a}</option>{/each}
				</select>
			</label>
			<button class="mini primary" on:click={createOrRotate} disabled={busy}>{busy ? '…' : 'Crea webhook'}</button>
		</div>
	{/if}

	{#if fresh}
		<div class="hook-fresh">
			<div class="fresh-row"><b>Segreto generato.</b> Copialo ORA: non sarà più mostrato.</div>
			<label class="fresh-field">Segreto
				<code>{fresh.secret}</code>
				<button class="mini" on:click={() => copy(fresh.secret)}>Copia</button>
			</label>
			<pre class="fresh-curl">{curlExample(fresh.url, fresh.secret)}</pre>
			<div class="hi-actions">
				<button class="mini" on:click={() => copy(curlExample(fresh.url, fresh.secret))}>Copia curl</button>
				<button class="mini" on:click={() => (fresh = null)}>Chiudi</button>
			</div>
		</div>
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
	.hook-form { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
	.hook-card { display: flex; flex-direction: column; gap: 8px; }
	.hook-card.disabled { opacity: .55; }
	.hook-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
	.trig-inline { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--fg-muted); }
	.trig-inline select { background: rgba(0,0,0,.25); border: 1px solid var(--border); color: var(--fg); border-radius: 7px; padding: 4px 8px; font: inherit; font-size: 12px; }
	.hi-uses { font-size: 10.5px; color: var(--fg-muted); margin-left: auto; }
	.hi-actions { display: flex; gap: 6px; }
	.hook-fresh { border: 1px solid var(--accent); border-radius: 8px; padding: 8px 10px; margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
	.fresh-row { font-size: 12px; }
	.fresh-field { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--fg-muted); }
	.fresh-field code { font-family: var(--mono); font-size: 11px; background: rgba(0,0,0,.3); padding: 2px 6px; border-radius: 4px; overflow-wrap: anywhere; flex: 1 1 auto; }
	.fresh-curl { font-family: var(--mono); font-size: 11px; background: rgba(0,0,0,.3); padding: 6px 8px; border-radius: 6px; white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; }
	.hooks-empty { font-size: 12px; color: var(--fg-muted); }
</style>
