<script lang="ts">
	/**
	 * Root layout — auth gate + shell + global SSE lease.
	 *
	 * Responsibilities:
	 *  1. **Auth gate.** On first mount we resolve the session via the `auth`
	 *     store (`GET /auth/status`, or an instant pass in dev-bypass mode).
	 *     Until that resolves we show a splash; afterwards a reactive guard
	 *     redirects unauthenticated users to `/login` and keeps `/login` out
	 *     of reach once authenticated. The `/login` route renders WITHOUT the
	 *     sidebar shell.
	 *  2. **Shell.** Sidebar + main slot for every authenticated route.
	 *  3. **Global SSE lease.** `/clodia/events` stays connected for the SPA's
	 *     lifetime so pages can subscribe without each opening their own
	 *     EventSource. The lease is only taken once the user is authenticated.
	 *
	 * `<Toaster />` is mounted here so toasts can be pushed from anywhere.
	 */
	import { onDestroy, onMount } from 'svelte';
	import { browser } from '$app/environment';
	import '../app.css';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import Toaster from '$lib/components/Toaster.svelte';
	import LoginScreen from '$lib/components/LoginScreen.svelte';
	import SetupScreen from '$lib/components/SetupScreen.svelte';
	import ChatWidget from '$lib/components/ChatWidget.svelte';
	import {
		onEventStream,
		startEventStream
	} from '$lib/stores/events-stream';
	import { bumpJobs } from '$lib/stores/jobs';
	import { AUTH_DISABLED } from '$lib/stores/auth';
	import { session, validateSession, restoreSession } from '$lib/auth/session';
	import { initPrefs } from '$lib/stores/prefs';
	import { getAdminState } from '$lib/api/client';

	let releaseStream: (() => void) | null = null;
	let offHandler: (() => void) | null = null;

	// Bootstrap gate (Admin Auth F1): l'istanza è stata reclamata da un admin?
	// Sta SOPRA l'auth gate: su istanza non reclamata si mostra solo EnrollGate.
	let bootstrapChecked = false;
	let instanceInitialized = true;

	// Auth gate (F2a): si entra SOLO con una sessione valida (login PKI). Il
	// flag PUBLIC_AUTH_DISABLED resta come escape hatch di sviluppo.
	$: loggedIn = AUTH_DISABLED || !!$session;

	onMount(async () => {
		initPrefs();
		try {
			instanceInitialized = (await getAdminState()).initialized;
		} catch {
			// fail-open: backend senza F1 (endpoint assente) → non bloccare.
			instanceInitialized = true;
		}
		bootstrapChecked = true;
		// "Ricordami": se il token è scaduto/assente ma la masterkey è salvata,
		// ri-firma prima di validare → niente re-login a ogni apertura.
		if (!AUTH_DISABLED) {
			await restoreSession();
			await validateSession();
		}
	});

	// --- SSE lease (only while authenticated) --------------------------------
	function startStream() {
		if (releaseStream) return;
		releaseStream = startEventStream();
		offHandler = onEventStream((ev) => {
			// The agent-server publishes `agent_activity` whenever an agent
			// records a new entry — use it to refresh the AGENTS grid + JOBS
			// list immediately rather than waiting for the next poll.
			if (ev.type === 'agent_activity') {
				bumpJobs();
			}
		});
	}

	function stopStream() {
		if (offHandler) offHandler();
		if (releaseStream) releaseStream();
		offHandler = null;
		releaseStream = null;
	}

	$: if (browser) {
		if (loggedIn) startStream();
		else stopStream();
	}

	onDestroy(() => {
		stopStream();
	});
</script>

{#if !bootstrapChecked}
	<div class="splash">
		<span class="dot">●</span>
		<p>Verifica istanza…</p>
	</div>
{:else if !instanceInitialized}
	<!-- Nessun superadmin: NON si rivela nulla dell'app. Solo il setup iniziale
	     per configurare il superadmin (unico human accanto a clodia/ophelia). -->
	<SetupScreen />
{:else if !loggedIn}
	<!-- Non loggato: si vede SOLO il modulo di login, nient'altro. -->
	<LoginScreen />
{:else}
	<div class="app">
		<Sidebar />
		<main class="main">
			<slot />
		</main>
		<ChatWidget
			agent="helpdesk"
			tier="SEAL-1"
			name="clodia-help"
			title="Assistenza — Helpdesk"
			initialMessage="Ciao Helpdesk, ho bisogno di aiuto con questa sezione."
		/>
	</div>
{/if}

<Toaster />

<style>
	.app {
		display: flex;
		/* Shell ad altezza fissa: la viewport non scrolla mai come pagina intera;
		   sidebar e header/input restano fissi, scrolla solo il contenuto interno.
		   Robusto al cambio di font-size. */
		/* --ui-zoom compensa lo `zoom` su <html> (Aa+): senza, 100dvh viene scalato
		   dallo zoom e la shell sfora la viewport tagliando il fondo. (issue #2) */
		height: calc(100vh / var(--ui-zoom, 1));
		height: calc(100dvh / var(--ui-zoom, 1));
		overflow: hidden;
	}

	.main {
		flex: 1 1 auto;
		padding: 28px 32px;
		min-width: 0;
		/* il contenuto scrolla qui dentro, non sul body */
		min-height: 0;
		overflow-y: auto;
	}


	.splash {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 10px;
		color: var(--fg-muted);
	}
	.splash .dot {
		color: var(--accent);
		font-size: 22px;
		animation: pulse 1.2s ease-in-out infinite;
	}
	@keyframes pulse {
		0%,
		100% {
			opacity: 0.35;
		}
		50% {
			opacity: 1;
		}
	}
</style>
