<script lang="ts">
	/**
	 * The system mailboxes of the Email MCP's card (clodia-platform#620): a
	 * mailbox is CHOSEN among the ones configured in the system, never typed —
	 * a hand-written address would land in the room's lists with no credential
	 * behind it. Linking is the existing `mail/mailbox-link` action (#406,
	 * #520): one mailbox becomes at once the room's source (`inbox:`) and
	 * destination (`outbox:`). The route is a platform admin's: anyone else is
	 * told so instead of seeing an empty list.
	 */
	import { onMount } from 'svelte';
	import {
		ApiError,
		applyConnectorAction,
		getTopicMailboxes,
		type TopicMailbox
	} from '$lib/api/client';
	import { isAdmin } from '$lib/stores/capabilities';

	export let tier: string;
	export let name: string;
	export let canEdit = false;

	const CONNECTOR = 'mail';
	const ACTION = 'mailbox-link';

	let boxes: TopicMailbox[] = [];
	let loaded = false;
	let busy = false;
	let err = '';

	function message(e: unknown): string {
		if (e instanceof ApiError && e.status === 403) {
			return 'Le caselle di sistema le collega un admin della piattaforma.';
		}
		return e instanceof ApiError || e instanceof Error ? e.message : String(e);
	}

	async function load() {
		if (!$isAdmin) {
			loaded = true;
			return;
		}
		try {
			boxes = await getTopicMailboxes(tier, name);
			err = '';
		} catch (e) {
			boxes = [];
			err = message(e);
		} finally {
			loaded = true;
		}
	}

	async function act(m: TopicMailbox, verso: 'connect' | 'disconnect') {
		if (busy) return;
		busy = true;
		err = '';
		try {
			await applyConnectorAction(tier, name, CONNECTOR, ACTION, verso, { account: m.account });
		} catch (e) {
			err = message(e);
		} finally {
			busy = false;
		}
		await load();
	}

	/** «Linked here» can be undone from here; «authorised globally» cannot. */
	const linked = (m: TopicMailbox) => m.inbox || m.outbox;
	const global = (m: TopicMailbox) => linked(m) && !m.local;

	onMount(load);
</script>

<div class="boxes">
	<h5>Caselle</h5>
	{#if !$isAdmin}
		<p class="muted wrap">Le caselle di sistema collegate a questo canale le gestisce un admin della piattaforma.</p>
	{:else if !loaded}
		<p class="muted">Caricamento…</p>
	{:else if boxes.length === 0 && !err}
		<p class="muted wrap">Nessuna casella configurata nel sistema (Impostazioni → Integrazioni).</p>
	{:else}
		<ul class="rows">
			{#each boxes as m (m.account)}
				<li>
					<code title={m.account}>{m.email}</code>
					{#if m.inbox}<span class="badge on">legge</span>{/if}
					{#if m.outbox}<span class="badge on">spedisce</span>{/if}
					{#if m.send_only}<span class="badge" title="Alias SMTP senza IMAP">solo spedisce</span>{/if}
					{#if global(m)}
						<span class="badge" title="Autorizzata da Impostazioni: non si scollega da qui">autorizzata globalmente</span>
					{:else if canEdit}
						{#if linked(m)}
							<button type="button" class="link-btn" disabled={busy}
								aria-label="Scollega {m.email}" on:click={() => act(m, 'disconnect')}>Scollega</button>
						{:else}
							<button type="button" class="link-btn" disabled={busy}
								aria-label="Collega {m.email}" on:click={() => act(m, 'connect')}>Collega</button>
						{/if}
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
	{#if err}<p class="err" role="alert">{err}</p>{/if}
</div>

<style>
	.boxes { margin-top: 8px; }
	h5 { margin: 0 0 4px; font-size: 11px; font-weight: 600; color: var(--fg); }
	.muted { color: var(--fg-muted); font-size: 11px; margin: 4px 0; }
	.wrap { white-space: normal; }
	.err { color: #dc2626; font-size: 11px; margin: 4px 0; }
	.rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
	.rows li { display: flex; align-items: center; gap: 6px; font-size: 11px; min-width: 0; flex-wrap: wrap; }
	.rows code { flex: 1 1 120px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.badge { font-size: 10px; border-radius: 3px; padding: 0 4px; border: 1px solid var(--border);
		color: var(--fg-muted); white-space: nowrap; }
	.badge.on { color: #15803d; border-color: #15803d; }
	.link-btn {
		font-size: 11px; background: transparent; border: 1px solid var(--border);
		border-radius: 4px; color: var(--fg); cursor: pointer; padding: 2px 8px; white-space: nowrap;
	}
	.link-btn:disabled { opacity: .5; cursor: default; }
</style>
