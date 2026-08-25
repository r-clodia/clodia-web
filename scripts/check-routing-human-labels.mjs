#!/usr/bin/env node
/**
 * Le decisioni prese da una PERSONA si leggono, e un rifiuto non si mostra come
 * un successo (clodia-platform#253).
 *
 * Due ricadute mute, entrambe misurate su `main` dopo il merge di R9:
 *
 *  1. la barra 🧭 rende `lastRouting.reason` attraverso `routingReason`, ma i
 *     due esiti che il backend produce quando decide un umano — `router
 *     overruled by human` e `routing ambiguity resolved by human` — non erano
 *     nella mappa. A schermo finiva la stringa interna del backend, in inglese,
 *     proprio nei due casi in cui chi legge vuole sapere che la scelta NON è
 *     stata del router. Nessun errore, nessun tipo rotto: solo una frase che
 *     nessuno ha scritto per essere letta.
 *
 *  2. da #253 l'endpoint dello scavalcamento distingue «non ho imparato» da
 *     «non ho agito»: quando l'atto declina risponde 200 con `acted: false` e
 *     un `outcome`. Se la UI non lo guarda, un rifiuto (non autorizzato, stesso
 *     agente, agente non instradabile) si mostra come «✓ turno passato a X» —
 *     un successo dichiarato per un turno che nessuno ha passato. È la stessa
 *     famiglia di difetto di #206: riportare successo senza aver agito.
 *
 * Nota (clodia-platform#293): le etichette non stanno più in una mappa dentro la
 * pagina, sono in `$lib/routingReason`, perché la stessa famiglia di difetto ha
 * colpito le reason di ripiego dopo il deploy della clodia-logic#357. Il
 * controllo qui sotto ci ha guadagnato: invece di cercare due chiavi nel
 * sorgente, ESEGUE la funzione che la pagina chiama davvero.
 */
import { leggiSorgente, senzaCommenti } from './lib/sorgente.mjs';
import { routingReasonLabel } from '../src/lib/routingReason.js';

const PAGE = 'src/routes/topics/[tier]/[name]/+page.svelte';
const CLIENT = 'src/lib/api/client.ts';
const guasti = [];

for (const reason of ['router overruled by human', 'routing ambiguity resolved by human']) {
	const label = routingReasonLabel(reason);
	if (!label || label === reason) {
		guasti.push(
			`nessuna etichetta per «${reason}»: a schermo va la stringa interna del backend, ` +
				`proprio nel caso in cui chi legge vuole sapere che la scelta NON è stata del router`
		);
	}
}

const page = leggiSorgente(PAGE, guasti, 'barra di routing');
if (page !== null) {
	const fn = page.match(/async function overruleRoute\([^)]*\)\s*\{[\s\S]*?\n\t\}/);
	if (!fn) {
		guasti.push(`${PAGE}: manca overruleRoute()`);
	} else if (!/res\.acted\s*===\s*false/.test(senzaCommenti(fn[0]))) {
		guasti.push(
			`${PAGE}: overruleRoute() non guarda \`acted\`: un rifiuto dell'atto ` +
				`(risposta 200 con acted:false) verrebbe mostrato come «turno passato»`
		);
	}
}

const client = leggiSorgente(CLIENT, guasti, 'tipo di overruleRouting');
if (client !== null) {
	const fn = client.match(/export async function overruleRouting\([\s\S]*?\n\}/);
	if (!fn) {
		guasti.push(`${CLIENT}: manca overruleRouting()`);
	} else if (
		!/\bacted\?*:/.test(senzaCommenti(fn[0])) ||
		!/\boutcome\?*:/.test(senzaCommenti(fn[0]))
	) {
		guasti.push(
			`${CLIENT}: il tipo di overruleRouting() non dichiara acted/outcome: ` +
				`la UI non può distinguere «ho agito» da «ho solo imparato»`
		);
	}
}

if (guasti.length) {
	console.error('decisioni umane sul routing:');
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log('decisioni umane sul routing: etichette presenti, rifiuto non spacciato per successo ✓');
