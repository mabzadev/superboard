import { lazy, Suspense, type ComponentType } from "react";

type DynamicOptions = {
	loading?: ComponentType;
	ssr?: boolean;
};

export default function dynamic<Props extends object>(
	loader: () => Promise<ComponentType<Props> | { default: ComponentType<Props> }>,
	options: DynamicOptions = {},
): ComponentType<Props> {
	const Lazy = lazy(async () => {
		const loaded = await loader();
		return typeof loaded === "object" && "default" in loaded ? loaded : { default: loaded };
	});
	const Loading = options.loading;
	return function DynamicComponent(props: Props) {
		if (options.ssr === false && typeof window === "undefined") {
			return Loading ? <Loading /> : null;
		}
		return (
			<Suspense fallback={Loading ? <Loading /> : null}>
				<Lazy {...props} />
			</Suspense>
		);
	};
}
