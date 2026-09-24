import { queryKeys } from "@superboard/front-ui/lib/queryKeys.js";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { listMcpTokensAPICall, revokeMcpTokenAPICall } from "../../api/mcp/mcpService.js";

export function useMcpTokensQuery() {
	return useQuery({
		queryKey: queryKeys.mcp.tokens,
		queryFn: async () => {
			const response = await listMcpTokensAPICall();
			return response.data.tokens;
		},
	});
}

export function useRevokeMcpTokenMutation() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (tokenId: string) => revokeMcpTokenAPICall(tokenId),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.mcp.tokens });
		},
	});
}
