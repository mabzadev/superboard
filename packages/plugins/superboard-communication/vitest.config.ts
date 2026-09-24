import { fileURLToPath } from "node:url";

import { pluginTestConfig } from "../../supbrd-front-ui/vitest.plugins.js";
export default pluginTestConfig(fileURLToPath(new URL(".", import.meta.url)));
