// #709: the topic's code-name is its title (the long title only on hover), no
// separate description line, and one «Connetti» popup with the room's MCPs and
// its data imports — the sidebar's own components.
import { readFileSync } from 'node:fs';

const page = readFileSync('src/routes/topics/[tier]/[name]/+page.svelte', 'utf8');
const list = readFileSync('src/routes/topics/+page.svelte', 'utf8');
const fail = (m) => { console.error('check-topic-title-connect: ' + m); process.exit(1); };

if (!/<h1 title=\{info\?\.meta\?\.title \|\| name\}[^>]*>#\{name\}<\/h1>/.test(page))
	fail('topic page: the h1 must show #{name} with the long title in title=');
if (page.includes('#{info?.meta?.title || name}'))
	fail('topic page: the long title is shown as heading again');
if (!/<span class="topic-title" title=\{t\.title \|\| t\.name\}[\s\S]*?>\{t\.name\}<\/span>/.test(list))
	fail('/topics: the card title must be {t.name} with the long title in title=');
if (list.includes('<code class="topic-name">'))
	fail('/topics: the second line with the code-name came back');
if (!/class="connect-btn"[\s\S]{0,200}🔌/.test(page) || !page.includes("apriComando('connect')"))
	fail('topic page: the 🔌 Connetti button is missing');
const pop = page.slice(page.indexOf("comandoAperto === 'connect'"));
if (!pop.includes('{@render corpo_tools(false)}') || !pop.includes('{@render corpo_data()}'))
	fail('the Connetti popup must render both the tools and the data panels');
console.log('check-topic-title-connect: ok');
