#!/usr/bin/env node
/**
 * La card dice il MODELLO per stanza, e non chiama «in uso» il preferito.
 *
 * #306 ha togliuto alla card la pretesa di un provider unico per agente; il
 * modello è rimasto indietro (clodia-platform#325). `effective_model` è il
 * modello del provider PREFERITO — quello che si sceglie fuori da un topic —
 * mentre dentro una stanza gira il provider min-cost idoneo al tier, che con
 * `provider_models` serve un ALTRO modello. Il campo era etichettato
 * `title="model (stack in uso)"`: l'unica affermazione esplicita della card era
 * anche la sbagliata, e contraddiceva il chip di stanza di #315.
 *
 * Perché una guard e non solo i tipi: `svelte-check` vede la FORMA del dato,
 * non la REGOLA DI VISUALIZZAZIONE. I due modi di tornare al difetto —
 * rietichettare il preferito come «in uso», o smettere di mostrare la mappa per
 * tier — compilano entrambi senza un fiato.
 *
 *     node scripts/check-modello-per-tier.mjs
 */
import { leggiSorgente, senzaCommenti } from './lib/sorgente.mjs';

const guasti = [];

// `providerPerTier` è generico sulla mappa `tier → valore`: la stessa resa vale
// per i modelli, e riusarla è il punto 3 dell'issue («non una seconda resa»).
let riassumiPerTier, vaMostrata;
try {
	({ riassumiPerTier, vaMostrata } = await import('../src/lib/providerPerTier.js'));
} catch (e) {
	guasti.push(`src/lib/providerPerTier.js non si importa (${e && e.message})`);
}

const MISTO = {
	'SEAL-0': 'claude-sonnet-4-5',
	'SEAL-1': 'claude-sonnet-4-5',
	'SEAL-2': 'claude-opus-5',
	'SEAL-3': null,
	'SEAL-4': null
};
const UNICO = {
	'SEAL-0': 'claude-sonnet-4-5',
	'SEAL-1': 'claude-sonnet-4-5',
	'SEAL-2': 'claude-sonnet-4-5',
	'SEAL-3': 'claude-sonnet-4-5',
	'SEAL-4': 'claude-sonnet-4-5'
};

if (typeof riassumiPerTier === 'function') {
	const casi = [
		[
			'IL CASO: due modelli e due tier preclusi',
			() => riassumiPerTier(MISTO),
			'SEAL-0/1 claude-sonnet-4-5 · SEAL-2 claude-opus-5 · SEAL-3/4 —'
		],
		['un modello per tutti i tier', () => riassumiPerTier(UNICO), 'SEAL-0/1/2/3/4 claude-sonnet-4-5'],
		['mappa assente (backend vecchio)', () => riassumiPerTier(undefined), '']
	];
	for (const [nome, fn, atteso] of casi) {
		const avuto = fn();
		const ok = avuto === atteso;
		if (!ok) guasti.push(`${nome}: «${avuto}» (atteso «${atteso}»)`);
		console.log(`${ok ? 'ok  ' : 'KO  '} ${nome} → «${avuto}»`);
	}
	// Stessa regola di rumore del provider: si mostra solo se aggiunge qualcosa.
	if (vaMostrata(UNICO)) {
		guasti.push('la riga modello-per-tier compare anche a modello unico: rumore su ogni card');
	}
	if (!vaMostrata(MISTO)) {
		guasti.push('la riga modello-per-tier NON compare quando il modello cambia: è il difetto #325');
	}
}

// --- la card: usa la mappa, e non chiama «in uso» il preferito -------------
const CARD = 'src/lib/components/AgentCard.svelte';
const card = leggiSorgente(CARD, guasti, 'modello per tier');
if (card !== null) {
	const codice = senzaCommenti(card);
	if (!/model_by_tier/.test(codice)) {
		guasti.push(`${CARD}: non legge \`model_by_tier\` — mostra solo il modello fuori-stanza (#325)`);
	}
	if (/stack in uso/.test(card)) {
		guasti.push(
			`${CARD}: dice ancora «stack in uso» del modello preferito. Dentro un topic il ` +
				`modello è quello del provider che regge il tier: è l'affermazione che ha generato #325`
		);
	}
}

// La tabella e la scheda leggono lo stesso campo: se una delle due lo rietichetta
// «in uso», il difetto è tornato in un altro punto della stessa UI.
for (const f of [
	'src/lib/components/AgentTable.svelte',
	'src/routes/agents/[name]/+page.svelte'
]) {
	const src = leggiSorgente(f, guasti, 'modello per tier');
	if (src !== null && /stack in uso/.test(src)) {
		guasti.push(`${f}: «stack in uso» riferito a \`effective_model\`, che è il preferito (#325)`);
	}
}

// Il tipo: senza il campo dichiarato, la card sopra non compilerebbe — e
// dichiararlo senza commento è come lo abbiamo perso la prima volta.
const TIPI = 'src/lib/api/types.ts';
const tipi = leggiSorgente(TIPI, guasti, 'modello per tier');
if (tipi !== null && !/model_by_tier/.test(tipi)) {
	guasti.push(`${TIPI}: manca \`model_by_tier\` accanto a \`provider_by_tier\``);
}

if (guasti.length) {
	console.error('modello per tier:');
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log('modello per tier: la card dice quale modello in quale stanza ✓');
