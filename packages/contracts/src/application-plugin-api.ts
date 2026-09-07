export const APPLICATION_USER_ROUTES = {
	"command.application_sign_in": { method: "POST", kind: "commands", id: "application_sign_in" },
	"command.link_provider": { method: "POST", kind: "commands", id: "link_provider" },
	"command.revoke_application_session": {
		method: "POST",
		kind: "commands",
		id: "revoke_application_session",
	},
	"data_source.linked_providers": { method: "GET", kind: "data-sources", id: "linked_providers" },
	"data_source.active_sessions": { method: "GET", kind: "data-sources", id: "active_sessions" },
} as const;

export function applicationUserOperation(kind: string, id: string) {
	return Object.values(APPLICATION_USER_ROUTES).find(
		(operation) => operation.kind === kind && operation.id === id,
	);
}
