import type { AxiosResponse } from "axios";
import { DELETE, GET, POST } from "@/lib/api";
import { config } from "@/lib/config";

export interface McpApproveConsentParams {
  client_id: string;
  redirect_uri: string;
  code_challenge?: string;
  code_challenge_method?: string;
  state?: string;
  scope?: string;
}

export interface McpApproveConsentResponse {
  code: string;
  redirect_uri: string;
  state?: string;
}

export interface McpTokenInfo {
  id: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

export interface McpTokensResponse {
  tokens: McpTokenInfo[];
}

export const approveConsentAPICall = async (
  params: McpApproveConsentParams
): Promise<AxiosResponse<McpApproveConsentResponse>> => {
  return POST(config.apiPath + "/mcp/approve_consent", params);
};

export const listMcpTokensAPICall = async (): Promise<
  AxiosResponse<McpTokensResponse>
> => {
  return GET(config.apiPath + "/mcp/tokens");
};

export const revokeMcpTokenAPICall = async (
  tokenId: string
): Promise<AxiosResponse> => {
  return DELETE(config.apiPath + `/mcp/tokens/${tokenId}`);
};
