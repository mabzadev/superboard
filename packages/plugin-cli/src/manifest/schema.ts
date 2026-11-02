import { isDid, isHandle } from "@atcute/lexicons/syntax";
import {
	CAPABILITY_RENAMES,
	isDeprecatedCapability,
	normalizeCapability,
	PLUGIN_SLUG_MAX_LENGTH,
	PLUGIN_SLUG_RE,
	PLUGIN_VERSION_MAX_LENGTH,
	PLUGIN_VERSION_RE,
} from "@emdash-cms/plugin-types";
import { isValidVersionRange } from "@emdash-cms/registry-client/env";
import { z } from "zod";

export const LicenseSchema = z
	.string()
	.min(1, 'license must be a non-empty SPDX expression (e.g. "MIT")')
	.max(256, "license must be <= 256 characters (SPDX expressions are short)")
	.refine((v) => v.trim().length > 0, "license cannot be whitespace-only")
	.meta({
		title: "License",
		description:
			'SPDX license expression (e.g. "MIT", "Apache-2.0", "MIT OR Apache-2.0"). Required on first publish; ignored on subsequent publishes (the existing profile wins).',
		examples: ["MIT", "Apache-2.0", "MIT OR Apache-2.0"],
	});

export const AuthorSchema = z
	.object({
		name: z
			.string()
			.min(1, "author.name cannot be empty")
			.max(256, "author.name must be <= 256 characters")
			.meta({ description: "Display name." }),
		url: z
			.string()
			.url("author.url must be a valid URL")
			.max(1024, "author.url must be <= 1024 characters")
			.meta({
				description: "Author's homepage or profile URL. Either this or `email` is recommended.",
			})
			.optional(),
		email: z
			.string()
			.email("author.email must be a valid email")
			.max(256, "author.email must be <= 256 characters")
			.meta({ description: "Author's contact email. Either this or `url` is recommended." })
			.optional(),
	})
	.strict()
	.meta({
		title: "Author",
		description: "A single author entry. Mirrors the lexicon's author shape.",
	});

export const SecurityContactSchema = z
	.object({
		url: z
			.string()
			.url("security.url must be a valid URL")
			.max(1024, "security.url must be <= 1024 characters")
			.meta({
				description:
					"Security disclosure URL (e.g. a security.txt or vulnerability-reporting page). Either this or `email` is required.",
			})
			.optional(),
		email: z
			.string()
			.email("security.email must be a valid email")
			.max(256, "security.email must be <= 256 characters")
			.meta({
				description: "Security contact email. Either this or `url` is required.",
			})
			.optional(),
	})
	.strict()
	.refine(
		(v) => v.url !== undefined || v.email !== undefined,
		"security contact must have at least one of `url` or `email`",
	)
	.meta({
		title: "Security contact",
		description: "A single security contact. At least one of `url` or `email` must be present.",
	});

export const PublisherSchema = z
	.string()
	.refine(
		(v) => isDid(v) || isHandle(v),
		'publisher must be an atproto DID (e.g. "did:plc:abc123") or handle (e.g. "example.com")',
	)
	.meta({
		title: "Publisher",
		description:
			"Atproto DID or handle of the publishing identity. Pinned on first publish to prevent accidental publishes from a different account. DIDs are recommended (durable); handles work but are mutable.",
		examples: ["did:plc:abc123def456", "example.com"],
	});

export const NameSchema = z
	.string()
	.min(1, "name cannot be empty when set")
	.max(1024, "name must be <= 1024 characters")
	.meta({
		title: "Display name",
		description:
			"Human-readable name shown in directory listings. Defaults to the plugin's `id` when omitted.",
	});

export const DescriptionSchema = z
	.string()
	.min(1, "description cannot be empty when set")
	.max(1024, "description must be <= 1024 characters")
	.meta({
		title: "Description",
		description:
			"Short description (<= 140 graphemes by FAIR convention). Aggregators may truncate longer values when displaying in compact lists.",
	});

export const KeywordsSchema = z
	.array(
		z.string().min(1, "keyword cannot be empty").max(128, "each keyword must be <= 128 characters"),
	)
	.max(5, "keywords array must have <= 5 entries (FAIR convention)")
	.meta({
		title: "Keywords",
		description: "Search keywords (<= 5 entries, FAIR convention).",
	});

