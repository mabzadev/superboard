const DIACRITIC_RANGE = /[\u0300-\u036f]/g;

export function foldForMatch(value: string): string {
	return value.normalize("NFD").replace(DIACRITIC_RANGE, "").toLowerCase();
}

export interface MatchableTerm {
	label: string;
}

export function termMatches(term: MatchableTerm, input: string): boolean {
	const needle = foldForMatch(input).trim();
	if (!needle) return false;
	return foldForMatch(term.label).includes(needle);
}

export function termExactMatches(term: MatchableTerm, input: string): boolean {
	const needle = foldForMatch(input).trim();
	if (!needle) return false;
	return foldForMatch(term.label).trim() === needle;
}

export function rankTermMatches<T extends MatchableTerm>(terms: readonly T[], input: string): T[] {
	const needle = foldForMatch(input).trim();
	if (!needle) return [];

	return terms
		.map((term) => {
			const label = foldForMatch(term.label).trim();
			const rank = label === needle ? 0 : label.startsWith(needle) ? 1 : 2;
			return { term, label, rank };
		})
		.filter(({ label }) => label.includes(needle))
		.toSorted((a, b) => {
			if (a.rank !== b.rank) return a.rank - b.rank;
			if (a.label < b.label) return -1;
			if (a.label > b.label) return 1;
			if (a.term.label < b.term.label) return -1;
			if (a.term.label > b.term.label) return 1;
			return 0;
		})
		.map(({ term }) => term);
}
