import { readdir, readFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const root =
	requestedRoot(process.argv.slice(2)) ?? resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceRoots = [
	"apps/site/src",
	"packages/supbrd-front-ui/src",
	"packages/supbrd-runtime-plugins/src/front",
	"sdks/flutterflow/lib",
	"sdks/flutterflow_messaging/lib",
	"sdks/flutter/lib",
	"sdks/flutter/android/src/main",
	"sdks/flutter/ios/Classes",
	"sdks/javascript/src",
	"sdks/android/OpenGrow/OpenGrow/src/main",
	"workers/api/src",
	"workers/billing/src",
	"workers/messaging/src",
];
// Engineering documentation and migration runbooks are intentionally excluded:
// they may be localized and may name the deployment they document. This gate is
// limited to copy that can ship in a product surface or reusable SDK.
const extensions = new Set([
	".dart",
	".html",
	".js",
	".jsx",
	".kt",
	".md",
	".swift",
	".ts",
	".tsx",
	".xml",
]);
const ignoredSegments = new Set([
	".dart_tool",
	".next",
	".open-next",
	"build",
	"node_modules",
	"test",
	"tests",
	"__tests__",
	"runtime-tests",
]);
const frenchDiacritics = /[àâäçéèêëîïôöùûüÿœæ]/iu;
const frenchProductTerms =
	/\b(accueil|achat|achats|ajout|ajouter|annulation|annuler|aucun|bienvenue|chargement|configurer|connexion|continuer|courant|créer|déconnexion|désolé|détails|échoué|enregistrer|erreur|essayer|fermer|gestion|impossible|mots-clés|ouvrir|paiement|profil|remboursement|réponse|réessayer|réussi|sélectionner|supprimer|utilisateur|vérifier|votre|vous)\b/iu;
const deploymentBrand = /\bvoco\s*star\b/iu;
const violations = [];

for (const sourceRoot of sourceRoots) {
	for (const file of await files(resolve(root, sourceRoot))) {
		if (!extensions.has(extname(file)) || /(?:^|\.)((?:test|spec))\.[^.]+$/u.test(file)) continue;
		const source = await readFile(file, "utf8");
		const lines = source.split(/\r?\n/u);
		const untranslatedLines = withoutTranslations(source, file).split(/\r?\n/u);
		for (const [index, line] of lines.entries()) {
			const visibleCandidate = stripTechnicalReferences(line);
			if (deploymentBrand.test(visibleCandidate)) {
				violations.push(issue(file, index, "deployment-specific branding"));
			}
			if (
				frenchDiacritics.test(untranslatedLines[index]) ||
				frenchProductTerms.test(untranslatedLines[index])
			) {
				violations.push(issue(file, index, "non-English product copy"));
			}
		}
	}
}

if (violations.length) {
	console.error(
		"Product copy policy failed. Source copy must be neutral English; translations belong in locale catalogs.",
	);
	for (const violation of violations) console.error(`- ${violation}`);
	process.exit(1);
}

console.log("Product copy policy passed.");

async function files(directory) {
	const result = [];
	let entries;
	try {
		entries = await readdir(directory, { withFileTypes: true });
	} catch (error) {
		if (error.code === "ENOENT") return result;
		throw error;
	}
	for (const entry of entries) {
		if (ignoredSegments.has(entry.name)) continue;
		const path = resolve(directory, entry.name);
		if (entry.isDirectory()) result.push(...(await files(path)));
		else if (entry.isFile()) result.push(path);
	}
	return result;
}

function stripTechnicalReferences(line) {
	return line
		.replace(/https?:\/\/[^\s'"`)>]+/giu, "")
		.replace(/[\w.+-]+@[\w.-]+/giu, "")
		.replace(/\b[\w.-]*vocostar\.(?:com|workers\.dev)\b/giu, "")
		.replace(/\b[\w.]*[-_][\w.-]*vocostar[\w.-]*\b/giu, "")
		.replace(/\b[\w.-]*vocostar[\w.-]*[-_][\w.-]*\b/giu, "")
		.replace(/--target\s+vocostar\b/giu, "")
		.replace(/deploy\/targets\/vocostar\.json\b/giu, "")
		.replace(/application:\s*\{\s*uid:\s*['"]vocostar['"]\s*\}/giu, "");
}

function issue(file, index, reason) {
	return `${relative(root, file)}:${index + 1}: ${reason}`;
}

function withoutTranslations(source, file) {
	if (!/\.[cm]?[jt]sx?$/u.test(file)) return source;
	const syntax = ts.createSourceFile(
		file,
		source,
		ts.ScriptTarget.Latest,
		true,
		file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
	);
	const ranges = [];
	const name = (node) =>
		node?.name && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))
			? node.name.text
			: null;
	const frenchConditions = new Set();
	const isFrenchComparison = (node) =>
		ts.isBinaryExpression(node) &&
		node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
		((ts.isStringLiteral(node.left) && node.left.text === "fr") ||
			(ts.isStringLiteral(node.right) && node.right.text === "fr"));
	function collect(node) {
		if (
			ts.isVariableDeclaration(node) &&
			node.initializer &&
			isFrenchComparison(node.initializer) &&
			name(node)
		)
			frenchConditions.add(name(node));
		ts.forEachChild(node, collect);
	}
	collect(syntax);
	function visit(node) {
		if (
			ts.isPropertyAssignment(node) &&
			name(node) === "fr" &&
			ts.isObjectLiteralExpression(node.parent) &&
			node.parent.properties.some((property) => name(property) === "en")
		)
			ranges.push([node.initializer.getStart(syntax), node.initializer.end]);
		else if (
			ts.isVariableDeclaration(node) &&
			["fr", "frCopy"].includes(name(node)) &&
			node.initializer &&
			ts.isObjectLiteralExpression(node.initializer)
		)
			ranges.push([node.initializer.getStart(syntax), node.initializer.end]);
		else if (
			ts.isConditionalExpression(node) &&
			(isFrenchComparison(node.condition) ||
				(ts.isIdentifier(node.condition) && frenchConditions.has(node.condition.text)))
		) {
			ranges.push([node.whenTrue.getStart(syntax), node.whenTrue.end]);
			visit(node.whenFalse);
		} else if (
			(ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
			/<html\s+lang=["']fr["']/u.test(ts.isTemplateExpression(node) ? node.head.text : node.text)
		)
			ranges.push([node.getStart(syntax), node.end]);
		else ts.forEachChild(node, visit);
	}
	visit(syntax);
	for (const [start, end] of ranges.sort((left, right) => right[0] - left[0]))
		source =
			source.slice(0, start) +
			source.slice(start, end).replace(/[^\r\n]/gu, " ") +
			source.slice(end);
	return source;
}
function requestedRoot(args) {
	if (args.length === 0) return null;
	if (args.length === 2 && args[0] === "--root" && args[1]) return resolve(args[1]);
	throw new Error("Usage: check-product-copy.mjs [--root <workspace>]");
}
