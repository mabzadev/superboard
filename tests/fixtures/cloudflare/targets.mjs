import { delimiter } from "node:path";
import { fileURLToPath } from "node:url";

const fixtures = fileURLToPath(new URL("./targets", import.meta.url));
process.env.SUPERBOARD_ADDITIONAL_TARGET_DIRECTORIES = [
	process.env.SUPERBOARD_ADDITIONAL_TARGET_DIRECTORIES,
	fixtures,
]
	.filter(Boolean)
	.join(delimiter);
