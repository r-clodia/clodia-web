#!/usr/bin/env node
/**
 * The room's orchestrator can be ANY AI participant (clodia-platform#695).
 *
 * Until #695 the «orchestratore» click was shown only next to segretario,
 * clodia and ophelia (`ORCHESTRATOR_SEEDS`). The owner asked that every agent
 * of the room can be chosen: the click depends on the participant's TYPE (an
 * AI agent — not a person, not a proxy), never on a list of names.
 *
 * DECLARED LIMIT: this reads the TEXT of the page, not the rendered DOM.
 */
import { readFileSync } from 'node:fs';

const page = readFileSync('src/routes/topics/[tier]/[name]/+page.svelte', 'utf8');
const errori = [];
const riga = page.split('\n').find((l) => l.includes('$: puoOrchestrare'));
if (!riga) errori.push('`puoOrchestrare` not found in the topic page');
else {
	if (riga.includes('ORCHESTRATOR_SEEDS'))
		errori.push('`puoOrchestrare` reads ORCHESTRATOR_SEEDS: only three seeds can be chosen');
	if (!riga.includes('tipoDi'))
		errori.push('`puoOrchestrare` does not read the participant type (`tipoDi`)');
}
const tipi = page.match(/const TIPI_AI = \[([^\]]*)\]/);
if (!tipi) errori.push('TIPI_AI not found');
else {
	for (const t of ['bot', 'normal', 'super'])
		if (!tipi[1].includes(`'${t}'`)) errori.push(`TIPI_AI lacks '${t}'`);
	for (const t of ['human', 'proxy'])
		if (tipi[1].includes(`'${t}'`)) errori.push(`TIPI_AI includes '${t}': a ${t} cannot orchestrate`);
}
if (errori.length) {
	console.error('check-orchestrator-any-agent:\n  ' + errori.join('\n  '));
	process.exit(1);
}
console.log('Orchestratore: qualunque agente AI della stanza, non tre nomi ✓');
