<script lang="ts">
	/**
	 * The room's «In ascolto» (clodia-platform#675/#680): the sources the room
	 * listens to — mail senders, Telegram chats, a pack connector's chats — and
	 * one Add form. Listening = trusted (owner, 12 Nov 2026).
	 *
	 * The list is the gateway's, derived from the room's lists and channel
	 * bindings. A typed source (a mail sender) is written here; a chat is linked
	 * by its connector's action, whose dialog lives in the topic page: this
	 * panel hands the click back (`azione`), as the Strumenti panel does.
	 */
	import { createEventDispatcher, onMount } from 'svelte';
	import {
		apiErrorDetail,
		getTopicListen,
		setTopicListen,
		type ListenKind,
		type ListenSource
	} from '$lib/api/client';
	import { toastError, toastSuccess } from '$lib/stores/toasts';
	import McpMailboxes from '$lib/components/McpMailboxes.svelte';

	export let tier: string;
	export let name: string;
	/** Owner or admin. */
	export let canEdit = false;
	/** The connectors' topic actions (`azioniDiTopic`), to link a chat. */
	type Azione = { connettore: string; azione: string; chiave: string; etichetta: string;
		nome: string; binding: string };
	export let azioni: Azione[] = [];
	export let azioneBusy = false;
	/** What the panel shows: the list, the Add form, or the list with its
	 *  remove buttons (owner, 13 Nov 2026: add/remove as buttons, /unlisten). */
	export let mode: 'view' | 'add' | 'remove' = 'view';

	const dispatch = createEventDispatcher<{ azione: Azione; count: number }>();

	let kinds: ListenKind[] = [];
	let sources: ListenSource[] = [];
	let err = '';
	let busy = false;

	let sel = '';
	let address = '';
	let reply = false;

	const key = (k: { connector: string; kind: string }) => `${k.connector}/${k.kind}`;
	const azioneDi = (connector: string, action: string) =>
		azioni.find((a) => a.connettore === connector && a.azione === action);
	// An action kind is offered only when its action is (the edition, admin-only…).
	$: offerti = kinds.filter((k) => !k.action || azioneDi(k.connector, k.action));
	$: if (!offerti.some((k) => key(k) === sel)) sel = offerti[0] ? key(offerti[0]) : '';
	$: scelto = offerti.find((k) => key(k) === sel) ?? null;

	export async function reload() {
		err = '';
		try {
			const r = await getTopicListen(tier, name);
			kinds = r.kinds ?? [];
			sources = r.sources ?? [];
			dispatch('count', sources.length);
		} catch (e) {
			err = apiErrorDetail(e);
		}
	}
	onMount(() => void reload());

	async function add() {
		if (!scelto || busy) return;
		if (scelto.action) {
			const a = azioneDi(scelto.connector, scelto.action);
			if (a) dispatch('azione', a);
			return;
		}
		const v = address.trim();
		if (!v) return;
		busy = true;
		try {
			await setTopicListen(tier, name, {
				action: 'add', connector: scelto.connector, kind: scelto.kind,
				address: v, reply: scelto.reply === 'choice' ? reply : undefined
			});
			address = '';
			reply = false;
			mode = 'view';
			await reload();
		} catch (e) {
			toastError('Fonte non aggiunta', apiErrorDetail(e));
		} finally {
			busy = false;
		}
	}

	async function copy(addr: string) {
		try {
			await navigator.clipboard.writeText(addr);
			toastSuccess('Indirizzo copiato');
		} catch {
			toastError('Copia non riuscita: seleziona l’indirizzo a mano');
		}
	}

	// Sources the owner can remove: everything but the room's own inbox.
	$: removibili = sources.filter((s) => !s.fixed);

	async function remove(s: ListenSource) {
		if (busy) return;
		if (s.action) {
			const a = azioneDi(s.connector, s.action);
			if (a && confirm(`Smettere di ascoltare ${s.label} ${s.address}? La chat viene scollegata.`))
				dispatch('azione', a);
			return;
		}
		if (!confirm(`Smettere di ascoltare ${s.address}?`)) return;
		busy = true;
		try {
			await setTopicListen(tier, name, {
				action: 'remove', connector: s.connector, kind: s.kind, address: s.address
			});
			await reload();
		} catch (e) {
			toastError('Fonte non rimossa', apiErrorDetail(e));
		} finally {
			busy = false;
		}
	}
</script>

