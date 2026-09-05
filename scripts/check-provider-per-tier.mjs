#!/usr/bin/env node
/**
 * La card dice il provider PER STANZA, e lo dice solo quando serve.
 *
 * Il provider di un agente dipende dal tier del topic: la sessione è per
 * `(topic, agente)` e nasce col provider meno costoso che regge quel tier. La
 * card però mostrava un provider solo — la variante senza tier — chiamandolo
 * «quello realmente in uso» (clodia-platform#306). Da lì la lettura naturale e
 * sbagliata: «un agente, un provider», che è esattamente la premessa da cui è
 * partita `agents-notebook` A13.
 *
 * Perché una guard e non solo dei tipi: la parte facile da rompere non è la
 * forma del dato, è la REGOLA DI VISUALIZZAZIONE — mostrare la riga sempre
 * (rumore su ogni agente a provider unico) o non mostrarla mai (torniamo al
 * difetto). Nessuna delle due rompe la compilazione.
 *
 *     node scripts/check-provider-per-tier.mjs
 */
import { leggiSorgente, senzaCommenti } from './lib/sorgente.mjs';

const guasti = [];

let raggruppaPerProvider, riassumiPerTier, vaMostrata, tierPreclusi;
try {
	({ raggruppaPerProvider, riassumiPerTier, vaMostrata, tierPreclusi } = await import(
		'../src/lib/providerPerTier.js'
	));
} catch (e) {
	guasti.push(`src/lib/providerPerTier.js non si importa (${e && e.message})`);
}

const MISTO = {
	'SEAL-0': 'anthropic-api',
	'SEAL-1': 'anthropic-api',
	'SEAL-2': 'aws-region-eu',
	'SEAL-3': 'aws-region-eu',
	'SEAL-4': null
};
const UNICO = {
	'SEAL-0': 'scaleway',
	'SEAL-1': 'scaleway',
	'SEAL-2': 'scaleway',
	'SEAL-3': 'scaleway',
	'SEAL-4': 'scaleway'
};

if (typeof riassumiPerTier === 'function') {
	const casi = [
		[
			'IL CASO: due provider e un tier precluso',
			() => riassumiPerTier(MISTO),
			'SEAL-0/1 anthropic-api · SEAL-2/3 aws-region-eu · SEAL-4 —'
		],
		['un provider per tutti i tier', () => riassumiPerTier(UNICO), 'SEAL-0/1/2/3/4 scaleway'],
		['mappa assente', () => riassumiPerTier(null), ''],
		[
			'il tier precluso si nomina',
			() => JSON.stringify(tierPreclusi(MISTO)),
			JSON.stringify(['SEAL-4'])
		],
		['nessun tier precluso', () => JSON.stringify(tierPreclusi(UNICO)), JSON.stringify([])]
	];
	for (const [nome, fn, atteso] of casi) {
		const avuto = fn();
		const ok = avuto === atteso;
		if (!ok) guasti.push(`${nome}: «${avuto}» (atteso «${atteso}»)`);
		console.log(`${ok ? 'ok  ' : 'KO  '} ${nome} → «${avuto}»`);
	}

	// La regola di visualizzazione, che è la parte che si rompe in silenzio.
	if (vaMostrata(UNICO)) {
		guasti.push('la riga per-tier compare anche quando il provider è sempre lo stesso: rumore su ogni card');
	}
	if (!vaMostrata(MISTO)) {
		guasti.push('la riga per-tier NON compare quando il provider cambia: è il difetto #306, tornato');
	}
	if (!vaMostrata({ 'SEAL-0': 'x', 'SEAL-1': null })) {
		guasti.push('un tier in cui l’agente non può lavorare deve comparire: è l’informazione più utile');
	}
	// I gruppi coprono i tier presenti, in ordine e senza perderne.
	const coperti = raggruppaPerProvider(MISTO).flatMap((g) => g.tiers);
	if (JSON.stringify(coperti) !== JSON.stringify(Object.keys(MISTO))) {
		guasti.push(`il raggruppamento perde o riordina dei tier: ${JSON.stringify(coperti)}`);
	}
}

// --- e la card deve usarla, dicendo la cosa giusta ------------------------
const CARD = 'src/lib/components/AgentCard.svelte';
const src = leggiSorgente(CARD, guasti, 'provider per tier');
if (src !== null) {
	const codice = senzaCommenti(src);
	if (!/vaMostrata\s*\(/.test(codice) || !/riassumiPerTier\s*\(/.test(codice)) {
		guasti.push(`${CARD}: non usa providerPerTier — la card torna a mostrare un provider solo`);
	}
	if (/SEAL del provider effettivo/.test(src)) {
		guasti.push(
			`${CARD}: il tooltip dice ancora «SEAL del provider effettivo». È il preferito: ` +
				`l'effettivo dipende dalla stanza, ed è l'affermazione che ha generato #306`
		);
	}
}

if (guasti.length) {
	console.error('provider per tier:');
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log('provider per tier: la card dice quale provider in quale stanza ✓');
