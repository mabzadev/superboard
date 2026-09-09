import { createPluginApiClient } from "@superboard/front-ui/api";

import { adapters } from "./adapters.js";
export const { GET, POST, PUT } = createPluginApiClient("supbrd-plugmod-vocostar", adapters);
