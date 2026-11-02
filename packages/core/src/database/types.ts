import type { Generated } from "kysely";

export interface RevisionTable {
	id: string;
	collection: string;
	entry_id: string;
	data: string;
	author_id: string | null;
	created_at: Generated<string>;
}

export interface RevisionPruneQueueTable {
	collection: string;
	entry_id: string;
	revision_id: string;
}

export interface TaxonomyTable {
	id: string;
	name: string;
	slug: string;
	label: string;
	parent_id: string | null;
	data: string | null;
	locale: Generated<string>;
	translation_group: string | null;
	sort_order: Generated<number>;
}

export interface ContentTaxonomyTable {
	collection: string;
	entry_id: string;
	taxonomy_id: string;
	status: Generated<string | null>;
	scheduled_at: Generated<string | null>;
	deleted_at: Generated<string | null>;
	locale: Generated<string | null>;
	published_at: Generated<string | null>;
	created_at: Generated<string | null>;
}

export interface TaxonomyDefTable {
	id: string;
	name: string;
	label: string;
	label_singular: string | null;
	hierarchical: number;
	collections: string | null;
	created_at: Generated<string>;
	locale: Generated<string>;
	translation_group: string | null;
}

export interface MediaTable {
	id: string;
	filename: string;
	mime_type: string;
	size: number | null;
	width: number | null;
	height: number | null;
	focal_x: number | null;
	focal_y: number | null;
	alt: string | null;
	caption: string | null;
	storage_key: string;
	status: string;
	content_hash: string | null;
	blurhash: string | null;
	dominant_color: string | null;
	created_at: Generated<string>;
	author_id: string | null;
	folder_id: Generated<string | null>;
}

export interface MediaFolderTable {
	id: string;
	name: string;
	name_key: string;
}

export interface MediaUploadAttemptTable {
	storage_key: string;
	media_id: string;
	status: string;
	created_at: Generated<string>;
	updated_at: Generated<string>;
}

export interface MediaUsageSourceTable {
	source_key: string;
	source_type: string;
	collection_id: Generated<string | null>;
	collection_slug: string | null;
	content_id: string | null;
	source_variant: string;
	locale: string | null;
	translation_group: string | null;
	content_slug: string | null;
	content_title: string | null;
	content_status: string | null;
	content_scheduled_at: string | null;
	content_deleted_at: string | null;
	revision_id: string | null;
	current_generation: string;
	schema_version: Generated<number>;
	source_updated_at: Generated<string | null>;
	source_version: Generated<number | null>;
	source_fingerprint: Generated<string | null>;
	identity_version: Generated<number | null>;
	source_completeness: Generated<string>;
	last_attempted_at: Generated<string | null>;
	last_error_code: Generated<string | null>;
	indexed_at: Generated<string>;
	created_at: Generated<string>;
	updated_at: Generated<string>;
}

export interface MediaUsageTable {
	id: string;
	source_key: string;
	generation: string;
	field_slug: string;
	field_path: string;
	occurrence_index: Generated<number>;
	reference_type: string;
	media_id: string | null;
	provider: Generated<string>;
	provider_asset_id: string;
	media_kind: string | null;
	mime_type: string | null;
	created_at: Generated<string>;
	cleanup_lease_token: Generated<string | null>;
}

export interface MediaUsageCleanupTable {
	task_key: string;
	lease_token: string | null;
	lease_expires_at: string | null;
	next_eligible_at: string;
	cursor_created_at: string | null;
	cursor_id: string | null;
	scan_before_at: string | null;
	consecutive_failures: Generated<number>;
	last_started_at: string | null;
	last_completed_at: string | null;
	last_candidate_count: Generated<number>;
	last_deleted_orphans: Generated<number>;
	last_deleted_stale: Generated<number>;
	last_deleted_abandoned: Generated<number>;
	last_deleted_write_leases: Generated<number>;
	last_backlog_lower_bound: Generated<number>;
	last_scan_has_more: Generated<number>;
	last_duration_ms: Generated<number>;
	last_error_code: string | null;
	updated_at: Generated<string>;
}

