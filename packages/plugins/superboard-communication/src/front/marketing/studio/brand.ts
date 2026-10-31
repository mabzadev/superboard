import type { EmailBlock, EmailDesign } from "@superboard/contracts/email-studio";

import type { BrandKit } from "./growth-service.js";

export const BRAND_FONTS: Record<string, string> = {
	"Arial, sans-serif": "Arial",
	"Helvetica, sans-serif": "Helvetica",
	"Georgia, serif": "Georgia",
	"Verdana, sans-serif": "Verdana",
	"Tahoma, sans-serif": "Tahoma",
	"Trebuchet MS, sans-serif": "Trebuchet MS",
	"Times New Roman, serif": "Times New Roman",
	"Courier New, monospace": "Courier New",
};

const SOCIAL_LABELS: Record<string, string> = {
	website: "Website",
	facebook: "Facebook",
	instagram: "Instagram",
	linkedin: "LinkedIn",
	x: "X",
	youtube: "YouTube",
	tiktok: "TikTok",
	github: "GitHub",
	discord: "Discord",
};
export const SOCIAL_NETWORKS = Object.keys(SOCIAL_LABELS);
export const socialLabel = (network: string) => SOCIAL_LABELS[network] ?? network;

/** Theme colors and font only: the Studio "apply brand" action keeps the content. */
export function applyBrandTheme(design: EmailDesign, brand: BrandKit): EmailDesign {
	return { ...design, theme: { ...design.theme, ...brand.colors, font: brand.font } };
}

/**
 * Brand defaults for a new email: theme, a logo header and a footer with the
 * company details and social links. Every block stays editable afterwards.
 */
export function applyBrandKit(design: EmailDesign, brand: BrandKit): EmailDesign {
	const next = applyBrandTheme(structuredClone(design), brand);
	const footerLines = [brand.company_name, brand.footer_text, brand.company_address].filter(
		(line): line is string => Boolean(line?.trim()),
	);
	for (const translation of Object.values(next.locales)) {
		const blocks = translation.blocks;
		const header: EmailBlock[] =
			brand.logo_url && !blocks.some((block) => block.id === "brand-logo")
				? [
						{
							id: "brand-logo",
							type: "image",
							url: brand.logo_url,
							alt: brand.company_name ?? "",
							align: "center",
						},
					]
				: [];
		const footer: EmailBlock[] = blocks.some((block) => block.id === "brand-footer")
			? []
			: [
					...(footerLines.length
						? [
								{
									id: "brand-footer",
									type: "text" as const,
									text: footerLines.join("\n"),
									align: "center" as const,
									font_size: 12,
									color: "#71717a",
								},
							]
						: []),
					...brand.social_links.map((link) => ({
						id: `brand-social-${link.network}`,
						type: "button" as const,
						text: socialLabel(link.network),
						url: link.url,
						align: "center" as const,
						background: brand.colors.surface,
						color: brand.colors.accent,
						font_size: 12,
					})),
				];
		// The footer goes before the unsubscribe divider when the template has one.
		const divider = blocks.findIndex((block) => block.id === "footer-divider");
		const at = divider === -1 ? blocks.length : divider;
		translation.blocks = [...header, ...blocks.slice(0, at), ...footer, ...blocks.slice(at)];
	}
	return next;
}