export const RepoSchema = z
	.string()
	.regex(/^https:\/\//, "repo must be an https:// URL (AT-URI source repos aren't supported yet)")
	.url("repo must be a valid URL")
	.max(1024, "repo must be <= 1024 characters")
	.meta({
		title: "Source repository",
		description: "HTTPS URL of the plugin's source repository. Surfaced in registry listings.",
		examples: ["https://github.com/emdash-cms/plugin-gallery"],
	});

const REQUIRES_ENV_KEY_RE = /^env:[^:]+$/;

export const RequiresSchema = z
	.record(
		z
			.string()
			.refine(
				(k) => REQUIRES_ENV_KEY_RE.test(k) || isDid(k),
				'requires key must be an `env:*` requirement (e.g. "env:astro") or a package DID',
			),
		z
			.string()
			.min(1, "requires range must be a non-empty semver range")
			.refine(
				isValidVersionRange,
				'requires range must be a valid semver range (e.g. ">=4.16", "^4.0.0", ">=4.16.0 <5.0.0")',
			),
	)
	.meta({
		title: "Environment requirements",
		description:
			'Host environment constraints for this release, keyed by `env:*` (e.g. "env:astro", "env:emdash") with semver-range values. EmDash refuses to install a release whose constraints the host does not satisfy.',
		examples: [{ "env:emdash": ">=1.0.0", "env:astro": ">=4.16" }],
	});

export const SlugSchema = z
	.string()
	.min(1, "slug must be a non-empty string")
	.max(PLUGIN_SLUG_MAX_LENGTH, `slug must be <= ${PLUGIN_SLUG_MAX_LENGTH} characters`)
	.regex(
		PLUGIN_SLUG_RE,
		'slug must start with a lowercase letter, then lowercase letters / digits / "-" / "_" (e.g. "gallery", "my-plugin")',
	)
	.meta({
		title: "Slug",
		description:
			"URL-safe plugin identifier within the publisher's namespace. ASCII letter then letters/digits/hyphens/underscores, max 64 characters. Combined with the publisher DID, this is the registry's primary key.",
		examples: ["gallery", "image-resizer", "my-plugin"],
	});

export const VersionSchema = z
	.string()
	.min(1, "version must be a non-empty string")
	.max(PLUGIN_VERSION_MAX_LENGTH, `version must be <= ${PLUGIN_VERSION_MAX_LENGTH} characters`)
	.regex(
		PLUGIN_VERSION_RE,
		'version must follow semver 2.0 without build-metadata (e.g. "0.1.0", "1.2.3-rc.1")',
	)
	.meta({
		title: "Version",
		description:
			"Plugin version. Semver 2.0 subset; build-metadata `+...` is disallowed (the atproto record-key alphabet has no `+`). Bumped on every release.",
		examples: ["0.1.0", "1.2.3", "1.0.0-rc.1"],
	});

const CURRENT_CAPABILITIES = new Set<string>([
	"network:request",
	"network:request:unrestricted",
	"content:read",
	"content:write",
	"taxonomies:read",
	"media:read",
	"media:write",
	"users:read",
	"email:send",
	"hooks.email-transport:register",
	"hooks.email-events:register",
	"hooks.page-fragments:register",
]);

export const CapabilitySchema = z
	.string()
	.min(1, "capability must be a non-empty string")
	.superRefine((cap, ctx) => {
		if (isDeprecatedCapability(cap)) {
			const replacement = CAPABILITY_RENAMES[cap];
			ctx.addIssue({
				code: "custom",
				message: `capability "${cap}" is deprecated. Use "${replacement}" instead.`,
			});
			return;
		}
		const normalised = normalizeCapability(cap);
		if (!CURRENT_CAPABILITIES.has(normalised)) {
			ctx.addIssue({
				code: "custom",
				message: `capability "${cap}" is not a recognised name. See the docs for the available capabilities.`,
			});
		}
	});

export const CapabilitiesSchema = z
	.array(CapabilitySchema)
	.max(32, "capabilities[] must have <= 32 entries")
	.meta({
		title: "Capabilities",
		description:
			"Trust contract: what runtime APIs the plugin is allowed to use. Changing this between releases requires a version bump because installed users have consented to the old contract.",
	});

const HOST_PATTERN_INVALID_CHARS = /[/\s]/;

export const AllowedHostsSchema = z
	.array(
		z
			.string()
			.min(1, "host pattern must be non-empty")
			.max(256, "host pattern must be <= 256 characters")
			.refine(
				(h) => !HOST_PATTERN_INVALID_CHARS.test(h) && !h.includes("://"),
				'host pattern must be a hostname only (no scheme, path, or whitespace; "*." for subdomain wildcard is allowed)',
			),
	)
	.max(64, "allowedHosts[] must have <= 64 entries")
	.meta({
		title: "Allowed hosts",
		description:
			"Allow-list of outbound host patterns when `network:request` is declared. Subdomain wildcards use a leading `*.`. Required (non-empty) when `network:request` is declared without `network:request:unrestricted`.",
		examples: [["api.example.com", "*.cdn.example.com"]],
	});

export const StorageCollectionSchema = z
	.object({
		indexes: z.array(z.union([z.string().min(1), z.array(z.string().min(1)).min(1)])),
		uniqueIndexes: z
			.array(z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]))
			.optional(),
	})
	.strict()
	.meta({
		title: "Storage collection",
		description:
			"Index configuration for a single storage collection. Indexes are either single field names or composite (array of field names).",
	});

