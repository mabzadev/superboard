import dashboardConfig from "../apps/dashboard/eslint.config.mjs";

export default [
	...dashboardConfig,
	{ settings: { next: { rootDir: "apps/dashboard" } } },
	{
		files: ["packages/supbrd-front-ui/src/next-image.tsx"],
		rules: { "@next/next/no-img-element": "off" },
	},
	{
		files: [
			"packages/supbrd-runtime-plugins/src/front/client/plugins/supbrd-plug-user/OperatorProfile.tsx",
		],
		rules: { "@next/next/no-location-assign-relative-destination": "off" },
	},
];
