#!/usr/bin/env node
/**
 * Chi è nella stanza si VEDE. L'idoneità è appartenenza, non un filtro di
 * visualizzazione (clodia-platform#190).
 *
 * Fino al 11 ago 2026 il pannello Partecipanti mostrava
 * `participants.filter((p) => eligibility[p]?.eligible ?? true)`. Il bit
 * `eligible` arrivava però da un predicato che mescolava due fatti diversi —
 * «lo stack dichiarato regge il tier» (durevole) e «il provider adesso è
 * collegato e non in pausa» (transitorio) — quindi bastava mettere in pausa un
 * provider perché una stanza piena sembrasse VUOTA. Nessun errore, nessun log,
 * nessun messaggio: la lista semplicemente si accorciava.
 *
 * È il difetto peggiore della famiglia, perché nasconde se stesso. Un
 * partecipante che non può rispondere va MOSTRATO e marcato; un partecipante
 * che non ha titolo a stare lì non dev'essere nella stanza (lo impedisce il
 * cancello in `clodia-logic`, non la CSS di questa pagina).
 *
 * Cosa protegge questa guard, e perché non basta `svelte-check`: la forma dei
 * dati è tipizzata e il compilatore la vede: `available` che scompare dal tipo
 * lo prenderebbe. Quello che nessun tipo vede è la REGOLA DI RENDERING — un
 * `.filter()` rimesso sulla lista «per non mostrare gli agenti spenti» compila
 * benissimo e riporta esattamente il sintomo dell'11 agosto.
 *
 * Le due metà vanno tenute insieme, ed è il motivo per cui questa guard
 * controlla anche il dropdown d'invito: lì il filtro su `eligible` DEVE
 * restare. Toglierlo ovunque «per simmetria» proporrebbe di invitare agenti
 * che il backend rifiuta con 409 — cioè si sposterebbe il difetto, non si
 * chiuderebbe.
 *
 *     node scripts/check-partecipanti-non-filtrati.mjs
 */
import { leggiSorgente, senzaCommenti } from './lib/sorgente.mjs';

const PAGINA = 'src/routes/topics/[tier]/[name]/+page.svelte';
const CLIENT = 'src/lib/api/client.ts';
const guasti = [];

const src = leggiSorgente(PAGINA, guasti, 'lista partecipanti non filtrata');
if (src !== null) {
	const codice = senzaCommenti(src);

	// 1. IL CASO. Nessuna lista derivata che tolga partecipanti: il nome storico
	//    era `shownParticipants`, ma qui si cerca la FORMA — un `.filter` sui
	//    partecipanti il cui corpo interroga l'idoneità — perché rinominarlo non
	//    è un rimedio.
	for (const [intero, corpo] of codice.matchAll(
		/\bparticipants\s*\.filter\(([\s\S]{0,200}?)\)\s*[;\n]/g
	)) {
		if (/eligib|available/.test(corpo)) {
			guasti.push(
				`${PAGINA}: i partecipanti tornano filtrati per idoneità — «${intero
					.trim()
					.slice(0, 90)}…». ` +
					`Con i provider in pausa la stanza si mostra vuota (clodia-platform#190)`
			);
		}
	}
	if (/\bshownParticipants\b/.test(codice)) {
		guasti.push(
			`${PAGINA}: «shownParticipants» è tornata. Era la lista amputata: ` +
				`il pannello e il conteggio devono leggere «participants»`
		);
	}

	// 2. Il pannello itera davvero la lista intera, e il contatore conta quella.
	const ognuno = [...codice.matchAll(/\{#each\s+([\w.?[\]]+)\s+as\s+p\b/g)].map((m) => m[1]);
	if (!ognuno.includes('participants')) {
		guasti.push(
			`${PAGINA}: il pannello Partecipanti non itera \`participants\` ` +
				`(trovato: ${ognuno.length ? ognuno.join(', ') : 'nessun #each'})`
		);
	}
	if (!/section-count">\{participants\.length\}/.test(codice)) {
		guasti.push(
			`${PAGINA}: il contatore della sezione non conta \`participants.length\` — ` +
				`un numero che non corrisponde alla lista è la stessa bugia, più piccola`
		);
	}

	// 3. Il transitorio si VEDE: chi non può rispondere adesso resta in lista con
	//    un badge. Senza questo, non filtrare significherebbe solo mentire al
	//    contrario — una stanza di agenti che sembrano tutti operativi.
	if (!/eligibility\[p\]\?\.available\s*===\s*false/.test(codice)) {
		guasti.push(
			`${PAGINA}: nessun badge sul partecipante non disponibile ` +
				`(atteso un ramo su \`eligibility[p]?.available === false\`)`
		);
	}

	// 4. Il tipo locale porta il campo: senza, `available` è sempre undefined e
	//    il badge del punto 3 non compare mai — verde e inerte.
	if (!/\bavailable\s*:\s*boolean/.test(codice)) {
		guasti.push(`${PAGINA}: il tipo Elig non dichiara \`available\``);
	}
	if (!/available\s*:\s*a\.available/.test(codice)) {
		guasti.push(
			`${PAGINA}: \`loadEligibility\` non copia \`available\` dalla risposta: ` +
				`il campo del backend si ferma qui`
		);
	}

	// 5. L'altra metà, che deve RESTARE: il dropdown d'invito non propone chi il
	//    backend rifiuterebbe.
	if (!/eligibility\[a\]\?\.eligible/.test(codice)) {
		guasti.push(
			`${PAGINA}: il dropdown d'invito non filtra più su \`eligible\` — ` +
				`proporrebbe agenti che l'API respinge con 409`
		);
	}
}

const cli = leggiSorgente(CLIENT, guasti, 'AgentEligibility.available');
if (cli !== null) {
	const codice = senzaCommenti(cli);
	for (const campo of ['eligible', 'available']) {
		if (!new RegExp(`\\b${campo}\\s*:\\s*boolean`).test(codice)) {
			guasti.push(`${CLIENT}: AgentEligibility non dichiara \`${campo}\``);
		}
	}
}

if (guasti.length) {
	console.error('partecipanti non filtrati:');
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log(
	'partecipanti non filtrati: la stanza mostra chi c’è, e marca chi ora non può rispondere ✓'
);
