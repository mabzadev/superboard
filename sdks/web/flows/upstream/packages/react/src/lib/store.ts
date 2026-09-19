import type { CustomFetch } from "@superboard/flows-shared";

interface GlobalConfig {
  userId: string;
  projectId: string;
  environment: string;
  apiUrl: string;
  customFetch?: CustomFetch;
}

export const globalConfig: Partial<GlobalConfig> = {};
