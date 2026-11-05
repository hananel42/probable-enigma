import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const warnings = [];
const report = (message) => failures.push(message);

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

const markdownFiles = (await walk(root)).filter(file => file.endsWith('.md') && !file.includes(`${path.sep}node_modules${path.sep}`));
const markdownSet = new Set(markdownFiles.map(file => path.resolve(file)));
const contentByFile = new Map();
for (const file of markdownFiles) contentByFile.set(file, await readFile(file, 'utf8'));

// Verify relative Markdown destinations and local anchors without needing network access.
for (const [file, content] of contentByFile) {
  const linkPattern = /!?\[[^\]]*\]\(([^)]+)\)/g;
  for (const match of content.matchAll(linkPattern)) {
    const rawTarget = match[1].trim().replace(/^<|>$/g, '');
    if (!rawTarget || /^(?:[a-z]+:|\/\/|#)/i.test(rawTarget)) continue;
    const [pathname, fragment = ''] = rawTarget.split('#', 2);
    const cleanPath = pathname.split('?')[0];
    const target = path.resolve(path.dirname(file), cleanPath || path.basename(file));
    let targetExists = false;
    try { targetExists = (await stat(target)).isFile() || (await stat(target)).isDirectory(); } catch { /* checked below */ }
    if (!targetExists) {
      report(`${path.relative(root, file)}: broken Markdown link '${rawTarget}'`);
      continue;
    }
    if (fragment && targetExists && markdownSet.has(target)) {
      const targetText = contentByFile.get(target) ?? '';
      const anchor = decodeURIComponent(fragment).toLowerCase();
      const headings = [...targetText.matchAll(/^#{1,6}\s+(.+)$/gm)].map(item => item[1]
        .toLowerCase().replace(/[`*_~]/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-'));
      if (!headings.includes(anchor)) warnings.push(`${path.relative(root, file)}: verify heading anchor '#${fragment}' in ${path.relative(root, target)}`);
    }
  }
}

const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const version = packageJson.version;
const readme = contentByFile.get(path.join(root, 'README.md')) ?? '';
const docsIndex = contentByFile.get(path.join(root, 'docs', 'README.md')) ?? '';
if (!readme.includes(`Version ${version}`)) report(`README.md does not identify package version ${version}.`);
if (!docsIndex.includes(`release-notes-v${version}.md`)) report(`docs/README.md does not link to release notes for ${version}.`);
if (!docsIndex.includes(`release-validation-v${version}.md`)) report(`docs/README.md does not link to validation for ${version}.`);
for (const releaseFile of [`release-notes-v${version}.md`, `release-validation-v${version}.md`]) {
  try { await stat(path.join(root, 'docs', releaseFile)); }
  catch { report(`Missing current release document: docs/${releaseFile}`); }
}

const skillsRoot = path.join(root, 'skills');
const skills = (await walk(skillsRoot)).filter(file => file.endsWith('SKILL.md'));
const skillsIndexPath = path.join(skillsRoot, 'README.md');
const skillsIndex = await readFile(skillsIndexPath, 'utf8');
for (const skillFile of skills) {
  const relative = path.relative(skillsRoot, skillFile).split(path.sep).join('/');
  const text = await readFile(skillFile, 'utf8');
  const frontMatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontMatter) {
    report(`skills/${relative}: missing YAML front matter.`);
    continue;
  }
  if (!/^name:\s*\S+/m.test(frontMatter[1])) report(`skills/${relative}: missing 'name' front matter.`);
  if (!/^description:\s*\S+/m.test(frontMatter[1])) report(`skills/${relative}: missing 'description' front matter.`);
  if (!skillsIndex.includes(`](${relative})`)) report(`skills/${relative}: not linked from skills/README.md.`);
}
if (!readme.includes('skills/README.md')) report('README.md must link to the skills index.');
const agents = await readFile(path.join(root, 'AGENTS.md'), 'utf8');
if (!agents.includes('skills/README.md')) report('AGENTS.md must route agents to skills/README.md.');
if (!agents.includes('scripts/check-maintenance-docs.mjs')) report('AGENTS.md must explain skills self-maintenance and its checker.');

// These files describe the current runtime, so old transport claims here are likely accidental regressions.
const activeRuntimeDocs = [
  'docs/architecture.md',
  'docs/multiplayer-engine-integration.md',
  'docs/client-server-boundary.md',
  'docs/host-authoritative-multiplayer.md',
  'docs/signaling-and-rooms.md',
  'docs/transport-adapter-contract.md'
];
const staleClaims = [
  /WebRTC is not active in the current release/i,
  /the current SignalingClient implements it using the WebSocket relay/i,
  /the current relay avoids peer-negotiation stalls/i,
  /WebSocket remains the active transport/i
];
for (const relative of activeRuntimeDocs) {
  const text = contentByFile.get(path.join(root, relative));
  if (!text) { report(`Missing active runtime document ${relative}.`); continue; }
  for (const pattern of staleClaims) if (pattern.test(text)) report(`${relative}: stale runtime claim '${pattern.source}'.`);
}

if (failures.length) {
  console.error(`[docs:check] FAILED with ${failures.length} error(s):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`[docs:check] Passed: ${markdownFiles.length} Markdown files, ${skills.length} indexed skill playbooks, version ${version}.`);
  if (warnings.length) console.warn(`[docs:check] ${warnings.length} anchor warning(s):\n${warnings.map(item => `  - ${item}`).join('\n')}`);
}
