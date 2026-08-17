<script lang="ts">
	/**
	 * Danger score «lethal trifecta» del contesto (issue clodia-platform#77).
	 *
	 * Sempre visibile accanto al titolo del topic: 0-1/3 ✅ · 2/3 ⚠️ · 3/3 🚨.
	 * Il numero da solo non è azionabile, e il tooltip è UN PARAGRAFO PER BIT:
	 * acceso → gli eventi o i verbi che l'hanno acceso; spento → «inerte».
	 *
	 * Spiegare perché un bit non è acceso occupava metà del riquadro con ciò che
	 * non serve, e le righe che contano finivano sotto il rumore. Di un bit spento
	 * l'unica cosa da sapere è che è spento.
	 *
	 * Il punteggio è di MISURA, non di enforcement: nessuna azione è bloccata.
	 */
	import type { TrifectaProfile, TrifectaLeg } from '$lib/api/client';

	export let profile: TrifectaProfile | null | undefined = null;
	/** Primo bit del vettore: contenuto non fidato ENTRATO in questo canale.
	 *  È l'unico dei tre che cambia in tempo reale e l'unico che l'owner può
	 *  azzerare — gli altri due sono proprietà della composizione. */
	/** L'owner può azzerare: il bottone appare solo a lui. */
	export let canReset = false;
	/** Chiamato al click: la pagina fa la POST e ricarica il canale. */
	export let onReset: (() => void) | null = null;
	export let onUndoReset: (() => void) | null = null;
	export let taint: { tainted: boolean; since?: number | null;
		sources?: { kind?: string; detail?: string; agent?: string }[] } | null = null;


	// Il punteggio è il numero di BIT ACCESI del vettore, calcolato dal backend:
	// contaminato · dati privati · uscita arbitraria. Non si ricalcola qui — una
	// definizione in due posti diverge al primo cambiamento.
	$: score = profile?.score ?? 0;
	$: bits = profile?.bits;
	$: tainted = bits ? bits.tainted === 1 : !!taint?.tainted;
	$: taintUnknown = profile?.tainted === null || profile?.tainted === undefined;
	// Il colore segue il PUNTEGGIO, che ora descrive il rischio reale: mostrare
	// 🚨 su un canale presidiato addestrerebbe a ignorare l'icona.
	$: level = score >= 3 ? 'high' : score === 2 ? 'mid' : 'low';
	$: vector = profile?.vector ?? '???';

	/** I tre bit come le tre scimmiette. Il gesto è lo SPAVENTO per lo stato del
	 *  canale, non il nome del senso: la scimmia si copre perché quel canale è
	 *  aperto. Piena = bit acceso, tenue = spento.
	 *
	 *  🙉 non-ascolta → è entrato contenuto non fidato
	 *  🙈 non-vede    → qualcuno qui legge dati privati
	 *  🙊 non-parla   → qualcuno può scrivere fuori senza approvazione
	 *
	 *  Tre icone in posizione fissa si leggono a colpo d'occhio; un numero da solo
	 *  dice quanti bit sono accesi, non QUALI — ed è «quali» che dice cosa fare. */
	$: SYMS = [
		{ on: tainted, unknown: taintUnknown, glyph: '🙉', label: 'contaminato' },
		{ on: (bits?.private_data ?? 0) === 1, unknown: false, glyph: '🙈',
		  label: 'dati privati' },
		{ on: (bits?.arbitrary_egress ?? 0) === 1, unknown: false, glyph: '🙊',
		  label: 'uscita' }
	];
	/** Chi e con QUALE verbo ha acceso un lato, fra i presenti.
	 *
	 *  `why` è per agente: aggregarlo qui dà «commercialista: topic.read_file,
	 *  gdocs.read», che è l'informazione con cui si decide qualcosa. Il solo nome
	 *  dice chi guardare, non cosa togliergli.
	 */
	$: causeFor = (leg: TrifectaLeg): string[] => {
		const names = direct?.by_leg?.[leg] ?? profile?.by_leg?.[leg] ?? [];
		const present = new Set(names);
		const detailed = (profile?.agents ?? [])
			.filter((a) => present.has(a.name))
			.map((a) => {
				const verbs = (a.why?.[leg] ?? []).slice(0, 4).join(', ');
				return verbs ? `${a.name}: ${verbs}` : a.name;
			});
		// Ricaduta sui soli nomi: se il profilo per agente manca, un bit acceso
		// senza NESSUNA spiegazione è peggio di una spiegazione parziale — dice
		// «c'è un problema» e niente su dove guardare.
		return detailed.length ? detailed : names;
	};
	/** Gli EVENTI che hanno contaminato: chi ha letto, cosa, da dove. */
	$: taintEvents = (taint?.sources ?? []).slice(-4).map((x) => {
		const who = x.agent ? `${x.agent} ` : '';
		const what = x.kind === 'verb' ? (x.detail ?? '?') : `${x.kind ?? '?'}: ${x.detail ?? '?'}`;
		return `${who}${what}`.trim();
	});

	// Reset dell'owner: il punteggio è a zero perché QUALCUNO se ne è assunto la
	// responsabilità, e il badge lo dice invece di mostrare uno zero anonimo.
	$: resetBy = (profile as { reset_by?: string } | null)?.reset_by ?? null;
	$: resetAt = (profile as { reset_at?: string } | null)?.reset_at ?? null;
	$: scoreBefore = (profile as { score_before_reset?: number } | null)?.score_before_reset;
	// Il secondo bit spento perché il canale non ha dati portati dentro: è una
	// spiegazione, non un dettaglio — senza, uno zero somiglia a un difetto.
	$: dataSuppressed = !!(profile as { private_data_suppressed?: boolean } | null)
		?.private_data_suppressed;
	$: remoteEgress = !!profile?.remote_egress;
	$: direct = profile?.direct;
	// Il canale arriva a 3 solo perché qualcuno può invitare altri agenti:
	// va detto, altrimenti il numero sembra descrivere i presenti.
	$: byInvitation = !!direct && direct.score < score && (profile?.expanded_by?.length ?? 0) > 0;
	// La shell va attribuita a chi è davvero nel canale, non a chi è invitabile.
	$: directShell = direct?.shell_agents ?? profile?.shell_agents ?? [];
