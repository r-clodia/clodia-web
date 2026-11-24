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
// Since 24 Nov 2026 the 🔌 sits in the chat input's button row, next to ↗
// (owner); it is checked in detail by check-connect-in-composer.mjs.
if (!/class="connect-input"[\s\S]{0,200}🔌/.test(page) || !page.includes("apriComando('connect')"))
	fail('topic page: the 🔌 Connetti button is missing');
// The popup is ONE new component merging the two pickers' elements (owner,
// 21 Nov 2026): not the two sidebar panels, which bring room lists, the index
// switch and the resources along.
const start = page.indexOf("comandoAperto === 'connect'");
const pop = page.slice(start, page.indexOf('{:else', start + 10));
if (!pop.includes('<ConnectPopup')) fail('the Connetti popup must be ConnectPopup');
if (/corpo_tools|corpo_data|TopicToolsPanel|TopicDataPanel/.test(pop))
	fail('the Connetti popup must not embed the sidebar panels');
const comp = readFileSync('src/lib/components/ConnectPopup.svelte', 'utf8');
for (const s of ['setChannelMcp', 'importTopicData',
	'removeTopicData', 'importableEntries', 'type="search"'])
	if (!comp.includes(s)) fail(`ConnectPopup: missing ${s}`);
if (/RoomList|McpResources|setTopicIndex|TopicToolsPanel|TopicDataPanel/.test(comp))
	fail('ConnectPopup must hold only MCPs and data: no room lists, resources or index switch');
// ONE list (owner, 21 Nov 2026): no section headers, the type badge is the
// only distinction, the search matches the type label.
if ((comp.match(/<ul class="rows"/g) || []).length !== 1) fail('ConnectPopup: exactly one list');
if (/<h3>|<section|Dati \(RAG e database\)/.test(comp)) fail('ConnectPopup: no section headers');
if (!/\[\.\.\.mcpRows, \.\.\.dataRows\]/.test(comp)) fail('ConnectPopup: MCPs and data merged in one list');
if (!/kindLabel\(r\)\.toLowerCase\(\)\.includes\(q\)/.test(comp)) fail('ConnectPopup: search by type label');
console.log('check-topic-title-connect: ok');
