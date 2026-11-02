type AlignClassName = "has-text-align-center" | "has-text-align-right" | "has-text-align-justify";

const ALIGN_CLASS_MAP: Record<string, AlignClassName> = {
	center: "has-text-align-center",
	right: "has-text-align-right",
	justify: "has-text-align-justify",
};

export function textAlignClassName(value: string | undefined): AlignClassName | undefined {
	if (value === undefined) return undefined;
	if (Object.hasOwn(ALIGN_CLASS_MAP, value)) {
		return ALIGN_CLASS_MAP[value];
	}
	return undefined;
}
