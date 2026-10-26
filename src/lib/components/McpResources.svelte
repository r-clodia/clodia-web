<script lang="ts">
	/**
	 * The resources of ONE authorised MCP (clodia-platform#620): one row per
	 * resource with allow / ask / deny, generated from the resource kinds
	 * (`schemes`) the MCP's verbs reach — a new MCP brings its panel with it.
	 * Targets no row names keep the verb's default (a read is allowed, a write
	 * asks). Drive folders linked to the room show here as read-only rows: they
	 * are linked from the room's Drive button, not here.
	 */
	import { createEventDispatcher } from 'svelte';
	import type { McpEffect, McpInfo, McpResource } from '$lib/api/client';

	export let mcp: McpInfo;
	export let rows: McpResource[] = [];
	/** Linked Drive folders (`gdrive:folder/<id>`), shown read-only. */
	export let linked: string[] = [];
	export let canEdit = false;
	export let busy = false;

	const dispatch = createEventDispatcher<{
		set: { uri: string; effect: McpEffect };
		unset: { uri: string };
	}>();

	const EFFECTS: { v: McpEffect; label: string }[] = [
		{ v: 'allow', label: 'consenti' },
		{ v: 'ask', label: 'chiedi' },
		{ v: 'deny', label: 'nega' }
	];
	const SCHEME_LABEL: Record<string, string> = {
		gdrive: 'Cartelle e file Drive',
		gsheets: 'Fogli Google',
		mailto: 'Destinatari email',
		mailfrom: 'Mittenti email',
		tg: 'Chat Telegram',
		https: 'Siti e repository',
		http: 'Siti',
		datastore: 'Archivi dati'
	};
	const PLACEHOLDER: Record<string, string> = {
		gdrive: 'folder/<id> oppure link della cartella',
		mailto: 'nome@dominio.it oppure *@dominio.it',
		mailfrom: 'nome@dominio.it oppure *@dominio.it',
		tg: 'id della chat (es. -100…)',
		https: 'github.com/owner/repo oppure URL'
	};

	$: schemes = [...new Set(mcp.schemes.map((s) => s.scheme))].sort();
	$: dirOf = (sc: string) => {
		const d = new Set(mcp.schemes.filter((s) => s.scheme === sc).map((s) => s.direction));
		return [d.has('source') ? 'legge' : '', d.has('egress') ? 'scrive' : ''].filter(Boolean).join(' · ');
	};
	$: linkedRows = schemes.includes('gdrive') ? linked : [];

	let scheme = '';
	let value = '';
	let effect: McpEffect = 'allow';
	let err = '';
	$: if (!schemes.includes(scheme)) scheme = schemes[0] ?? '';

	/** The URI to send: a pasted browser link goes as is (the gateway turns it
	 *  into the canonical form), a value already carrying its scheme too;
	 *  otherwise the chosen kind is prefixed. */
	function compose(): string | null {
		const v = value.trim();
		if (!v) return null;
		if (/^https?:\/\//i.test(v)) return scheme === 'https' || scheme === 'http' || scheme === 'gdrive' ? v : null;
		const m = /^([a-z][a-z0-9+.-]*):/i.exec(v);
		if (m && schemes.includes(m[1].toLowerCase())) return v;
		return `${scheme}:${v}`;
	}

	function add() {
		err = '';
		const uri = compose();
		if (!uri) {
			err = `Non è una risorsa di ${mcp.label}.`;
			return;
		}
		dispatch('set', { uri, effect });
		value = '';
	}

	const effectLabel = (e: McpEffect) => EFFECTS.find((x) => x.v === e)?.label ?? e;
</script>

{#if schemes.length === 0}
	<p class="muted wrap">
		Nessuna risorsa da indicare: autorizzato l'MCP, i suoi verbi di lettura sono liberi e quelli che
		scrivono chiedono conferma.
	</p>
{:else}
	<ul class="rows">
		{#each linkedRows as uri (uri)}
			<li>
				<code title={uri}>{uri}</code>
				<span class="badge">collegata · lettura</span>
			</li>
		{/each}
		{#each rows as r (r.uri)}
			<li>
				<code title={r.uri}>{r.uri}</code>
				{#if canEdit}
					<select value={r.effect} disabled={busy} aria-label="Effetto per {r.uri}"
						on:change={(e) => dispatch('set', { uri: r.uri, effect: e.currentTarget.value as McpEffect })}>
						{#each EFFECTS as x (x.v)}<option value={x.v}>{x.label}</option>{/each}
					</select>
					<button type="button" class="x" disabled={busy} aria-label="Rimuovi {r.uri}"
						on:click={() => dispatch('unset', { uri: r.uri })}>✕</button>
				{:else}
					<span class="badge eff-{r.effect}">{effectLabel(r.effect)}</span>
				{/if}
			</li>
		{/each}
		{#if rows.length === 0 && linkedRows.length === 0}
			<li class="muted">Nessuna risorsa: vale il default (lettura libera, scrittura con conferma).</li>
		{/if}
	</ul>
	{#if canEdit}
		<form class="add" on:submit|preventDefault={add}>
			{#if schemes.length > 1}
				<select bind:value={scheme} disabled={busy} aria-label="Tipo di risorsa">
					{#each schemes as sc (sc)}<option value={sc}>{SCHEME_LABEL[sc] ?? sc} ({dirOf(sc)})</option>{/each}
				</select>
			{:else}
				<span class="muted" title={dirOf(scheme)}>{SCHEME_LABEL[scheme] ?? scheme}</span>
			{/if}
			<input type="text" bind:value={value} disabled={busy} placeholder={PLACEHOLDER[scheme] ?? `${scheme}:…`}
				aria-label="Risorsa" />
			<select bind:value={effect} disabled={busy} aria-label="Effetto">
				{#each EFFECTS as x (x.v)}<option value={x.v}>{x.label}</option>{/each}
			</select>
			<button type="submit" class="link-btn" disabled={busy || !value.trim()}>Aggiungi</button>
		</form>
		{#if err}<p class="err" role="alert">{err}</p>{/if}
	{/if}
{/if}

<style>
	.muted { color: var(--fg-muted); font-size: 11px; margin: 4px 0; }
	.wrap { white-space: normal; }
	.err { color: #dc2626; font-size: 11px; margin: 4px 0; }
	.rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
	.rows li { display: flex; align-items: center; gap: 6px; font-size: 11px; min-width: 0; }
	.rows code { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.badge { font-size: 10px; border-radius: 3px; padding: 0 4px; border: 1px solid var(--border);
		color: var(--fg-muted); white-space: nowrap; }
	.badge.eff-allow { color: #15803d; border-color: #15803d; }
	.badge.eff-ask { color: #b45309; border-color: #b45309; }
	.badge.eff-deny { color: #dc2626; border-color: #dc2626; }
	select, input {
		font-size: 11px; padding: 2px 4px; border-radius: 4px;
		border: 1px solid var(--border); background: var(--bg); color: var(--fg); min-width: 0;
	}
	.add { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; align-items: center; }
	.add input { flex: 1 1 140px; }
	.x {
		background: transparent; border: none; color: var(--fg-muted); cursor: pointer;
		font-size: 11px; padding: 0 2px; flex-shrink: 0;
	}
	.x:hover:not(:disabled) { color: #dc2626; }
	.link-btn {
		font-size: 11px; background: transparent; border: 1px solid var(--border);
		border-radius: 4px; color: var(--fg); cursor: pointer; padding: 2px 8px; white-space: nowrap;
	}
	.link-btn:disabled { opacity: .5; cursor: default; }
</style>
