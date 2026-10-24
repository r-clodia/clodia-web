#!/usr/bin/env node
/**
 * «Questa stanza non ha un coordinatore» (clodia-platform#607, coda webui).
 *
 * Il difetto che questa guard ferma è il caso FALSO POSITIVO, non quello vero:
 * un `{#if !info?.coordinator?.available}` scritto a mano è verde, compila, e
 * accende l'avviso su OGNI stanza quando l'agent-server non manda ancora il
 * campo — cioè esattamente durante un deploy disallineato, quando nessuno
 * saprebbe distinguere l'allarme dal rumore. «Non so» e «non c'è» sono due
 * cose diverse e devono restarlo.
 *
 *     node scripts/check-coordinator-banner.mjs
 */
import { leggiSorgente, senzaCommenti } from './lib/sorgente.mjs';

const guasti = [];

let bannerCoordinatore, segmenti;
try {
	({ bannerCoordinatore, segmenti } = await import('../src/lib/coordinatore.js'));
} catch (e) {
	guasti.push(`src/lib/coordinatore.js non si importa (${e && e.message})`);
}
if (typeof bannerCoordinatore !== 'function') {
	guasti.push('src/lib/coordinatore.js non esporta bannerCoordinatore');
}

if (typeof bannerCoordinatore === 'function') {
	const casi = [
		['campo assente (agent-server precedente): NON si allarma', undefined, false],
		['campo nullo: NON si allarma', null, false],
		['payload malformato: NON si allarma', 'boh', false],
		['campo vuoto, `available` mai scritto: NON si allarma', {}, false],
		[
			'coordinatore presente e idoneo: nessun banner',
			{ name: 'segretario', available: true, reason: null },
			false
		],
		[
			'IL CASO SEGNALATO: nessun provider al tier → banner',
			{ name: null, available: false, reason: 'nessun provider con SEAL ≥ SEAL-3 per **segretario**' },
			true
		],
		[
			'available falso SENZA motivo: il banner c\'è lo stesso',
			{ name: null, available: false, reason: null },
			true
		],
		[
			'motivo vuoto: il banner c\'è lo stesso, con una frase di riserva',
			{ name: null, available: false, reason: '   ' },
			true
		]
	];
	for (const [nome, campo, atteso] of casi) {
		const b = bannerCoordinatore(campo);
		const ok = !!b === atteso;
		if (!ok) guasti.push(`${nome}: banner ${b ? 'mostrato' : 'assente'}`);
		// Un banner senza niente da leggere è un rettangolo giallo muto.
		if (b && (!b.titolo || !b.segmenti?.length)) {
			guasti.push(`${nome}: il banner non ha testo`);
		}
		console.log(`${ok ? 'ok  ' : 'KO  '} ${nome}`);
	}

	// L'invariante, detta a voce alta: il banner nasce SOLO da `available ===
	// false`. Qualunque altro valore è «non so», e non si allarma la stanza
	// per un campo che nessuno ha scritto.
	for (const v of [undefined, null, true, 0, '', 'false']) {
		if (bannerCoordinatore({ available: v })) {
			guasti.push(`available=${JSON.stringify(v)} accende l'avviso: solo \`false\` deve accenderlo`);
		}
	}
}

if (typeof segmenti === 'function') {
	// Il motivo arriva col grassetto Markdown attorno al nome: va reso come
	// testo + <strong>, non passato a un renderer HTML per due asterischi.
	const s = segmenti('nessun provider per **segretario**: stanza ferma.');
	const forti = s.filter((x) => x.forte).map((x) => x.testo);
	if (JSON.stringify(forti) !== JSON.stringify(['segretario'])) {
		guasti.push(`il grassetto del motivo non viene estratto (${JSON.stringify(forti)})`);
	}
	if (s.map((x) => x.testo).join('').includes('*')) {
		guasti.push('gli asterischi del Markdown finiscono a schermo');
	}
	if (segmenti('senza grassetto').some((x) => x.forte)) {
		guasti.push('un testo senza grassetto produce segmenti forti');
	}
}

// --------------------------------------------------------------- la pagina

const PAGINA = 'src/routes/topics/[tier]/[name]/+page.svelte';
const src = leggiSorgente(PAGINA, guasti, 'banner «stanza senza coordinatore»');
if (src !== null) {
	const codice = senzaCommenti(src);
	if (!/bannerCoordinatore\s*\(/.test(codice)) {
		guasti.push(
			`${PAGINA}: il banner non passa da bannerCoordinatore(): un {#if} scritto a mano ` +
				"accende l'avviso su ogni stanza quando il campo non arriva"
		);
	}
	if (!/class="coord-warn"/.test(codice)) {
		guasti.push(`${PAGINA}: il banner non è renderizzato`);
	}
	// `{@html}` qui significherebbe passare al browser una frase composta dal
	// server per rendere due asterischi: non serve, e apre una superficie.
	if (/coord-warn[\s\S]{0,400}\{@html/.test(codice)) {
		guasti.push(`${PAGINA}: il motivo del banner è reso come HTML`);
	}
}

const CLIENT = 'src/lib/api/client.ts';
const client = leggiSorgente(CLIENT, guasti, 'tipo del campo coordinator');
if (client !== null && !/coordinator\?:/.test(senzaCommenti(client))) {
	guasti.push(`${CLIENT}: il payload del canale non dichiara \`coordinator\` come OPZIONALE`);
}

if (guasti.length) {
	console.error('\ncheck-coordinator-banner: ' + guasti.length + ' problemi');
	for (const g of guasti) console.error(' - ' + g);
	process.exit(1);
}
console.log('coordinatore: «non so» ≠ «non c\'è», banner solo su available:false ✓');
