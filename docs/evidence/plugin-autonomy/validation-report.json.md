# Plugin and view validation

Status: incomplete.

| Plugin | Surface | Route or scenario | Result | Evidence |
| --- | --- | --- | --- | --- |
| emdash-core | core |  · all-disabled | passed | docs/evidence/plugin-autonomy/onboardings-lifecycle.txt, docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plug-audit | lifecycle |  · activate | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plug-audit | lifecycle |  · deactivate | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plug-audit | lifecycle |  · reactivate | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plug-audit | lifecycle |  · standalone | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plug-audit | lifecycle |  · data-retention | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plug-audit | lifecycle |  · direct-route-rejection | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plug-audit | lifecycle |  · direct-api-rejection | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plug-audit | view | /system/audit · render | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-audit | view | /system/audit · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-audit | view | /system/audit · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-audit | view | /system/audit · functional | unverified |  |
| supbrd-plug-audit | api | /_emdash/api/plugins/supbrd-plug-audit/health · read | unverified |  |
| supbrd-plug-audit | api | /_emdash/api/superboard/plugins/supbrd-plug-audit/commands/supbrd-plug-audit.command.archive_ledger · mutation | unverified |  |
| supbrd-plug-audit | api | /_emdash/api/superboard/plugins/supbrd-plug-audit/commands/supbrd-plug-audit.command.verify_ledger · mutation | unverified |  |
| supbrd-plug-audit | api | /_emdash/api/superboard/plugins/supbrd-plug-audit/data-sources/supbrd-plug-audit.data_source.ledger · read | unverified |  |
| supbrd-plug-audit | api | /_emdash/api/superboard/plugins/supbrd-plug-audit/data-sources/supbrd-plug-audit.data_source.ledger_search · read | unverified |  |
| supbrd-plug-audit | api | /_emdash/api/superboard/plugins/supbrd-plug-audit/data-sources/supbrd-plug-audit.data_source.archives · read | unverified |  |
| supbrd-plug-content | lifecycle |  · activate | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plug-content | lifecycle |  · deactivate | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plug-content | lifecycle |  · reactivate | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plug-content | lifecycle |  · standalone | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plug-content | lifecycle |  · data-retention | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plug-content | lifecycle |  · direct-route-rejection | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plug-content | lifecycle |  · direct-api-rejection | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plug-content | view | /system/content · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-content | view | /system/content · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-content | view | /system/content · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-content | view | /system/content · functional | unverified |  |
| supbrd-plug-content | api | /_emdash/api/plugins/supbrd-plug-content/health · read | unverified |  |
| supbrd-plug-content | api | /_emdash/api/superboard/plugins/supbrd-plug-content/commands/supbrd-plug-content.command.create_document · mutation | unverified |  |
| supbrd-plug-content | api | /_emdash/api/superboard/plugins/supbrd-plug-content/commands/supbrd-plug-content.command.update_document · mutation | unverified |  |
| supbrd-plug-content | api | /_emdash/api/superboard/plugins/supbrd-plug-content/commands/supbrd-plug-content.command.publish_document · mutation | unverified |  |
| supbrd-plug-content | api | /_emdash/api/superboard/plugins/supbrd-plug-content/data-sources/supbrd-plug-content.data_source.documents · read | unverified |  |
| supbrd-plug-content | api | /_emdash/api/superboard/plugins/supbrd-plug-content/data-sources/supbrd-plug-content.data_source.taxonomies · read | unverified |  |
| supbrd-plug-content | api | /_emdash/api/superboard/plugins/supbrd-plug-content/data-sources/supbrd-plug-content.data_source.revisions · read | unverified |  |
| supbrd-plug-products | lifecycle |  · activate | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plug-products | lifecycle |  · deactivate | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plug-products | lifecycle |  · reactivate | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plug-products | lifecycle |  · standalone | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plug-products | lifecycle |  · data-retention | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plug-products | lifecycle |  · direct-route-rejection | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plug-products | lifecycle |  · direct-api-rejection | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plug-products | view | /products/offerings · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-products | view | /products/offerings · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-products | view | /products/offerings · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-products | view | /products/offerings · functional | unverified |  |
| supbrd-plug-products | navigation | /products/offerings · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plug-products | navigation | /products/offerings · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plug-products | navigation | /products/offerings · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plug-products | api | /_emdash/api/plugins/supbrd-plug-products/health · read | unverified |  |
| supbrd-plug-products | api | /_emdash/api/superboard/plugins/supbrd-plug-products/commands/supbrd-plug-products.command.create_product · mutation | unverified |  |
| supbrd-plug-products | api | /_emdash/api/superboard/plugins/supbrd-plug-products/commands/supbrd-plug-products.command.update_product · mutation | unverified |  |
| supbrd-plug-products | api | /_emdash/api/superboard/plugins/supbrd-plug-products/commands/supbrd-plug-products.command.archive_product · mutation | unverified |  |
| supbrd-plug-products | api | /_emdash/api/superboard/plugins/supbrd-plug-products/commands/supbrd-plug-products.command.create_package · mutation | unverified |  |
| supbrd-plug-products | api | /_emdash/api/superboard/plugins/supbrd-plug-products/commands/supbrd-plug-products.command.update_package · mutation | unverified |  |
| supbrd-plug-products | api | /_emdash/api/superboard/plugins/supbrd-plug-products/commands/supbrd-plug-products.command.archive_package · mutation | unverified |  |
| supbrd-plug-products | api | /_emdash/api/superboard/plugins/supbrd-plug-products/commands/supbrd-plug-products.command.create_offering · mutation | unverified |  |
| supbrd-plug-products | api | /_emdash/api/superboard/plugins/supbrd-plug-products/commands/supbrd-plug-products.command.update_offering · mutation | unverified |  |
| supbrd-plug-products | api | /_emdash/api/superboard/plugins/supbrd-plug-products/commands/supbrd-plug-products.command.archive_offering · mutation | unverified |  |
| supbrd-plug-products | api | /_emdash/api/superboard/plugins/supbrd-plug-products/commands/supbrd-plug-products.command.create_entitlement · mutation | unverified |  |
| supbrd-plug-products | api | /_emdash/api/superboard/plugins/supbrd-plug-products/commands/supbrd-plug-products.command.update_entitlement · mutation | unverified |  |
| supbrd-plug-products | api | /_emdash/api/superboard/plugins/supbrd-plug-products/commands/supbrd-plug-products.command.archive_entitlement · mutation | unverified |  |
| supbrd-plug-products | api | /_emdash/api/superboard/plugins/supbrd-plug-products/commands/supbrd-plug-products.command.sync_store_catalog · mutation | unverified |  |
| supbrd-plug-products | api | /_emdash/api/superboard/plugins/supbrd-plug-products/data-sources/supbrd-plug-products.data_source.products · read | unverified |  |
| supbrd-plug-products | api | /_emdash/api/superboard/plugins/supbrd-plug-products/data-sources/supbrd-plug-products.data_source.packages · read | unverified |  |
| supbrd-plug-products | api | /_emdash/api/superboard/plugins/supbrd-plug-products/data-sources/supbrd-plug-products.data_source.offerings · read | unverified |  |
| supbrd-plug-products | api | /_emdash/api/superboard/plugins/supbrd-plug-products/data-sources/supbrd-plug-products.data_source.entitlements · read | unverified |  |
| supbrd-plug-products | api | /_emdash/api/superboard/plugins/supbrd-plug-products/data-sources/supbrd-plug-products.data_source.product_statistics · read | unverified |  |
| supbrd-plug-products | api | /_emdash/api/superboard/plugins/supbrd-plug-products/data-sources/supbrd-plug-products.data_source.store_sync_runs · read | unverified |  |
| supbrd-plug-settings | lifecycle |  · activate | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plug-settings | lifecycle |  · deactivate | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plug-settings | lifecycle |  · reactivate | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plug-settings | lifecycle |  · standalone | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plug-settings | lifecycle |  · data-retention | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plug-settings | lifecycle |  · direct-route-rejection | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plug-settings | lifecycle |  · direct-api-rejection | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plug-settings | view | /app/android-setup · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-settings | view | /app/android-setup · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-settings | view | /app/android-setup · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-settings | view | /app/android-setup · functional | unverified |  |
| supbrd-plug-settings | view | /app/ios-setup · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-settings | view | /app/ios-setup · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-settings | view | /app/ios-setup · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-settings | view | /app/ios-setup · functional | unverified |  |
| supbrd-plug-settings | view | /app/libraries · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-settings | view | /app/libraries · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-settings | view | /app/libraries · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-settings | view | /app/libraries · functional | unverified |  |
| supbrd-plug-settings | view | /app/web-setup · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-settings | view | /app/web-setup · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-settings | view | /app/web-setup · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-settings | view | /app/web-setup · functional | unverified |  |
| supbrd-plug-settings | view | /project-settings · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-settings | view | /project-settings · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-settings | view | /project-settings · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-settings | view | /project-settings · functional | unverified |  |
| supbrd-plug-settings | navigation | /app/libraries · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plug-settings | navigation | /app/libraries · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plug-settings | navigation | /app/libraries · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plug-settings | navigation | /app/android-setup · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plug-settings | navigation | /app/android-setup · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plug-settings | navigation | /app/android-setup · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plug-settings | navigation | /app/ios-setup · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plug-settings | navigation | /app/ios-setup · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plug-settings | navigation | /app/ios-setup · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plug-settings | navigation | /app/web-setup · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plug-settings | navigation | /app/web-setup · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plug-settings | navigation | /app/web-setup · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plug-settings | api | /_emdash/api/plugins/supbrd-plug-settings/health · read | unverified |  |
| supbrd-plug-settings | api | /_emdash/api/superboard/plugins/supbrd-plug-settings/commands/supbrd-plug-settings.command.update_effective_settings · mutation | unverified |  |
| supbrd-plug-settings | api | /_emdash/api/superboard/plugins/supbrd-plug-settings/commands/supbrd-plug-settings.command.save_sdk_configuration · mutation | unverified |  |
| supbrd-plug-settings | api | /_emdash/api/superboard/plugins/supbrd-plug-settings/commands/supbrd-plug-settings.command.test_sdk_configuration · mutation | unverified |  |
| supbrd-plug-settings | api | /_emdash/api/superboard/plugins/supbrd-plug-settings/data-sources/supbrd-plug-settings.data_source.effective_settings · read | unverified |  |
| supbrd-plug-settings | api | /_emdash/api/superboard/plugins/supbrd-plug-settings/data-sources/supbrd-plug-settings.data_source.settings_versions · read | unverified |  |
| supbrd-plug-settings | api | /_emdash/api/superboard/plugins/supbrd-plug-settings/data-sources/supbrd-plug-settings.data_source.sdk_configurations · read | unverified |  |
| supbrd-plug-user | lifecycle |  · activate | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plug-user | lifecycle |  · deactivate | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plug-user | lifecycle |  · reactivate | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plug-user | lifecycle |  · standalone | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plug-user | lifecycle |  · data-retention | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plug-user | lifecycle |  · direct-route-rejection | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plug-user | lifecycle |  · direct-api-rejection | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plug-user | view | /accept-invite · render | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /accept-invite · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /accept-invite · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /accept-invite · functional | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /account · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /account · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /account · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /account · functional | unverified |  |
| supbrd-plug-user | view | /app/access-key · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /app/access-key · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /app/access-key · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /app/access-key · functional | unverified |  |
| supbrd-plug-user | view | /app/customers · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /app/customers · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /app/customers · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /app/customers · functional | unverified |  |
| supbrd-plug-user | view | /app/members · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /app/members · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /app/members · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /app/members · functional | unverified |  |
| supbrd-plug-user | view | /app/profile · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /app/profile · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /app/profile · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /app/profile · functional | unverified |  |
| supbrd-plug-user | view | /app/referrals · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /app/referrals · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /app/referrals · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /app/referrals · functional | unverified |  |
| supbrd-plug-user | view | /app/users · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /app/users · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /app/users · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /app/users · functional | unverified |  |
| supbrd-plug-user | view | /identity · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity · functional | unverified |  |
| supbrd-plug-user | view | /identity/:lang · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang · functional | unverified |  |
| supbrd-plug-user | view | /identity/:lang/account · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/account · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/account · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/account · functional | unverified |  |
| supbrd-plug-user | view | /identity/:lang/apps · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/apps · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/apps · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/apps · functional | unverified |  |
| supbrd-plug-user | view | /identity/:lang/apps/:id · render | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/apps/:id · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/apps/:id · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/apps/:id · functional | unverified |  |
| supbrd-plug-user | view | /identity/:lang/apps/banners/:id · render | passed | docs/evidence/plugin-autonomy/identity-new-fixture-routes.json |
| supbrd-plug-user | view | /identity/:lang/apps/banners/:id · reload | passed | docs/evidence/plugin-autonomy/identity-new-fixture-routes.json |
| supbrd-plug-user | view | /identity/:lang/apps/banners/:id · navigation | passed | docs/evidence/plugin-autonomy/identity-new-fixture-routes.json |
| supbrd-plug-user | view | /identity/:lang/apps/banners/:id · functional | unverified |  |
| supbrd-plug-user | view | /identity/:lang/apps/banners/new · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/apps/banners/new · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/apps/banners/new · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/apps/banners/new · functional | unverified |  |
| supbrd-plug-user | view | /identity/:lang/apps/new · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/apps/new · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/apps/new · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/apps/new · functional | unverified |  |
| supbrd-plug-user | view | /identity/:lang/dashboard · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/dashboard · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/dashboard · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/dashboard · functional | unverified |  |
| supbrd-plug-user | view | /identity/:lang/logs · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/logs · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/logs · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/logs · functional | unverified |  |
| supbrd-plug-user | view | /identity/:lang/logs/email/:id · render | unverified |  |
| supbrd-plug-user | view | /identity/:lang/logs/email/:id · reload | unverified |  |
| supbrd-plug-user | view | /identity/:lang/logs/email/:id · navigation | unverified |  |
| supbrd-plug-user | view | /identity/:lang/logs/email/:id · functional | unverified |  |
| supbrd-plug-user | view | /identity/:lang/logs/sign-in/:id · render | unverified |  |
| supbrd-plug-user | view | /identity/:lang/logs/sign-in/:id · reload | unverified |  |
| supbrd-plug-user | view | /identity/:lang/logs/sign-in/:id · navigation | unverified |  |
| supbrd-plug-user | view | /identity/:lang/logs/sign-in/:id · functional | unverified |  |
| supbrd-plug-user | view | /identity/:lang/logs/sms/:id · render | unverified |  |
| supbrd-plug-user | view | /identity/:lang/logs/sms/:id · reload | unverified |  |
| supbrd-plug-user | view | /identity/:lang/logs/sms/:id · navigation | unverified |  |
| supbrd-plug-user | view | /identity/:lang/logs/sms/:id · functional | unverified |  |
| supbrd-plug-user | view | /identity/:lang/orgs · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/orgs · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/orgs · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/orgs · functional | unverified |  |
| supbrd-plug-user | view | /identity/:lang/orgs/:id · render | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/orgs/:id · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/orgs/:id · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/orgs/:id · functional | unverified |  |
| supbrd-plug-user | view | /identity/:lang/orgs/new · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/orgs/new · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/orgs/new · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/orgs/new · functional | unverified |  |
| supbrd-plug-user | view | /identity/:lang/roles · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/roles · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/roles · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/roles · functional | unverified |  |
| supbrd-plug-user | view | /identity/:lang/roles/:id · render | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/roles/:id · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/roles/:id · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/roles/:id · functional | unverified |  |
| supbrd-plug-user | view | /identity/:lang/roles/new · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/roles/new · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/roles/new · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/roles/new · functional | unverified |  |
| supbrd-plug-user | view | /identity/:lang/saml · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/saml · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/saml · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/saml · functional | unverified |  |
| supbrd-plug-user | view | /identity/:lang/saml/:id · render | passed | docs/evidence/plugin-autonomy/identity-new-fixture-routes.json |
| supbrd-plug-user | view | /identity/:lang/saml/:id · reload | passed | docs/evidence/plugin-autonomy/identity-new-fixture-routes.json |
| supbrd-plug-user | view | /identity/:lang/saml/:id · navigation | passed | docs/evidence/plugin-autonomy/identity-new-fixture-routes.json |
| supbrd-plug-user | view | /identity/:lang/saml/:id · functional | unverified |  |
| supbrd-plug-user | view | /identity/:lang/saml/new · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/saml/new · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/saml/new · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/saml/new · functional | unverified |  |
| supbrd-plug-user | view | /identity/:lang/scopes · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/scopes · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/scopes · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/scopes · functional | unverified |  |
| supbrd-plug-user | view | /identity/:lang/scopes/:id · render | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/scopes/:id · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/scopes/:id · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/scopes/:id · functional | unverified |  |
| supbrd-plug-user | view | /identity/:lang/scopes/new · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/scopes/new · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/scopes/new · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/scopes/new · functional | unverified |  |
| supbrd-plug-user | view | /identity/:lang/user-attributes · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/user-attributes · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/user-attributes · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/user-attributes · functional | unverified |  |
| supbrd-plug-user | view | /identity/:lang/user-attributes/:id · render | passed | docs/evidence/plugin-autonomy/identity-new-fixture-routes.json |
| supbrd-plug-user | view | /identity/:lang/user-attributes/:id · reload | passed | docs/evidence/plugin-autonomy/identity-new-fixture-routes.json |
| supbrd-plug-user | view | /identity/:lang/user-attributes/:id · navigation | passed | docs/evidence/plugin-autonomy/identity-new-fixture-routes.json |
| supbrd-plug-user | view | /identity/:lang/user-attributes/:id · functional | unverified |  |
| supbrd-plug-user | view | /identity/:lang/user-attributes/new · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/user-attributes/new · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/user-attributes/new · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/user-attributes/new · functional | unverified |  |
| supbrd-plug-user | view | /identity/:lang/users · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/users · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/users · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/users · functional | unverified |  |
| supbrd-plug-user | view | /identity/:lang/users/:authId · render | unverified |  |
| supbrd-plug-user | view | /identity/:lang/users/:authId · reload | unverified |  |
| supbrd-plug-user | view | /identity/:lang/users/:authId · navigation | unverified |  |
| supbrd-plug-user | view | /identity/:lang/users/:authId · functional | unverified |  |
| supbrd-plug-user | view | /login · render | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /login · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /login · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /login · functional | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /new_password · render | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /new_password · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /new_password · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /new_password · functional | unverified |  |
| supbrd-plug-user | view | /register · render | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /register · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /register · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /register · functional | unverified |  |
| supbrd-plug-user | view | /register/with_email · render | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /register/with_email · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /register/with_email · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /register/with_email · functional | unverified |  |
| supbrd-plug-user | view | /reset_password · render | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /reset_password · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /reset_password · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /reset_password · functional | unverified |  |
| supbrd-plug-user | navigation | /app/customers · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plug-user | navigation | /app/customers · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plug-user | navigation | /app/customers · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plug-user | navigation | /app/users · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plug-user | navigation | /app/users · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plug-user | navigation | /app/users · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plug-user | navigation | /app/referrals · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plug-user | navigation | /app/referrals · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plug-user | navigation | /app/referrals · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plug-user | navigation | /app/access-key · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plug-user | navigation | /app/access-key · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plug-user | navigation | /app/access-key · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plug-user | navigation | /identity/en/dashboard · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plug-user | navigation | /identity/en/dashboard · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plug-user | navigation | /identity/en/dashboard · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plug-user | navigation | /identity/en/users · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plug-user | navigation | /identity/en/users · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plug-user | navigation | /identity/en/users · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plug-user | navigation | /identity/en/user-attributes · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plug-user | navigation | /identity/en/user-attributes · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plug-user | navigation | /identity/en/user-attributes · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plug-user | navigation | /identity/en/roles · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plug-user | navigation | /identity/en/roles · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plug-user | navigation | /identity/en/roles · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plug-user | navigation | /identity/en/apps · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plug-user | navigation | /identity/en/apps · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plug-user | navigation | /identity/en/apps · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plug-user | navigation | /identity/en/scopes · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plug-user | navigation | /identity/en/scopes · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plug-user | navigation | /identity/en/scopes · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plug-user | navigation | /identity/en/orgs · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plug-user | navigation | /identity/en/orgs · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plug-user | navigation | /identity/en/orgs · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plug-user | navigation | /identity/en/logs · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plug-user | navigation | /identity/en/logs · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plug-user | navigation | /identity/en/logs · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plug-user | navigation | /identity/en/saml · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plug-user | navigation | /identity/en/saml · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plug-user | navigation | /identity/en/saml · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plug-user | navigation | /identity/en/account · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plug-user | navigation | /identity/en/account · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plug-user | navigation | /identity/en/account · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plug-user | api | /_emdash/api/plugins/supbrd-plug-user/health · read | unverified |  |
| supbrd-plug-user | api | /_emdash/api/superboard/plugins/supbrd-plug-user/commands/supbrd-plug-user.command.application_sign_in · mutation | unverified |  |
| supbrd-plug-user | api | /_emdash/api/superboard/plugins/supbrd-plug-user/commands/supbrd-plug-user.command.update_profile · mutation | unverified |  |
| supbrd-plug-user | api | /_emdash/api/superboard/plugins/supbrd-plug-user/commands/supbrd-plug-user.command.suspend_member · mutation | unverified |  |
| supbrd-plug-user | api | /_emdash/api/superboard/plugins/supbrd-plug-user/commands/supbrd-plug-user.command.link_provider · mutation | unverified |  |
| supbrd-plug-user | api | /_emdash/api/superboard/plugins/supbrd-plug-user/commands/supbrd-plug-user.command.revoke_application_session · mutation | unverified |  |
| supbrd-plug-user | api | /_emdash/api/superboard/plugins/supbrd-plug-user/data-sources/supbrd-plug-user.data_source.current_profile · read | unverified |  |
| supbrd-plug-user | api | /_emdash/api/superboard/plugins/supbrd-plug-user/data-sources/supbrd-plug-user.data_source.members · read | unverified |  |
| supbrd-plug-user | api | /_emdash/api/superboard/plugins/supbrd-plug-user/data-sources/supbrd-plug-user.data_source.linked_providers · read | unverified |  |
| supbrd-plug-user | api | /_emdash/api/superboard/plugins/supbrd-plug-user/data-sources/supbrd-plug-user.data_source.active_sessions · read | unverified |  |
| supbrd-plugmod-analytics | lifecycle |  · activate | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plugmod-analytics | lifecycle |  · deactivate | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-analytics | lifecycle |  · reactivate | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-analytics | lifecycle |  · standalone | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plugmod-analytics | lifecycle |  · data-retention | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-analytics | lifecycle |  · direct-route-rejection | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-analytics | lifecycle |  · direct-api-rejection | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plugmod-analytics | view | / · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | / · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | / · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | / · functional | unverified |  |
| supbrd-plugmod-analytics | view | /analytics · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics · functional | unverified |  |
| supbrd-plugmod-analytics | view | /analytics/alerts · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/alerts · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/alerts · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/alerts · functional | unverified |  |
| supbrd-plugmod-analytics | view | /analytics/cohorts · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/cohorts · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/cohorts · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/cohorts · functional | unverified |  |
| supbrd-plugmod-analytics | view | /analytics/crashes · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/crashes · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/crashes · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/crashes · functional | unverified |  |
| supbrd-plugmod-analytics | view | /analytics/dashboards · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/dashboards · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/dashboards · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/dashboards · functional | unverified |  |
| supbrd-plugmod-analytics | view | /analytics/dimensions · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/dimensions · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/dimensions · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/dimensions · functional | unverified |  |
| supbrd-plugmod-analytics | view | /analytics/events · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/events · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/events · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/events · functional | unverified |  |
| supbrd-plugmod-analytics | view | /analytics/feedback · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/feedback · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/feedback · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/feedback · functional | unverified |  |
| supbrd-plugmod-analytics | view | /analytics/insights · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/insights · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/insights · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/insights · functional | unverified |  |
| supbrd-plugmod-analytics | view | /analytics/installations · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/installations · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/installations · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/installations · functional | unverified |  |
| supbrd-plugmod-analytics | view | /analytics/purchases · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/purchases · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/purchases · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/purchases · functional | unverified |  |
| supbrd-plugmod-analytics | view | /analytics/remote-config · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/remote-config · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/remote-config · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/remote-config · functional | unverified |  |
| supbrd-plugmod-analytics | view | /analytics/reports · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/reports · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/reports · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/reports · functional | unverified |  |
| supbrd-plugmod-analytics | view | /analytics/settings · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/settings · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/settings · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/settings · functional | unverified |  |
| supbrd-plugmod-analytics | view | /analytics/users · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/users · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/users · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/users · functional | unverified |  |
| supbrd-plugmod-analytics | view | /analytics/views · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/views · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/views · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/views · functional | unverified |  |
| supbrd-plugmod-analytics | view | /app · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /app · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /app · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /app · functional | unverified |  |
| supbrd-plugmod-analytics | view | /dashboard · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /dashboard · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /dashboard · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /dashboard · functional | unverified |  |
| supbrd-plugmod-analytics | navigation | /dashboard · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-analytics | navigation | /dashboard · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-analytics | navigation | /dashboard · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-analytics | navigation | /analytics · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-analytics | navigation | /analytics · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-analytics | navigation | /analytics · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-analytics | navigation | /analytics/dashboards · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-analytics | navigation | /analytics/dashboards · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-analytics | navigation | /analytics/dashboards · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-analytics | navigation | /analytics/users · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-analytics | navigation | /analytics/users · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-analytics | navigation | /analytics/users · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-analytics | navigation | /analytics/events · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-analytics | navigation | /analytics/events · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-analytics | navigation | /analytics/events · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-analytics | navigation | /analytics/dimensions · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-analytics | navigation | /analytics/dimensions · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-analytics | navigation | /analytics/dimensions · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-analytics | navigation | /analytics/views · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-analytics | navigation | /analytics/views · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-analytics | navigation | /analytics/views · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-analytics | navigation | /analytics/installations · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-analytics | navigation | /analytics/installations · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-analytics | navigation | /analytics/installations · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-analytics | navigation | /analytics/purchases · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-analytics | navigation | /analytics/purchases · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-analytics | navigation | /analytics/purchases · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-analytics | navigation | /analytics/insights · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-analytics | navigation | /analytics/insights · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-analytics | navigation | /analytics/insights · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-analytics | navigation | /analytics/cohorts · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-analytics | navigation | /analytics/cohorts · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-analytics | navigation | /analytics/cohorts · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-analytics | navigation | /analytics/crashes · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-analytics | navigation | /analytics/crashes · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-analytics | navigation | /analytics/crashes · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-analytics | navigation | /analytics/feedback · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-analytics | navigation | /analytics/feedback · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-analytics | navigation | /analytics/feedback · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-analytics | navigation | /analytics/remote-config · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-analytics | navigation | /analytics/remote-config · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-analytics | navigation | /analytics/remote-config · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-analytics | navigation | /analytics/alerts · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-analytics | navigation | /analytics/alerts · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-analytics | navigation | /analytics/alerts · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-analytics | navigation | /analytics/reports · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-analytics | navigation | /analytics/reports · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-analytics | navigation | /analytics/reports · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-analytics | navigation | /analytics/settings · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-analytics | navigation | /analytics/settings · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-analytics | navigation | /analytics/settings · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-analytics | api | /_emdash/api/plugins/supbrd-plugmod-analytics/health · read | unverified |  |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/commands/supbrd-plugmod-analytics.command.create_analytics_report · mutation | unverified |  |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/commands/supbrd-plugmod-analytics.command.update_analytics_report · mutation | unverified |  |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/commands/supbrd-plugmod-analytics.command.delete_analytics_report · mutation | unverified |  |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/commands/supbrd-plugmod-analytics.command.create_analytics_operation · mutation | unverified |  |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/commands/supbrd-plugmod-analytics.command.create_analytics_dashboard · mutation | unverified |  |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/commands/supbrd-plugmod-analytics.command.update_analytics_dashboard · mutation | unverified |  |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/commands/supbrd-plugmod-analytics.command.delete_analytics_dashboard · mutation | unverified |  |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/commands/supbrd-plugmod-analytics.command.create_analytics_cohort · mutation | unverified |  |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/commands/supbrd-plugmod-analytics.command.evaluate_analytics_cohort · mutation | unverified |  |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/commands/supbrd-plugmod-analytics.command.upsert_analytics_remote_config · mutation | unverified |  |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/commands/supbrd-plugmod-analytics.command.create_analytics_alert · mutation | unverified |  |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/commands/supbrd-plugmod-analytics.command.update_analytics_settings · mutation | unverified |  |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/data-sources/supbrd-plugmod-analytics.data_source.analytics_overview · read | unverified |  |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/data-sources/supbrd-plugmod-analytics.data_source.analytics_events · read | unverified |  |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/data-sources/supbrd-plugmod-analytics.data_source.analytics_event_analysis · read | unverified |  |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/data-sources/supbrd-plugmod-analytics.data_source.analytics_installations · read | unverified |  |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/data-sources/supbrd-plugmod-analytics.data_source.analytics_purchases · read | unverified |  |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/data-sources/supbrd-plugmod-analytics.data_source.analytics_retention · read | unverified |  |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/data-sources/supbrd-plugmod-analytics.data_source.analytics_reports · read | unverified |  |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/data-sources/supbrd-plugmod-analytics.data_source.analytics_dashboards · read | unverified |  |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/data-sources/supbrd-plugmod-analytics.data_source.analytics_sessions · read | unverified |  |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/data-sources/supbrd-plugmod-analytics.data_source.analytics_profiles · read | unverified |  |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/data-sources/supbrd-plugmod-analytics.data_source.analytics_views · read | unverified |  |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/data-sources/supbrd-plugmod-analytics.data_source.analytics_dimensions · read | unverified |  |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/data-sources/supbrd-plugmod-analytics.data_source.analytics_crashes · read | unverified |  |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/data-sources/supbrd-plugmod-analytics.data_source.analytics_feedback · read | unverified |  |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/data-sources/supbrd-plugmod-analytics.data_source.analytics_cohorts · read | unverified |  |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/data-sources/supbrd-plugmod-analytics.data_source.analytics_remote_config · read | unverified |  |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/data-sources/supbrd-plugmod-analytics.data_source.analytics_alerts · read | unverified |  |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/data-sources/supbrd-plugmod-analytics.data_source.analytics_settings · read | unverified |  |
| supbrd-plugmod-billing | lifecycle |  · activate | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plugmod-billing | lifecycle |  · deactivate | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-billing | lifecycle |  · reactivate | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-billing | lifecycle |  · standalone | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plugmod-billing | lifecycle |  · data-retention | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-billing | lifecycle |  · direct-route-rejection | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-billing | lifecycle |  · direct-api-rejection | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plugmod-billing | view | /products/customers · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-billing | view | /products/customers · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-billing | view | /products/customers · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-billing | view | /products/customers · functional | unverified |  |
| supbrd-plugmod-billing | view | /products/entitlements · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json, docs/evidence/plugin-autonomy/billing-entitlement-functional.json |
| supbrd-plugmod-billing | view | /products/entitlements · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json, docs/evidence/plugin-autonomy/billing-entitlement-functional.json |
| supbrd-plugmod-billing | view | /products/entitlements · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-billing | view | /products/entitlements · functional | passed | docs/evidence/plugin-autonomy/billing-entitlement-functional.json |
| supbrd-plugmod-billing | view | /products/purchases · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-billing | view | /products/purchases · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-billing | view | /products/purchases · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-billing | view | /products/purchases · functional | passed | docs/evidence/plugin-autonomy/billing-import-browser.json |
| supbrd-plugmod-billing | navigation | /products/purchases · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-billing | navigation | /products/purchases · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-billing | navigation | /products/purchases · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-billing | navigation | /products/customers · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-billing | navigation | /products/customers · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-billing | navigation | /products/customers · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-billing | navigation | /products/entitlements · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-billing | navigation | /products/entitlements · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-billing | navigation | /products/entitlements · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-billing | api | /_emdash/api/plugins/supbrd-plugmod-billing/health · read | unverified |  |
| supbrd-plugmod-billing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-billing/commands/supbrd-plugmod-billing.command.create_purchase · mutation | unverified |  |
| supbrd-plugmod-billing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-billing/commands/supbrd-plugmod-billing.command.create_refund · mutation | unverified |  |
| supbrd-plugmod-billing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-billing/commands/supbrd-plugmod-billing.command.update_refund · mutation | unverified |  |
| supbrd-plugmod-billing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-billing/commands/supbrd-plugmod-billing.command.update_subscription · mutation | unverified |  |
| supbrd-plugmod-billing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-billing/commands/supbrd-plugmod-billing.command.reconcile_store · mutation | unverified |  |
| supbrd-plugmod-billing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-billing/data-sources/supbrd-plugmod-billing.data_source.purchases · read | unverified |  |
| supbrd-plugmod-billing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-billing/data-sources/supbrd-plugmod-billing.data_source.purchase · read | unverified |  |
| supbrd-plugmod-billing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-billing/data-sources/supbrd-plugmod-billing.data_source.refunds · read | unverified |  |
| supbrd-plugmod-billing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-billing/data-sources/supbrd-plugmod-billing.data_source.subscriptions · read | unverified |  |
| supbrd-plugmod-billing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-billing/data-sources/supbrd-plugmod-billing.data_source.financial_customer_entitlements · read | unverified |  |
| supbrd-plugmod-billing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-billing/data-sources/supbrd-plugmod-billing.data_source.billing_ledger · read | unverified |  |
| supbrd-plugmod-dynamic-links | lifecycle |  · activate | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plugmod-dynamic-links | lifecycle |  · deactivate | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-dynamic-links | lifecycle |  · reactivate | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-dynamic-links | lifecycle |  · standalone | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plugmod-dynamic-links | lifecycle |  · data-retention | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-dynamic-links | lifecycle |  · direct-route-rejection | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-dynamic-links | lifecycle |  · direct-api-rejection | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/campaigns · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/campaigns · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/campaigns · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/campaigns · functional | unverified |  |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/campaigns/:id · render | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json, docs/evidence/plugin-autonomy/campaign-functional-complete.json |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/campaigns/:id · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json, docs/evidence/plugin-autonomy/campaign-functional-complete.json |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/campaigns/:id · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json, docs/evidence/plugin-autonomy/campaign-functional-complete.json |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/campaigns/:id · functional | passed | docs/evidence/plugin-autonomy/campaign-functional-complete.json |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/domain · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/domain · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/domain · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/domain · functional | unverified |  |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/links · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/links · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/links · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/links · functional | unverified |  |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/redirect-rules · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/redirect-rules · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/redirect-rules · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/redirect-rules · functional | unverified |  |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/social-media-preview · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/social-media-preview · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/social-media-preview · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/social-media-preview · functional | unverified |  |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/tracking · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/tracking · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/tracking · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/tracking · functional | unverified |  |
| supbrd-plugmod-dynamic-links | navigation | /dynamic-links/links · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-dynamic-links | navigation | /dynamic-links/links · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-dynamic-links | navigation | /dynamic-links/links · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-dynamic-links | navigation | /dynamic-links/campaigns · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-dynamic-links | navigation | /dynamic-links/campaigns · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-dynamic-links | navigation | /dynamic-links/campaigns · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-dynamic-links | navigation | /dynamic-links/redirect-rules · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-dynamic-links | navigation | /dynamic-links/redirect-rules · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-dynamic-links | navigation | /dynamic-links/redirect-rules · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-dynamic-links | navigation | /dynamic-links/domain · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-dynamic-links | navigation | /dynamic-links/domain · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-dynamic-links | navigation | /dynamic-links/domain · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-dynamic-links | navigation | /dynamic-links/social-media-preview · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-dynamic-links | navigation | /dynamic-links/social-media-preview · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-dynamic-links | navigation | /dynamic-links/social-media-preview · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-dynamic-links | navigation | /dynamic-links/tracking · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-dynamic-links | navigation | /dynamic-links/tracking · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-dynamic-links | navigation | /dynamic-links/tracking · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-dynamic-links | api | /_emdash/api/plugins/supbrd-plugmod-dynamic-links/health · read | unverified |  |
| supbrd-plugmod-dynamic-links | api | /_emdash/api/superboard/plugins/supbrd-plugmod-dynamic-links/commands/supbrd-plugmod-dynamic-links.command.create_link · mutation | unverified |  |
| supbrd-plugmod-dynamic-links | api | /_emdash/api/superboard/plugins/supbrd-plugmod-dynamic-links/commands/supbrd-plugmod-dynamic-links.command.update_link · mutation | unverified |  |
| supbrd-plugmod-dynamic-links | api | /_emdash/api/superboard/plugins/supbrd-plugmod-dynamic-links/commands/supbrd-plugmod-dynamic-links.command.delete_link · mutation | unverified |  |
| supbrd-plugmod-dynamic-links | api | /_emdash/api/superboard/plugins/supbrd-plugmod-dynamic-links/commands/supbrd-plugmod-dynamic-links.command.create_link_campaign · mutation | unverified |  |
| supbrd-plugmod-dynamic-links | api | /_emdash/api/superboard/plugins/supbrd-plugmod-dynamic-links/commands/supbrd-plugmod-dynamic-links.command.delete_link_campaign · mutation | unverified |  |
| supbrd-plugmod-dynamic-links | api | /_emdash/api/superboard/plugins/supbrd-plugmod-dynamic-links/commands/supbrd-plugmod-dynamic-links.command.create_redirect_rule · mutation | unverified |  |
| supbrd-plugmod-dynamic-links | api | /_emdash/api/superboard/plugins/supbrd-plugmod-dynamic-links/commands/supbrd-plugmod-dynamic-links.command.update_redirect_rule · mutation | unverified |  |
| supbrd-plugmod-dynamic-links | api | /_emdash/api/superboard/plugins/supbrd-plugmod-dynamic-links/commands/supbrd-plugmod-dynamic-links.command.delete_redirect_rule · mutation | unverified |  |
| supbrd-plugmod-dynamic-links | api | /_emdash/api/superboard/plugins/supbrd-plugmod-dynamic-links/commands/supbrd-plugmod-dynamic-links.command.create_domain · mutation | unverified |  |
| supbrd-plugmod-dynamic-links | api | /_emdash/api/superboard/plugins/supbrd-plugmod-dynamic-links/commands/supbrd-plugmod-dynamic-links.command.verify_domain · mutation | unverified |  |
| supbrd-plugmod-dynamic-links | api | /_emdash/api/superboard/plugins/supbrd-plugmod-dynamic-links/commands/supbrd-plugmod-dynamic-links.command.delete_domain · mutation | unverified |  |
| supbrd-plugmod-dynamic-links | api | /_emdash/api/superboard/plugins/supbrd-plugmod-dynamic-links/commands/supbrd-plugmod-dynamic-links.command.save_social_preview · mutation | unverified |  |
| supbrd-plugmod-dynamic-links | api | /_emdash/api/superboard/plugins/supbrd-plugmod-dynamic-links/commands/supbrd-plugmod-dynamic-links.command.save_tracking · mutation | unverified |  |
| supbrd-plugmod-dynamic-links | api | /_emdash/api/superboard/plugins/supbrd-plugmod-dynamic-links/data-sources/supbrd-plugmod-dynamic-links.data_source.links · read | unverified |  |
| supbrd-plugmod-dynamic-links | api | /_emdash/api/superboard/plugins/supbrd-plugmod-dynamic-links/data-sources/supbrd-plugmod-dynamic-links.data_source.resolved_link · read | unverified |  |
| supbrd-plugmod-dynamic-links | api | /_emdash/api/superboard/plugins/supbrd-plugmod-dynamic-links/data-sources/supbrd-plugmod-dynamic-links.data_source.link_campaigns · read | unverified |  |
| supbrd-plugmod-dynamic-links | api | /_emdash/api/superboard/plugins/supbrd-plugmod-dynamic-links/data-sources/supbrd-plugmod-dynamic-links.data_source.link_campaign_analytics · read | unverified |  |
| supbrd-plugmod-dynamic-links | api | /_emdash/api/superboard/plugins/supbrd-plugmod-dynamic-links/data-sources/supbrd-plugmod-dynamic-links.data_source.redirect_rules · read | unverified |  |
| supbrd-plugmod-dynamic-links | api | /_emdash/api/superboard/plugins/supbrd-plugmod-dynamic-links/data-sources/supbrd-plugmod-dynamic-links.data_source.domains · read | unverified |  |
| supbrd-plugmod-dynamic-links | api | /_emdash/api/superboard/plugins/supbrd-plugmod-dynamic-links/data-sources/supbrd-plugmod-dynamic-links.data_source.social_preview · read | unverified |  |
| supbrd-plugmod-dynamic-links | api | /_emdash/api/superboard/plugins/supbrd-plugmod-dynamic-links/data-sources/supbrd-plugmod-dynamic-links.data_source.tracking · read | unverified |  |
| supbrd-plugmod-dynamic-links | api | /_emdash/api/superboard/plugins/supbrd-plugmod-dynamic-links/data-sources/supbrd-plugmod-dynamic-links.data_source.link_statistics · read | unverified |  |
| supbrd-plugmod-email | lifecycle |  · activate | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plugmod-email | lifecycle |  · deactivate | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-email | lifecycle |  · reactivate | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-email | lifecycle |  · standalone | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plugmod-email | lifecycle |  · data-retention | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-email | lifecycle |  · direct-route-rejection | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-email | lifecycle |  · direct-api-rejection | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plugmod-email | view | /system/email · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-email | view | /system/email · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-email | view | /system/email · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-email | view | /system/email · functional | passed | docs/evidence/plugin-autonomy/email-functional-capture-corrected.json |
| supbrd-plugmod-email | api | /_emdash/api/plugins/supbrd-plugmod-email/health · read | unverified |  |
| supbrd-plugmod-email | api | /_emdash/api/superboard/plugins/supbrd-plugmod-email/commands/supbrd-plugmod-email.command.send_transactional_email · mutation | unverified |  |
| supbrd-plugmod-email | api | /_emdash/api/superboard/plugins/supbrd-plugmod-email/commands/supbrd-plugmod-email.command.save_smtp_settings · mutation | unverified |  |
| supbrd-plugmod-email | api | /_emdash/api/superboard/plugins/supbrd-plugmod-email/commands/supbrd-plugmod-email.command.delete_smtp_settings · mutation | unverified |  |
| supbrd-plugmod-email | api | /_emdash/api/superboard/plugins/supbrd-plugmod-email/commands/supbrd-plugmod-email.command.test_smtp_settings · mutation | unverified |  |
| supbrd-plugmod-email | api | /_emdash/api/superboard/plugins/supbrd-plugmod-email/commands/supbrd-plugmod-email.command.verify_smtp_domain · mutation | unverified |  |
| supbrd-plugmod-email | api | /_emdash/api/superboard/plugins/supbrd-plugmod-email/commands/supbrd-plugmod-email.command.retry_delivery_outbox · mutation | unverified |  |
| supbrd-plugmod-email | api | /_emdash/api/superboard/plugins/supbrd-plugmod-email/commands/supbrd-plugmod-email.command.replay_dead_letter · mutation | unverified |  |
| supbrd-plugmod-email | api | /_emdash/api/superboard/plugins/supbrd-plugmod-email/commands/supbrd-plugmod-email.command.discard_dead_letter · mutation | unverified |  |
| supbrd-plugmod-email | api | /_emdash/api/superboard/plugins/supbrd-plugmod-email/data-sources/supbrd-plugmod-email.data_source.smtp_settings · read | unverified |  |
| supbrd-plugmod-email | api | /_emdash/api/superboard/plugins/supbrd-plugmod-email/data-sources/supbrd-plugmod-email.data_source.delivery_outbox · read | unverified |  |
| supbrd-plugmod-email | api | /_emdash/api/superboard/plugins/supbrd-plugmod-email/data-sources/supbrd-plugmod-email.data_source.dead_letters · read | unverified |  |
| supbrd-plugmod-email | api | /_emdash/api/superboard/plugins/supbrd-plugmod-email/data-sources/supbrd-plugmod-email.data_source.provider_webhooks · read | unverified |  |
| supbrd-plugmod-email | api | /_emdash/api/superboard/plugins/supbrd-plugmod-email/data-sources/supbrd-plugmod-email.data_source.provider_events · read | unverified |  |
| supbrd-plugmod-files | lifecycle |  · activate | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plugmod-files | lifecycle |  · deactivate | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-files | lifecycle |  · reactivate | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-files | lifecycle |  · standalone | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plugmod-files | lifecycle |  · data-retention | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-files | lifecycle |  · direct-route-rejection | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-files | lifecycle |  · direct-api-rejection | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plugmod-files | view | /system/files · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/targeted-functional-results.json |
| supbrd-plugmod-files | view | /system/files · reload | passed | docs/evidence/plugin-autonomy/targeted-functional-results.json |
| supbrd-plugmod-files | view | /system/files · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-files | view | /system/files · functional | passed | docs/evidence/plugin-autonomy/targeted-functional-results.json |
| supbrd-plugmod-files | api | /_emdash/api/plugins/supbrd-plugmod-files/health · read | unverified |  |
| supbrd-plugmod-files | api | /_emdash/api/superboard/plugins/supbrd-plugmod-files/commands/supbrd-plugmod-files.command.create_upload_ticket · mutation | unverified |  |
| supbrd-plugmod-files | api | /_emdash/api/superboard/plugins/supbrd-plugmod-files/commands/supbrd-plugmod-files.command.complete_upload · mutation | unverified |  |
| supbrd-plugmod-files | api | /_emdash/api/superboard/plugins/supbrd-plugmod-files/commands/supbrd-plugmod-files.command.delete_object · mutation | unverified |  |
| supbrd-plugmod-files | api | /_emdash/api/superboard/plugins/supbrd-plugmod-files/commands/supbrd-plugmod-files.command.collect_garbage · mutation | unverified |  |
| supbrd-plugmod-files | api | /_emdash/api/superboard/plugins/supbrd-plugmod-files/data-sources/supbrd-plugmod-files.data_source.objects · read | unverified |  |
| supbrd-plugmod-files | api | /_emdash/api/superboard/plugins/supbrd-plugmod-files/data-sources/supbrd-plugmod-files.data_source.object_metadata · read | unverified |  |
| supbrd-plugmod-files | api | /_emdash/api/superboard/plugins/supbrd-plugmod-files/data-sources/supbrd-plugmod-files.data_source.download_ticket · read | unverified |  |
| supbrd-plugmod-files | api | /_emdash/api/superboard/plugins/supbrd-plugmod-files/data-sources/supbrd-plugmod-files.data_source.storage_usage · read | unverified |  |
| supbrd-plugmod-flows | lifecycle |  · activate | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plugmod-flows | lifecycle |  · deactivate | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-flows | lifecycle |  · reactivate | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-flows | lifecycle |  · standalone | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plugmod-flows | lifecycle |  · data-retention | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-flows | lifecycle |  · direct-route-rejection | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-flows | lifecycle |  · direct-api-rejection | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plugmod-flows | view | /flows · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows · functional | unverified |  |
| supbrd-plugmod-flows | view | /flows/components · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/components · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/components · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/components · functional | unverified |  |
| supbrd-plugmod-flows | view | /flows/launchpad · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/launchpad · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/launchpad · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/launchpad · functional | unverified |  |
| supbrd-plugmod-flows | view | /flows/settings/environments · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/settings/environments · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/settings/environments · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/settings/environments · functional | unverified |  |
| supbrd-plugmod-flows | view | /flows/settings/localization · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/settings/localization · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/settings/localization · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/settings/localization · functional | unverified |  |
| supbrd-plugmod-flows | view | /flows/settings/sdk · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/settings/sdk · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/settings/sdk · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/settings/sdk · functional | unverified |  |
| supbrd-plugmod-flows | view | /flows/users · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/users · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/users · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/users · functional | unverified |  |
| supbrd-plugmod-flows | view | /flows/users/:id · render | passed | docs/evidence/plugin-autonomy/flows-user-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/users/:id · reload | passed | docs/evidence/plugin-autonomy/flows-user-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/users/:id · navigation | passed | docs/evidence/plugin-autonomy/flows-user-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/users/:id · functional | unverified |  |
| supbrd-plugmod-flows | view | /flows/workflows · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/workflows · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/workflows · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/workflows · functional | unverified |  |
| supbrd-plugmod-flows | view | /flows/workflows/:id · render | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/workflows/:id · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/workflows/:id · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/workflows/:id · functional | unverified |  |
| supbrd-plugmod-flows | navigation | /flows · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-flows | navigation | /flows · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-flows | navigation | /flows · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-flows | navigation | /flows/workflows · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-flows | navigation | /flows/workflows · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-flows | navigation | /flows/workflows · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-flows | navigation | /flows/launchpad · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-flows | navigation | /flows/launchpad · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-flows | navigation | /flows/launchpad · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-flows | navigation | /flows/users · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-flows | navigation | /flows/users · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-flows | navigation | /flows/users · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-flows | navigation | /flows/components · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-flows | navigation | /flows/components · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-flows | navigation | /flows/components · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-flows | navigation | /flows/settings/environments · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-flows | navigation | /flows/settings/environments · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-flows | navigation | /flows/settings/environments · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-flows | navigation | /flows/settings/localization · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-flows | navigation | /flows/settings/localization · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-flows | navigation | /flows/settings/localization · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-flows | navigation | /flows/settings/sdk · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-flows | navigation | /flows/settings/sdk · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-flows | navigation | /flows/settings/sdk · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-flows | api | /_emdash/api/plugins/supbrd-plugmod-flows/health · read | unverified |  |
| supbrd-plugmod-flows | api | /_emdash/api/superboard/plugins/supbrd-plugmod-flows/commands/supbrd-plugmod-flows.command.create_workflow · mutation | unverified |  |
| supbrd-plugmod-flows | api | /_emdash/api/superboard/plugins/supbrd-plugmod-flows/commands/supbrd-plugmod-flows.command.update_workflow · mutation | unverified |  |
| supbrd-plugmod-flows | api | /_emdash/api/superboard/plugins/supbrd-plugmod-flows/commands/supbrd-plugmod-flows.command.publish_workflow · mutation | unverified |  |
| supbrd-plugmod-flows | api | /_emdash/api/superboard/plugins/supbrd-plugmod-flows/commands/supbrd-plugmod-flows.command.activate_version · mutation | unverified |  |
| supbrd-plugmod-flows | api | /_emdash/api/superboard/plugins/supbrd-plugmod-flows/commands/supbrd-plugmod-flows.command.create_environment · mutation | unverified |  |
| supbrd-plugmod-flows | api | /_emdash/api/superboard/plugins/supbrd-plugmod-flows/commands/supbrd-plugmod-flows.command.rotate_environment_key · mutation | unverified |  |
| supbrd-plugmod-flows | api | /_emdash/api/superboard/plugins/supbrd-plugmod-flows/commands/supbrd-plugmod-flows.command.save_localization · mutation | unverified |  |
| supbrd-plugmod-flows | api | /_emdash/api/superboard/plugins/supbrd-plugmod-flows/data-sources/supbrd-plugmod-flows.data_source.overview · read | unverified |  |
| supbrd-plugmod-flows | api | /_emdash/api/superboard/plugins/supbrd-plugmod-flows/data-sources/supbrd-plugmod-flows.data_source.components · read | unverified |  |
| supbrd-plugmod-flows | api | /_emdash/api/superboard/plugins/supbrd-plugmod-flows/data-sources/supbrd-plugmod-flows.data_source.workflows · read | unverified |  |
| supbrd-plugmod-flows | api | /_emdash/api/superboard/plugins/supbrd-plugmod-flows/data-sources/supbrd-plugmod-flows.data_source.workflow · read | unverified |  |
| supbrd-plugmod-flows | api | /_emdash/api/superboard/plugins/supbrd-plugmod-flows/data-sources/supbrd-plugmod-flows.data_source.environments · read | unverified |  |
| supbrd-plugmod-flows | api | /_emdash/api/superboard/plugins/supbrd-plugmod-flows/data-sources/supbrd-plugmod-flows.data_source.localization · read | unverified |  |
| supbrd-plugmod-flows | api | /_emdash/api/superboard/plugins/supbrd-plugmod-flows/data-sources/supbrd-plugmod-flows.data_source.users · read | unverified |  |
| supbrd-plugmod-flows | api | /_emdash/api/superboard/plugins/supbrd-plugmod-flows/data-sources/supbrd-plugmod-flows.data_source.user_details · read | unverified |  |
| supbrd-plugmod-gateway | lifecycle |  · activate | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plugmod-gateway | lifecycle |  · deactivate | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-gateway | lifecycle |  · reactivate | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-gateway | lifecycle |  · standalone | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plugmod-gateway | lifecycle |  · data-retention | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-gateway | lifecycle |  · direct-route-rejection | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-gateway | lifecycle |  · direct-api-rejection | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plugmod-gateway | view | /system/gateway · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-gateway | view | /system/gateway · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-gateway | view | /system/gateway · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-gateway | view | /system/gateway · functional | unverified |  |
| supbrd-plugmod-gateway | api | /_emdash/api/plugins/supbrd-plugmod-gateway/health · read | unverified |  |
| supbrd-plugmod-gateway | api | /_emdash/api/superboard/plugins/supbrd-plugmod-gateway/commands/supbrd-plugmod-gateway.command.publish_gateway_manifest · mutation | unverified |  |
| supbrd-plugmod-gateway | api | /_emdash/api/superboard/plugins/supbrd-plugmod-gateway/commands/supbrd-plugmod-gateway.command.update_gateway_route · mutation | unverified |  |
| supbrd-plugmod-gateway | api | /_emdash/api/superboard/plugins/supbrd-plugmod-gateway/commands/supbrd-plugmod-gateway.command.rotate_access_policy · mutation | unverified |  |
| supbrd-plugmod-gateway | api | /_emdash/api/superboard/plugins/supbrd-plugmod-gateway/data-sources/supbrd-plugmod-gateway.data_source.active_gateway_manifest · read | unverified |  |
| supbrd-plugmod-gateway | api | /_emdash/api/superboard/plugins/supbrd-plugmod-gateway/data-sources/supbrd-plugmod-gateway.data_source.gateway_routes · read | unverified |  |
| supbrd-plugmod-gateway | api | /_emdash/api/superboard/plugins/supbrd-plugmod-gateway/data-sources/supbrd-plugmod-gateway.data_source.rate_limits · read | unverified |  |
| supbrd-plugmod-marketing | lifecycle |  · activate | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plugmod-marketing | lifecycle |  · deactivate | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-marketing | lifecycle |  · reactivate | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-marketing | lifecycle |  · standalone | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plugmod-marketing | lifecycle |  · data-retention | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-marketing | lifecycle |  · direct-route-rejection | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-marketing | lifecycle |  · direct-api-rejection | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plugmod-marketing | view | /marketing/campaigns · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-marketing | view | /marketing/campaigns · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-marketing | view | /marketing/campaigns · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-marketing | view | /marketing/campaigns · functional | unverified |  |
| supbrd-plugmod-marketing | view | /marketing/channels · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-marketing | view | /marketing/channels · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-marketing | view | /marketing/channels · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-marketing | view | /marketing/channels · functional | unverified |  |
| supbrd-plugmod-marketing | view | /marketing/email · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-marketing | view | /marketing/email · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-marketing | view | /marketing/email · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-marketing | view | /marketing/email · functional | unverified |  |
| supbrd-plugmod-marketing | view | /marketing/in-app-messages · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-marketing | view | /marketing/in-app-messages · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-marketing | view | /marketing/in-app-messages · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-marketing | view | /marketing/in-app-messages · functional | unverified |  |
| supbrd-plugmod-marketing | view | /marketing/journeys · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-marketing | view | /marketing/journeys · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-marketing | view | /marketing/journeys · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-marketing | view | /marketing/journeys · functional | unverified |  |
| supbrd-plugmod-marketing | view | /marketing/settings · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-marketing | view | /marketing/settings · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-marketing | view | /marketing/settings · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-marketing | view | /marketing/settings · functional | unverified |  |
| supbrd-plugmod-marketing | view | /marketing/statistics · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-marketing | view | /marketing/statistics · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-marketing | view | /marketing/statistics · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-marketing | view | /marketing/statistics · functional | unverified |  |
| supbrd-plugmod-marketing | view | /message-preview-craft · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-marketing | view | /message-preview-craft · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-marketing | view | /message-preview-craft · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-marketing | view | /message-preview-craft · functional | passed | docs/evidence/plugin-autonomy/marketing-preview-functional.json |
| supbrd-plugmod-marketing | navigation | /marketing/in-app-messages · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-marketing | navigation | /marketing/in-app-messages · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-marketing | navigation | /marketing/in-app-messages · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-marketing | navigation | /marketing/email · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-marketing | navigation | /marketing/email · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-marketing | navigation | /marketing/email · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-marketing | navigation | /marketing/campaigns · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-marketing | navigation | /marketing/campaigns · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-marketing | navigation | /marketing/campaigns · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-marketing | navigation | /marketing/journeys · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-marketing | navigation | /marketing/journeys · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-marketing | navigation | /marketing/journeys · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-marketing | navigation | /marketing/channels · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-marketing | navigation | /marketing/channels · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-marketing | navigation | /marketing/channels · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-marketing | navigation | /marketing/statistics · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-marketing | navigation | /marketing/statistics · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-marketing | navigation | /marketing/statistics · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-marketing | navigation | /marketing/settings · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-marketing | navigation | /marketing/settings · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-marketing | navigation | /marketing/settings · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-marketing | api | /_emdash/api/plugins/supbrd-plugmod-marketing/health · read | unverified |  |
| supbrd-plugmod-marketing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-marketing/commands/supbrd-plugmod-marketing.command.create_email_campaign · mutation | unverified |  |
| supbrd-plugmod-marketing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-marketing/commands/supbrd-plugmod-marketing.command.update_email_campaign · mutation | unverified |  |
| supbrd-plugmod-marketing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-marketing/commands/supbrd-plugmod-marketing.command.transition_email_campaign · mutation | unverified |  |
| supbrd-plugmod-marketing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-marketing/commands/supbrd-plugmod-marketing.command.schedule_email_campaign · mutation | unverified |  |
| supbrd-plugmod-marketing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-marketing/commands/supbrd-plugmod-marketing.command.create_marketing_journey · mutation | unverified |  |
| supbrd-plugmod-marketing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-marketing/commands/supbrd-plugmod-marketing.command.update_marketing_journey · mutation | unverified |  |
| supbrd-plugmod-marketing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-marketing/commands/supbrd-plugmod-marketing.command.transition_marketing_journey · mutation | unverified |  |
| supbrd-plugmod-marketing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-marketing/commands/supbrd-plugmod-marketing.command.create_marketing_channel_connector · mutation | unverified |  |
| supbrd-plugmod-marketing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-marketing/commands/supbrd-plugmod-marketing.command.update_marketing_channel_connector · mutation | unverified |  |
| supbrd-plugmod-marketing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-marketing/commands/supbrd-plugmod-marketing.command.delete_marketing_channel_connector · mutation | unverified |  |
| supbrd-plugmod-marketing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-marketing/data-sources/supbrd-plugmod-marketing.data_source.email_subscribers · read | unverified |  |
| supbrd-plugmod-marketing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-marketing/data-sources/supbrd-plugmod-marketing.data_source.subscriber_lists · read | unverified |  |
| supbrd-plugmod-marketing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-marketing/data-sources/supbrd-plugmod-marketing.data_source.subscriber_segments · read | unverified |  |
| supbrd-plugmod-marketing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-marketing/data-sources/supbrd-plugmod-marketing.data_source.email_templates · read | unverified |  |
| supbrd-plugmod-marketing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-marketing/data-sources/supbrd-plugmod-marketing.data_source.email_campaigns · read | unverified |  |
| supbrd-plugmod-marketing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-marketing/data-sources/supbrd-plugmod-marketing.data_source.marketing_statistics · read | unverified |  |
| supbrd-plugmod-marketing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-marketing/data-sources/supbrd-plugmod-marketing.data_source.marketing_journeys · read | unverified |  |
| supbrd-plugmod-marketing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-marketing/data-sources/supbrd-plugmod-marketing.data_source.journey_enrollments · read | unverified |  |
| supbrd-plugmod-marketing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-marketing/data-sources/supbrd-plugmod-marketing.data_source.journey_statistics · read | unverified |  |
| supbrd-plugmod-marketing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-marketing/data-sources/supbrd-plugmod-marketing.data_source.marketing_channel_connectors · read | unverified |  |
| supbrd-plugmod-mcp | lifecycle |  · activate | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plugmod-mcp | lifecycle |  · deactivate | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-mcp | lifecycle |  · reactivate | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-mcp | lifecycle |  · standalone | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plugmod-mcp | lifecycle |  · data-retention | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-mcp | lifecycle |  · direct-route-rejection | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-mcp | lifecycle |  · direct-api-rejection | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plugmod-mcp | view | /mcp/authorize · render | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-mcp | view | /mcp/authorize · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-mcp | view | /mcp/authorize · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-mcp | view | /mcp/authorize · functional | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-mcp | api | /_emdash/api/plugins/supbrd-plugmod-mcp/health · read | unverified |  |
| supbrd-plugmod-mcp | api | /_emdash/api/superboard/plugins/supbrd-plugmod-mcp/commands/supbrd-plugmod-mcp.command.approve_consent · mutation | unverified |  |
| supbrd-plugmod-mcp | api | /_emdash/api/superboard/plugins/supbrd-plugmod-mcp/commands/supbrd-plugmod-mcp.command.revoke_token · mutation | unverified |  |
| supbrd-plugmod-mcp | api | /_emdash/api/superboard/plugins/supbrd-plugmod-mcp/commands/supbrd-plugmod-mcp.command.invoke_tool · mutation | unverified |  |
| supbrd-plugmod-mcp | api | /_emdash/api/superboard/plugins/supbrd-plugmod-mcp/data-sources/supbrd-plugmod-mcp.data_source.tokens · read | unverified |  |
| supbrd-plugmod-mcp | api | /_emdash/api/superboard/plugins/supbrd-plugmod-mcp/data-sources/supbrd-plugmod-mcp.data_source.sessions · read | unverified |  |
| supbrd-plugmod-mcp | api | /_emdash/api/superboard/plugins/supbrd-plugmod-mcp/data-sources/supbrd-plugmod-mcp.data_source.tool_receipts · read | unverified |  |
| supbrd-plugmod-observability | lifecycle |  · activate | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plugmod-observability | lifecycle |  · deactivate | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-observability | lifecycle |  · reactivate | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-observability | lifecycle |  · standalone | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plugmod-observability | lifecycle |  · data-retention | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-observability | lifecycle |  · direct-route-rejection | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-observability | lifecycle |  · direct-api-rejection | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plugmod-observability | view | /infrastructure · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-observability | view | /infrastructure · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-observability | view | /infrastructure · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-observability | view | /infrastructure · functional | unverified |  |
| supbrd-plugmod-observability | api | /_emdash/api/plugins/supbrd-plugmod-observability/health · read | unverified |  |
| supbrd-plugmod-observability | api | /_emdash/api/superboard/plugins/supbrd-plugmod-observability/commands/supbrd-plugmod-observability.command.acknowledge_incident · mutation | unverified |  |
| supbrd-plugmod-observability | api | /_emdash/api/superboard/plugins/supbrd-plugmod-observability/commands/supbrd-plugmod-observability.command.resolve_incident · mutation | unverified |  |
| supbrd-plugmod-observability | api | /_emdash/api/superboard/plugins/supbrd-plugmod-observability/commands/supbrd-plugmod-observability.command.retry_custom_job · mutation | unverified |  |
| supbrd-plugmod-observability | api | /_emdash/api/superboard/plugins/supbrd-plugmod-observability/commands/supbrd-plugmod-observability.command.replay_email_dead_letter · mutation | unverified |  |
| supbrd-plugmod-observability | api | /_emdash/api/superboard/plugins/supbrd-plugmod-observability/commands/supbrd-plugmod-observability.command.discard_email_dead_letter · mutation | unverified |  |
| supbrd-plugmod-observability | api | /_emdash/api/superboard/plugins/supbrd-plugmod-observability/data-sources/supbrd-plugmod-observability.data_source.platform_status · read | unverified |  |
| supbrd-plugmod-observability | api | /_emdash/api/superboard/plugins/supbrd-plugmod-observability/data-sources/supbrd-plugmod-observability.data_source.runtime_metrics · read | unverified |  |
| supbrd-plugmod-observability | api | /_emdash/api/superboard/plugins/supbrd-plugmod-observability/data-sources/supbrd-plugmod-observability.data_source.service_health · read | unverified |  |
| supbrd-plugmod-observability | api | /_emdash/api/superboard/plugins/supbrd-plugmod-observability/data-sources/supbrd-plugmod-observability.data_source.incidents · read | unverified |  |
| supbrd-plugmod-observability | api | /_emdash/api/superboard/plugins/supbrd-plugmod-observability/data-sources/supbrd-plugmod-observability.data_source.platform_custom_jobs · read | unverified |  |
| supbrd-plugmod-observability | api | /_emdash/api/superboard/plugins/supbrd-plugmod-observability/data-sources/supbrd-plugmod-observability.data_source.platform_email_operations · read | unverified |  |
| supbrd-plugmod-onboardings | lifecycle |  · activate | passed | docs/evidence/plugin-autonomy/onboardings-lifecycle.txt, docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plugmod-onboardings | lifecycle |  · deactivate | passed | docs/evidence/plugin-autonomy/onboardings-lifecycle.txt, docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-onboardings | lifecycle |  · reactivate | passed | docs/evidence/plugin-autonomy/onboardings-lifecycle.txt, docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-onboardings | lifecycle |  · standalone | passed | docs/evidence/plugin-autonomy/onboardings-lifecycle.txt, docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plugmod-onboardings | lifecycle |  · data-retention | passed | docs/evidence/plugin-autonomy/onboardings-lifecycle.txt, docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-onboardings | lifecycle |  · direct-route-rejection | passed | docs/evidence/plugin-autonomy/onboardings-lifecycle.txt, docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-onboardings | lifecycle |  · direct-api-rejection | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plugmod-onboardings | view | /onboardings · render | passed | docs/evidence/plugin-autonomy/onboardings-functional.txt, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-onboardings | view | /onboardings · reload | passed | docs/evidence/plugin-autonomy/onboardings-functional.txt, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-onboardings | view | /onboardings · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-onboardings | view | /onboardings · functional | passed | docs/evidence/plugin-autonomy/onboardings-functional.txt |
| supbrd-plugmod-onboardings | view | /onboardings/statistics · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-onboardings | view | /onboardings/statistics · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-onboardings | view | /onboardings/statistics · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-onboardings | view | /onboardings/statistics · functional | unverified |  |
| supbrd-plugmod-onboardings | api | /_emdash/api/plugins/supbrd-plugmod-onboardings/health · read | unverified |  |
| supbrd-plugmod-onboardings | api | /_emdash/api/superboard/plugins/supbrd-plugmod-onboardings/commands/supbrd-plugmod-onboardings.command.create_onboarding · mutation | passed | docs/evidence/plugin-autonomy/onboardings-functional.txt |
| supbrd-plugmod-onboardings | api | /_emdash/api/superboard/plugins/supbrd-plugmod-onboardings/commands/supbrd-plugmod-onboardings.command.update_onboarding · mutation | unverified |  |
| supbrd-plugmod-onboardings | api | /_emdash/api/superboard/plugins/supbrd-plugmod-onboardings/commands/supbrd-plugmod-onboardings.command.delete_onboarding · mutation | unverified |  |
| supbrd-plugmod-onboardings | api | /_emdash/api/superboard/plugins/supbrd-plugmod-onboardings/commands/supbrd-plugmod-onboardings.command.create_onboarding_version · mutation | unverified |  |
| supbrd-plugmod-onboardings | api | /_emdash/api/superboard/plugins/supbrd-plugmod-onboardings/commands/supbrd-plugmod-onboardings.command.publish_onboarding · mutation | passed | docs/evidence/plugin-autonomy/onboardings-functional.txt |
| supbrd-plugmod-onboardings | api | /_emdash/api/superboard/plugins/supbrd-plugmod-onboardings/commands/supbrd-plugmod-onboardings.command.save_onboarding_placement · mutation | unverified |  |
| supbrd-plugmod-onboardings | api | /_emdash/api/superboard/plugins/supbrd-plugmod-onboardings/commands/supbrd-plugmod-onboardings.command.create_onboarding_targeting_rule · mutation | unverified |  |
| supbrd-plugmod-onboardings | api | /_emdash/api/superboard/plugins/supbrd-plugmod-onboardings/commands/supbrd-plugmod-onboardings.command.create_onboarding_experience · mutation | unverified |  |
| supbrd-plugmod-onboardings | api | /_emdash/api/superboard/plugins/supbrd-plugmod-onboardings/commands/supbrd-plugmod-onboardings.command.set_onboarding_experience_status · mutation | unverified |  |
| supbrd-plugmod-onboardings | api | /_emdash/api/superboard/plugins/supbrd-plugmod-onboardings/data-sources/supbrd-plugmod-onboardings.data_source.onboardings · read | unverified |  |
| supbrd-plugmod-onboardings | api | /_emdash/api/superboard/plugins/supbrd-plugmod-onboardings/data-sources/supbrd-plugmod-onboardings.data_source.onboarding_versions · read | unverified |  |
| supbrd-plugmod-onboardings | api | /_emdash/api/superboard/plugins/supbrd-plugmod-onboardings/data-sources/supbrd-plugmod-onboardings.data_source.onboarding_placements · read | unverified |  |
| supbrd-plugmod-onboardings | api | /_emdash/api/superboard/plugins/supbrd-plugmod-onboardings/data-sources/supbrd-plugmod-onboardings.data_source.onboarding_targeting_rules · read | unverified |  |
| supbrd-plugmod-onboardings | api | /_emdash/api/superboard/plugins/supbrd-plugmod-onboardings/data-sources/supbrd-plugmod-onboardings.data_source.onboarding_experiences · read | unverified |  |
| supbrd-plugmod-onboardings | api | /_emdash/api/superboard/plugins/supbrd-plugmod-onboardings/data-sources/supbrd-plugmod-onboardings.data_source.onboarding_statistics · read | unverified |  |
| supbrd-plugmod-paywalls | lifecycle |  · activate | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plugmod-paywalls | lifecycle |  · deactivate | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-paywalls | lifecycle |  · reactivate | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-paywalls | lifecycle |  · standalone | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plugmod-paywalls | lifecycle |  · data-retention | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-paywalls | lifecycle |  · direct-route-rejection | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-paywalls | lifecycle |  · direct-api-rejection | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plugmod-paywalls | view | /paywalls · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-paywalls | view | /paywalls · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-paywalls | view | /paywalls · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-paywalls | view | /paywalls · functional | unverified |  |
| supbrd-plugmod-paywalls | view | /paywalls/statistics · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-paywalls | view | /paywalls/statistics · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-paywalls | view | /paywalls/statistics · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-paywalls | view | /paywalls/statistics · functional | unverified |  |
| supbrd-plugmod-paywalls | api | /_emdash/api/plugins/supbrd-plugmod-paywalls/health · read | unverified |  |
| supbrd-plugmod-paywalls | api | /_emdash/api/superboard/plugins/supbrd-plugmod-paywalls/commands/supbrd-plugmod-paywalls.command.create_paywall · mutation | unverified |  |
| supbrd-plugmod-paywalls | api | /_emdash/api/superboard/plugins/supbrd-plugmod-paywalls/commands/supbrd-plugmod-paywalls.command.update_paywall · mutation | unverified |  |
| supbrd-plugmod-paywalls | api | /_emdash/api/superboard/plugins/supbrd-plugmod-paywalls/commands/supbrd-plugmod-paywalls.command.archive_paywall · mutation | unverified |  |
| supbrd-plugmod-paywalls | api | /_emdash/api/superboard/plugins/supbrd-plugmod-paywalls/commands/supbrd-plugmod-paywalls.command.create_paywall_version · mutation | unverified |  |
| supbrd-plugmod-paywalls | api | /_emdash/api/superboard/plugins/supbrd-plugmod-paywalls/commands/supbrd-plugmod-paywalls.command.publish_paywall_version · mutation | unverified |  |
| supbrd-plugmod-paywalls | api | /_emdash/api/superboard/plugins/supbrd-plugmod-paywalls/commands/supbrd-plugmod-paywalls.command.save_paywall_placement · mutation | unverified |  |
| supbrd-plugmod-paywalls | api | /_emdash/api/superboard/plugins/supbrd-plugmod-paywalls/commands/supbrd-plugmod-paywalls.command.create_paywall_experience · mutation | unverified |  |
| supbrd-plugmod-paywalls | api | /_emdash/api/superboard/plugins/supbrd-plugmod-paywalls/commands/supbrd-plugmod-paywalls.command.update_paywall_experience · mutation | unverified |  |
| supbrd-plugmod-paywalls | api | /_emdash/api/superboard/plugins/supbrd-plugmod-paywalls/commands/supbrd-plugmod-paywalls.command.archive_paywall_experience · mutation | unverified |  |
| supbrd-plugmod-paywalls | api | /_emdash/api/superboard/plugins/supbrd-plugmod-paywalls/data-sources/supbrd-plugmod-paywalls.data_source.paywalls · read | unverified |  |
| supbrd-plugmod-paywalls | api | /_emdash/api/superboard/plugins/supbrd-plugmod-paywalls/data-sources/supbrd-plugmod-paywalls.data_source.paywall_versions · read | unverified |  |
| supbrd-plugmod-paywalls | api | /_emdash/api/superboard/plugins/supbrd-plugmod-paywalls/data-sources/supbrd-plugmod-paywalls.data_source.paywall_placements · read | unverified |  |
| supbrd-plugmod-paywalls | api | /_emdash/api/superboard/plugins/supbrd-plugmod-paywalls/data-sources/supbrd-plugmod-paywalls.data_source.paywall_experiences · read | unverified |  |
| supbrd-plugmod-paywalls | api | /_emdash/api/superboard/plugins/supbrd-plugmod-paywalls/data-sources/supbrd-plugmod-paywalls.data_source.paywall_statistics · read | unverified |  |
| supbrd-plugmod-support | lifecycle |  · activate | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plugmod-support | lifecycle |  · deactivate | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-support | lifecycle |  · reactivate | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-support | lifecycle |  · standalone | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plugmod-support | lifecycle |  · data-retention | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-support | lifecycle |  · direct-route-rejection | passed | docs/evidence/plugin-autonomy/browser-lifecycle-matrix.json |
| supbrd-plugmod-support | lifecycle |  · direct-api-rejection | passed | docs/evidence/plugin-autonomy/site-runtime-tests.txt |
| supbrd-plugmod-support | view | /support/automations · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/automations · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/automations · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/automations · functional | unverified |  |
| supbrd-plugmod-support | view | /support/captain · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/captain · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/captain · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/captain · functional | unverified |  |
| supbrd-plugmod-support | view | /support/channels · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/channels · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/channels · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/channels · functional | unverified |  |
| supbrd-plugmod-support | view | /support/configuration · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/configuration · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/configuration · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/configuration · functional | unverified |  |
| supbrd-plugmod-support | view | /support/contacts · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/contacts · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/contacts · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/contacts · functional | unverified |  |
| supbrd-plugmod-support | view | /support/help-center · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/help-center · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/help-center · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/help-center · functional | unverified |  |
| supbrd-plugmod-support | view | /support/inbox · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/inbox · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/inbox · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/inbox · functional | unverified |  |
| supbrd-plugmod-support | view | /support/integrations · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/integrations · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/integrations · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/integrations · functional | unverified |  |
| supbrd-plugmod-support | view | /support/proactive-support · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/proactive-support · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/proactive-support · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/proactive-support · functional | unverified |  |
| supbrd-plugmod-support | view | /support/quality · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/quality · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/quality · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/quality · functional | unverified |  |
| supbrd-plugmod-support | view | /support/reports · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/reports · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/reports · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/reports · functional | unverified |  |
| supbrd-plugmod-support | view | /support/settings · render | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/settings · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/settings · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/settings · functional | unverified |  |
| supbrd-plugmod-support | view | /support/workforce · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/workforce · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/workforce · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/workforce · functional | unverified |  |
| supbrd-plugmod-support | navigation | /support/inbox · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-support | navigation | /support/inbox · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-support | navigation | /support/inbox · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-support | navigation | /support/contacts · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-support | navigation | /support/contacts · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-support | navigation | /support/contacts · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-support | navigation | /support/workforce · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-support | navigation | /support/workforce · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-support | navigation | /support/workforce · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-support | navigation | /support/channels · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-support | navigation | /support/channels · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-support | navigation | /support/channels · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-support | navigation | /support/automations · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-support | navigation | /support/automations · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-support | navigation | /support/automations · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-support | navigation | /support/proactive-support · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-support | navigation | /support/proactive-support · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-support | navigation | /support/proactive-support · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-support | navigation | /support/help-center · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-support | navigation | /support/help-center · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-support | navigation | /support/help-center · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-support | navigation | /support/captain · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-support | navigation | /support/captain · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-support | navigation | /support/captain · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-support | navigation | /support/integrations · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-support | navigation | /support/integrations · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-support | navigation | /support/integrations · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-support | navigation | /support/reports · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-support | navigation | /support/reports · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-support | navigation | /support/reports · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-support | navigation | /support/settings · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plugmod-support | navigation | /support/settings · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-support | navigation | /support/settings · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plugmod-support | api | /_emdash/api/plugins/supbrd-plugmod-support/health · read | unverified |  |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/commands/supbrd-plugmod-support.command.update_support_settings · mutation | unverified |  |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/commands/supbrd-plugmod-support.command.create_support_configuration · mutation | unverified |  |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/commands/supbrd-plugmod-support.command.update_support_configuration · mutation | unverified |  |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/commands/supbrd-plugmod-support.command.delete_support_configuration · mutation | unverified |  |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/commands/supbrd-plugmod-support.command.rotate_support_webhook_secret · mutation | unverified |  |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/commands/supbrd-plugmod-support.command.revoke_support_webhook_secret · mutation | unverified |  |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/commands/supbrd-plugmod-support.command.send_inbox_message · mutation | unverified |  |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/commands/supbrd-plugmod-support.command.update_inbox_conversation · mutation | unverified |  |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/commands/supbrd-plugmod-support.command.create_support_provider · mutation | unverified |  |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/commands/supbrd-plugmod-support.command.update_support_provider · mutation | unverified |  |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/commands/supbrd-plugmod-support.command.delete_support_provider · mutation | unverified |  |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/commands/supbrd-plugmod-support.command.create_support_integration · mutation | unverified |  |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/commands/supbrd-plugmod-support.command.update_support_integration · mutation | unverified |  |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/commands/supbrd-plugmod-support.command.delete_support_integration · mutation | unverified |  |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/commands/supbrd-plugmod-support.command.publish_support_article · mutation | unverified |  |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/data-sources/supbrd-plugmod-support.data_source.support_settings · read | unverified |  |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/data-sources/supbrd-plugmod-support.data_source.unified_inbox_items · read | unverified |  |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/data-sources/supbrd-plugmod-support.data_source.inbox_conversations · read | unverified |  |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/data-sources/supbrd-plugmod-support.data_source.inbox_messages · read | unverified |  |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/data-sources/supbrd-plugmod-support.data_source.support_channels · read | unverified |  |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/data-sources/supbrd-plugmod-support.data_source.support_providers · read | unverified |  |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/data-sources/supbrd-plugmod-support.data_source.support_integrations · read | unverified |  |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/data-sources/supbrd-plugmod-support.data_source.support_portals · read | unverified |  |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/data-sources/supbrd-plugmod-support.data_source.support_categories · read | unverified |  |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/data-sources/supbrd-plugmod-support.data_source.support_folders · read | unverified |  |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/data-sources/supbrd-plugmod-support.data_source.support_articles · read | unverified |  |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/data-sources/supbrd-plugmod-support.data_source.support_assistant_tasks · read | unverified |  |
| supbrd-plugmod-mcp | view | /mcp · render | passed | docs/evidence/plugin-autonomy/targeted-functional-results.json |
| supbrd-plugmod-mcp | view | /mcp · reload | passed | docs/evidence/plugin-autonomy/targeted-functional-results.json |
| supbrd-plugmod-mcp | view | /mcp · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-mcp | view | /mcp · functional | passed | docs/evidence/plugin-autonomy/targeted-functional-results.json |
| supbrd-plugmod-billing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-billing/commands/supbrd-plugmod-billing.command.migrate_products · mutation | unverified |  |
| supbrd-plugmod-billing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-billing/data-sources/supbrd-plugmod-billing.data_source.migration_status · read | unverified |  |
