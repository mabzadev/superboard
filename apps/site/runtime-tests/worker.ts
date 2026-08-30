export default {
	fetch: () => new Response("ok"),
} satisfies ExportedHandler<Cloudflare.Env>;
