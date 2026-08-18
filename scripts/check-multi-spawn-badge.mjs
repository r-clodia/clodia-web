#!/usr/bin/env node
/**
 * Ogni superficie che elenca un participant/agent rende il badge multi-spawn.
 *
 * Il campo `multi_spawn` viaggiava nel payload `/api/agents` — tipizzato e
 * commentato in `src/lib/api/types.ts`, «la UI lo segnala col simbolo 👯» —
 * mentre la UI lo segnalava in UN posto solo (issue clodia-platform#210). Un
 * participant che risponde come quattro istanze era disegnato esattamente come
 * uno che risponde una volta: il difetto non si vede guardando il codice, si
 * vede solo sapendo che quel campo esiste.
 *
 * Un contratto che non ha un controllo torna a rompersi in silenzio: qui il
 * silenzio è "il badge non c'è", che nessuno segnala come errore.
 *
 * LIMITE DICHIARATO: questo controllo verifica le superfici ELENCATE sotto, non
 * scopre quelle nuove. Un elenco di participant aggiunto domani in un file che
 * non è in questa lista passa verde. Chi aggiunge una superficie aggiunge la
 * riga: è il prezzo di un controllo che non prova a indovinare cos'è un elenco.
 */
import { readFileSync } from 'node:fs';

/** file → cosa elenca (il testo compare nel messaggio d'errore). */
const SUPERFICI = {
	'src/routes/topics/[tier]/[name]/+page.svelte':
		'partecipanti del canale e autore del messaggio',
	'src/routes/topics/+page.svelte': 'partecipanti nella card del topic',
	'src/lib/components/AgentCard.svelte': 'registry agent, vista a card',
	'src/lib/components/AgentTable.svelte': 'registry agent, vista a tabella'
};

const BADGE = 'MultiSpawnBadge';
const guasti = [];

/** Il file, o `null` con il guasto registrato: un ENOENT qui è un esito del
 *  controllo (la superficie non c'è più), non un incidente da stack trace. */
function leggi(file, cosa) {
	try {
		return readFileSync(file, 'utf8');
	} catch {
		guasti.push(`${file}: file assente — spostato, rinominato o mai creato (${cosa})`);
		return null;
	}
}

for (const [file, cosa] of Object.entries(SUPERFICI)) {
	const src = leggi(file, cosa);
	if (src === null) continue;
	if (!src.includes(`${BADGE}.svelte`)) {
		guasti.push(`${file}: non importa ${BADGE} (${cosa})`);
		continue;
	}
	if (!src.includes(`<${BADGE}`)) {
		guasti.push(`${file}: importa ${BADGE} ma non lo rende (${cosa})`);
	}
}

// Il badge deve leggere ENTRAMBI i campi: senza `max_spawns` il tooltip non
// risponde al "fino a quante istanze" che il simbolo solleva.
const badge = leggi(`src/lib/components/${BADGE}.svelte`, 'componente del badge');
if (badge !== null && !badge.includes('maxSpawns')) {
	guasti.push(`${BADGE}.svelte: non espone il cap (max_spawns) nel tooltip`);
}
const tipi = leggi('src/lib/api/types.ts', 'contratto del payload agents');
for (const campo of ['multi_spawn', 'max_spawns']) {
	if (tipi !== null && !tipi.includes(campo)) {
		guasti.push(`src/lib/api/types.ts: il campo ${campo} del payload agents non è tipizzato`);
	}
}

if (guasti.length) {
	console.error('badge multi-spawn (👯) mancante:');
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log(`badge multi-spawn presente in ${Object.keys(SUPERFICI).length} superfici ✓`);
