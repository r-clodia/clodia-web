// The helpdesk widget shows only the conversation after the last context
// reset; the topic page reads the same marker through the same helper.
import { readFileSync } from 'node:fs';

const fail = (m) => { console.error(`check-widget-since-reset: ${m}`); process.exit(1); };
const widget = readFileSync('src/lib/components/ChatWidget.svelte', 'utf8');
const page = readFileSync('src/routes/topics/[tier]/[name]/+page.svelte', 'utf8');
const helper = readFileSync('src/lib/contextReset.ts', 'utf8');

if (!helper.includes("'__CLODIA_CONTEXT_RESET__'")) fail('the marker is not defined in $lib/contextReset');
if (!/sinceLastReset\(messages\)/.test(widget)) fail('the widget does not derive its view from the last reset');
if (/\$:\s*shown\s*=\s*messages\.slice/.test(widget)) fail('the widget still shows the whole history');
if (!widget.includes('Nuova conversazione: azzera il contesto e svuota la chat del widget (i messaggi restano nella DM)'))
	fail('the ⟳ button does not say what it does');
if (!/current\.reset\s*\?/.test(widget)) fail('no «Nuova conversazione» empty state after a reset');
if (!page.includes('sinceLastReset(')) fail('the topic page does not use the shared helper');
if (page.includes("m.text === '__CLODIA_CONTEXT_RESET__'")) fail('the topic page keeps its own copy of the marker test');
console.log('check-widget-since-reset: ok');
