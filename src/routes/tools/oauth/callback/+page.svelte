<script lang="ts">
	/**
	 * Return of an MCP OAuth consent (clodia-platform#534).
	 *
	 * The authorization server sends the browser here with `code` and `state`.
	 * This page only FORWARDS them to the gateway's `oauth/complete`, which
	 * keeps every check of its own (unknown, expired, already used, other
	 * backend, other session) and stores the token in its vault. Nothing here
	 * ever sees a token.
	 *
	 * In front of the gateway, three refusals that forward nothing:
	 *   - no admin session: the layout already shows only the login form; once
	 *     logged in, a non-admin gets an error here;
	 *   - a `state` this tab did not start (`takePending`): a link carrying
	 *     someone else's `code` and `state` dies here;
	 *   - a reload: the entry is consumed before the call, so it cannot replay.
	 *
	 * The query (`code`, `state`) leaves the address bar at once, so it is not
	 * kept in history. The way back is a path of this webui only
	 * (`safeReturnPath`), never an address taken from the URL.
	 */
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { goto, replaceState } from '$app/navigation';
	import { completeMcpOAuth, ApiError } from '$lib/api/client';
	import { isAdmin, refreshCapabilities } from '$lib/stores/capabilities';
	import { toastSuccess } from '$lib/stores/toasts';
	import { CALLBACK_PATH, DEFAULT_RETURN, safeReturnPath, takePending } from '$lib/mcpOAuthReturn.js';

	let stato: 'busy' | 'error' = 'busy';
	let errore = '';
	let ritorno = DEFAULT_RETURN;
	let server = '';

	onMount(async () => {
		const q = new URLSearchParams(window.location.search);
		const code = q.get('code') ?? '';
		const state = q.get('state') ?? '';
		const rifiuto = q.get('error');
		// Out of the address bar and of history before anything else.
		try {
			replaceState(CALLBACK_PATH, {});
		} catch {
			/* router not ready: the redirect below replaces the entry anyway */
		}

		let pending: { server: string; returnTo: string } | null = null;
		try {
			pending = takePending(window.sessionStorage, state);
		} catch {
			pending = null;
		}
		if (!pending) {
			fail(
				'Questo consenso non è partito da questa scheda (o è scaduto): non inoltro niente. ' +
					'Riapri «Connetti» dalla card del server MCP.'
			);
			return;
		}
		server = pending.server;
		ritorno = safeReturnPath(pending.returnTo);
		if (rifiuto) {
			fail(`L’authorization server ha rifiutato il consenso (${rifiuto.slice(0, 80)}).`);
			return;
		}
		if (!code) {
			fail('Il ritorno non porta un codice di autorizzazione: riapri «Connetti».');
			return;
		}
		await refreshCapabilities();
		if (!get(isAdmin)) {
			fail('Serve una sessione admin per completare il consenso: non inoltro niente.');
			return;
		}
		try {
			const res = await completeMcpOAuth(server, { state, code });
			toastSuccess('MCP server autorizzato', `${res.server}${res.detail ? ' — ' + res.detail : ''}`);
			// The gateway's return page passes the same rule as ours.
			await goto(safeReturnPath(res.return_to ?? ritorno), { replaceState: true });
		} catch (err) {
			fail(err instanceof ApiError ? err.message : String(err));
		}
	});

	function fail(msg: string) {
		errore = msg;
		stato = 'error';
	}
</script>

<div class="wrap">
	<div class="box" role="status" aria-live="polite">
		{#if stato === 'busy'}
			<strong>Completo l’autorizzazione…</strong>
			<p>Consegno il codice al gateway: il token resta nel suo vault.</p>
		{:else}
			<strong>Autorizzazione non completata{server ? ` — «${server}»` : ''}</strong>
			<p class="err">{errore}</p>
			<p><a href={ritorno}>Torna alla pagina di partenza</a></p>
		{/if}
	</div>
</div>

<style>
	.wrap { display: flex; justify-content: center; padding: 48px 16px; }
	.box {
		max-width: 520px; width: 100%;
		background: var(--card-bg); border: 1px solid var(--border); border-radius: 10px;
		padding: 20px; display: flex; flex-direction: column; gap: 8px;
	}
	.err { color: var(--danger, #b42318); }
</style>
