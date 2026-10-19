// #575 — testing an MCP backend opens a dialog with its verbs.
// Static checks: the dialog exists, opens from the test result, and renders
// the backend's descriptions as text only (third-party content, no {@html}).
import { readFileSync } from 'node:fs';

const dialog = readFileSync('src/lib/components/McpVerbsDialog.svelte', 'utf8');
const page = readFileSync('src/routes/tools/+page.svelte', 'utf8');
const client = readFileSync('src/lib/api/client.ts', 'utf8');
const fail = (m) => { console.error('check-mcp-test-verbs: ' + m); process.exit(1); };

if (dialog.includes('{@html')) fail('the dialog must not render backend text as HTML');
if (!/v\.enabled/.test(dialog) || !/v\.reason/.test(dialog)) fail('enabled/reason not shown');
if (!/<McpVerbsDialog\b/.test(page)) fail('the Tools page does not mount the dialog');
if (!/r\.verbs/.test(page) || !/verbsOpen = true/.test(page)) fail('a test result with verbs does not open the dialog');
if (!/verbs\?: McpTestVerb\[\]/.test(client)) fail('testConnector does not type `verbs`');
console.log('mcp test verbs: dialog from the test result, plain-text descriptions ✓');
