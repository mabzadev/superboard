import { readdir, readFile } from 'node:fs/promises';
import { extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const sourceRoots = [
  'apps/dashboard/src/app',
  'apps/dashboard/src/components',
  'docs',
  'sdks/flutterflow/lib',
  'sdks/flutterflow_messaging/lib',
  'workers/api/src',
  'workers/growth/src',
  'workers/messaging/src',
];
const extensions = new Set(['.dart', '.js', '.jsx', '.md', '.ts', '.tsx']);
const ignoredSegments = new Set(['.dart_tool', '.next', '.open-next', 'build', 'node_modules']);
const frenchDiacritics = /[àâäçéèêëîïôöùûüÿœæ]/iu;
const frenchProductTerms = /\b(ajouter|annuler|chargement|continuer|enregistrer|erreur|fermer|mots-clés|ouvrir|remboursement|supprimer)\b/iu;
const deploymentBrand = /\bvoco\s*star\b/iu;
const violations = [];

for (const sourceRoot of sourceRoots) {
  for (const file of await files(resolve(root, sourceRoot))) {
    if (!extensions.has(extname(file)) || /(?:^|\.)((?:test|spec))\.[^.]+$/u.test(file)) continue;
    const lines = (await readFile(file, 'utf8')).split(/\r?\n/u);
    for (const [index, line] of lines.entries()) {
      const visibleCandidate = stripTechnicalReferences(line);
      if (deploymentBrand.test(visibleCandidate)) {
        violations.push(issue(file, index, 'deployment-specific branding'));
      }
      if (frenchDiacritics.test(line) || frenchProductTerms.test(line)) {
        violations.push(issue(file, index, 'non-English product copy'));
      }
    }
  }
}

if (violations.length) {
  console.error('Product copy policy failed. User-facing copy must be neutral English.');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log('Product copy policy passed.');

async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignoredSegments.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}

function stripTechnicalReferences(line) {
  return line
    .replace(/https?:\/\/[^\s'"`)>]+/giu, '')
    .replace(/[\w.+-]+@[\w.-]+/giu, '')
    .replace(/\b[\w.-]*vocostar\.(?:com|workers\.dev)\b/giu, '')
    .replace(/\b[\w.]*[-_][\w.-]*vocostar[\w.-]*\b/giu, '')
    .replace(/\b[\w.-]*vocostar[\w.-]*[-_][\w.-]*\b/giu, '')
    .replace(/--target\s+vocostar\b/giu, '')
    .replace(/deploy\/targets\/vocostar\.json\b/giu, '')
    .replace(/application:\s*\{\s*uid:\s*['"]vocostar['"]\s*\}/giu, '');
}

function issue(file, index, reason) {
  return `${relative(root, file)}:${index + 1}: ${reason}`;
}
