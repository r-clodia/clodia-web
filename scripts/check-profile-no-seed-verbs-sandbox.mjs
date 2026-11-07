#!/usr/bin/env node
/**
 * The agent profile renders without the seed «Verbi» block and without the
 * «Sandbox» section (clodia-platform#656).
 *
 * Since #626 seeds carry no verbs, and under A·V·R·Q enforce the gateway does
 * not read them for reachability: a section listing them (or the global
 * tuples «Ovunque / Fuori dalle stanze / Per tutti gli agenti») next to the
 * room's Strumenti tells two stories. The path sandbox
 * (`allow_read`/`deny_read`/`allow_write`) is enforced by one runtime out of
 * three and its relative paths match nothing: the boundary is the runtime uid
 * plus root-700 directories. Both are removed with their data; this guard
 * keeps them from coming back by copy-paste.
 *
 * What stays: a person's «Verbi (matrice)» (the human role matrix, read from
 * the gateway, no `tool_permissions` fallback) and the «Shell» line.
 *
 * DECLARED LIMIT: it reads the source TEXT (comments stripped), not the DOM.
 */
import { leggiSorgente, senzaCommenti } from './lib/sorgente.mjs';

const PAGE = 'src/routes/agents/[name]/+page.svelte';
const TYPES = 'src/lib/api/types.ts';
const CLIENT = 'src/lib/api/client.ts';

const failures = [];

const raw = leggiSorgente(PAGE, failures, 'agent profile');
if (raw !== null) {
	const page = senzaCommenti(raw);
	const forbidden = [
		[/<dt>Sandbox<\/dt>/, 'the «Sandbox» section is back'],
		[/sandboxOff/, '`sandboxOff` is back'],
		[/\b(allow_read|deny_read|allow_write)\b/, 'a path sandbox field is printed'],
		[/tool_permissions/, 'the seed `tool_permissions` is read'],
		[/dichiarati nel seed/, 'the collapsed «dichiarati nel seed» verb list is back'],
		[/Fuori dalle stanze|Per tutti gli agenti/, 'the global authz tuples block is back'],
		[/getAgentAuthz/, '`getAgentAuthz` is called'],
		[/<dt>Verbi<\/dt>/, 'the non-human «Verbi» block is back']
	];
	for (const [re, why] of forbidden) {
		if (re.test(page)) failures.push(`${PAGE}: ${why}`);
	}
	// What must stay.
	if (!/<dt>Verbi \(matrice\)<\/dt>/.test(page)) {
		failures.push(`${PAGE}: the human «Verbi (matrice)» section is gone — it is the role matrix, not seed verbs`);
	}
	if (!/verbs\?\.principal_kind === 'human'/.test(page)) {
		failures.push(`${PAGE}: the role matrix is no longer limited to human principals`);
	}
	if (!/<dt>Shell<\/dt>/.test(page)) {
		failures.push(`${PAGE}: the «Shell» line is missing`);
	}
}

const types = leggiSorgente(TYPES, failures, 'agents payload types');
if (types !== null) {
	const t = senzaCommenti(types);
	for (const [re, why] of [
		[/\bAgentSandbox\b/, '`AgentSandbox` is still declared'],
		[/\b(allow_read|deny_read|allow_write)\??:/, 'a path sandbox field is still typed'],
		[/\btool_permissions\??:/, '`tool_permissions` is still typed']
	]) {
		if (re.test(t)) failures.push(`${TYPES}: ${why}`);
	}
	if (!/\ballow_shell_cmds\??:/.test(t) || !/\bdeny_shell_patterns\??:/.test(t)) {
		failures.push(`${TYPES}: the shell guards are no longer typed`);
	}
}

const client = leggiSorgente(CLIENT, failures, 'API client');
if (client !== null && /\b(getAgentAuthz|AgentAuthz|AuthzTuple)\b/.test(senzaCommenti(client))) {
	failures.push(`${CLIENT}: the authz-tuples client (\`getAgentAuthz\` and types) is still there`);
}

if (failures.length) {
	console.error('agent profile: seed verbs / sandbox residues:');
	for (const f of failures) console.error(`  - ${f}`);
	process.exit(1);
}
console.log('agent profile: no seed verbs, no path sandbox; role matrix and «Shell» line kept ✓');