export interface MediaUsageGenerationWriteTable {
	source_key: string;
	generation: string;
	lease_token: string;
	expires_at: string;
	created_at: Generated<string>;
}

export interface MediaUsageGenerationFenceTable {
	task_key: string;
	generation_floor: string;
	updated_at: Generated<string>;
}

export interface MediaUsageIndexStatusTable {
	adapter_id: string;
	scope_type: string;
	scope_key: string;
	status: string;
	schema_version: Generated<number>;
	started_at: Generated<string | null>;
	completed_at: Generated<string | null>;
	cursor: Generated<string | null>;
	indexed_source_count: Generated<number>;
	failed_source_count: Generated<number>;
	last_error_code: Generated<string | null>;
	updated_at: Generated<string>;
	collection_id: Generated<string | null>;
	change_epoch: Generated<number | string>;
	reconciliation_required: Generated<number>;
	last_incremental_success_at: Generated<string | null>;
	capture_state: Generated<string | null>;
}

export interface MediaUsageActivationTable {
	task_key: string;
	state: Generated<string>;
	runtime_generation: Generated<number>;
	collection_cursor: Generated<string | null>;
	drain_confirmed_at: Generated<string | null>;
	lease_token: Generated<string | null>;
	lease_expires_at: Generated<string | null>;
	attempt_count: Generated<number>;
	last_attempted_at: Generated<string | null>;
	last_error_code: Generated<string | null>;
	activated_at: Generated<string | null>;
	created_at: Generated<string>;
	updated_at: Generated<string>;
	media_usage_maintenance_turn: Generated<number>;
}

export interface MediaUsageWorkTable {
	collection_id: string;
	collection_slug: string;
	content_id: string;
	change_epoch: number | string;
	work_version: Generated<number | string>;
	state: Generated<string>;
	attempt_count: Generated<number>;
	next_attempt_at: string;
	lease_token: Generated<string | null>;
	lease_expires_at: Generated<string | null>;
	last_attempted_at: Generated<string | null>;
	last_error_code: Generated<string | null>;
	created_at: Generated<string>;
	updated_at: Generated<string>;
}

export interface MediaUsageCollectionDeletionTable {
	collection_id: string;
	collection_slug: string;
	force_delete: number;
	state: Generated<string>;
	phase: Generated<string>;
	work_cursor: Generated<string | null>;
	source_key: Generated<string | null>;
	occurrence_cursor: Generated<string | null>;
	attempt_count: Generated<number>;
	next_attempt_at: string;
	lease_token: Generated<string | null>;
	lease_expires_at: Generated<string | null>;
	last_error_code: Generated<string | null>;
	created_at: Generated<string>;
	updated_at: Generated<string>;
}

export interface MediaUsageReconciliationTable {
	collection_id: string;
	collection_slug: string;
	run_token: string;
	target_epoch: Generated<number | string | null>;
	field_fingerprint: Generated<string | null>;
	state: Generated<string>;
	phase: Generated<string>;
	scan_cursor: Generated<string | null>;
	scan_upper_id: Generated<string | null>;
	source_cursor: Generated<string | null>;
	source_upper_key: Generated<string | null>;
	attempt_count: Generated<number>;
	next_attempt_at: string;
	lease_token: Generated<string | null>;
	lease_expires_at: Generated<string | null>;
	last_error_code: Generated<string | null>;
	created_at: Generated<string>;
	updated_at: Generated<string>;
}

export interface UserTable {
	id: string;
	email: string;
	name: string | null;
	avatar_url: string | null;
	role: number;
	email_verified: number;
	data: string | null;
	disabled: Generated<number>;
	created_at: Generated<string>;
	updated_at: Generated<string>;
}

export interface CredentialTable {
	id: string;
	user_id: string;
	public_key: Uint8Array;
	algorithm: number;
	counter: number;
	device_type: string;
	backed_up: number;
	transports: string | null;
	name: string | null;
	created_at: Generated<string>;
	last_used_at: Generated<string>;
}

export interface AuthTokenTable {
	hash: string;
	user_id: string | null;
	email: string | null;
	type: string;
	role: number | null;
	invited_by: string | null;
	expires_at: string;
	created_at: Generated<string>;
}

