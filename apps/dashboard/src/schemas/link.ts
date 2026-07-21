import { z } from "zod";

const redirectUrlSchema = z
  .object({
    url: z.string().optional(),
    open_app_if_installed: z.boolean().optional(),
  })
  .nullable();

export const createLinkSchema = z.object({
  // Navigation
  section: z.string(),

  // Core
  name: z.string(),
  path: z.string(),
  linkType: z.string(),

  // Social media
  socialMediaTitle: z.string(),
  socialMediaSubTitle: z.string(),
  socialMediaCardType: z.string(),
  imageType: z.string(),
  imageFile: z.instanceof(File).optional(),
  imageLink: z.string(),
  imagePreview: z.string().nullable(),

  // Data
  keyValuePair: z.array(z.object({ key: z.string(), value: z.string() })),
  tagList: z.array(z.string()),

  // Redirects
  iOSRedirectURL: redirectUrlSchema,
  androidRedirectURL: redirectUrlSchema,
  desktopRedirectURL: redirectUrlSchema,
  iOSRedirectType: z.string(),
  androidRedirectType: z.string(),
  desktopRedirectType: z.string(),
  showPreviewAndroid: z.boolean().nullable(),
  showPreviewIOS: z.boolean().nullable(),

  // Tracking
  utmCampaign: z.string(),
  utmMedium: z.string(),
  utmSource: z.string(),

  // Validation state (managed externally via path availability check)
  pathAvailable: z.boolean(),
});

export type CreateLinkFormValues = z.infer<typeof createLinkSchema>;
