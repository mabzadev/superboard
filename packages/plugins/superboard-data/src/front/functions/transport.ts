import { createPluginApiClient } from "@superboard/front-ui/api";

import { adapters } from "./adapters.js";

export const { DELETE, GET, POST, PUT } = createPluginApiClient("superboard-functions", adapters);