export const StorageSchema = z
	.record(
		z
			.string()
			.min(1, "storage collection name must be non-empty")
			.regex(
				/^[a-z][a-z0-9_]*$/,
				'storage collection name must start with a lowercase letter, then lowercase letters / digits / "_"',
			),
		StorageCollectionSchema,
	)
	.meta({
		title: "Storage",
		description:
			"Storage collections the plugin uses. Each collection is namespaced to this plugin at runtime.",
	});

export const AdminPageSchema = z
	.object({
		path: z
			.string()
			.min(2, "admin page path must be at least 2 characters (leading slash + name)")
			.max(128, "admin page path must be <= 128 characters")
			.regex(
				/^\/[a-z0-9][a-z0-9/_-]*$/i,
				'admin page path must start with "/" and contain only letters, digits, "-", "_", "/"',
			),
		label: z
			.string()
			.min(1, "admin page label cannot be empty")
			.max(128, "admin page label must be <= 128 characters"),
		icon: z.string().min(1).max(64).optional(),
	})
	.strict()
	.meta({
		title: "Admin page",
		description:
			"A single admin page declaration. The plugin's `admin` route handler is responsible for rendering Block Kit content for this path.",
	});

export const AdminWidgetSchema = z
	.object({
		id: z
			.string()
			.min(1, "admin widget id cannot be empty")
			.max(64, "admin widget id must be <= 64 characters")
			.regex(
				/^[a-z][a-z0-9_-]*$/,
				'admin widget id must start with a lowercase letter, then lowercase letters / digits / "-" / "_"',
			),
		title: z.string().min(1).max(128).optional(),
		size: z.enum(["full", "half", "third"]).optional(),
	})
	.strict()
	.meta({
		title: "Admin widget",
		description: "A single dashboard widget declaration.",
	});

export const AdminSchema = z
	.object({
		pages: z.array(AdminPageSchema).max(32, "admin.pages[] must have <= 32 entries").optional(),
		widgets: z
			.array(AdminWidgetSchema)
			.max(32, "admin.widgets[] must have <= 32 entries")
			.optional(),
	})
	.strict()
	.meta({
		title: "Admin surface",
		description:
			"Pages and widgets the plugin exposes in the admin UI. The plugin's `admin` route handler renders Block Kit content for each path / widget id at runtime.",
	});

export const SECTION_MAX_BYTES = 20000;
export const SECTION_MAX_GRAPHEMES = 2000;

export const SECTION_KEYS = [
	"description",
	"installation",
	"faq",
	"changelog",
	"security",
] as const;

export type SectionKey = (typeof SECTION_KEYS)[number];

const sectionGraphemeSegmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

export function countGraphemes(value: string): number {
	let count = 0;
	for (const _ of sectionGraphemeSegmenter.segment(value)) count++;
	return count;
}

