#!/usr/bin/env node
/**
 * Il chip della stanza dice provider **e** modello, e li dice insieme.
 *
 * #310 ha portato in chat il provider effettivo per stanza; il modello restava
 * fuori (clodia-platform#315). Provider e modello però non sono due dati
 * indipendenti: il backend sceglie il provider min-cost idoneo al tier e con lui
 * il modello ABBINATO a quello stack. Mostrarli separati inviterebbe a leggerli
 * come due assi liberi — «questo agente usa opus, su qualunque provider» — che è
 * la stessa premessa sbagliata da cui è nata la #306.
 *
 * Perché una guard e non solo i tipi: la parte che si rompe in silenzio non è la
 * forma del dato (quella la vede `svelte-check`), è la REGOLA DI SCRITTURA del
 * chip — degradare a `provider · undefined` quando il modello manca, o stampare
 * l'inference-profile Bedrock per esteso finché il chip non sta più nella riga.
 * Nessuna delle due rompe la compilazione.
 *
 *     node scripts/check-modello-in-stanza.mjs
 */
import { leggiSorgente, senzaCommenti } from './lib/sorgente.mjs';

const guasti = [];

let chipStanza, modelloBreve, titoloChip;
try {
	({ chipStanza, modelloBreve, titoloChip } = await import('../src/lib/modelloInStanza.js'));
} catch (e) {
	guasti.push(`src/lib/modelloInStanza.js non si importa (${e && e.message})`);
}

if (typeof chipStanza === 'function' && typeof modelloBreve === 'function') {
	const casi = [
		[
			'IL CASO: provider e modello, un chip solo',
			() => chipStanza('anthropic-api', 'claude-sonnet-4-5'),
			'anthropic-api · claude-sonnet-4-5'
		],
		[
			"l'inference-profile Bedrock si accorcia",
			() => chipStanza('aws-region-eu', 'eu.anthropic.claude-opus-4-6-v1'),
			'aws-region-eu · claude-opus-4-6'
		],
		[
			'la data del modello non entra nel chip',
			() => modelloBreve('claude-haiku-4-5-20251001'),
			'claude-haiku-4-5'
		],
		[
			'modello ignoto: il chip resta quello di #310, non «· undefined»',
			() => chipStanza('scaleway', null),
			'scaleway'
		],
		['provider ignoto: nessun chip', () => chipStanza(null, 'gpt-5-codex'), ''],
		[
			'modello NON riconosciuto: si mostra com’è, non si inventa',
			() => modelloBreve('mistral-small-3.2-24b-instruct-2506'),
			'mistral-small-3.2-24b-instruct-2506'
		]
	];
	for (const [nome, fn, atteso] of casi) {
		const avuto = fn();
		const ok = avuto === atteso;
		if (!ok) guasti.push(`${nome}: «${avuto}» (atteso «${atteso}»)`);
		console.log(`${ok ? 'ok  ' : 'KO  '} ${nome} → «${avuto}»`);
	}

	// Il chip si accorcia, il tooltip no: chi debugga un turno ha bisogno
	// dell'id ESATTO che è arrivato al provider, ed è l'unico posto che ce l'ha.
	const t =
		typeof titoloChip === 'function'
			? titoloChip('aws-region-eu', 'eu.anthropic.claude-opus-4-6-v1')
			: '';
	if (!t.includes('eu.anthropic.claude-opus-4-6-v1')) {
		guasti.push(
			'il titolo del chip non porta il modello per esteso: accorciato in tutti e due ' +
				'i posti, l’id reale non si legge da nessuna parte'
		);
	}
}

// --- e la chat deve usarlo, in tutti i punti in cui il chip esiste ---------
const PAGINA = 'src/routes/topics/[tier]/[name]/+page.svelte';
const src = leggiSorgente(PAGINA, guasti, 'chip provider · modello');
if (src !== null) {
	const codice = senzaCommenti(src);
	for (const f of ['chipStanza', 'titoloChip']) {
		if (!new RegExp(`${f}\\s*\\(`).test(codice)) {
			guasti.push(`${PAGINA}: non usa ${f} — il chip torna a dire il solo provider`);
		}
	}
	// I tre punti in cui il chip compare: header messaggio, bolla live,
	// pannello Partecipanti. Nessuno dei tre deve stampare il campo `provider`
	// grezzo: quello È il difetto #315, cioè il modello invisibile in chat.
	const chips = [...codice.matchAll(/class="(?:author|part)-provider"([^>]*)>\{([^}]*)\}/g)];
	if (chips.length < 3) {
		guasti.push(
			`${PAGINA}: trovati ${chips.length} chip provider, attesi almeno 3 ` +
				`(header messaggio, bolla live, Partecipanti)`
		);
	}
	for (const [, attributi, testo] of chips) {
		if (/\.provider\b/.test(testo)) {
			guasti.push(`${PAGINA}: un chip stampa «${testo.trim()}»: lì il modello non si vede`);
		}
		// Il tooltip fisso di #310 diceva il solo provider: se resta, il chip
		// mostra una coppia e il titolo ne spiega metà.
		if (/title\s*=\s*"/.test(attributi)) {
			guasti.push(`${PAGINA}: un chip ha un title fisso ${attributi.trim()} invece di titoloChip`);
		}
	}
	if (!/\bmodel\s*:\s*string\s*\|\s*null/.test(codice)) {
		guasti.push(`${PAGINA}: il tipo Elig non porta \`model\` — il campo del backend si perde qui`);
	}
}

const CLIENT = 'src/lib/api/client.ts';
const cli = leggiSorgente(CLIENT, guasti, 'AgentEligibility.model');
if (cli !== null && !/model\s*:\s*string\s*\|\s*null/.test(senzaCommenti(cli))) {
	guasti.push(`${CLIENT}: AgentEligibility non dichiara \`model\``);
}

if (guasti.length) {
	console.error('modello in stanza:');
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log('modello in stanza: il chip dice provider · modello, in ogni stanza ✓');
