<script lang="ts">
	/**
	 * Danger score «lethal trifecta» del contesto (issue clodia-platform#77).
	 *
	 * Sempre visibile accanto al titolo del topic: 0-1/3 ✅ · 2/3 ⚠️ · 3/3 🚨.
	 * Il numero da solo non è azionabile — il tooltip lo scompone per lato e
	 * per agente («legge il web: clodia · dati privati: ophelia · può inviare:
	 * messaggero»), perché è quella l'informazione che serve a decidere.
	 *
	 * Il punteggio è di MISURA, non di enforcement: nessuna azione è bloccata.
	 */
	import type { TrifectaProfile, TrifectaLeg } from '$lib/api/client';

	export let profile: TrifectaProfile | null | undefined = null;
	/** Primo bit del vettore: contenuto non fidato ENTRATO in questo canale.
	 *  È l'unico dei tre che cambia in tempo reale e l'unico che l'owner può
	 *  azzerare — gli altri due sono proprietà della composizione. */
	export let taint: { tainted: boolean; since?: number | null;
		sources?: { kind?: string; detail?: string; agent?: string }[] } | null = null;

	const LEG_LABEL: Record<TrifectaLeg, string> = {
		private_data: 'dati privati',
		untrusted_input: 'contenuto non fidato',
		egress: 'uscita verso l’esterno'
	};
	const LEGS: TrifectaLeg[] = ['private_data', 'untrusted_input', 'egress'];

	// Il punteggio è il numero di BIT ACCESI del vettore, calcolato dal backend:
	// contaminato · dati privati · uscita arbitraria. Non si ricalcola qui — una
	// definizione in due posti diverge al primo cambiamento.
	$: score = profile?.score ?? 0;
	$: bits = profile?.bits;
	$: tainted = bits ? bits.tainted === 1 : !!taint?.tainted;
	$: taintUnknown = profile?.tainted === null || profile?.tainted === undefined;
	$: capability = profile?.capability ?? score;
	// Il colore segue il PUNTEGGIO, che ora descrive il rischio reale: mostrare
	// 🚨 su un canale presidiato addestrerebbe a ignorare l'icona.
	$: level = score >= 3 ? 'high' : score === 2 ? 'mid' : 'low';
	$: vector = profile?.vector ?? '???';
	$: sources = (taint?.sources ?? []).slice(-3)
		.map((x) => `${x.kind ?? '?'}:${x.detail ?? '?'}`).join(' · ');

	/** I tre bit come simboli: acceso = presente, spento = assente. Tre icone si
	 *  leggono a colpo d'occhio; un numero da solo dice quanti ma non quali, ed è
	 *  «quali» che dice cosa fare. */
	$: SYMS = [
		{ on: tainted, unknown: taintUnknown, glyph: '☣', label: 'contaminato',
		  tip: taintUnknown
			? 'contaminazione non leggibile dal gateway'
			: tainted
				? 'è entrato contenuto non fidato'
				: 'nessun contenuto non fidato entrato' },
		{ on: (bits?.private_data ?? 0) === 1, unknown: false, glyph: '🗄',
		  label: 'dati privati',
		  tip: (bits?.private_data ?? 0) === 1
			? 'qualcuno qui accede a dati privati'
			: 'nessun accesso a dati privati' },
		{ on: (bits?.arbitrary_egress ?? 0) === 1, unknown: false, glyph: '↗',
		  label: 'uscita',
		  tip: (bits?.arbitrary_egress ?? 0) === 1
			? 'uscita ARBITRARIA: può scrivere verso destinazioni non approvate'
			: 'uscita presidiata o assente: una destinazione nuova passa da un’approvazione' }
	];
	$: direct = profile?.direct;
	// Il canale arriva a 3 solo perché qualcuno può invitare altri agenti:
	// va detto, altrimenti il numero sembra descrivere i presenti.
	$: byInvitation = !!direct && direct.score < score && (profile?.expanded_by?.length ?? 0) > 0;
	// La shell va attribuita a chi è davvero nel canale, non a chi è invitabile.
	$: directShell = direct?.shell_agents ?? profile?.shell_agents ?? [];
	$: names = (leg: TrifectaLeg) =>
		(direct?.by_leg?.[leg] ?? profile?.by_leg?.[leg] ?? []).join(', ');
</script>

{#if profile}
	<!-- button e non span: il tooltip dev'essere raggiungibile da tastiera -->
	<button type="button" class="trifecta {level}"
		aria-label="Trifecta {profile.label}: {SYMS.map((b) => `${b.label} ${b.on ? 'sì' : 'no'}`).join(', ')}">
		<span class="bits" aria-hidden="true">
			{#each SYMS as b}
				<span class="bit" class:on={b.on} class:unk={b.unknown}
					title="{b.label}: {b.tip}">{b.unknown ? '?' : b.glyph}</span>
			{/each}
		</span>
		<span class="val">{profile.label}</span>
		{#if profile.shell}<span class="shell" aria-hidden="true">⛨</span>{/if}
		<span class="tip">
			<strong>Trifecta {profile.label}</strong>
			<span class="vec">{vector}</span>
			<ul>
				{#each SYMS as b}
					<li class:on={b.on}>
						<span class="g">{b.unknown ? '?' : b.glyph}</span> {b.label} — {b.tip}
					</li>
				{/each}
			</ul>
			{#if capability > score}
				<p class="note">
					Capacità presente {capability}/3: i verbi ci sono, ma
					{#if !tainted}nessun contenuto non fidato è entrato{/if}{#if !tainted && (bits?.arbitrary_egress ?? 0) === 0} e {/if}{#if (bits?.arbitrary_egress ?? 0) === 0}l’uscita è presidiata{/if}.
					{#each LEGS as leg}{#if profile.legs[leg] && names(leg)}<br />{LEG_LABEL[leg]}: <span class="who">{names(leg)}</span>{/if}{/each}
				</p>
			{/if}
			{#if tainted}
				<p class="note warn">
					☣ Contaminato: è entrato contenuto non fidato{#if sources} ({sources}){/if}.
					La prima uscita da questo canale chiede conferma; approvando, il canale
					viene declassificato.
				</p>
			{/if}
			{#if byInvitation}
				<p class="note">
					Fra i soli partecipanti è {direct?.label}: sale a {profile.label} perché
					{profile.expanded_by?.join(', ')} può aggiungere altri agenti.
				</p>
			{/if}
			{#if directShell.length}
				<p class="note">
					⛨ {directShell.join(', ')}: shell attiva, i controlli del gateway sono
					aggirabili (curl non passa dal gateway).
				</p>
			{:else if profile.shell}
				<p class="note">
					⛨ Nessun presente ha la shell, ma fra gli agenti invitabili sì
					({profile.shell_agents?.join(', ')}).
				</p>
			{/if}
			{#if profile.unknown_participants?.length}
				<p class="note">Partecipanti non registrati, non valutati: {profile.unknown_participants.join(', ')}.</p>
			{/if}
			<p class="note dim">
				Il punteggio conta i bit accesi. Il primo è un <em>evento</em> e si azzera
				declassificando; gli altri due sono <em>proprietà</em> della composizione.
			</p>
		</span>
	</button>
{/if}

<style>
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
	.bit { opacity: .28; }
	.bit.on { opacity: 1; }
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
	.tip .who { color: var(--fg-muted); font-size: 11px; }
	.tip .who::before { content: '— '; }
	.tip .note { margin: 6px 0 0; color: var(--fg-muted); font-size: 11px; }
	.tip .note.dim { opacity: .75; }
</style>
