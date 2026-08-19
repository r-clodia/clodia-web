#!/usr/bin/env node
/**
 * Scavalcare il router è un'AZIONE, non un appunto (clodia-platform#187).
 *
 * Nella barra 🧭 convivono due gesti che si somigliano e costano cose diverse:
 *
 *   - «Avresti usato: X»  → `recordRoutingFeedback`, insegna per la volta dopo
 *                            e lascia parlare l'agente sbagliato;
 *   - «Passa il turno a X» → `overruleRouting`, ferma quel turno e lo consegna.
 *
 * Il difetto che questo controllo intercetta è la ricaduta silenziosa: se il
 * chip dello scavalcamento torna a chiamare il feedback, la UI dice «fatto»,
 * nessun errore compare, i tipi passano — e l'agente sbagliato continua a
 * parlare, cioè esattamente lo stato che l'issue descriveva.
 *
 * Seconda cosa, altrettanto muta: dopo l'interruzione i box live del turno
 * fermato non riceveranno mai la fine del turno. Senza `resetLive()` restano
 * accesi a schermo come quelli di un turno vivo.
 */
import { readFileSync } from 'node:fs';

const PAGE = 'src/routes/topics/[tier]/[name]/+page.svelte';
const CLIENT = 'src/lib/api/client.ts';
const guasti = [];

const leggi = (f) => {
	try {
		return readFileSync(f, 'utf8');
	} catch {
		guasti.push(`${f}: file assente — spostato o rinominato`);
		return '';
	}
};

const client = leggi(CLIENT);
if (client) {
	if (!/export async function overruleRouting\s*\(/.test(client)) {
		guasti.push(`${CLIENT}: manca overruleRouting()`);
	}
	if (!/routing-overrule/.test(client)) {
		guasti.push(
			`${CLIENT}: nessuna chiamata a /routing-overrule: il client non ha più il verbo che ferma il turno`
		);
	}
}

const page = leggi(PAGE);
if (page) {
	const fn = page.match(/async function overruleRoute\([^)]*\)\s*\{[\s\S]*?\n\t\}/);
	if (!fn) {
		guasti.push(`${PAGE}: manca overruleRoute() — il chip non ha più cosa chiamare`);
	} else {
		const corpo = fn[0];
		if (!/overruleRouting\(/.test(corpo)) {
			guasti.push(
				`${PAGE}: overruleRoute() non chiama overruleRouting(): ` +
					`se passa da recordRoutingFeedback la UI dice «fatto» e l'agente sbagliato continua`
			);
		}
		if (!/resetLive\(\)/.test(corpo)) {
			guasti.push(
				`${PAGE}: overruleRoute() non azzera il live: i box del turno interrotto ` +
					`non riceveranno mai la fine del turno e restano accesi`
			);
		}
	}
	if (!/on:click=\{\(\) => overruleRoute\(a\)\}/.test(page)) {
		guasti.push(`${PAGE}: nessun chip cablato a overruleRoute()`);
	}
	if (!/on:click=\{\(\) => correctRoute\(a\)\}/.test(page)) {
		guasti.push(
			`${PAGE}: è sparito il chip che INSEGNA: lo scavalcamento non lo sostituisce, ` +
				`correggere una statistica non deve costare un turno`
		);
	}
}

if (guasti.length) {
	console.error('scavalcamento del router:');
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log('scavalcamento del router: chip → overruleRouting, live azzerato ✓');
