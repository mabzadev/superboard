export const pluginId = "superboard-email";
export const views = {
	"superboard.system_email": () => import("./views/superboard.system_email.js"),
	"superboard.communication_email": () => import("./views/superboard.system_email.js"),
};
