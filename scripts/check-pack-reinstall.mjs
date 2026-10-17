#!/usr/bin/env node
/**
 * A removed first-party pack can come back from the Packs view
 * (clodia-platform#562).
 *
 * Only base-pack is non-removable now. A first-party pack's name is reserved
 * against spoofing, so a zip/URL import cannot bring it back: the only way is
 * `GET /clodia/packs/available` + `POST /clodia/packs/{name}/install`. If the
 * view loses either, removing google-pack becomes a one-way trip — and nothing
 * fails: the page builds, the types check, the section just never appears.
 *
 * Required:
 *   1. the client calls both endpoints;
 *   2. the page lists the available packs and offers the install;
 *   3. the removal confirmation of a first-party pack says it can be
 *      reinstalled, and that its connectors close (removing comms-pack stops
 *      Telegram and mail — the owner must read that before confirming).
 */
import { leggiSorgente, senzaCommenti } from './lib/sorgente.mjs';

const SUPERFICIE = 'src/routes/packs/+page.svelte';
const CLIENT = 'src/lib/api/client.ts';

const guasti = [];

const client = leggiSorgente(CLIENT, guasti, 'the backend calls');
if (client) {
	const codice = senzaCommenti(client);
	for (const [s, why] of [
		["'/clodia/packs/available'", 'no call to GET /clodia/packs/available'],
		['/install`', 'no call to POST /clodia/packs/{name}/install']
	]) {
		if (!codice.includes(s)) guasti.push(`${CLIENT}: ${why}`);
	}
}

const pagina = leggiSorgente(SUPERFICIE, guasti, 'the Packs view');
if (pagina) {
	const codice = senzaCommenti(pagina);
	for (const [s, why] of [
		['listAvailablePacks', 'the page never asks which first-party packs are available'],
		['{#each available', 'the available packs are never shown'],
		['apiInstallPack(', 'the page never installs an available pack'],
		['item.first_party', 'the removal confirmation does not tell a first-party pack apart'],
		['reinstallarlo', 'the confirmation does not say the pack can be reinstalled'],
		['connettori del pack si chiudono', 'the confirmation does not say the connectors close'],
		['usedByText(pendingDelete.item)', 'the confirmation does not name the agents that lose skills (`used_by`)']
	]) {
		if (!codice.includes(s)) guasti.push(`${SUPERFICIE}: ${why}`);
	}
}

if (guasti.length) {
	console.error('check-pack-reinstall: FAIL');
	for (const g of guasti) console.error(`  - ${g}`);
	process.exit(1);
}
console.log('check-pack-reinstall: ok');
