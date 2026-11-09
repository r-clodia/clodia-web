#!/usr/bin/env node
/**
 * The agent profile must not show a shell guard the runtime does not enforce
 * as if it were in force.
 *
 * clodia-platform#296, narrowed by #656. Of the seed sandbox only the shell
 * guards are left — `allow_shell_cmds` and `deny_shell_patterns` — shown in one
 * compact «Shell» line. `allow_shell_cmds` is enforced only by the claude
 * runtime; opencode also applies `deny_shell_patterns`; codex neither. The
 * server says which fields are not enforced (`sandbox_info.unenforced`, by
 * NAME); the page has to read it and mark each printed field on its own.
 *
 * Formerly `check-sandbox-unenforced-visible.mjs`: the path fields
 * (`allow_read`/`deny_read`/`allow_write`) and their section are gone, and
 * `check-profile-no-seed-verbs-sandbox.mjs` guards that they stay gone.
 *
 * DECLARED LIMIT: it reads the component TEXT, not the rendered DOM. It covers
 * the literal regression, not every way of being silent.
 */
import { leggiSorgente, senzaCommenti } from './lib/sorgente.mjs';

const PAGE = 'src/routes/agents/[name]/+page.svelte';
const TYPES = 'src/lib/api/types.ts';
const FIELDS = ['allow_shell_cmds', 'deny_shell_patterns'];

const failures = [];

const raw = leggiSorgente(PAGE, failures, 'agent profile');
if (raw !== null) {
	const page = senzaCommenti(raw);
	// 1. The server's answer must be READ.
	if (!/agent\?\.sandbox_info\?\.unenforced/.test(page)) {
		failures.push(`${PAGE}: the page does not read \`sandbox_info.unenforced\``);
	}
	// 2. The compact «Shell» line exists.
	if (!/<dt>Shell<\/dt>/.test(page)) {
		failures.push(`${PAGE}: no «Shell» line — the shell guards are no longer shown`);
	}
	// 3. Each field is printed AND marked on its own when not enforced.
	for (const field of FIELDS) {
		if (!page.includes(`agent.sandbox?.${field}`) && !page.includes(`agent.sandbox.${field}`)) {
			failures.push(`${PAGE}: \`${field}\` is not printed in the «Shell» line`);
			continue;
		}
		if (!page.includes(`shellOff.includes('${field}')`)) {
			failures.push(
				`${PAGE}: \`${field}\` is printed but not marked when the runtime does not ` +
					'enforce it — it reads as a restriction in force');
		}
	}
	// 4. The mark NAMES the runtime.
	if (!/non applicato da \{agent\.agent_sdk\}/.test(page)) {
		failures.push(`${PAGE}: the mark does not name the runtime (\`agent_sdk\`)`);
	}
}

const types = leggiSorgente(TYPES, failures, 'agents payload types');
if (types !== null && !/\bsandbox_info\?:/.test(types)) {
	failures.push(`${TYPES}: \`sandbox_info\` of the agents payload is not typed`);
}

if (failures.length) {
	console.error('shell guards declared and not enforced, shown as if they counted:');
	for (const f of failures) console.error(`  - ${f}`);
	process.exit(1);
}
console.log('agent profile: «Shell» line shown, unenforced fields marked ✓');