{#if err}
	<p class="err" role="alert">{err}</p>
{:else}
	<p class="muted wrap">
		I messaggi di queste fonti arrivano nel canale e sono considerati fidati.
	</p>
	{#if canEdit}
		<div class="actions">
			<button type="button" class="btn-add" class:on={mode === 'add'}
				on:click={() => (mode = mode === 'add' ? 'view' : 'add')}>+ Ascolta</button>
		</div>
	{/if}
	{#if canEdit && mode === 'add' && !offerti.length}
		<!-- Clickable even when there is nothing to offer: it says why. -->
		<p class="hint wrap">Nessun tipo di fonte disponibile: i connettori lo dichiarano dalla
			versione che supporta «In ascolto» (comms-pack 2.7.0, Packs → Update).</p>
	{/if}
	{#if canEdit && mode === 'remove' && !removibili.length}
		<p class="hint wrap">Nessuna fonte da togliere: la inbox del canale resta sempre in ascolto.</p>
	{/if}
	{#if canEdit && mode === 'add' && offerti.length}
		<form class="add" on:submit|preventDefault={add}>
			<select bind:value={sel} disabled={busy} aria-label="Tipo di fonte">
				{#each offerti as k (key(k))}
					<option value={key(k)}>{k.label}</option>
				{/each}
			</select>
			{#if scelto && !scelto.action}
				<input type="text" bind:value={address} disabled={busy}
					placeholder={scelto.field?.placeholder || scelto.field?.label || 'indirizzo'}
					aria-label={scelto.field?.label || 'Indirizzo'} />
				{#if scelto.reply === 'choice'}
					<label class="reply"><input type="checkbox" bind:checked={reply} disabled={busy} /> può rispondere</label>
				{/if}
				<button type="submit" disabled={busy || !address.trim()}>Ascolta</button>
			{:else if scelto}
				<button type="submit" disabled={azioneBusy}>Collega…</button>
			{/if}
		</form>
	{/if}
	{#if sources.length === 0}
		<p class="muted">Nessuna fonte in ascolto.</p>
	{:else}
		<ul class="list">
			{#each sources as s (key(s) + s.address)}
				<li class:fixed={s.fixed}>
					<span class="kind">{s.label}</span>
					<code title={s.address}>{s.address}</code>
					{#if s.fixed}
						{#if s.active}
							<button type="button" class="copy" title="Copia l'indirizzo"
								on:click={() => void copy(s.address)}>⧉</button>
							<span class="badge" title="La posta inviata a questo indirizzo arriva nel canale, chiunque scriva">sempre</span>
						{:else}
							<span class="badge" title="La casella della colonia non è impostata: l'indirizzo non è ancora attivo">non attiva</span>
						{/if}
					{/if}
					{#if s.reply}<span class="badge" title="Gli agenti possono rispondere qui">risponde</span>{/if}
					{#if canEdit && !s.fixed}
						<button type="button" class="rm" disabled={busy || azioneBusy}
							title="Smetti di ascoltare" aria-label="Smetti di ascoltare {s.address}"
							on:click={() => void remove(s)}>Ⓧ</button>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
	<!-- A system mailbox linked to the room is a source too: its mail of the
	     senders above reaches the channel. Moved here from Strumenti → Email
	     (owner, 13 Nov 2026); linking stays an admin's act. -->
	<details class="mailboxes">
		<summary>Caselle collegate</summary>
		<McpMailboxes {tier} {name} {canEdit} />
	</details>
{/if}

<style>
	.muted { color: var(--fg-muted); font-size: 11px; margin: 4px 0; }
	.wrap { white-space: normal; }
	.err { color: #dc2626; font-size: 11px; margin: 4px 0; }
	.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
	.list li { display: flex; align-items: center; gap: 6px; font-size: 11px; min-width: 0; }
	.kind { color: var(--fg-muted); white-space: nowrap; }
	.list code { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.badge { font-size: 10px; border-radius: 3px; padding: 0 4px; border: 1px solid var(--border);
		color: var(--fg-muted); white-space: nowrap; }
	.actions { display: flex; gap: 6px; margin: 4px 0; }
	.actions button { font: inherit; font-size: 11px; padding: 2px 8px; cursor: pointer;
		border: 1px solid var(--border); border-radius: 4px; background: transparent; color: inherit; }
	.rm { background: transparent; border: none; color: var(--fg-muted); cursor: pointer;
		font-size: 13px; line-height: 1; padding: 0 2px; flex-shrink: 0; }
	.actions .btn-add { background: var(--success, #16a34a); border-color: var(--success, #16a34a);
		color: #fff; font-weight: 600; }
	.actions .btn-add:hover, .actions .btn-add.on { filter: brightness(1.1); }
	.rm:disabled { opacity: .5; cursor: default; }
	.list li.fixed code { font-weight: 600; }
	.copy { background: transparent; border: none; color: var(--fg-muted); cursor: pointer;
		font-size: 11px; padding: 0 2px; }
	.copy:hover { color: var(--accent); }
	.mailboxes { margin-top: 6px; }
	.mailboxes > summary { font-size: 11px; color: var(--fg-muted); cursor: pointer; }
	.hint { font-size: 11px; color: var(--fg-muted); margin: 4px 0; }
	.rm:hover:not(:disabled) { color: var(--danger, #dc2626); }
	.add { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; align-items: center; }
	.add select, .add input[type='text'] { font: inherit; font-size: 11px; padding: 2px 4px;
		border: 1px solid var(--border); border-radius: 4px; background: transparent; color: inherit; }
	.add input[type='text'] { flex: 1 1 140px; min-width: 0; }
	.add button { font: inherit; font-size: 11px; padding: 2px 8px; cursor: pointer;
		border: 1px solid var(--border); border-radius: 4px; background: transparent; color: inherit; }
	.add button:disabled { opacity: .5; cursor: default; }
	.reply { font-size: 11px; color: var(--fg-muted); display: inline-flex; align-items: center; gap: 3px; }
</style>
