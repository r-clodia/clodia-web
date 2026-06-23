<script lang="ts">
	/**
	 * Login — Claude Max OAuth.
	 *
	 * The agent-server drives the OAuth dance (`claude auth login --claudeai`)
	 * and hands us back the OAuth URL. The flow on this page:
	 *
	 *   1. "Accedi con Claude Max" → POST /auth/login → get the OAuth URL.
	 *   2. The user opens the URL (new tab), authorises, copies the return code.
	 *   3. Paste the code → POST /auth/code → poll GET /auth/status until the
	 *      server reports `logged_in`, then redirect into the app.
	 *
	 * If a token already exists the server short-circuits to
	 * `already_logged_in` and we redirect immediately. In dev-bypass mode
	 * (`PUBLIC_AUTH_DISABLED=1`) this page just shows a banner and a button to
	 * enter the app directly.
	 */
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import {
		AUTH_DISABLED,
		refreshAuth,
		startLogin,
		submitAuthCode
	} from '$lib/stores/auth';
	import { toastError, toastSuccess } from '$lib/stores/toasts';

	type Step = 'idle' | 'await-code' | 'verifying';

	let step: Step = 'idle';
	let busy = false;
	let oauthUrl: string | null = null;
	let code = '';
	let error: string | null = null;
	let copied = false;

	// Where to land after a successful login (carried via ?next=…), defaulting
	// to the agents grid — the app's home.
	function nextTarget(): string {
		if (typeof window === 'undefined') return '/agents';
		const next = new URLSearchParams(window.location.search).get('next');
		// Only allow same-app absolute paths to avoid open-redirects.
		if (next && next.startsWith('/') && !next.startsWith('//') && next !== '/login') {
			return next;
		}
		return '/agents';
	}

	onMount(async () => {
		if (AUTH_DISABLED) return; // dev bypass — show the banner, no auto-redirect
		// If the server already has a token, skip the form entirely.
		const ok = await refreshAuth();
		if (ok) void goto(nextTarget(), { replaceState: true });
	});

	async function onStartLogin() {
		error = null;
		busy = true;
		try {
			const res = await startLogin();
			if (res.status === 'already_logged_in') {
				toastSuccess('Sei già autenticato.');
				void goto(nextTarget(), { replaceState: true });
				return;
			}
			if (res.url) {
				oauthUrl = res.url;
				step = 'await-code';
				// Best-effort: pop the OAuth page so the user doesn't have to copy
				// the URL manually. Pop-up blockers may swallow this — the link is
				// always shown below as a fallback.
				try {
					window.open(res.url, '_blank', 'noopener,noreferrer');
				} catch {
					/* ignore — fallback link is rendered */
				}
			} else {
				error = `Risposta inattesa dal server (status: ${res.status}). URL OAuth assente.`;
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Avvio del login fallito.';
		} finally {
			busy = false;
		}
	}

	async function onSubmitCode() {
		const trimmed = code.trim();
		if (!trimmed) {
			error = 'Incolla il codice di ritorno OAuth.';
			return;
		}
		error = null;
		busy = true;
		step = 'verifying';
		try {
			await submitAuthCode(trimmed);
			// The server processes the code asynchronously; poll /auth/status
			// until it flips to logged_in (or we give up after ~30s).
			const deadline = Date.now() + 30_000;
			let ok = false;
			while (Date.now() < deadline) {
				ok = await refreshAuth();
				if (ok) break;
				await new Promise((r) => setTimeout(r, 1500));
			}
			if (ok) {
				toastSuccess('Login completato.');
				void goto(nextTarget(), { replaceState: true });
			} else {
				error =
					'Codice inviato ma il login non risulta ancora completato. ' +
					'Verifica il codice e riprova.';
				step = 'await-code';
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Invio del codice fallito.';
			step = 'await-code';
		} finally {
			busy = false;
		}
	}

	async function copyUrl() {
		if (!oauthUrl) return;
		try {
			await navigator.clipboard.writeText(oauthUrl);
			copied = true;
			setTimeout(() => (copied = false), 1800);
		} catch {
			toastError('Copia non riuscita — seleziona e copia il link manualmente.');
		}
	}

	function restart() {
		step = 'idle';
		oauthUrl = null;
		code = '';
		error = null;
	}

	function enterBypass() {
		void goto(nextTarget(), { replaceState: true });
	}
</script>

<div class="login-wrap">
	<div class="card">
		<div class="brand">
			<span class="brand-mark">●</span>
			<span class="brand-name">Clodia</span>
			<span class="brand-tag">v2</span>
		</div>

		<h1>Accedi</h1>
		<p class="lede">Autenticazione tramite il tuo account <strong>Claude Max</strong>.</p>

		{#if AUTH_DISABLED}
			<div class="banner dev">
				<strong>Modalità dev — autenticazione disabilitata.</strong>
				<span
					>Il gate OAuth è bypassato (<code>PUBLIC_AUTH_DISABLED</code>). L'app è
					utilizzabile senza login.</span
				>
			</div>
			<button class="primary" type="button" on:click={enterBypass}>Entra nell'app</button>
		{:else}
			{#if error}
				<div class="banner err" role="alert">{error}</div>
			{/if}

			{#if step === 'idle'}
				<p class="hint">
					Avvieremo il flusso OAuth di Claude. Si aprirà una pagina per autorizzare
					l'accesso; al termine riceverai un codice da incollare qui.
				</p>
				<button class="primary" type="button" on:click={onStartLogin} disabled={busy}>
					{busy ? 'Avvio…' : 'Accedi con Claude Max'}
				</button>
			{:else}
				<ol class="steps">
					<li>
						Apri la pagina di autorizzazione Claude:
						{#if oauthUrl}
							<div class="url-row">
								<a class="oauth-link" href={oauthUrl} target="_blank" rel="noopener noreferrer"
									>Apri pagina OAuth ↗</a
								>
								<button class="ghost" type="button" on:click={copyUrl}>
									{copied ? 'Copiato ✓' : 'Copia link'}
								</button>
							</div>
							<code class="url-display">{oauthUrl}</code>
						{/if}
					</li>
					<li>Autorizza l'accesso e copia il codice di ritorno.</li>
					<li>
						Incolla il codice qui sotto:
						<form
							class="code-form"
							on:submit|preventDefault={onSubmitCode}
						>
							<input
								class="code-input"
								type="text"
								placeholder="Codice di ritorno OAuth"
								bind:value={code}
								disabled={busy}
								autocomplete="off"
								spellcheck="false"
							/>
							<button class="primary" type="submit" disabled={busy || !code.trim()}>
								{step === 'verifying' ? 'Verifica…' : 'Invia codice'}
							</button>
						</form>
					</li>
				</ol>
				<button class="link-btn" type="button" on:click={restart} disabled={busy}>
					← Ricomincia
				</button>
			{/if}
		{/if}
	</div>
</div>

<style>
	.login-wrap {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 24px;
		background: radial-gradient(
			1200px 600px at 50% -10%,
			rgba(255, 107, 61, 0.08),
			transparent
		);
	}

	.card {
		width: 100%;
		max-width: 460px;
		background: var(--card-bg);
		border: 1px solid var(--border);
		border-radius: 12px;
		padding: 32px 30px;
		box-shadow: 0 18px 48px rgba(0, 0, 0, 0.35);
	}

	.brand {
		display: flex;
		align-items: baseline;
		gap: 8px;
		margin-bottom: 22px;
	}
	.brand-mark {
		color: var(--accent);
		font-size: 16px;
		line-height: 1;
	}
	.brand-name {
		font-weight: 600;
		letter-spacing: 0.02em;
	}
	.brand-tag {
		font-size: 11px;
		color: var(--fg-muted);
		text-transform: uppercase;
	}

	h1 {
		margin: 0 0 4px;
	}
	.lede {
		margin: 0 0 20px;
		color: var(--fg-muted);
	}
	.hint {
		color: var(--fg-muted);
		font-size: 13px;
		margin: 0 0 18px;
	}

	.banner {
		border-radius: 8px;
		padding: 12px 14px;
		margin-bottom: 18px;
		font-size: 13px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.banner.dev {
		background: rgba(92, 184, 138, 0.1);
		border: 1px solid rgba(92, 184, 138, 0.4);
		color: var(--fg);
	}
	.banner.err {
		background: rgba(232, 93, 117, 0.1);
		border: 1px solid rgba(232, 93, 117, 0.45);
		color: #f3b6c1;
	}

	button.primary {
		width: 100%;
		background: var(--accent);
		border-color: var(--accent);
		color: var(--accent-fg);
		font-weight: 600;
		padding: 11px 14px;
		letter-spacing: 0.02em;
	}
	button.primary:hover:not(:disabled) {
		filter: brightness(1.06);
		background: var(--accent);
		border-color: var(--accent);
	}
	button:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.steps {
		margin: 0 0 14px;
		padding-left: 20px;
		display: flex;
		flex-direction: column;
		gap: 14px;
		font-size: 13.5px;
	}
	.steps li {
		line-height: 1.5;
	}

	.url-row {
		display: flex;
		gap: 8px;
		margin: 8px 0 6px;
		align-items: center;
		flex-wrap: wrap;
	}
	.oauth-link {
		color: var(--accent);
		font-weight: 600;
	}
	.oauth-link:hover {
		text-decoration: underline;
	}
	.url-display {
		display: block;
		word-break: break-all;
		font-size: 11px;
		color: var(--fg-muted);
		background: var(--bg);
		padding: 8px 10px;
		border-radius: 6px;
		border: 1px solid var(--border);
	}

	.code-form {
		display: flex;
		gap: 8px;
		margin-top: 8px;
		flex-wrap: wrap;
	}
	.code-input {
		flex: 1 1 200px;
		min-width: 0;
		font: inherit;
		color: var(--fg);
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 9px 11px;
	}
	.code-input:focus {
		outline: none;
		border-color: var(--accent);
	}
	.code-form .primary {
		width: auto;
		flex: 0 0 auto;
	}

	button.ghost {
		font-size: 12px;
		padding: 6px 10px;
	}

	.link-btn {
		border: none;
		background: none;
		color: var(--fg-muted);
		font-size: 12.5px;
		padding: 4px 0;
		cursor: pointer;
	}
	.link-btn:hover:not(:disabled) {
		color: var(--fg);
		background: none;
	}
</style>
