import { lazy, Suspense, type ComponentType, type ReactNode } from "react";

export default function dynamic<T extends Record<string, unknown>>(
	loader: () => Promise<{ default: ComponentType<T> } | ComponentType<T>>,
	options: { loading?: () => ReactNode; ssr?: boolean } = {},
) {
	const LazyComponent = lazy(async () => {
		const loaded = await loader();
		return typeof loaded === "function" ? { default: loaded } : loaded;
	});
	return function DynamicComponent(props: T) {
		return (
			<Suspense fallback={options.loading?.() ?? null}>
				<LazyComponent {...props} />
			</Suspense>
		);
	};
}
