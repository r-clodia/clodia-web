#!/usr/bin/env node
// clodia-platform#507: the sidebar shows 10 recent topics, as a named
// constant; the list scrolls inside its own section, and the topics' signals
// stay one request.
import { readFileSync } from 'node:fs';

const fail = (m) => { console.error('check-recent-topics-limit: ' + m); process.exit(1); };
const side = readFileSync('src/lib/components/Sidebar.svelte', 'utf8');
const client = readFileSync('src/lib/api/client.ts', 'utf8');

if (!/const RECENT_TOPICS_LIMIT = 10;/.test(side)) fail('RECENT_TOPICS_LIMIT = 10 is not declared');
if (!/\.slice\(0, RECENT_TOPICS_LIMIT\)/.test(side)) fail('the list is not cut at RECENT_TOPICS_LIMIT');
if (/\.slice\(0, 5\)/.test(side)) fail('a literal 5 is still cutting the list');
const css = side.match(/\.recent-list \{([^}]*)\}/);
if (!css || !/max-height:/.test(css[1]) || !/overflow-y: auto/.test(css[1])) fail('.recent-list must scroll inside its section (max-height + overflow-y: auto)');
if (!/refreshSignals\(recentTopics\.map\(/.test(side)) fail('the signals are not refreshed for the shown topics in one call');
if (!/\/api\/topics\/signals\?topics=\$\{q\}/.test(client)) fail('getTopicSignals is no longer a single request');

console.log('recent topics: 10, named constant, scrolling section, one signals request ✓');
