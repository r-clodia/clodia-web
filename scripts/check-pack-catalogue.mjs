// clodia-platform#700 — the Packs page shows the catalogue states and a
// visible deprecated tag; a deprecated pack is never offered for install.
import { readFileSync } from 'node:fs';

const page = readFileSync('src/routes/packs/+page.svelte', 'utf8');
const client = readFileSync('src/lib/api/client.ts', 'utf8');
const fail = [];
const need = (cond, msg) => { if (!cond) fail.push(msg); };

need(client.includes("/clodia/packs/catalogue"), 'client reads /clodia/packs/catalogue');
need(client.includes('installFromCatalogue'), 'client installs from the catalogue');
for (const label of ['● installato', '⬆ ', '○ disponibile', '⚠ deprecato', '✕ rimosso dal catalogo']) {
	need(page.includes(label), `page shows the state «${label.trim()}»`);
}
need(/\{#if e\.installable\}[\s\S]{0,200}installCatalogue\(e\)/.test(page),
	'Install appears only for installable catalogue entries (never a deprecated one)');
need(page.includes('dep-note'), 'the deprecation is spelled out under the pack');
need(/removed_from_catalogue[\s\S]{0,300}disinstallalo/.test(page),
	'«Aggiorna tutto» names a pack removed from the catalogue');

if (fail.length) {
	console.error('check-pack-catalogue:\n  - ' + fail.join('\n  - '));
	process.exit(1);
}
console.log('check-pack-catalogue: ok');