export interface OAuthAccountTable {
	provider: string;
	provider_account_id: string;
	user_id: string;
	created_at: Generated<string>;
}

export interface AllowedDomainTable {
	domain: string;
	default_role: number;
	enabled: number;
	created_at: Generated<string>;
}

export interface AuthChallengeTable {
	challenge: string;
	type: string;
	user_id: string | null;
	data: string | null;
	expires_at: string;
	created_at: Generated<string>;
}

export interface ApiTokenTable {
	id: string;
	name: string;
	token_hash: string;
	prefix: string;
	user_id: string;
	scopes: string;
	expires_at: string | null;
	last_used_at: string | null;
	created_at: Generated<string>;
}

export interface OAuthTokenTable {
	token_hash: string;
	token_type: string;
	user_id: string;
	scopes: string;
	client_type: string;
	expires_at: string;
	refresh_token_hash: string | null;
	client_id: string | null;
	created_at: Generated<string>;
}

export interface AuthorizationCodeTable {
	code_hash: string;
	client_id: string;
	redirect_uri: string;
	user_id: string;
	scopes: string;
	code_challenge: string;
	code_challenge_method: string;
	resource: string | null;
	expires_at: string;
	created_at: Generated<string>;
}

export interface OAuthClientTable {
	id: string;
	name: string;
	redirect_uris: string;
	scopes: string | null;
	created_at: Generated<string>;
	updated_at: Generated<string>;
}

export interface DeviceCodeTable {
	device_code: string;
	user_code: string;
	scopes: string;
	user_id: string | null;
	status: string;
	expires_at: string;
	interval: number;
	last_polled_at: string | null;
	created_at: Generated<string>;
}

export interface OptionTable {
	name: string;
	value: string;
}

export interface AuditLogTable {
	id: string;
	timestamp: Generated<string>;
	actor_id: string | null;
	actor_ip: string | null;
	action: string;
	resource_type: string | null;
	resource_id: string | null;
	details: string | null;
	status: string | null;
}

export interface MigrationTable {
	name: string;
	timestamp: string;
}

export interface CollectionTable {
	id: string;
	slug: string;
	label: string;
	label_singular: string | null;
	description: string | null;
	icon: string | null;
	admin_config: Generated<string | null>;
	supports: string | null;
	source: string | null;
	search_config: string | null;
	has_seo: number;
	title_field: string | null;
	date_field: string | null;
	url_pattern: string | null;
	routable: Generated<number>;
	hidden: Generated<number>;
	sort_order: number | null;
	comments_enabled: Generated<number>;
	comments_moderation: Generated<string>;
	comments_closed_after_days: Generated<number>;
	comments_auto_approve_users: Generated<number>;
	created_at: Generated<string>;
	updated_at: Generated<string>;
}

export interface SeoTable {
	collection: string;
	content_id: string;
	seo_title: string | null;
	seo_description: string | null;
	seo_image: string | null;
	seo_canonical: string | null;
	seo_no_index: number;
	created_at: Generated<string>;
	updated_at: Generated<string>;
}

export interface FieldTable {
	id: string;
	collection_id: string;
	slug: string;
	label: string;
	type: string;
	column_type: string;
	required: number;
	unique: number;
	default_value: string | null;
	validation: string | null;
	widget: string | null;
	options: string | null;
	sort_order: number;
	searchable: Generated<number>;
	indexed: Generated<number>;
	translatable: Generated<number>;
	created_at: Generated<string>;
}

export interface PluginStorageTable {
	plugin_id: string;
	collection: string;
	id: string;
	data: string;
	created_at: Generated<string>;
	updated_at: Generated<string>;
}

export interface PluginStateTable {
	plugin_id: string;
	version: string;
	status: string;
	installed_at: Generated<string>;
	activated_at: string | null;
	deactivated_at: string | null;
	data: string | null;
	source: Generated<string>;
	marketplace_version: string | null;
	display_name: string | null;
	description: string | null;
	registry_publisher_did: string | null;
	registry_slug: string | null;
	mcp_tools_enabled: Generated<number>;
	mcp_tools_consent: string | null;
}

