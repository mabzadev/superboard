import { createPluginApiClient } from "@superboard/front-ui/api";

import { adapters } from "./adapters.js";

export const { DELETE, GET, PATCH, POST } = createPluginApiClient("superboard-database", adapters);
