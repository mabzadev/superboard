const pluginIdPattern = /^supbrd-(?:plug|plugmod)-[a-z0-9-]+$/u;

export function watchPluginLifecycle(): () => void {
	if (typeof BroadcastChannel === "undefined") return () => {};
	const channel = new BroadcastChannel("superboard-plugin-lifecycle");
	channel.onmessage = ({ data }: MessageEvent<unknown>) => {
		if (
			typeof data !== "object" ||
			data === null ||
			!("type" in data) ||
			data.type !== "plugin-state-changed" ||
			!("plugin_id" in data) ||
			typeof data.plugin_id !== "string" ||
			!pluginIdPattern.test(data.plugin_id)
		)
			return;
		window.location.reload();
	};
	return () => channel.close();
}
