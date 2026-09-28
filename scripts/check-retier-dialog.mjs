#!/usr/bin/env node
/**
 * Riclassificazione del livello di un topic (clodia-platform#426): chi conferma
 * se ne assume la responsabilità.
 *
 * Il dialog non deve poter inviare senza motivazione né senza la spunta, e il
 * client deve dichiarare la presa di responsabilità al server (che la esige).
 * Il comando compare solo a owner e admin. Controllo sul TESTO dei file.
 */
import { leggiSorgente } from './lib/sorgente.mjs';

const guasti = [];
const dialog = leggiSorgente('src/lib/components/RetierDialog.svelte', guasti);
const client = leggiSorgente('src/lib/api/client.ts', guasti);
const pagina = leggiSorgente('src/routes/topics/[tier]/[name]/+page.svelte', guasti);
if (dialog) {
	if (!/pronto\s*=.*reason\.trim\(\)\.length > 0 && accept/.test(dialog)) {
		guasti.push('RetierDialog: il pulsante deve richiedere motivazione e spunta di responsabilità');
	}
	if (!dialog.includes('non vengono modificati')) {
		guasti.push("RetierDialog: deve dire che egress/ingress non cambiano");
	}
}
if (client && !client.includes('accept_responsibility: true')) {
	guasti.push('client.setTopicTier: deve dichiarare accept_responsibility al server');
}
if (pagina && !pagina.includes('{#if isOwner || $isAdmin}')) {
	guasti.push('pagina topic: il comando di riclassificazione è per owner o admin');
}
if (guasti.length) {
	console.error('check-retier-dialog:\n  ' + guasti.join('\n  '));
	process.exit(1);
}
console.log('check-retier-dialog: ok');