export interface PluginIndexTable {
	plugin_id: string;
	collection: string;
	index_name: string;
	fields: string;
	created_at: Generated<string>;
}

export interface MenuTable {
	id: string;
	name: string;
	label: string;
	created_at: Generated<string>;
	updated_at: Generated<string>;
	locale: Generated<string>;
	translation_group: string | null;
}

export interface MenuItemTable {
	id: string;
	menu_id: string;
	parent_id: string | null;
	sort_order: number;
	type: string;
	reference_collection: string | null;
	reference_id: string | null;
	custom_url: string | null;
	label: string;
	title_attr: string | null;
	target: string | null;
	css_classes: string | null;
	created_at: Generated<string>;
	locale: Generated<string>;
	translation_group: string | null;
}

export interface WidgetAreaTable {
	id: string;
	name: string;
	label: string;
	description: string | null;
	created_at: Generated<string>;
}

export interface WidgetTable {
	id: string;
	area_id: string;
	sort_order: number;
	type: string;
	title: string | null;
	content: string | null;
	menu_name: string | null;
	component_id: string | null;
	component_props: string | null;
	created_at: Generated<string>;
}

export interface CronTaskTable {
	id: string;
	plugin_id: string;
	task_name: string;
	schedule: string;
	is_oneshot: number;
	data: string | null;
	next_run_at: string;
	last_run_at: string | null;
	status: string;
	locked_at: string | null;
	enabled: number;
	created_at: Generated<string>;
}

export interface CommentTable {
	id: string;
	collection: string;
	content_id: string;
	parent_id: string | null;
	author_name: string;
	author_email: string;
	author_user_id: string | null;
	body: string;
	status: string;
	ip_hash: string | null;
	user_agent: string | null;
	moderation_metadata: string | null;
	created_at: Generated<string>;
	updated_at: Generated<string>;
}

export interface CommentReactionTable {
	id: string;
	comment_id: string;
	reaction: string;
	voter_hash: string;
	created_at: Generated<string>;
}

export interface SectionTable {
	id: string;
	slug: string;
	title: string;
	description: string | null;
	keywords: string | null;
	content: string;
	preview_media_id: string | null;
	source: string;
	theme_id: string | null;
	created_at: Generated<string>;
	updated_at: Generated<string>;
}

export interface Database {
	_emdash_plugin_setting_versions: {
		id: string;
		plugin_id: string;
		values_json: string;
		secrets_set_json: string;
		changed_keys_json: string;
		created_at: string;
	};
	revisions: RevisionTable;
	_emdash_revision_prune_queue: RevisionPruneQueueTable;
	taxonomies: TaxonomyTable;
	content_taxonomies: ContentTaxonomyTable;
	_emdash_taxonomy_defs: TaxonomyDefTable;
	media: MediaTable;
	media_folders: MediaFolderTable;
	_emdash_media_upload_attempts: MediaUploadAttemptTable;
	_emdash_media_usage_sources: MediaUsageSourceTable;
	_emdash_media_usage: MediaUsageTable;
	_emdash_media_usage_cleanup: MediaUsageCleanupTable;
	_emdash_media_usage_generation_writes: MediaUsageGenerationWriteTable;
	_emdash_media_usage_cleanup_fence: MediaUsageGenerationFenceTable;
	_emdash_media_usage_index_status: MediaUsageIndexStatusTable;
	_emdash_media_usage_activation: MediaUsageActivationTable;
	_emdash_media_usage_work: MediaUsageWorkTable;
	_emdash_media_usage_collection_deletions: MediaUsageCollectionDeletionTable;
	_emdash_media_usage_reconciliations: MediaUsageReconciliationTable;
	users: UserTable;
	credentials: CredentialTable;
	auth_tokens: AuthTokenTable;
	oauth_accounts: OAuthAccountTable;
	allowed_domains: AllowedDomainTable;
	auth_challenges: AuthChallengeTable;
	options: OptionTable;
	audit_logs: AuditLogTable;
	_emdash_migrations: MigrationTable;
	_emdash_collections: CollectionTable;
	_emdash_fields: FieldTable;
	_plugin_storage: PluginStorageTable;
	_plugin_state: PluginStateTable;
	_plugin_indexes: PluginIndexTable;
	_emdash_menus: MenuTable;
	_emdash_menu_items: MenuItemTable;
	_emdash_widget_areas: WidgetAreaTable;
	_emdash_widgets: WidgetTable;
	_emdash_sections: SectionTable;
	_emdash_api_tokens: ApiTokenTable;
	_emdash_oauth_tokens: OAuthTokenTable;
	_emdash_device_codes: DeviceCodeTable;
	_emdash_authorization_codes: AuthorizationCodeTable;
	_emdash_oauth_clients: OAuthClientTable;
	_emdash_seo: SeoTable;
	_emdash_cron_tasks: CronTaskTable;
	_emdash_comments: CommentTable;
	_emdash_comment_reactions: CommentReactionTable;
	_emdash_redirects: RedirectTable;
	_emdash_404_log: NotFoundLogTable;
	_emdash_bylines: BylineTable;
	_emdash_content_bylines: ContentBylineTable;
	_emdash_byline_fields: BylineFieldTable;
	_emdash_byline_field_values: BylineFieldValueTable;
	_emdash_byline_field_group_values: BylineFieldGroupValueTable;
	_emdash_relations: RelationTable;
	_emdash_content_references: ContentReferenceTable;
	_emdash_rate_limits: RateLimitTable;
}

