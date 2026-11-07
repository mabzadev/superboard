import { dataResourceHook, useBrickPath } from "../console/client.js";
import { GET } from "./transport.js";

export const useDataResource = dataResourceHook(GET);

export function useDataPath(): string | null {
	return useBrickPath("database");
}
