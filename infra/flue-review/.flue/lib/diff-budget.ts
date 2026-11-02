const DEFAULT_PER_FILE_BYTES = 48 * 1024;
const DEFAULT_TOTAL_BYTES = 384 * 1024;

export interface DiffBudget {
	readonly perFileBytes?: number;
	readonly totalBytes?: number;
}

interface Section {
	text: string;
	elided: boolean;
}

export function elideLargeDiffSections(diff: string, budget: DiffBudget = {}): string {
	const perFileBytes = budget.perFileBytes ?? DEFAULT_PER_FILE_BYTES;
	const totalBytes = budget.totalBytes ?? DEFAULT_TOTAL_BYTES;
	if (diff.length <= Math.min(perFileBytes, totalBytes)) return diff;

	const sections = splitSections(diff);
	for (const section of sections) {
		if (!section.elided && section.text.length > perFileBytes) elide(section);
	}
	let total = sections.reduce((n, s) => n + s.text.length, 0);
	while (total > totalBytes) {
		const next = sections
			.filter((s) => !s.elided)
			.toSorted((a, b) => b.text.length - a.text.length)[0];
		if (!next) break;
		total -= next.text.length;
		elide(next);
		total += next.text.length;
	}
	return sections.map((s) => s.text).join("");
}

function splitSections(diff: string): Section[] {
	const starts: number[] = [];
	const re = /^diff --git /gm;
	for (let m = re.exec(diff); m; m = re.exec(diff)) starts.push(m.index);
	if (starts.length === 0) return [{ text: diff, elided: false }];
	const sections: Section[] = [];
	if (starts[0] !== 0) sections.push({ text: diff.slice(0, starts[0]), elided: true });
	for (let i = 0; i < starts.length; i++) {
		const end = i + 1 < starts.length ? starts[i + 1] : diff.length;
		sections.push({ text: diff.slice(starts[i], end), elided: false });
	}
	return sections;
}

function elide(section: Section): void {
	section.elided = true;
	const lines = section.text.split("\n");
	let headerEnd = lines.findIndex((line) => line.startsWith("+++ "));
	if (headerEnd === -1) headerEnd = lines.findIndex((line) => line.startsWith("@@ ")) - 1;
	if (headerEnd < 0) return;
	const body = lines.length - (headerEnd + 1);
	section.text = [
		...lines.slice(0, headerEnd + 1),
		`(diff content elided: ${body} lines over the size budget -- read this file from the checkout instead)`,
		"",
	].join("\n");
}