export type MediaRow = {
	id: string;
	filename: string;
	mime_type: string;
	size: number | null;
	width: number | null;
	height: number | null;
	focal_x: number | null;
	focal_y: number | null;
	alt: string | null;
	caption: string | null;
	storage_key: string;
	status: string;
	content_hash: string | null;
	blurhash: string | null;
	dominant_color: string | null;
	created_at: string;
	author_id: string | null;
	folder_id: string | null;
};

export interface RedirectTable {
	id: string;
	source: string;
	destination: string;
	type: number;
	is_pattern: number;
	enabled: number;
	hits: number;
	last_hit_at: string | null;
	group_name: string | null;
	auto: number;
	created_at: string;
	updated_at: string;
}

export interface NotFoundLogTable {
	id: string;
	path: string;
	referrer: string | null;
	user_agent: string | null;
	ip: string | null;
	hits: number;
	last_seen_at: string | null;
	created_at: string;
}

export interface BylineTable {
	id: string;
	slug: string;
	display_name: string;
	bio: string | null;
	avatar_media_id: string | null;
	website_url: string | null;
	user_id: string | null;
	is_guest: number;
	created_at: Generated<string>;
	updated_at: Generated<string>;
	locale: Generated<string>;
	translation_group: string | null;
}

export interface ContentBylineTable {
	id: string;
	collection_slug: string;
	content_id: string;
	byline_id: string;
	sort_order: number;
	role_label: string | null;
	created_at: Generated<string>;
}

export interface BylineFieldTable {
	id: string;
	slug: string;
	label: string;
	type: string;
	required: Generated<number>;
	translatable: Generated<number>;
	validation: string | null;
	sort_order: Generated<number>;
	created_at: Generated<string>;
	updated_at: Generated<string>;
}

export interface BylineFieldValueTable {
	byline_id: string;
	field_id: string;
	value: string | null;
	created_at: Generated<string>;
	updated_at: Generated<string>;
}

export interface BylineFieldGroupValueTable {
	translation_group: string;
	field_id: string;
	value: string | null;
	created_at: Generated<string>;
	updated_at: Generated<string>;
}

export interface RelationTable {
	id: string;
	name: string;
	parent_collection: string;
	child_collection: string;
	parent_label: string;
	child_label: string;
	locale: Generated<string>;
	translation_group: string;
	created_at: Generated<string>;
	updated_at: Generated<string>;
}

export interface ContentReferenceTable {
	id: string;
	relation_group: string;
	parent_group: string;
	child_group: string;
	sort_order: Generated<number>;
	created_at: Generated<string>;
}

export interface RateLimitTable {
	key: string;
	window: string;
	count: number;
}
