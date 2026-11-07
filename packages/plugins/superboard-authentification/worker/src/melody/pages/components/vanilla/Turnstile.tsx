import { useEffect, useRef } from "hono/jsx";

import { turnstileScriptId } from "../../../../captcha.js";
import type { typeConfig } from "../../../configs";

interface TurnstileApi {
	render(container: HTMLElement, options: Record<string, unknown>): string | null | undefined;
	reset(widgetId: string): void;
	remove(widgetId: string): void;
}

function isTurnstileApi(value: unknown): value is TurnstileApi {
	return (
		!!value &&
		typeof value === "object" &&
		["render", "reset", "remove"].every((name) => typeof Reflect.get(value, name) === "function")
	);
}

function loadedTurnstile(): TurnstileApi | null {
	const api: unknown = Reflect.get(window, "turnstile");
	return isTurnstileApi(api) ? api : null;
}

function whenTurnstileLoads(callback: (api: TurnstileApi) => void): () => void {
	const api = loadedTurnstile();
	if (api) {
		callback(api);
		return () => undefined;
	}
	const script = document.getElementById(turnstileScriptId);
	const listener = () => {
		const loaded = loadedTurnstile();
		if (loaded) callback(loaded);
	};
	script?.addEventListener("load", listener);
	return () => script?.removeEventListener("load", listener);
}

interface TurnstileProps {
	siteKey: string;
	locale: typeConfig.Locale;
	resetCount: number;
	onToken: (token: string | null) => void;
}

const Turnstile = ({ siteKey, locale, resetCount, onToken }: TurnstileProps) => {
	const container = useRef<HTMLDivElement>(null);
	const widget = useRef<{ api: TurnstileApi; id: string } | null>(null);

	useEffect(() => {
		const stop = whenTurnstileLoads((api) => {
			if (!container.current) return;
			const id = api.render(container.current, {
				sitekey: siteKey,
				language: locale,
				callback: (token: string) => {
					onToken(token);
				},
				"expired-callback": () => {
					onToken(null);
				},
				"error-callback": () => {
					onToken(null);
				},
				"timeout-callback": () => {
					onToken(null);
				},
			});
			widget.current = id ? { api, id } : null;
		});
		return () => {
			stop();
			widget.current?.api.remove(widget.current.id);
			widget.current = null;
		};
	}, [siteKey, locale, onToken]);

	useEffect(() => {
		if (resetCount === 0 || !widget.current) return;
		widget.current.api.reset(widget.current.id);
		onToken(null);
	}, [resetCount, onToken]);

	return <div ref={container} className="mt-4 flex flex-row justify-center" />;
};

export default Turnstile;
