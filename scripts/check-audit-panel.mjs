#!/usr/bin/env node
/**
 * The audit-trail panel (clodia-platform#447) is for admins, and its export is
 * a real authenticated download.
 *
 * - Settings shows it only under `$isAdmin`: the backend refuses non-admins,
 *   and a panel that always fails for them is noise that teaches people to
 *   ignore the panel.
 * - The export goes through `fetch` with `authHeaders()`: an `<a href>` to the
 *   export route would arrive anonymous and get a 401 (the same trap as
 *   check-download-firmato, clodia-platform#323).
 * - The panel says when there is NO off-system copy of the checkpoints, in
 *   words: a trail without it looks healthy while a cut tail would go unseen.
 * Checked on the TEXT of the files.
 */
import { leggiSorgente } from './lib/sorgente.mjs';

const guasti = [];
const pagina = leggiSorgente('src/routes/settings/+page.svelte', guasti);
const panel = leggiSorgente('src/lib/components/AuditTrailPanel.svelte', guasti);
const client = leggiSorgente('src/lib/api/client.ts', guasti);
if (pagina && !/\{#if \$isAdmin\}\s*(<!--[^>]*-->\s*)?<AuditTrailPanel \/>/.test(pagina)) {
	guasti.push('settings: AuditTrailPanel va mostrato solo sotto {#if $isAdmin}');
}
if (client) {
	const i = client.indexOf('export async function downloadAuditExport');
	const body = i >= 0 ? client.slice(i, i + 900) : '';
	if (!body.includes('authHeaders()') || !body.includes("method: 'POST'")) {
		guasti.push('client.downloadAuditExport: deve essere una POST con authHeaders()');
	}
}
if (panel) {
	if (/<a[^>]+href=[^>]*audit/.test(panel)) {
		guasti.push('AuditTrailPanel: niente <a href> verso l’export (arriverebbe anonimo)');
	}
	if (!panel.includes('un taglio della coda non sarebbe rilevabile')) {
		guasti.push('AuditTrailPanel: deve dire quando manca la copia fuori sistema dei checkpoint');
	}
}
if (guasti.length) {
	console.error('check-audit-panel: ' + guasti.length + ' guasti\n  - ' + guasti.join('\n  - '));
	process.exit(1);
}
console.log('check-audit-panel: ok');
