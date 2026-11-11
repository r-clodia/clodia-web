#!/usr/bin/env node
/**
 * A link the owner posts offers «＋ Fonte» unless the room already covers it
 * (clodia-platform#663). Runs `fontiDaProporre` on the cases that matter and
 * checks that the topic page wires it under the viewer's own messages.
 *
 *     node scripts/check-link-fonte.mjs
 */
import { readFileSync } from 'node:fs';
import { fontiDaProporre } from '../src/lib/fonti.js';

const guasti = [];
const siti = (t, f, own) => fontiDaProporre(t, f, own).map((x) => x.sito).join(' ');
function atteso(nome, got, want) {
	if (got !== want) guasti.push(`${nome}: «${got}» invece di «${want}»`);
}

atteso('link nudo → il suo sito', siti('guarda https://www.NTSB.gov/investigations/x.', []), 'https://www.ntsb.gov/');
atteso('due link stesso sito → uno', siti('https://a.it/1 e https://a.it/2', []), 'https://a.it/');
atteso('due siti, in ordine', siti('https://b.it/x poi (vedi https://a.it/y)', []), 'https://b.it/ https://a.it/');
atteso('già fra le fonti (sito)', siti('https://a.it/p/q', ['https://a.it/']), '');
atteso('già fra le fonti (percorso)', siti('https://github.com/o/repo/tree/main', ['https://github.com/o/repo']), '');
atteso('prefisso NON sul confine', siti('https://github.com/o/repo-fork', ['https://github.com/o/repo']), 'https://github.com/');
atteso('web aperto copre https', siti('https://a.it/', ['https:*']), '');
atteso('web aperto non copre http', siti('http://a.it/', ['https:*']), 'http://a.it/');
atteso('host interni esclusi', siti('http://localhost:7843/topics/x http://192.168.1.4/ https://web.host.it/t', [], 'web.host.it:8443'), '');
atteso('niente altri schemi', siti('javascript:alert(1) ftp://a.it mailto:x@y.it', []), '');
atteso('markdown [t](url)', siti('[qui](https://a.it/doc)', []), 'https://a.it/');
atteso('testo senza link', siti('nessun link qui', []), '');

const PAGINA = 'src/routes/topics/[tier]/[name]/+page.svelte';
const src = readFileSync(PAGINA, 'utf8');
for (const [ago, cosa] of [
	['fontiDaProporre', 'il calcolo dei link da proporre'],
	['m.author === me', 'solo sotto i messaggi di chi guarda'],
	["editTopicEgressScope(tier, name, 'ingress', 'allow'", 'l\'aggiunta fra le Fonti della stanza']
]) {
	if (!src.includes(ago)) guasti.push(`${PAGINA}: manca «${ago}» — ${cosa}`);
}

if (guasti.length) {
	console.error('link in chat → Fonti:');
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log('link in chat → «＋ Fonte» solo dove la stanza non lo copre già ✓');
