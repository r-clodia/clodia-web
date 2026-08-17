<script lang="ts">
	/**
	 * Destinazioni e fonti censite — pagina a sé, e navigabile.
	 *
	 * Richiesta dell'owner, 17 ago 2026: «la pagina egress/ingress in settings
	 * deve essere separata e navigabile, potrebbe contenere centinaia di
	 * elementi». Il pannello dentro `/settings` stampava due `{#each}` interi:
	 * con 48 fonti era già una parete di testo, e il giorno che diventano
	 * trecento la pagina delle impostazioni non si legge più.
	 *
	 * Navigabile vuol dire tre cose, e ognuna risponde a una domanda diversa:
	 *
	 * · **cerca** — «c'è già eur-lex fra le fonti?». È la domanda più frequente e
	 *   l'unica per cui una lista lunga è inutilizzabile;
	 * · **filtra per schema** — `mailto:` e `https://` non sono la stessa cosa:
	 *   un indirizzo email è un destinatario, un host è una superficie. Chi
	 *   controlla le uscite guarda i primi, chi controlla la contaminazione i
	 *   secondi;
	 * · **mostra a blocchi** — non paginazione a numeri (che costringe a
	 *   ricordare a che pagina si era) ma «mostra altri N», che con un filtro
	 *   attivo non serve quasi mai.
	 *
	 * Da sola lettura a scrivibile — «devo poter inserire un egress o ingress anche
	 * a mano», stesso giorno. La prima versione di questa pagina non lo permetteva,
	 * col ragionamento che il dialog del gate è il posto giusto per concedere una
	 * destinazione perché lì l'informazione è completa («@clodia vuole scrivere a
	 * X»). Resta vero per le destinazioni che chiede un agente, e resta il percorso
	 * normale. Non copre il caso opposto: quando l'owner sa GIÀ cosa censire, le 48
	 * fonti di un digest non passano da 48 dialog, e senza un campo qui l'unica
	 * alternativa era scrivere il file di configurazione a mano — cioè fuori da ogni
	 * controllo e da ogni traccia.
	 *
	 * Le modifiche sono riservate agli admin (il controllo vero è nell'endpoint, qui
	 * si nascondono solo i comandi) e la validazione la fa il gateway: il motivo del
	 * rifiuto arriva da lì e si mostra così com'è.
	 */
	import { onMount } from 'svelte';
	import { getEgressWhitelist, editEgressWhitelist } from '$lib/api/client';
	import { isAdmin } from '$lib/stores/capabilities';

	let mode = 'unknown';
	let egressAllow: string[] = [];
	let sourceAllow: string[] = [];
	let loading = true;
	let err = '';

	/** `egress` = dove si può scrivere · `ingress` = da dove si può leggere senza
	 *  contaminare. Due elenchi con due significati opposti: tenerli in due
	 *  schede evita di leggere una riga nella colonna sbagliata. */
	let tab: 'egress' | 'ingress' = 'egress';
	let q = '';
	let schema = '';
	let mostrati = 50;
	const PASSO = 50;

	const MODE_LABEL: Record<string, string> = {
		gate: 'chiede — una destinazione nuova passa da un’approvazione, e approvando resta',
		on: 'nega — una destinazione fuori lista è rifiutata senza chiedere',
		report: 'osserva — decide e registra, non blocca nulla',
		off: 'spento — nessun controllo sulle destinazioni',
		unknown: 'non leggibile dal gateway'
	};

	/** Lo schema di un URI: `mailto:x@y` → `mailto`, `https://h/` → `https`. */
	function schemaDi(u: string): string {
		const i = u.indexOf(':');
		return i > 0 ? u.slice(0, i) : '—';
	}

	$: lista = tab === 'egress' ? egressAllow : sourceAllow;
	/** Gli schemi presenti, con quante voci ciascuno: il conteggio è la parte
	 *  utile — dice se una categoria è una svista (1) o una politica (40). */
	$: schemi = Object.entries(
		lista.reduce<Record<string, number>>((acc, u) => {
			const s = schemaDi(u);
			acc[s] = (acc[s] ?? 0) + 1;
			return acc;
		}, {})
	).sort((a, b) => b[1] - a[1]);
	$: filtrata = lista.filter(
		(u) =>
			(!schema || schemaDi(u) === schema) &&
			(!q.trim() || u.toLowerCase().includes(q.trim().toLowerCase()))
	);
	$: visibili = filtrata.slice(0, mostrati);
	// Cambiare scheda o filtro riparte dall'inizio: tenere lo scorrimento di una
	// lista diversa fa sembrare che manchino delle voci.
	$: void [tab, q, schema], (mostrati = PASSO);
	// Una conferma pendente non sopravvive al cambio di scheda: la riga sotto il
	// puntatore non sarebbe più quella per cui si era chiesto.
	$: void tab, (daConfermare = '');

	/* --- inserimento e rimozione a mano (solo admin) --- */
	let nuova = '';
	let inCorso = false;
	let errEdit = '';
	let esito = '';
	/** La riga in attesa di conferma. Rimuovere una fonte fidata la fa tornare a
	 *  contaminare: un secondo click è poco, ma è più di zero, e un `confirm()`
	 *  nativo in una lista di trecento righe si clicca via senza leggerlo. */
	let daConfermare = '';

	async function ricarica() {
		const r = await getEgressWhitelist();
		mode = r.mode ?? 'unknown';
		egressAllow = r.egress_allow ?? [];
		sourceAllow = r.source_allow ?? [];
	}

	async function aggiungi() {
		const uri = nuova.trim();
		if (!uri || inCorso) return;
		inCorso = true;
		errEdit = '';
		esito = '';
		try {
			await editEgressWhitelist(tab, 'allow', uri);
			await ricarica();
			// Cercare la voce appena inserita: con una lista lunga è l'unico modo di
			// vedere che c'è, e di vedere in che FORMA il gateway l'ha scritta (un
			// indirizzo viene messo in minuscolo, un URL canonicalizzato).
			q = uri;
			nuova = '';
			esito = 'aggiunta';
		} catch (e) {
			errEdit = e instanceof Error ? e.message : String(e);
		} finally {
			inCorso = false;
		}
	}

	async function rimuovi(uri: string) {
		if (inCorso) return;
		inCorso = true;
		errEdit = '';
		esito = '';
		try {
			await editEgressWhitelist(tab, 'revoke', uri);
			await ricarica();
			esito = 'rimossa';
		} catch (e) {
			errEdit = e instanceof Error ? e.message : String(e);
		} finally {
			inCorso = false;
			daConfermare = '';
		}
	}

	onMount(async () => {
		try {
			const r = await getEgressWhitelist();
			mode = r.mode ?? 'unknown';
			egressAllow = r.egress_allow ?? [];
			sourceAllow = r.source_allow ?? [];
		} catch (e) {
			err = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	});
</script>

<svelte:head><title>Destinazioni e fonti · Clodia</title></svelte:head>

<div class="wrap">
	<nav class="back"><a href="/settings">← Impostazioni</a></nav>
	<h1>Destinazioni e fonti</h1>
	<p class="mode">
		Confinamento delle uscite: <strong>{mode}</strong> — {MODE_LABEL[mode] ?? MODE_LABEL.unknown}
	</p>

	{#if err}
		<p class="err">Non leggibile: {err}</p>
	{:else if loading}
		<p class="muted">Carico…</p>
	{:else}
		<div class="tabs" role="tablist">
			<button role="tab" aria-selected={tab === 'egress'} class:on={tab === 'egress'}
				on:click={() => (tab = 'egress')}>
				In uscita <span class="n">{egressAllow.length}</span>
			</button>
			<button role="tab" aria-selected={tab === 'ingress'} class:on={tab === 'ingress'}
				on:click={() => (tab = 'ingress')}>
				In ingresso <span class="n">{sourceAllow.length}</span>
			</button>
		</div>

		<p class="hint">
			{#if tab === 'egress'}
				Dove gli agenti possono scrivere senza che nessuno approvi. Una voce qui
				rende silenziosa quella destinazione per sempre.
			{:else}
				Fonti che <em>non</em> contaminano il canale. Una voce qui spegne il
				segnale sulla provenienza: le istruzioni nascoste in quel contenuto non
				produrranno più nessun allarme.
			{/if}
		</p>

		{#if $isAdmin}
			<form class="aggiungi" on:submit|preventDefault={aggiungi}>
				<input
					bind:value={nuova}
					disabled={inCorso}
					placeholder={tab === 'egress'
						? 'mailto:qualcuno@esempio.it · https://host/percorso'
						: 'https://fonte.esempio.eu/'}
					aria-label={tab === 'egress' ? 'nuova destinazione' : 'nuova fonte'}
				/>
				<button type="submit" disabled={inCorso || !nuova.trim()}>
					{inCorso ? '…' : tab === 'egress' ? 'censisci destinazione' : 'censisci fonte'}
				</button>
			</form>
			{#if errEdit}
				<p class="err">{errEdit}</p>
			{:else if esito}
				<p class="esito">Voce {esito}.</p>
			{/if}
		{/if}

		<div class="filtri">
			<input type="search" bind:value={q} placeholder="cerca…" aria-label="cerca" />
			<div class="schemi">
				<button class:on={!schema} on:click={() => (schema = '')}>tutti</button>
				{#each schemi as [s, n]}
					<button class:on={schema === s} on:click={() => (schema = s)}>
						{s} <span class="n">{n}</span>
					</button>
				{/each}
			</div>
		</div>

		{#if !lista.length}
			<p class="vuoto">
				Nessuna voce. {#if tab === 'egress'}Con il modo <strong>{mode}</strong> ogni
					destinazione nuova passa da un'approvazione.{:else}Ogni lettura
					contamina il canale che la riceve.{/if}
			</p>
		{:else if !filtrata.length}
			<p class="vuoto">Nessuna voce corrisponde. <button class="link" on:click={() => { q = ''; schema = ''; }}>azzera i filtri</button></p>
		{:else}
			<ul class="uri">
				{#each visibili as u}
					<li>
						<span class="sc">{schemaDi(u)}</span><code>{u}</code>
						{#if $isAdmin}
							{#if daConfermare === u}
								<button class="link tolgo" disabled={inCorso} on:click={() => rimuovi(u)}>
									confermi? {tab === 'egress'
										? 'tornerà a chiedere'
										: 'tornerà a contaminare'}
								</button>
								<button class="link" on:click={() => (daConfermare = '')}>no</button>
							{:else}
								<button class="link tolgo" on:click={() => (daConfermare = u)}>rimuovi</button>
							{/if}
						{/if}
					</li>
				{/each}
			</ul>
			<p class="conta">
				{visibili.length} di {filtrata.length}{#if filtrata.length !== lista.length} (filtrate su {lista.length}){/if}
				{#if filtrata.length > visibili.length}
					· <button class="link" on:click={() => (mostrati += PASSO)}>mostra altri {Math.min(PASSO, filtrata.length - visibili.length)}</button>
				{/if}
			</p>
		{/if}
	{/if}
</div>

<style>
	.wrap { max-width: 900px; padding: 16px; }
	.back { font-size: 12px; margin-bottom: 4px; }
	h1 { font-size: 20px; margin: 0 0 4px; }
	.mode { font-size: 12px; opacity: 0.85; margin: 0 0 14px; }
	.tabs { display: flex; gap: 6px; margin-bottom: 8px; }
	.tabs button {
		font: inherit; font-size: 12px; cursor: pointer; padding: 5px 12px;
		border: 1px solid var(--border); border-radius: 999px;
		background: transparent; color: inherit; opacity: 0.7;
	}
	.tabs button.on { opacity: 1; border-color: currentColor; }
	.hint { font-size: 12px; opacity: 0.8; margin: 0 0 12px; line-height: 1.5; }
	.filtri { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; }
	.filtri input {
		font: inherit; font-size: 13px; padding: 6px 10px; max-width: 320px;
		border: 1px solid var(--border); border-radius: 6px;
		background: transparent; color: inherit;
	}
	.schemi { display: flex; flex-wrap: wrap; gap: 4px; }
	.schemi button {
		font: inherit; font-size: 11px; cursor: pointer; padding: 2px 8px;
		border: 1px solid var(--border); border-radius: 999px;
		background: transparent; color: inherit; opacity: 0.65;
	}
	.schemi button.on { opacity: 1; border-color: currentColor; }
	.n { opacity: 0.6; font-variant-numeric: tabular-nums; }
	.uri { list-style: none; margin: 0; padding: 0; }
	.uri li {
		display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap;
		padding: 4px 0; border-bottom: 1px solid var(--border);
	}
	/* Lo schema in colonna fissa: scorrendo trecento righe l'occhio distingue
	   `mailto` da `https` senza rileggere l'inizio di ogni URI. */
	.sc {
		flex: none; width: 70px; font-size: 10px; text-transform: uppercase;
		opacity: 0.55; letter-spacing: 0.04em;
	}
	.uri code { font-size: 12px; word-break: break-all; }
	.aggiungi { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
	.aggiungi input {
		font: inherit; font-size: 13px; padding: 6px 10px; flex: 1; min-width: 260px;
		border: 1px solid var(--border); border-radius: 6px;
		background: transparent; color: inherit;
	}
	.aggiungi button {
		font: inherit; font-size: 12px; cursor: pointer; padding: 6px 12px;
		border: 1px solid var(--border); border-radius: 6px;
		background: transparent; color: inherit;
	}
	.aggiungi button:disabled { opacity: 0.5; cursor: default; }
	.esito { font-size: 12px; opacity: 0.8; margin: 0 0 10px; }
	/* Il comando di rimozione all'estremità della riga e in secondo piano: la
	   lista si legge, non si smonta. */
	.tolgo { margin-left: auto; flex: none; font-size: 11px; opacity: 0.6; }
	.tolgo:hover { opacity: 1; }
	.conta { font-size: 12px; opacity: 0.8; margin-top: 10px; }
	.link {
		font: inherit; font-size: inherit; cursor: pointer; padding: 0;
		background: transparent; border: 0; color: inherit; text-decoration: underline;
	}
	.vuoto, .muted { font-size: 13px; opacity: 0.8; }
	.err { font-size: 13px; color: #f87171; }
</style>
