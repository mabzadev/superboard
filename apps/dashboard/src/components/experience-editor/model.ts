import type {
  EditorBlockType,
  ExperienceBlock,
  ExperienceDocument,
  ExperienceScreen,
  ExperienceTheme,
  ValidationIssue,
} from "./types";

export const DEFAULT_THEME: ExperienceTheme = {
  accent_color: "#6366f1",
  background_color: "#ffffff",
  text_color: "#111827",
  font_family: "Inter",
  corner_radius: 14,
};

const blockDefaults: Record<EditorBlockType, Record<string, unknown>> = {
  heading: { text: "Unlock everything", align: "center" },
  text: { text: "A better experience starts here.", align: "center" },
  image: { url: "", alt: "", aspect_ratio: "16/9" },
  benefits: { items: ["Premium features", "Cancel anytime"] },
  product: {
    style: "cards",
    offering_identifier: "default",
    package_identifiers: [],
  },
  button: { text: "Continue", action: "next" },
  close: { accessibility_label: "Close" },
  legal: { text: "Terms and privacy apply." },
  spacer: { height: 24 },
};

export function uniqueId(prefix: string): string {
  const id =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${id.replaceAll("-", "").slice(0, 16)}`;
}

export function createBlock(type: EditorBlockType): ExperienceBlock {
  return {
    id: uniqueId(type),
    type,
    props: structuredClone(blockDefaults[type]),
  };
}

export function createScreen(name = "Welcome"): ExperienceScreen {
  return {
    id: uniqueId("screen"),
    name,
    blocks: [
      createBlock("heading"),
      createBlock("text"),
      createBlock("button"),
    ],
  };
}

export function createExperienceDocument(): ExperienceDocument {
  return {
    schema_version: 1,
    theme: { ...DEFAULT_THEME },
    screens: [createScreen()],
    metadata: {},
  };
}

export function validateExperienceDocument(
  document: ExperienceDocument
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!document.screens.length) {
    issues.push({ path: "screens", message: "Add at least one screen." });
  }
  const screenIds = new Set<string>();
  for (const [screenIndex, screen] of document.screens.entries()) {
    if (!screen.id.trim() || screenIds.has(screen.id)) {
      issues.push({
        path: `screens.${screenIndex}.id`,
        message: "Every screen needs a unique identifier.",
      });
    }
    screenIds.add(screen.id);
    if (!screen.name.trim()) {
      issues.push({
        path: `screens.${screenIndex}.name`,
        message: "Every screen needs a name.",
      });
    }
    if (!screen.blocks.length) {
      issues.push({
        path: `screens.${screenIndex}.blocks`,
        message: `${screen.name || "Screen"} is empty.`,
      });
    }
    const blockIds = new Set<string>();
    for (const [blockIndex, block] of screen.blocks.entries()) {
      if (!block.id.trim() || blockIds.has(block.id)) {
        issues.push({
          path: `screens.${screenIndex}.blocks.${blockIndex}.id`,
          message: "Every block needs a unique identifier within its screen.",
        });
      }
      blockIds.add(block.id);
      if (["heading", "text", "button", "legal"].includes(block.type)) {
        const text = block.props.text;
        if (typeof text !== "string" || !text.trim()) {
          issues.push({
            path: `screens.${screenIndex}.blocks.${blockIndex}.props.text`,
            message: `${block.type} text cannot be empty.`,
          });
        }
      }
      if (block.type === "image") {
        const url = block.props.url;
        if (url && typeof url === "string") {
          try {
            new URL(url);
          } catch {
            issues.push({
              path: `screens.${screenIndex}.blocks.${blockIndex}.props.url`,
              message: "Image URL must be absolute.",
            });
          }
        }
      }
      if (
        block.type === "product" &&
        (typeof block.props.offering_identifier !== "string" ||
          !block.props.offering_identifier.trim())
      ) {
        issues.push({
          path: `screens.${screenIndex}.blocks.${blockIndex}.props.offering_identifier`,
          message: "Product blocks need an offering identifier.",
        });
      }
    }
    if (
      screen.next_screen_id &&
      !document.screens.some(({ id }) => id === screen.next_screen_id)
    ) {
      issues.push({
        path: `screens.${screenIndex}.next_screen_id`,
        message: "The next screen no longer exists.",
      });
    }
  }
  if (!/^#[0-9a-f]{6}$/i.test(document.theme.accent_color)) {
    issues.push({
      path: "theme.accent_color",
      message: "Accent color must be a hex color.",
    });
  }
  return issues;
}

export function toPaywallDefinition(document: ExperienceDocument) {
  const components =
    document.screens[0]?.blocks.filter(
      (
        block
      ): block is ExperienceBlock & {
        type: Exclude<EditorBlockType, "benefits">;
      } => block.type !== "benefits"
    ) ?? [];
  return {
    schema_version: 1 as const,
    theme: document.theme,
    components: components.map((block) => ({ ...block })),
    metadata: document.metadata,
  };
}

export function fromPaywallDefinition(
  value?: Record<string, unknown>
): ExperienceDocument {
  const theme = readTheme(value?.theme);
  const components = Array.isArray(value?.components)
    ? (value.components.map(readBlock).filter(Boolean) as ExperienceBlock[])
    : [];
  return {
    schema_version: 1,
    theme,
    screens: [
      {
        id: "paywall",
        name: "Paywall",
        blocks: components.length ? components : createScreen().blocks,
      },
    ],
    metadata: readRecord(value?.metadata),
  };
}

export function toOnboardingDefinition(document: ExperienceDocument) {
  return {
    schema_version: 1,
    theme: document.theme,
    screens: document.screens,
    metadata: document.metadata,
  };
}

export function fromOnboardingDefinition(
  value?: Record<string, unknown>
): ExperienceDocument {
  const screens = Array.isArray(value?.screens)
    ? (value.screens.map(readScreen).filter(Boolean) as ExperienceScreen[])
    : [];
  return {
    schema_version: 1,
    theme: readTheme(value?.theme),
    screens: screens.length ? screens : [createScreen()],
    metadata: readRecord(value?.metadata),
  };
}

function readTheme(value: unknown): ExperienceTheme {
  const theme = readRecord(value);
  return {
    accent_color: readString(theme.accent_color, DEFAULT_THEME.accent_color),
    background_color: readString(
      theme.background_color,
      DEFAULT_THEME.background_color
    ),
    text_color: readString(theme.text_color, DEFAULT_THEME.text_color),
    font_family: readString(theme.font_family, DEFAULT_THEME.font_family),
    corner_radius:
      typeof theme.corner_radius === "number"
        ? theme.corner_radius
        : DEFAULT_THEME.corner_radius,
  };
}

function readScreen(value: unknown): ExperienceScreen | null {
  const screen = readRecord(value);
  if (typeof screen.id !== "string") return null;
  return {
    id: screen.id,
    name: readString(screen.name, screen.id),
    blocks: Array.isArray(screen.blocks)
      ? (screen.blocks.map(readBlock).filter(Boolean) as ExperienceBlock[])
      : [],
    ...(typeof screen.next_screen_id === "string"
      ? { next_screen_id: screen.next_screen_id }
      : {}),
    ...(screen.conditions &&
    typeof screen.conditions === "object" &&
    !Array.isArray(screen.conditions)
      ? { conditions: readRecord(screen.conditions) }
      : {}),
  };
}

function readBlock(value: unknown): ExperienceBlock | null {
  const block = readRecord(value);
  if (typeof block.id !== "string" || typeof block.type !== "string")
    return null;
  const supported = Object.keys(blockDefaults) as EditorBlockType[];
  if (!supported.includes(block.type as EditorBlockType)) return null;
  return {
    id: block.id,
    type: block.type as EditorBlockType,
    props: readRecord(block.props),
  };
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value : fallback;
}
