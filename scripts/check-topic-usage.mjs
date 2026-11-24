#!/usr/bin/env node
// clodia-platform#732: the Activity page shows time or tokens spent per topic
// over 24h, 7d and 4w, in a section between «Spawn live» and the agent seed
// leaderboard. The derivations are EXECUTED; the page is checked by text.
import { readFileSync } from 'node:fs';
import { usageRows, fmtDuration } from '../src/lib/topicUsage.js';

const fail = (m) => { console.error('check-topic-usage: ' + m); process.exit(1); };
const b = (runs, seconds, tin, tout) => ({ runs, seconds, tokens_in: tin, tokens_out: tout });
const topics = [
	{ tier: 'SEAL-1', name: 'lungo', windows: { '24h': b(1, 3600, 10, 10), '7d': b(2, 4000, 10, 10), '4w': b(2, 4000, 10, 10) } },
	{ tier: 'SEAL-1', name: 'verboso', windows: { '24h': b(3, 60, 9000, 1000), '7d': b(3, 60, 9000, 1000), '4w': b(3, 60, 9000, 1000) } },
	{ tier: 'SEAL-2', name: 'vecchio', windows: { '24h': b(0, 0, 0, 0), '7d': b(0, 0, 0, 0), '4w': b(5, 900, 50, 50) } },
];
if (usageRows(topics, '24h', 'tempo').map((r) => r.name).join() !== 'lungo,verboso') fail('by time: the longest first, idle topics out');
if (usageRows(topics, '24h', 'token').map((r) => r.name).join() !== 'verboso,lungo') fail('by tokens: in + out');
if (usageRows(topics, '4w', 'tempo').length !== 3) fail('4w must include the older topic');
if (fmtDuration(5400) !== '1h 30m' || fmtDuration(95) !== '1m 35s' || fmtDuration(40) !== '40s') fail('duration format');

const page = readFileSync('src/routes/activity/+page.svelte', 'utf8');
const live = page.indexOf('<h2>Spawn live</h2>'), use = page.indexOf('<h2>Consumo per topic</h2>'), lead = page.indexOf('<h2>Agent seed leaderboard</h2>');
if (!(live >= 0 && use > live && lead > use)) fail('the section must sit between «Spawn live» and «Agent seed leaderboard»');
if (!/USAGE_WINDOWS = \['24h', '7d', '4w'\]/.test(page)) fail('periods 24h, 7d, 4w');
if (!/usageMeasure === 'tempo'/.test(page) || !/usageMeasure === 'token'/.test(page)) fail('a time / tokens switch');
if (!/getTopicUsage\(\)/.test(page)) fail('the data comes from /api/agents/activity/topics');

console.log('topic usage: 24h/7d/4w, time or tokens, between Spawn live and the leaderboard ✓');
