#!/usr/bin/env node
/**
 * A schermo si legge il numero di SPAWN, non l'ordinale di canale.
 *
 * Requisito di Davide: ogni spawn ha un progressivo per seed (`clodia-124`,
 * persistito e mai riusato) e va mostrato sempre. `#N` è un'altra cosa —
 * relativo al canale, capped a `max_spawns`, riusato appena il reaper evince
 * un'istanza — quindi mostrarlo al posto dell'altro significa mostrare un numero
 * che non identifica nulla.
 *
 * Il `chat_id` porta `#N` (`chan:tier:topic:seed#2`), quindi ricavare l'etichetta
 * tagliandone la coda è la strada sbagliata che sembra giusta: compila, funziona,
 * e mostra il numero relativo. Il nome vero arriva dall'evento `spawn_label`.
 *
 * Perché un controllo: questa regressione è già passata una volta, ed è passata
 * PROPRIO perché nessun controllo nominava il requisito. Il test che c'era
 * esercitava l'etichetta su un oggetto finto che rispettava il contratto, mentre
 * l'oggetto vero non lo rispettava — verde su un requisito inerte.
 */
import { readFileSync } from 'node:fs';

const PAGINA = 'src/routes/topics/[tier]/[name]/+page.svelte';
const AGENTS = 'src/lib/agents.ts';
const guasti = [];

function leggi(file) {
	try {
		return readFileSync(file, 'utf8');
	} catch {
		guasti.push(`${file}: file assente — spostato o rinominato`);
		return null;
	}
}

const pagina = leggi(PAGINA);
if (pagina) {
	if (!/'spawn_label'/.test(pagina)) {
		guasti.push(
			`${PAGINA}: l'evento spawn_label non è gestito — i box live tornerebbero ` +
				`a etichettarsi con l'ordinale di canale ricavato dal chat_id`
		);
	}
	if (!/spawnByChat/.test(pagina)) {
		guasti.push(`${PAGINA}: manca la mappa chat_id → nome dello spawn`);
	}
	// La coda del chat_id resta lecita SOLO come fallback: se è l'unica cosa che
	// decide l'etichetta, il numero mostrato è quello relativo.
	const fn = pagina.match(/function agentFromChatId[\s\S]{0,400}?\n\t\}/);
	if (!fn) {
		guasti.push(`${PAGINA}: non trovo agentFromChatId — se è stata riscritta, riscrivi anche questo controllo`);
	} else if (!/spawnByChat/.test(fn[0])) {
		guasti.push(
			`${PAGINA}: agentFromChatId non consulta spawnByChat: l'etichetta live ` +
				`viene dal chat_id, cioè dall'ordinale di canale`
		);
	}
}

const agents = leggi(AGENTS);
if (agents) {
	if (!/setKnownSeeds/.test(agents)) {
		guasti.push(`${AGENTS}: manca setKnownSeeds — senza i seed noti, seedName non può tagliare nome-N`);
	}
	// Deve capire ENTRAMBE le forme: `-N` è quella mostrata, `#N` sta scritta nei
	// messaggi già inviati e nella memoria degli agenti.
	if (!/#\\d\+\$/.test(agents) && !/#\\d\+/.test(agents)) {
		guasti.push(`${AGENTS}: seedName non riconosce più la forma storica #N`);
	}
	if (!/-\\d\+\$/.test(agents)) {
		guasti.push(
			`${AGENTS}: seedName non riconosce nome-N: l'autore di un messaggio ` +
				`(clodia-124) non risolverebbe più al suo seed, e il badge e la pfp ` +
				`dell'istanza sparirebbero`
		);
	}
}

if (guasti.length) {
	console.error('etichetta dello spawn (progressivo per seed):');
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log('etichetta dello spawn: numero assoluto a schermo, forma storica capita ✓');
