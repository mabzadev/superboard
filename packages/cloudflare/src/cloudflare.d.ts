declare module "cloudflare:workers" {
	export const env: Record<string, unknown>;

	export const exports: Record<string, unknown>;

	export class WorkerEntrypoint<TEnv = unknown, TProps = unknown> {
		env: TEnv;
		ctx: ExecutionContext & { props: TProps };
	}
}

declare module "cloudflare:email" {}
