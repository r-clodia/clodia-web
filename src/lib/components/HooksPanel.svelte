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
	export let showHeading = true;

	let hook: ChatHook | null = null;
	let loading = false;
	let busy = false;
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
			const r = await createHook(tier, name, { label: name });
			fresh = { secret: r.secret, url: hookUrl(r.hook.id) };
			await load();
		} catch (e) {
			toastError('Hook', e instanceof Error ? e.message : String(e));
		} finally {
			busy = false;
		}
	}

	async function remove() {
		if (!hook || !confirm('Disattivare il webhook di questo topic?')) return;
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

<div class="hooks" class:embedded={!showHeading}>
	<div class="hooks-head">
		<span class="hooks-title">{showHeading ? 'Webhook del topic' : 'Webhook'}</span>
		<button type="button" class="info" aria-label="Informazioni sul webhook">
			<span aria-hidden="true">ⓘ</span>
			<span class="tooltip" role="tooltip">
				Un URL segreto inietta messaggi dall'esterno. L'input non è fidato:
				le azioni fuori-topic restano da approvare.
			</span>
		</button>
	</div>

	{#if loading}
		<p class="hooks-empty">Carico…</p>
	{:else if hook}
		<div class="hook-card" class:disabled={!hook.enabled}>
			{#if hook.enabled}
				<label class="fresh-field">URL
					<code>{hookUrl(hook.id)}</code>
					<button class="mini" on:click={() => copy(hookUrl(hook!.id))}>Copia</button>
				</label>
			{:else}
				<span class="hooks-empty">Webhook disattivato per questo topic.</span>
			{/if}
			<div class="hook-row">
				<span class="hi-uses">{hook.uses} usi · max {hook.rate_per_min}/min{#if hook.last_source} · ultimo da {hook.last_source}{/if}</span>
			</div>
			{#if hook.events?.length}
				<details class="hook-log">
					<summary>Attività recente ({hook.events.length})</summary>
					<ul>
						{#each [...hook.events].reverse().slice(0, 8) as ev}
							<li class="ev ev-{ev.status}">
								<span class="ev-ts">{new Date(ev.ts).toLocaleString()}</span>
								<span class="ev-st">{ev.status}</span>
								{#if ev.authority}<span class="ev-auth">{ev.authority}{#if ev.principal} · {ev.principal}{/if}</span>{/if}
								{#if ev.source}<span class="ev-src">{ev.source}</span>{/if}
								{#if ev.note}<span class="ev-note" title={ev.note}>{ev.note}</span>{/if}
							</li>
						{/each}
					</ul>
				</details>
			{/if}
			<div class="hi-actions">
				<button class="mini" on:click={createOrRotate} disabled={busy} title="Genera un nuovo segreto (invalida il precedente)">{hook.enabled ? 'Rigenera segreto' : 'Attiva webhook'}</button>
				{#if hook.enabled}
					<button class="mini danger" on:click={remove} disabled={busy}>Disattiva</button>
				{/if}
			</div>
		</div>
	{:else}
		<div class="hook-form">
			<span class="hooks-empty">Webhook disattivato per questo topic.</span>
			<button class="mini primary" on:click={createOrRotate} disabled={busy}>{busy ? '…' : 'Attiva webhook'}</button>
		</div>
	{/if}

	{#if fresh}
		<div class="hook-fresh">
			<div class="fresh-row"><b>Segreto generato.</b> Copialo ORA: non sarà più mostrato.</div>
			<label class="fresh-field">Segreto
				<code>{fresh.secret}</code>
				<button class="mini" on:click={() => copy(fresh!.secret)}>Copia</button>
			</label>
			<pre class="fresh-curl">{curlExample(fresh.url, fresh.secret)}</pre>
			<div class="hi-actions">
				<button class="mini" on:click={() => copy(curlExample(fresh!.url, fresh!.secret))}>Copia curl</button>
				<button class="mini" on:click={() => (fresh = null)}>Chiudi</button>
			</div>
		</div>
	{/if}

</div>

<style>
	.hooks { min-width: 0; }
	.hooks-head { display: flex; align-items: center; justify-content: space-between; }
	.hooks-title { font-weight: 700; font-size: 13px; }
	.info { position: relative; border: 0; padding: 0; background: none; color: var(--fg-muted); cursor: help; font: inherit; line-height: 1; outline: none; }
	.info:hover, .info:focus { color: var(--accent); }
	.tooltip {
		position: absolute; right: 0; top: calc(100% + 6px); z-index: 30; display: none;
		width: min(240px, 70vw); padding: 7px 8px; border: 1px solid var(--border);
		border-radius: 6px; background: var(--card-bg); color: var(--fg);
		font-size: 11px; font-weight: 400; line-height: 1.35; box-shadow: 0 6px 18px rgba(0,0,0,.28);
	}
	.info:hover .tooltip, .info:focus .tooltip { display: block; }
	.mini { font: inherit; font-size: 11px; padding: 3px 8px; border-radius: 7px; border: 1px solid var(--border); background: transparent; color: var(--fg); cursor: pointer; }
	.mini.primary { background: var(--accent); border-color: var(--accent); color: #1a1208; font-weight: 700; }
	.mini.danger:hover { border-color: var(--danger); color: var(--danger); }
	.mini:disabled { opacity: .5; }
	.hook-form { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
	.hook-card { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
	.hook-card.disabled { opacity: .55; }
	.hook-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
	.hi-uses { font-size: 10.5px; color: var(--fg-muted); margin-left: auto; }
	.hi-actions { display: flex; gap: 6px; }
	.hook-fresh { border-left: 2px solid var(--accent); padding: 4px 0 4px 8px; margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
	.fresh-row { font-size: 12px; }
	.fresh-field { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--fg-muted); }
	.fresh-field code { font-family: var(--mono); font-size: 11px; background: rgba(0,0,0,.3); padding: 2px 6px; border-radius: 4px; overflow-wrap: anywhere; flex: 1 1 auto; }
	.fresh-curl { font-family: var(--mono); font-size: 11px; background: rgba(0,0,0,.3); padding: 6px 8px; border-radius: 6px; white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; }
	.hooks-empty { font-size: 12px; color: var(--fg-muted); }
	.hook-log { font-size: 11px; }
	.hook-log summary { color: var(--fg-muted); cursor: pointer; }
	.hook-log ul { list-style: none; margin: 4px 0 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
	.ev { display: flex; gap: 8px; flex-wrap: wrap; align-items: baseline; font-family: var(--mono); font-size: 10.5px; color: var(--fg-muted); }
	.ev-ts { opacity: .8; }
	.ev-st { font-weight: 700; }
	.ev-ok .ev-st { color: #4ade80; }
	.ev-bad_signature .ev-st, .ev-rate_limited .ev-st { color: var(--danger); }
	.ev-auth { color: var(--accent); }
	.ev-note { font-style: italic; }
</style>
