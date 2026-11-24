#!/usr/bin/env node
// clodia-platform#738: the deterministic processes — courier, topic indexer,
// logic jobs such as the backup — are visible in Jobs and in Activity. The
// derivations are EXECUTED; the pages are checked by text.
import { readFileSync } from 'node:fs';
import { sortProcesses, countersText, cadence, PROCESS_STATUS_LABEL } from '../src/lib/processes.js';

const fail = (m) => { console.error('check-processes-panel: ' + m); process.exit(1); };
const row = (name, status, extra = {}) => ({ name, label: name, status, source: 'loop', ...extra });
const sorted = sortProcesses([row('b', 'idle'), row('a', 'disabled'), row('c', 'failed'), row('d', 'running')]);
if (sorted.map((r) => r.name).join() !== 'c,d,b,a') fail('failed first, then running, ok, off');
if (countersText({ delivered: 3, fetched: 2 }) !== '3 consegnate · 2 scaricate') fail('counters in words');
if (cadence(row('x', 'idle', { interval_s: 120 })) !== 'ogni 2m') fail('loop cadence');
if (cadence(row('y', 'idle', { source: 'job', cron: '0 3 * * *' })) !== 'cron 0 3 * * *') fail('job cadence is its cron');
for (const s of ['running', 'idle', 'failed', 'disabled']) if (!PROCESS_STATUS_LABEL[s]) fail(`a label for ${s}`);

const panel = readFileSync('src/lib/components/ProcessesPanel.svelte', 'utf8');
if (!/getProcesses\(\)/.test(panel)) fail('the data comes from /api/processes');
if (!/e\.status === 403/.test(panel)) fail('a non-admin (403) does not see the panel, and no error either');
if (!/runProcess\(p\.name\)/.test(panel)) fail('«Esegui ora» for loop processes');
if (!/\/jobs\/\$\{p\.job_id\}/.test(panel)) fail('a logic job links to its job page');

const act = readFileSync('src/routes/activity/+page.svelte', 'utf8');
const live = act.indexOf('<h2>Spawn live</h2>'), proc = act.indexOf('<ProcessesPanel variant="activity"'), use = act.indexOf('<h2>Consumo per topic</h2>');
if (!(live >= 0 && proc > live && use > proc)) fail('Activity: «Processi» right after «Spawn live»');
const jobs = readFileSync('src/routes/jobs/+page.svelte', 'utf8');
if (!/<ProcessesPanel variant="jobs" \/>/.test(jobs)) fail('Jobs: the processes panel');

console.log('processes: courier, indexer and logic jobs in Jobs and Activity ✓');
