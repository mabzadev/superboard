import consola from "consola";

export function redirectConsolaToStderr(): () => void {
	const previous = consola.options.reporters?.slice() ?? [];
	consola.setReporters([
		{
			log(logObj) {
				const level = logObj.type ?? "info";
				const tag = logObj.tag ? `[${logObj.tag}] ` : "";
				const args = logObj.args ?? [];
				const message = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
				process.stderr.write(`${level}: ${tag}${message}\n`);
			},
		},
	]);
	return () => {
		consola.setReporters(previous);
	};
}
