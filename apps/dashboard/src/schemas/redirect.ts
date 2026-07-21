import { z } from "zod";

const platformRedirectSchema = z.object({
  enabled: z.boolean(),
  appStore: z.boolean(),
  customUrl: z.string(),
  showPreview: z.boolean(),
});

export const redirectRulesSchema = z.object({
  defaultUrl: z.string(),
  android: platformRedirectSchema,
  ios: platformRedirectSchema,
  desktop: z.object({
    generatedPage: z.boolean(),
    customUrl: z.string(),
  }),
});

export type RedirectRulesFormValues = z.infer<typeof redirectRulesSchema>;