</script>

{#if profile}
	<!-- button e non span: il tooltip dev'essere raggiungibile da tastiera -->
	<button type="button" class="trifecta {level}"
		aria-label="Trifecta {profile.label}: {SYMS.map((b) => `${b.label} ${b.on ? 'sì' : 'no'}`).join(', ')}">
		<span class="sym" aria-hidden="true">{profile.symbol}</span>
		<span class="bits" aria-hidden="true">
			{#each SYMS as b}
				<span class="bit" class:on={b.on} class:unk={b.unknown}
					title={b.label}>{b.unknown ? '?' : b.glyph}</span>
			{/each}
		</span>
		<span class="val">{profile.label}</span>
		{#if profile.shell}<span class="shell" aria-hidden="true">⛨</span>{/if}
		<span class="tip">
			<strong>Trifecta {profile.label}</strong>
			<span class="vec">{vector}</span>
			<!-- Un paragrafo per scimmietta, e niente altro.
			     Acceso → si elencano gli eventi o i verbi che l'hanno acceso: è la
			     sola informazione con cui si decide qualcosa.
			     Spento → «inerte». Spiegare perché un bit NON è acceso occupava metà
			     del riquadro con ciò che non serve, e le tre righe che contano
			     finivano sotto il rumore. -->
			<ul>
				<li class:on={tainted}>
					<span class="g">{taintUnknown ? '?' : '🙉'}</span>
					<strong>contaminato</strong>
					{#if taintUnknown}
						— non leggibile dal gateway
					{:else if tainted}
						{#if taintEvents.length}<br /><span class="why">{taintEvents.join(' · ')}</span>{/if}
						<br /><span class="why">La prima uscita chiede conferma; approvando, il canale è declassificato.</span>
					{:else}
						— inerte
					{/if}
				</li>
				<li class:on={(bits?.private_data ?? 0) === 1}>
					<span class="g">🙈</span> <strong>dati privati</strong>
					{#if (bits?.private_data ?? 0) === 1}
						{#if causeFor('private_data').length}<br /><span class="why">{causeFor('private_data').join(' · ')}</span>{/if}
					{:else if dataSuppressed}
						— inerte<br /><span class="why">qui ci sono solo file prodotti dagli agenti:
						i verbi di lettura del canale non trovano niente di portato dentro</span>
					{:else}
						— inerte
					{/if}
				</li>
				<li class:on={(bits?.arbitrary_egress ?? 0) === 1}>
					<span class="g">🙊</span> <strong>uscita</strong>
					{#if (bits?.arbitrary_egress ?? 0) === 1}
						{#if remoteEgress}<br /><span class="why">remote non vagliato: è un condotto permanente</span>{/if}
						{#if causeFor('egress').length}<br /><span class="why">{causeFor('egress').join(' · ')}</span>{/if}
					{:else}
						— inerte
					{/if}
				</li>
			</ul>
			{#if byInvitation}
				<p class="note">Fra i soli presenti è {direct?.label}: sale perché {profile.expanded_by?.join(', ')} può aggiungere agenti.</p>
			{/if}
			{#if directShell.length}
				<p class="note">⛨ {directShell.join(', ')}: shell attiva, il gateway è aggirabile.</p>
			{/if}
			{#if profile.unknown_participants?.length}
				<p class="note">Non registrati, non valutati: {profile.unknown_participants.join(', ')}.</p>
			{/if}
			{#if resetBy}
				<p class="note reset-note">
					Azzerato da <strong>{resetBy}</strong>{#if resetAt} il {new Date(resetAt).toLocaleString()}{/if}{#if scoreBefore != null} — prima era {scoreBefore}/3{/if}.
					<br />Decade da sé se cambia la composizione del canale. I gate NON sono
					toccati: se il canale è contaminato, l'uscita chiede comunque.
				</p>
			{/if}
		</span>
	</button>
	<!-- Il bottone sta FUORI dal badge: un <button> dentro un <button> è HTML non
	     valido e il browser lo spost. Accanto, e non dentro il tooltip, ha anche
	     un vantaggio: si raggiunge senza dover tenere aperto un tooltip. -->
	{#if canReset}
		{#if resetBy}
			<button type="button" class="reset-btn" on:click={() => onUndoReset?.()}
				title="Rimuove l'azzeramento: il punteggio torna a parlare da sé.">
				annulla reset
			</button>
		{:else}
			<button type="button" class="reset-btn" on:click={() => onReset?.()}
				title="Porta il punteggio a 0/3 assumendotene la responsabilità. Resta registrato con il tuo nome, decade se cambia la composizione del canale, e NON spegne i gate.">
				reset trifecta
			</button>
		{/if}
	{/if}
{/if}

<style>
	/* Volutamente discreto: è un'assunzione di responsabilità, non un'azione
	   frequente — un bottone vistoso invita a cliccarlo per far sparire un
	   allarme, che è il contrario del suo scopo. */
	.reset-btn {
		font: inherit; font-size: 10px; cursor: pointer; margin-left: 4px;
		background: transparent; color: inherit; opacity: 0.75;
		border: 1px solid var(--border); border-radius: 999px; padding: 2px 8px;
	}
	.reset-btn:hover { opacity: 1; }
	.reset-note { opacity: 0.85; }
	.trifecta {
		position: relative; display: inline-flex; align-items: center; gap: 4px;
		font: inherit; font-size: 11px; line-height: 1.6; background: transparent;
		border: 1px solid var(--border); border-radius: 999px; padding: 1px 8px;
		cursor: help; color: var(--fg-muted);
	}
	.trifecta:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
	.trifecta.mid { border-color: var(--warn, #e0a800); color: var(--warn, #e0a800); }
	.bits { display: inline-flex; gap: 1px; font-size: 10px; line-height: 1; }
	/* Spento = tenue, non assente: la posizione dei tre simboli è fissa, così si
	   legge quale bit è acceso senza contare. */
	/* Spento = tenue E desaturato: un'emoji a colori resta leggibile anche a
	   opacità bassa, e due bit spenti sembrerebbero accesi. La posizione resta
	   fissa, così si legge QUALE è acceso senza contare. */
	.bit { opacity: .3; filter: grayscale(1); }
	.bit.on { opacity: 1; filter: none; }
	.bit.unk { opacity: .55; font-family: ui-monospace, monospace; }
	.tip .g { display: inline-block; width: 14px; }
	.vec { font-family: ui-monospace, monospace; letter-spacing: 2px; opacity: .8; }
	.note.warn { color: #d97706; }
	.trifecta.high { border-color: var(--danger); color: var(--danger); }
	.sym { font-size: 10px; }
	.val { font-variant-numeric: tabular-nums; }
	.shell { opacity: .8; }
	.tip {
		position: absolute; left: 0; top: calc(100% + 6px); z-index: 30; display: none;
		width: min(320px, 80vw); padding: 8px 10px; border: 1px solid var(--border);
		border-radius: 6px; background: var(--card-bg); color: var(--fg);
		box-shadow: 0 6px 18px rgba(0, 0, 0, .28); font-size: 12px; font-weight: 400;
		white-space: normal; text-align: left;
	}
	.trifecta:hover .tip, .trifecta:focus .tip, .trifecta:focus-within .tip { display: block; }
	.tip ul { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
	.tip li { color: var(--fg-muted); }
	.tip li.on { color: var(--fg); }
	.tip .why { color: var(--fg-muted); font-size: 11px; padding-left: 14px; display: inline-block; }
	.tip .note { margin: 6px 0 0; color: var(--fg-muted); font-size: 11px; }
</style>
