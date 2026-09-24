export const pluginId = "supbrd-plug-settings";
export const views = {
	"superboard.app_android_setup": () => import("./views/superboard.app_android_setup.js"),
	"superboard.app_ios_setup": () => import("./views/superboard.app_ios_setup.js"),
	"superboard.app_libraries": () => import("./views/superboard.app_libraries.js"),
	"superboard.app_web_setup": () => import("./views/superboard.app_web_setup.js"),
	"superboard.project_settings": () => import("./views/superboard.project_settings.js"),
};
