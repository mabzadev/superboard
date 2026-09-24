import catalog from "../../../../scripts/config/superboard-plugin-catalog.json";
import { createConfiguredSuperBoardPlugin } from "../../../supbrd-core/src/plugin-runtime.js";
const plugin = catalog.plugins.find((entry) => entry.manifest.plugin_id === "supbrd-plug-commerce");
if (!plugin) throw new Error("Missing plugin declaration: supbrd-plug-commerce");
export default createConfiguredSuperBoardPlugin(plugin.manifest, plugin.label);