export function sectionCapError(value: string): string | null {
	const bytes = Buffer.byteLength(value, "utf8");
	if (bytes > SECTION_MAX_BYTES) {
		return `content is ${bytes} bytes, exceeding the ${SECTION_MAX_BYTES}-byte cap`;
	}
	const graphemes = countGraphemes(value);
	if (graphemes > SECTION_MAX_GRAPHEMES) {
		return `content is ${graphemes} graphemes, exceeding the ${SECTION_MAX_GRAPHEMES}-grapheme cap`;
	}
	return null;
}

export const SectionFileSchema = z
	.object({
		file: z
			.string()
			.min(1, "section `file` path cannot be empty")
			.max(1024, "section `file` path must be <= 1024 characters")
			.meta({
				description:
					"Path to a CommonMark Markdown file, relative to the manifest. Its content is read inline into the section at publish time.",
			}),
	})
	.strict()
	.meta({
		title: "Section file reference",
		description:
			"Loads the section's Markdown from a sibling file instead of inlining it in the manifest.",
	});

export const SectionValueSchema = z
	.union([
		z
			.string()
			.superRefine((value, ctx) => {
				const error = sectionCapError(value);
				if (error) ctx.addIssue({ code: "custom", message: error });
			})
			.meta({
				description:
					"Inline CommonMark Markdown for this section. Capped at 20000 bytes / 2000 graphemes.",
			}),
		SectionFileSchema,
	])
	.meta({
		title: "Section value",
		description:
			"Either inline CommonMark Markdown or a `{ file }` reference to a sibling Markdown file.",
	});

export const SectionsSchema = z
	.object({
		description: SectionValueSchema.optional(),
		installation: SectionValueSchema.optional(),
		faq: SectionValueSchema.optional(),
		changelog: SectionValueSchema.optional(),
		security: SectionValueSchema.optional(),
	})
	.strict()
	.meta({
		title: "Profile sections",
		description:
			"Long-form package documentation (description / installation / faq / changelog / security). Each value is CommonMark Markdown (inline or a `{ file }` ref) capped at 20000 bytes / 2000 graphemes. Rendered on the package's registry page.",
	});

const ArtifactLangSchema = z
	.string()
	.min(2, 'lang must be a BCP 47 language tag (e.g. "en", "pt-BR")')
	.max(64, "lang must be <= 64 characters")
	.meta({
		description: 'BCP 47 language tag for a localised artifact (e.g. "en", "pt-BR").',
		examples: ["en", "pt-BR"],
	});

export const ArtifactFileSchema = z
	.object({
		file: z
			.string()
			.min(1, "artifact `file` path cannot be empty")
			.max(1024, "artifact `file` path must be <= 1024 characters")
			.meta({
				description:
					"Path to the image file, relative to the manifest. Resolved, hashed, measured, and uploaded at publish time.",
			}),
		lang: ArtifactLangSchema.optional(),
	})
	.strict()
	.meta({
		title: "Artifact file reference",
		description:
			"A media file (PNG / JPEG / WebP / GIF / AVIF) bundled into a release as an icon, screenshot, or banner.",
	});

export const ArtifactsSchema = z
	.object({
		icon: ArtifactFileSchema.optional(),
		banner: ArtifactFileSchema.optional(),
		screenshots: z
			.array(ArtifactFileSchema)
			.min(1, "screenshots[] must have at least one entry when set")
			.max(8, "screenshots[] must have <= 8 entries")
			.meta({
				title: "Screenshots",
				description: "Screenshot gallery for the plugin's detail page (<= 8 entries).",
			})
			.optional(),
	})
	.strict()
	.meta({
		title: "Artifacts",
		description:
			"Release media artifacts. `icon` and `banner` are single images; `screenshots` is a gallery array.",
	});

export const ReleaseSchema = z
	.object({
		requires: RequiresSchema.optional(),
		artifacts: ArtifactsSchema.optional(),
	})
	.strict()
	.meta({
		title: "Release",
		description:
			"Per-release fields: environment constraints (`requires`) and media artifacts (icon / screenshot / banner).",
	});

