#!/usr/bin/env node
/**
 * La barra 🧭 non deve mostrare il gergo interno del router (clodia-platform#253).
 *
 * `routingReason` traduce `payload.reason` in una frase; la chiave assente non
 * rompe niente e non si vede in nessun controllo — si stampa la stringa del
 * backend così com'è. È un degrado MUTO, ed è il motivo per cui due decisioni
 * prese da una persona («router overruled by human», «routing ambiguity resolved
 * by human») sono rimaste a schermo in inglese: nessuno le vedeva mancare.
 *
 * Qui si tengono ferme quelle due, che sono il caso peggiore della categoria:
 * chi legge ha appena causato la decisione con un click ed è l'unico che si
 * aspetta di riconoscersi nella spiegazione.
 */
import { readFileSync } from 'node:fs';

const PAGE = 'src/routes/topics/[tier]/[name]/+page.svelte';
// Le stringhe sono quelle emesse da clodia-logic (`server/api/channels.py`) per
// le decisioni di routing prese da un umano, non dal router.
const ATTESE = ['router overruled by human', 'routing ambiguity resolved by human'];
const guasti = [];

let page = '';
try {
	page = readFileSync(PAGE, 'utf8');
} catch {
	guasti.push(`${PAGE}: file assente — spostato o rinominato`);
}

if (page) {
	const mappa = page.match(/const routingReason: Record<string, string> = \{[\s\S]*?\n\t\};/);
	if (!mappa) {
		guasti.push(`${PAGE}: manca la mappa routingReason — la barra 🧭 non traduce più nulla`);
	} else {
		for (const chiave of ATTESE) {
			if (!mappa[0].includes(`'${chiave}'`)) {
				guasti.push(
					`${PAGE}: routingReason non ha la voce «${chiave}»: ` +
						`a schermo comparirà la stringa interna del backend, in inglese`
				);
			}
		}
	}
}

if (guasti.length) {
	console.error('etichette del motivo di instradamento:');
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log('etichette del motivo di instradamento: le decisioni umane hanno una frase ✓');
