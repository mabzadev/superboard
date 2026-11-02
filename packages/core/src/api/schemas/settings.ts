import { z } from "zod";

import { httpUrl } from "./common.js";

const mediaReferenceInput = z.object({
	mediaId: z.string(),
	alt: z.string().optional(),
});

const socialSettings = z.object({
	twitter: z.string().optional(),
	github: z.string().optional(),
	facebook: z.string().optional(),
	instagram: z.string().optional(),
	linkedin: z.string().optional(),
	youtube: z.string().optional(),
});

const seoSettingsInput = z.object({
	titleSeparator: z.string().max(10).optional(),
	defaultOgImage: mediaReferenceInput.optional(),
	robotsTxt: z.string().max(5000).optional(),
	googleVerification: z.string().max(100).optional(),
	bingVerification: z.string().max(100).optional(),
});

export const settingsUpdateBody = z
	.object({
		title: z.string().optional(),
		tagline: z.string().optional(),
		logo: mediaReferenceInput.optional(),
		favicon: mediaReferenceInput.optional(),
		url: z.union([httpUrl, z.literal("")]).optional(),
		postsPerPage: z.number().int().min(1).max(100).optional(),
		dateFormat: z.string().optional(),
		timezone: z.string().optional(),
		social: socialSettings.optional(),
		seo: seoSettingsInput.optional(),
	})
	.meta({ id: "SettingsUpdateBody" });

const mediaReferenceResponse = z.object({
	mediaId: z.string(),
	alt: z.string().optional(),
	url: z.string().optional(),
	contentType: z.string().optional(),
	width: z.number().int().optional(),
	height: z.number().int().optional(),
});

const seoSettingsResponse = z.object({
	titleSeparator: z.string().max(10).optional(),
	defaultOgImage: mediaReferenceResponse.optional(),
	robotsTxt: z.string().max(5000).optional(),
	googleVerification: z.string().max(100).optional(),
	bingVerification: z.string().max(100).optional(),
});

export const siteSettingsSchema = z
	.object({
		title: z.string().optional(),
		tagline: z.string().optional(),
		logo: mediaReferenceResponse.optional(),
		favicon: mediaReferenceResponse.optional(),
		url: z.string().optional(),
		postsPerPage: z.number().int().optional(),
		dateFormat: z.string().optional(),
		timezone: z.string().optional(),
		social: socialSettings.optional(),
		seo: seoSettingsResponse.optional(),
	})
	.meta({ id: "SiteSettings" });
