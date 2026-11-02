import { fontProviders } from "astro/config";

const ALL_GOOGLE_SUBSETS = [
	"arabic",
	"armenian",
	"bengali",
	"chinese-simplified",
	"chinese-traditional",
	"chinese-hongkong",
	"cyrillic",
	"cyrillic-ext",
	"devanagari",
	"ethiopic",
	"farsi",
	"georgian",
	"greek",
	"greek-ext",
	"gujarati",
	"gurmukhi",
	"hebrew",
	"japanese",
	"kannada",
	"khmer",
	"korean",
	"lao",
	"latin",
	"latin-ext",
	"malayalam",
	"math",
	"myanmar",
	"oriya",
	"sinhala",
	"symbols",
	"tamil",
	"telugu",
	"thai",
	"tibetan",
	"vietnamese",
];

const NOTO_SCRIPT_FAMILIES: Record<string, string> = {
	arabic: "Noto Sans Arabic",
	armenian: "Noto Sans Armenian",
	bengali: "Noto Sans Bengali",
	"chinese-simplified": "Noto Sans SC",
	"chinese-traditional": "Noto Sans TC",
	"chinese-hongkong": "Noto Sans HK",
	devanagari: "Noto Sans Devanagari",
	ethiopic: "Noto Sans Ethiopic",
	farsi: "Vazirmatn",
	georgian: "Noto Sans Georgian",
	gujarati: "Noto Sans Gujarati",
	gurmukhi: "Noto Sans Gurmukhi",
	hebrew: "Noto Sans Hebrew",
	japanese: "Noto Sans JP",
	kannada: "Noto Sans Kannada",
	khmer: "Noto Sans Khmer",
	korean: "Noto Sans KR",
	lao: "Noto Sans Lao",
	malayalam: "Noto Sans Malayalam",
	myanmar: "Noto Sans Myanmar",
	oriya: "Noto Sans Oriya",
	sinhala: "Noto Sans Sinhala",
	tamil: "Noto Sans Tamil",
	telugu: "Noto Sans Telugu",
	thai: "Noto Sans Thai",
	tibetan: "Noto Sans Tibetan",
};

export interface NotoSansProviderOptions {
	scripts?: string[];
}

type GoogleProvider = ReturnType<typeof fontProviders.google>;

export function notoSans(options?: NotoSansProviderOptions): GoogleProvider {
	const googleProvider = fontProviders.google();

	return {
		name: "emdash-noto",
		async init(context) {
			await googleProvider.init?.(context);
		},
		async resolveFont(resolveFontOptions) {
			const base = await googleProvider.resolveFont(resolveFontOptions);
			const baseFonts = base?.fonts ?? [];

			if (!options?.scripts?.length) {
				return base;
			}

			const baseSubsets = new Set(baseFonts.map((f) => f.meta?.subset).filter(Boolean));

			const extraFonts = await Promise.all(
				options.scripts.map(async (script) => {
					const family = NOTO_SCRIPT_FAMILIES[script];
					if (!family) {
						if (ALL_GOOGLE_SUBSETS.includes(script)) {
							return undefined;
						}
						console.warn(
							`[emdash] Unknown Noto Sans script "${script}". ` +
								`Available: ${Object.keys(NOTO_SCRIPT_FAMILIES).join(", ")}`,
						);
						return undefined;
					}
					return googleProvider.resolveFont({
						...resolveFontOptions,
						familyName: family,
						subsets: ALL_GOOGLE_SUBSETS,
					});
				}),
			);

			const extraFaces = extraFonts.flatMap((r) =>
				(r?.fonts ?? []).filter((f) => !f.meta?.subset || !baseSubsets.has(f.meta.subset)),
			);

			return {
				fonts: [...baseFonts, ...extraFaces],
			};
		},
	};
}

export function getAvailableNotoScripts(): string[] {
	return Object.keys(NOTO_SCRIPT_FAMILIES);
}
