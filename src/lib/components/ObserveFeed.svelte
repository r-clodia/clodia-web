<script lang="ts">
	/**
	 * Feedback effimero della modalità di osservazione (clodia-platform#104).
	 *
	 * Con `CLODIA_DANGEROUSLY_SKIP_GATES` attivo la piattaforma si usa come prima:
	 * i controlli decidono, registrano e lasciano passare. Il rischio di quella
	 * modalità non è tecnico, è cognitivo — **è muta**. Senza un segnale l'owner
	 * lavora per giorni senza sapere che venti gate sarebbero scattati, e la
	 * decisione su quali controlli attivare arriva da una lettura a posteriori
	 * invece che dall'esperienza di averli visti passare.
	 *
	 * Quindi: un messaggio nel footer, che compare e scompare. Non un badge
	 * persistente e non un contatore — quelli si imparano a ignorare. Un evento
	 * che passa, esattamente come è passata l'azione che l'ha generato.
	 *
	 * Silenzioso quando l'osservazione è spenta: in enforcement i gate si vedono
	 * da sé, sono popup.
	 */
	import { onDestroy, onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { getObservations, type Observation } from '$lib/api/client';

	/** Ogni quanto si chiede al backend. Non è una chat: 15s è abbastanza
	 *  ravvicinato per collegare l'evento all'azione che l'ha causato, e
	 *  abbastanza rado per non pesare. */
	const POLL_MS = 15_000;
	/** Quanto resta a schermo un messaggio. */
	const LIFE_MS = 9_000;
	/** Quanti mostrarne insieme: oltre, si smette di leggerli. */
	const MAX_VISIBLE = 3;

	type Shown = Observation & { id: string };
	let shown: Shown[] = [];
	let observing = false;
	let since = 0;
	let timer: ReturnType<typeof setInterval> | null = null;

	const WHY: Record<string, string> = {
		'egress:email': 'invio email verso una destinazione non dichiarata',
		'egress:telegram': 'messaggio Telegram verso una chat non dichiarata',
		'egress:http': 'POST HTTP verso un host non dichiarato',
		'egress:drive': 'scrittura su Drive fuori dalle cartelle dichiarate',
		'egress:gsheets': 'scrittura su un foglio non dichiarato',
		'egress:github': 'scrittura su un repository non dichiarato',
		denied_tools: 'verbo escluso per questo agent',
		unattended: 'accesso ai dati di un topic da un job'
	};

	function describe(o: Observation): string {
		const why = o.why ? WHY[o.why] ?? o.why : '';
		if (o.verb.startsWith('egress-context:')) {
			return `avrebbe chiesto conferma a ${o.agent}: uscita da un canale contaminato`;
		}
		return `avrebbe chiesto conferma a ${o.agent} per ${o.verb}${why ? ` — ${why}` : ''}`;
	}

	async function poll() {
		try {
			const r = await getObservations(since);
			observing = r.observing;
			const rows = r.observations ?? [];
			if (!rows.length) return;
			// `since` avanza all'ultimo visto: il backend filtra, così un messaggio
			// non ricompare al giro dopo.
			since = Math.max(since, ...rows.map((x) => x.at || 0));
			for (const o of rows.slice(-MAX_VISIBLE)) {
				const id = `${o.at}-${o.verb}-${o.agent}`;
				if (shown.some((x) => x.id === id)) continue;
				shown = [...shown, { ...o, id }].slice(-MAX_VISIBLE);
				setTimeout(() => {
					shown = shown.filter((x) => x.id !== id);
				}, LIFE_MS);
			}
		} catch {
			// Silenzio: un feedback che segnala il proprio fallimento è peggio di
			// un feedback assente, e questa vista non è operativa.
		}
	}

	onMount(() => {
		if (!browser) return;
		void poll();
		timer = setInterval(poll, POLL_MS);
	});
	onDestroy(() => {
		if (timer) clearInterval(timer);
	});
</script>

{#if observing && shown.length}
	<div class="feed" role="status" aria-live="polite">
		{#each shown as o (o.id)}
			<p class="row" class:deny={o.outcome === 'would_deny'}>
				<span class="tag">osserva</span>
				{describe(o)}
			</p>
		{/each}
	</div>
{/if}

<style>
	.feed {
		position: fixed;
		left: 50%;
		bottom: 10px;
		transform: translateX(-50%);
		z-index: 55;
		display: flex;
		flex-direction: column;
		gap: 4px;
		max-width: min(720px, calc(100vw - 24px));
		pointer-events: none; /* non deve mai intercettare un click */
	}
	.row {
		margin: 0;
		padding: 5px 10px;
		font-size: 11px;
		line-height: 1.35;
		color: var(--fg-muted);
		background: var(--card-bg);
		border: 1px solid var(--border);
		border-radius: 999px;
		box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
		opacity: 0.94;
	}
	.tag {
		font-family: ui-monospace, monospace;
		font-size: 9px;
		text-transform: uppercase;
		letter-spacing: 0.6px;
		color: #d97706;
		margin-right: 6px;
	}
	.row.deny .tag { color: var(--danger, #dc2626); }
</style>
