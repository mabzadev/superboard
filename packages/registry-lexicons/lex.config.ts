import { defineLexiconConfig } from "@atcute/lex-cli";

export default defineLexiconConfig({
	files: ["./lexicons/com/emdashcms/experimental/**/*.json"],
	outdir: "src/generated/",
	imports: ["@atcute/atproto"],
});
