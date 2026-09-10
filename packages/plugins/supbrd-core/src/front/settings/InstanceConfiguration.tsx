import { parseDeploymentConfiguration } from "@superboard/contracts/deployment-configuration";
import { useFrontContext } from "@superboard/front-ui/context";
import { LinkButton, Loader } from "@superboard/front-ui/kumo";
import { useQuery } from "@superboard/front-ui/query";

import { deploymentI18n } from "../../../../../supbrd-front-ui/src/deployment-i18n.js";

export default function InstanceConfiguration() {
	const context = useFrontContext();
	const t = deploymentI18n(context.locale ?? "en");
	const query = useQuery({
		queryKey: ["deployment-configuration", context.instanceId],
		queryFn: async () => {
			const response = await fetch("/_emdash/api/superboard/deployment-configuration", {
				credentials: "same-origin",
			});
			if (!response.ok) throw new Error("DEPLOYMENT_CONFIGURATION_UNAVAILABLE");
			const body: unknown = await response.json();
			if (!body || typeof body !== "object" || !("configuration" in body))
				throw new Error("DEPLOYMENT_CONFIGURATION_INVALID");
			return parseDeploymentConfiguration(JSON.stringify(body.configuration));
		},
		refetchInterval: 30000,
	});
	return (
		<section className="p-6 space-y-4">
			<h1 className="text-xl font-semibold">{t("title")}</h1>
			<p>{t("description")}</p>
			{query.isPending ? (
				<Loader />
			) : query.error ? (
				<p role="alert">{t("unavailable")}</p>
			) : query.data ? (
				<>
					<p>
						{query.data.target} · {query.data.environment} · {t("configured")}
					</p>
					<div className="overflow-auto">
						<table className="w-full text-start">
							<thead>
								<tr>
									<th>{t("surface")}</th>
									<th>{t("url")}</th>
									<th>{t("worker")}</th>
								</tr>
							</thead>
							<tbody>
								{query.data.endpoints.map((endpoint) => (
									<tr key={endpoint.surface}>
										<td className="py-2">{t(`surface.${endpoint.surface}`)}</td>
										<td className="px-4">
											<code>{endpoint.url}</code>
										</td>
										<td>{endpoint.worker}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					<p>
						{t("workers")} : {query.data.workers.length}
					</p>
				</>
			) : null}
			<LinkButton href="/_emdash/admin/plugins/supbrd-plug-settings/configuration">
				{t("open")}
			</LinkButton>
		</section>
	);
}