export const ManifestSchema = z
	.object({
		$schema: z
			.string()
			.meta({
				description:
					"Path or URL to the JSON Schema describing this file. Editors use this for completion and validation.",
			})
			.optional(),

		slug: SlugSchema,
		version: VersionSchema.optional(),

		license: LicenseSchema,

		publisher: PublisherSchema,

		capabilities: CapabilitiesSchema.default([]),
		allowedHosts: AllowedHostsSchema.default([]),
		storage: StorageSchema.default({}),

		admin: AdminSchema.optional(),

		author: AuthorSchema.optional(),
		authors: z
			.array(AuthorSchema)
			.min(1, "authors[] must have at least one entry")
			.max(32, "authors[] must have <= 32 entries (lexicon constraint)")
			.meta({
				title: "Authors (multiple)",
				description:
					"Multi-author form. Mutually exclusive with `author`. Use the singular `author` if there is only one.",
			})
			.optional(),

		security: SecurityContactSchema.optional(),
		securityContacts: z
			.array(SecurityContactSchema)
			.min(1, "securityContacts[] must have at least one entry")
			.max(8, "securityContacts[] must have <= 8 entries (lexicon constraint)")
			.meta({
				title: "Security contacts (multiple)",
				description:
					"Multi-contact form. Mutually exclusive with `security`. Use the singular `security` if there is only one.",
			})
			.optional(),

		name: NameSchema.optional(),
		description: DescriptionSchema.optional(),
		keywords: KeywordsSchema.optional(),

		sections: SectionsSchema.optional(),

		repo: RepoSchema.optional(),

		release: ReleaseSchema.optional(),
	})
	.strict()
	.refine((v) => !(v.author !== undefined && v.authors !== undefined), {
		message:
			"manifest has both `author` and `authors`. Use one form: `author: { ... }` for a single author, or `authors: [...]` for multiple.",
		path: ["authors"],
	})
	.refine((v) => !(v.security !== undefined && v.securityContacts !== undefined), {
		message:
			"manifest has both `security` and `securityContacts`. Use one form: `security: { ... }` for a single contact, or `securityContacts: [...]` for multiple.",
		path: ["securityContacts"],
	})
	.refine((v) => v.author !== undefined || v.authors !== undefined, {
		message: "manifest must specify either `author: { ... }` or `authors: [...]`",
		path: ["author"],
	})
	.refine((v) => v.security !== undefined || v.securityContacts !== undefined, {
		message: "manifest must specify either `security: { ... }` or `securityContacts: [...]`",
		path: ["security"],
	})
	.refine(
		(v) => {
			const caps = new Set((v.capabilities ?? []).map((c) => normalizeCapability(c)));
			if (caps.has("network:request") && !caps.has("network:request:unrestricted")) {
				return (v.allowedHosts ?? []).length > 0;
			}
			return true;
		},
		{
			message:
				'capability "network:request" requires a non-empty `allowedHosts` list. Either add hosts, or upgrade to "network:request:unrestricted" if the plugin really needs to call any host.',
			path: ["allowedHosts"],
		},
	)
	.refine(
		(v) => {
			const caps = new Set((v.capabilities ?? []).map((c) => normalizeCapability(c)));
			if (caps.has("network:request:unrestricted")) {
				return (v.allowedHosts ?? []).length === 0;
			}
			return true;
		},
		{
			message:
				'`allowedHosts` must be empty when "network:request:unrestricted" is declared (the unrestricted capability already grants any host).',
			path: ["allowedHosts"],
		},
	)
	.meta({
		title: "EmDash plugin manifest",
		description:
			"Hand-authored manifest for publishing a plugin to the EmDash plugin registry. Lives next to the plugin's `package.json` as `emdash-plugin.jsonc`.",
	});

export type Manifest = z.infer<typeof ManifestSchema>;

export type ManifestAuthor = z.infer<typeof AuthorSchema>;

export type ManifestSecurityContact = z.infer<typeof SecurityContactSchema>;

export type ManifestArtifactFile = z.infer<typeof ArtifactFileSchema>;

export type ManifestSectionFile = z.infer<typeof SectionFileSchema>;

export type ManifestSections = z.infer<typeof SectionsSchema>;

export type ManifestArtifacts = z.infer<typeof ArtifactsSchema>;
