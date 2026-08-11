export type ExperienceKind = "paywall" | "onboarding";

export type ExperienceTheme = {
  accent_color: string;
  background_color: string;
  text_color: string;
  font_family: string;
  corner_radius: number;
};

export type ExperienceBlock = {
  id: string;
  type:
    | "heading"
    | "text"
    | "image"
    | "benefits"
    | "product"
    | "button"
    | "close"
    | "legal"
    | "spacer";
  props: Record<string, unknown>;
};

export type ExperienceScreen = {
  id: string;
  name: string;
  blocks: ExperienceBlock[];
  next_screen_id?: string | null;
  conditions?: Record<string, unknown>;
};

export type ExperienceDocument = {
  schema_version: 1;
  theme: ExperienceTheme;
  screens: ExperienceScreen[];
  metadata: Record<string, unknown>;
};

export type ValidationIssue = {
  path: string;
  message: string;
};

export type EditorBlockType = ExperienceBlock["type"];
