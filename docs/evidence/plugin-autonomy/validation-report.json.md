# Plugin and view validation

Status: complete.

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
| supbrd-plug-audit | view | /system/audit · functional | passed | docs/evidence/plugin-autonomy/retirement-system-tools-browser.json |
| supbrd-plug-audit | api | /_emdash/api/plugins/supbrd-plug-audit/health · read | passed | docs/evidence/plugin-autonomy/retirement-api-health.txt |
| supbrd-plug-audit | api | /_emdash/api/superboard/plugins/supbrd-plug-audit/commands/supbrd-plug-audit.command.archive_ledger · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-audit.txt |
| supbrd-plug-audit | api | /_emdash/api/superboard/plugins/supbrd-plug-audit/commands/supbrd-plug-audit.command.verify_ledger · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-audit.txt |
| supbrd-plug-audit | api | /_emdash/api/superboard/plugins/supbrd-plug-audit/data-sources/supbrd-plug-audit.data_source.ledger · read | passed | docs/evidence/plugin-autonomy/retirement-api-audit.txt |
| supbrd-plug-audit | api | /_emdash/api/superboard/plugins/supbrd-plug-audit/data-sources/supbrd-plug-audit.data_source.ledger_search · read | passed | docs/evidence/plugin-autonomy/retirement-api-audit.txt |
| supbrd-plug-audit | api | /_emdash/api/superboard/plugins/supbrd-plug-audit/data-sources/supbrd-plug-audit.data_source.archives · read | passed | docs/evidence/plugin-autonomy/retirement-api-audit.txt |
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
| supbrd-plug-content | view | /system/content · functional | passed | docs/evidence/plugin-autonomy/retirement-system-tools-browser.json |
| supbrd-plug-content | api | /_emdash/api/plugins/supbrd-plug-content/health · read | passed | docs/evidence/plugin-autonomy/retirement-api-health.txt |
| supbrd-plug-content | api | /_emdash/api/superboard/plugins/supbrd-plug-content/commands/supbrd-plug-content.command.create_document · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-content.txt |
| supbrd-plug-content | api | /_emdash/api/superboard/plugins/supbrd-plug-content/commands/supbrd-plug-content.command.update_document · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-content.txt |
| supbrd-plug-content | api | /_emdash/api/superboard/plugins/supbrd-plug-content/commands/supbrd-plug-content.command.publish_document · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-content.txt |
| supbrd-plug-content | api | /_emdash/api/superboard/plugins/supbrd-plug-content/data-sources/supbrd-plug-content.data_source.documents · read | passed | docs/evidence/plugin-autonomy/retirement-api-content.txt |
| supbrd-plug-content | api | /_emdash/api/superboard/plugins/supbrd-plug-content/data-sources/supbrd-plug-content.data_source.taxonomies · read | passed | docs/evidence/plugin-autonomy/retirement-api-content.txt |
| supbrd-plug-content | api | /_emdash/api/superboard/plugins/supbrd-plug-content/data-sources/supbrd-plug-content.data_source.revisions · read | passed | docs/evidence/plugin-autonomy/retirement-api-content.txt |
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
| supbrd-plug-products | view | /products/offerings · functional | passed | docs/evidence/plugin-autonomy/retirement-products-browser.json |
| supbrd-plug-products | navigation | /products/offerings · menu-active | passed | docs/evidence/plugin-autonomy/browser-menu-navigation.json |
| supbrd-plug-products | navigation | /products/offerings · menu-disabled | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plug-products | navigation | /products/offerings · menu-reactivated | passed | docs/evidence/plugin-autonomy/browser-menu-lifecycle.json |
| supbrd-plug-products | api | /_emdash/api/plugins/supbrd-plug-products/health · read | passed | docs/evidence/plugin-autonomy/retirement-api-health.txt |
| supbrd-plug-products | api | /_emdash/api/superboard/plugins/supbrd-plug-products/commands/supbrd-plug-products.command.create_product · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-products.txt |
| supbrd-plug-products | api | /_emdash/api/superboard/plugins/supbrd-plug-products/commands/supbrd-plug-products.command.update_product · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-products.txt |
| supbrd-plug-products | api | /_emdash/api/superboard/plugins/supbrd-plug-products/commands/supbrd-plug-products.command.archive_product · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-products.txt |
| supbrd-plug-products | api | /_emdash/api/superboard/plugins/supbrd-plug-products/commands/supbrd-plug-products.command.create_package · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-products.txt |
| supbrd-plug-products | api | /_emdash/api/superboard/plugins/supbrd-plug-products/commands/supbrd-plug-products.command.update_package · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-products.txt |
| supbrd-plug-products | api | /_emdash/api/superboard/plugins/supbrd-plug-products/commands/supbrd-plug-products.command.archive_package · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-products.txt |
| supbrd-plug-products | api | /_emdash/api/superboard/plugins/supbrd-plug-products/commands/supbrd-plug-products.command.create_offering · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-products.txt |
| supbrd-plug-products | api | /_emdash/api/superboard/plugins/supbrd-plug-products/commands/supbrd-plug-products.command.update_offering · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-products.txt |
| supbrd-plug-products | api | /_emdash/api/superboard/plugins/supbrd-plug-products/commands/supbrd-plug-products.command.archive_offering · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-products.txt |
| supbrd-plug-products | api | /_emdash/api/superboard/plugins/supbrd-plug-products/commands/supbrd-plug-products.command.create_entitlement · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-products.txt |
| supbrd-plug-products | api | /_emdash/api/superboard/plugins/supbrd-plug-products/commands/supbrd-plug-products.command.update_entitlement · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-products.txt |
| supbrd-plug-products | api | /_emdash/api/superboard/plugins/supbrd-plug-products/commands/supbrd-plug-products.command.archive_entitlement · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-products.txt |
| supbrd-plug-products | api | /_emdash/api/superboard/plugins/supbrd-plug-products/commands/supbrd-plug-products.command.sync_store_catalog · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-products.txt |
| supbrd-plug-products | api | /_emdash/api/superboard/plugins/supbrd-plug-products/data-sources/supbrd-plug-products.data_source.products · read | passed | docs/evidence/plugin-autonomy/retirement-api-products.txt |
| supbrd-plug-products | api | /_emdash/api/superboard/plugins/supbrd-plug-products/data-sources/supbrd-plug-products.data_source.packages · read | passed | docs/evidence/plugin-autonomy/retirement-api-products.txt |
| supbrd-plug-products | api | /_emdash/api/superboard/plugins/supbrd-plug-products/data-sources/supbrd-plug-products.data_source.offerings · read | passed | docs/evidence/plugin-autonomy/retirement-api-products.txt |
| supbrd-plug-products | api | /_emdash/api/superboard/plugins/supbrd-plug-products/data-sources/supbrd-plug-products.data_source.entitlements · read | passed | docs/evidence/plugin-autonomy/retirement-api-products.txt |
| supbrd-plug-products | api | /_emdash/api/superboard/plugins/supbrd-plug-products/data-sources/supbrd-plug-products.data_source.product_statistics · read | passed | docs/evidence/plugin-autonomy/retirement-api-products.txt |
| supbrd-plug-products | api | /_emdash/api/superboard/plugins/supbrd-plug-products/data-sources/supbrd-plug-products.data_source.store_sync_runs · read | passed | docs/evidence/plugin-autonomy/retirement-api-products.txt |
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
| supbrd-plug-settings | view | /app/android-setup · functional | passed | docs/evidence/plugin-autonomy/retirement-sdk-browser.json |
| supbrd-plug-settings | view | /app/ios-setup · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-settings | view | /app/ios-setup · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-settings | view | /app/ios-setup · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-settings | view | /app/ios-setup · functional | passed | docs/evidence/plugin-autonomy/retirement-sdk-browser.json |
| supbrd-plug-settings | view | /app/libraries · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-settings | view | /app/libraries · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-settings | view | /app/libraries · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-settings | view | /app/libraries · functional | passed | docs/evidence/plugin-autonomy/retirement-libraries-browser.json |
| supbrd-plug-settings | view | /app/web-setup · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-settings | view | /app/web-setup · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-settings | view | /app/web-setup · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-settings | view | /app/web-setup · functional | passed | docs/evidence/plugin-autonomy/retirement-sdk-browser.json |
| supbrd-plug-settings | view | /project-settings · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-settings | view | /project-settings · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-settings | view | /project-settings · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-settings | view | /project-settings · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
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
| supbrd-plug-settings | api | /_emdash/api/plugins/supbrd-plug-settings/health · read | passed | docs/evidence/plugin-autonomy/retirement-api-health.txt |
| supbrd-plug-settings | api | /_emdash/api/superboard/plugins/supbrd-plug-settings/commands/supbrd-plug-settings.command.update_effective_settings · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-settings.txt |
| supbrd-plug-settings | api | /_emdash/api/superboard/plugins/supbrd-plug-settings/commands/supbrd-plug-settings.command.save_sdk_configuration · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-settings.txt |
| supbrd-plug-settings | api | /_emdash/api/superboard/plugins/supbrd-plug-settings/commands/supbrd-plug-settings.command.test_sdk_configuration · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-settings.txt |
| supbrd-plug-settings | api | /_emdash/api/superboard/plugins/supbrd-plug-settings/data-sources/supbrd-plug-settings.data_source.effective_settings · read | passed | docs/evidence/plugin-autonomy/retirement-api-settings.txt |
| supbrd-plug-settings | api | /_emdash/api/superboard/plugins/supbrd-plug-settings/data-sources/supbrd-plug-settings.data_source.settings_versions · read | passed | docs/evidence/plugin-autonomy/retirement-api-settings.txt |
| supbrd-plug-settings | api | /_emdash/api/superboard/plugins/supbrd-plug-settings/data-sources/supbrd-plug-settings.data_source.sdk_configurations · read | passed | docs/evidence/plugin-autonomy/retirement-api-settings.txt |
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
| supbrd-plug-user | view | /account · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plug-user | view | /app/access-key · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /app/access-key · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /app/access-key · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /app/access-key · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plug-user | view | /app/customers · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /app/customers · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /app/customers · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /app/customers · functional | passed | docs/evidence/plugin-autonomy/retirement-app-audience-browser.json |
| supbrd-plug-user | view | /app/members · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /app/members · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /app/members · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /app/members · functional | passed | docs/evidence/plugin-autonomy/retirement-app-audience-browser.json |
| supbrd-plug-user | view | /app/profile · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /app/profile · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /app/profile · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /app/profile · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plug-user | view | /app/referrals · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /app/referrals · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /app/referrals · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /app/referrals · functional | passed | docs/evidence/plugin-autonomy/retirement-app-audience-browser.json |
| supbrd-plug-user | view | /app/users · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /app/users · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /app/users · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /app/users · functional | passed | docs/evidence/plugin-autonomy/retirement-app-audience-browser.json |
| supbrd-plug-user | view | /identity · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity · functional | passed | docs/evidence/plugin-autonomy/retirement-identity-browser.json |
| supbrd-plug-user | view | /identity/:lang · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang · functional | passed | docs/evidence/plugin-autonomy/retirement-identity-browser.json |
| supbrd-plug-user | view | /identity/:lang/account · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/account · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/account · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/account · functional | passed | docs/evidence/plugin-autonomy/retirement-identity-browser.json |
| supbrd-plug-user | view | /identity/:lang/apps · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/apps · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/apps · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/apps · functional | passed | docs/evidence/plugin-autonomy/retirement-identity-browser.json |
| supbrd-plug-user | view | /identity/:lang/apps/:id · render | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/apps/:id · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/apps/:id · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/apps/:id · functional | passed | docs/evidence/plugin-autonomy/retirement-identity-browser.json |
| supbrd-plug-user | view | /identity/:lang/apps/banners/:id · render | passed | docs/evidence/plugin-autonomy/identity-new-fixture-routes.json |
| supbrd-plug-user | view | /identity/:lang/apps/banners/:id · reload | passed | docs/evidence/plugin-autonomy/identity-new-fixture-routes.json |
| supbrd-plug-user | view | /identity/:lang/apps/banners/:id · navigation | passed | docs/evidence/plugin-autonomy/identity-new-fixture-routes.json |
| supbrd-plug-user | view | /identity/:lang/apps/banners/:id · functional | passed | docs/evidence/plugin-autonomy/retirement-identity-browser.json |
| supbrd-plug-user | view | /identity/:lang/apps/banners/new · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/apps/banners/new · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/apps/banners/new · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/apps/banners/new · functional | passed | docs/evidence/plugin-autonomy/retirement-identity-browser.json |
| supbrd-plug-user | view | /identity/:lang/apps/new · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/apps/new · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/apps/new · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/apps/new · functional | passed | docs/evidence/plugin-autonomy/retirement-identity-browser.json |
| supbrd-plug-user | view | /identity/:lang/dashboard · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/dashboard · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/dashboard · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/dashboard · functional | passed | docs/evidence/plugin-autonomy/retirement-identity-browser.json |
| supbrd-plug-user | view | /identity/:lang/logs · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/logs · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/logs · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/logs · functional | passed | docs/evidence/plugin-autonomy/retirement-identity-browser.json |
| supbrd-plug-user | view | /identity/:lang/logs/email/:id · render | passed | docs/evidence/plugin-autonomy/retirement-identity-details-browser.json |
| supbrd-plug-user | view | /identity/:lang/logs/email/:id · reload | passed | docs/evidence/plugin-autonomy/retirement-identity-details-browser.json |
| supbrd-plug-user | view | /identity/:lang/logs/email/:id · navigation | passed | docs/evidence/plugin-autonomy/retirement-identity-details-browser.json |
| supbrd-plug-user | view | /identity/:lang/logs/email/:id · functional | passed | docs/evidence/plugin-autonomy/retirement-identity-details-browser.json |
| supbrd-plug-user | view | /identity/:lang/logs/sign-in/:id · render | passed | docs/evidence/plugin-autonomy/retirement-identity-details-browser.json |
| supbrd-plug-user | view | /identity/:lang/logs/sign-in/:id · reload | passed | docs/evidence/plugin-autonomy/retirement-identity-details-browser.json |
| supbrd-plug-user | view | /identity/:lang/logs/sign-in/:id · navigation | passed | docs/evidence/plugin-autonomy/retirement-identity-details-browser.json |
| supbrd-plug-user | view | /identity/:lang/logs/sign-in/:id · functional | passed | docs/evidence/plugin-autonomy/retirement-identity-details-browser.json |
| supbrd-plug-user | view | /identity/:lang/logs/sms/:id · render | passed | docs/evidence/plugin-autonomy/retirement-identity-details-browser.json |
| supbrd-plug-user | view | /identity/:lang/logs/sms/:id · reload | passed | docs/evidence/plugin-autonomy/retirement-identity-details-browser.json |
| supbrd-plug-user | view | /identity/:lang/logs/sms/:id · navigation | passed | docs/evidence/plugin-autonomy/retirement-identity-details-browser.json |
| supbrd-plug-user | view | /identity/:lang/logs/sms/:id · functional | passed | docs/evidence/plugin-autonomy/retirement-identity-details-browser.json |
| supbrd-plug-user | view | /identity/:lang/orgs · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/orgs · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/orgs · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/orgs · functional | passed | docs/evidence/plugin-autonomy/retirement-identity-browser.json |
| supbrd-plug-user | view | /identity/:lang/orgs/:id · render | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/orgs/:id · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/orgs/:id · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/orgs/:id · functional | passed | docs/evidence/plugin-autonomy/retirement-identity-browser.json |
| supbrd-plug-user | view | /identity/:lang/orgs/new · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/orgs/new · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/orgs/new · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/orgs/new · functional | passed | docs/evidence/plugin-autonomy/retirement-identity-browser.json |
| supbrd-plug-user | view | /identity/:lang/roles · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/roles · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/roles · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/roles · functional | passed | docs/evidence/plugin-autonomy/retirement-identity-browser.json |
| supbrd-plug-user | view | /identity/:lang/roles/:id · render | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/roles/:id · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/roles/:id · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/roles/:id · functional | passed | docs/evidence/plugin-autonomy/retirement-identity-browser.json |
| supbrd-plug-user | view | /identity/:lang/roles/new · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/roles/new · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/roles/new · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/roles/new · functional | passed | docs/evidence/plugin-autonomy/retirement-identity-browser.json |
| supbrd-plug-user | view | /identity/:lang/saml · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/saml · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/saml · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/saml · functional | passed | docs/evidence/plugin-autonomy/retirement-identity-browser.json |
| supbrd-plug-user | view | /identity/:lang/saml/:id · render | passed | docs/evidence/plugin-autonomy/identity-new-fixture-routes.json |
| supbrd-plug-user | view | /identity/:lang/saml/:id · reload | passed | docs/evidence/plugin-autonomy/identity-new-fixture-routes.json |
| supbrd-plug-user | view | /identity/:lang/saml/:id · navigation | passed | docs/evidence/plugin-autonomy/identity-new-fixture-routes.json |
| supbrd-plug-user | view | /identity/:lang/saml/:id · functional | passed | docs/evidence/plugin-autonomy/retirement-identity-browser.json |
| supbrd-plug-user | view | /identity/:lang/saml/new · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/saml/new · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/saml/new · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/saml/new · functional | passed | docs/evidence/plugin-autonomy/retirement-identity-browser.json |
| supbrd-plug-user | view | /identity/:lang/scopes · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/scopes · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/scopes · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/scopes · functional | passed | docs/evidence/plugin-autonomy/retirement-identity-browser.json |
| supbrd-plug-user | view | /identity/:lang/scopes/:id · render | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/scopes/:id · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/scopes/:id · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/scopes/:id · functional | passed | docs/evidence/plugin-autonomy/retirement-identity-browser.json |
| supbrd-plug-user | view | /identity/:lang/scopes/new · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/scopes/new · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/scopes/new · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/scopes/new · functional | passed | docs/evidence/plugin-autonomy/retirement-identity-browser.json |
| supbrd-plug-user | view | /identity/:lang/user-attributes · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/user-attributes · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/user-attributes · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/user-attributes · functional | passed | docs/evidence/plugin-autonomy/retirement-identity-browser.json |
| supbrd-plug-user | view | /identity/:lang/user-attributes/:id · render | passed | docs/evidence/plugin-autonomy/identity-new-fixture-routes.json |
| supbrd-plug-user | view | /identity/:lang/user-attributes/:id · reload | passed | docs/evidence/plugin-autonomy/identity-new-fixture-routes.json |
| supbrd-plug-user | view | /identity/:lang/user-attributes/:id · navigation | passed | docs/evidence/plugin-autonomy/identity-new-fixture-routes.json |
| supbrd-plug-user | view | /identity/:lang/user-attributes/:id · functional | passed | docs/evidence/plugin-autonomy/retirement-identity-browser.json |
| supbrd-plug-user | view | /identity/:lang/user-attributes/new · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/user-attributes/new · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/user-attributes/new · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/user-attributes/new · functional | passed | docs/evidence/plugin-autonomy/retirement-identity-browser.json |
| supbrd-plug-user | view | /identity/:lang/users · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/users · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/users · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /identity/:lang/users · functional | passed | docs/evidence/plugin-autonomy/retirement-identity-browser.json |
| supbrd-plug-user | view | /identity/:lang/users/:authId · render | passed | docs/evidence/plugin-autonomy/retirement-identity-details-browser.json |
| supbrd-plug-user | view | /identity/:lang/users/:authId · reload | passed | docs/evidence/plugin-autonomy/retirement-identity-details-browser.json |
| supbrd-plug-user | view | /identity/:lang/users/:authId · navigation | passed | docs/evidence/plugin-autonomy/retirement-identity-details-browser.json |
| supbrd-plug-user | view | /identity/:lang/users/:authId · functional | passed | docs/evidence/plugin-autonomy/retirement-identity-details-browser.json |
| supbrd-plug-user | view | /login · render | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /login · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /login · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /login · functional | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /new_password · render | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /new_password · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /new_password · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /new_password · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plug-user | view | /register · render | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /register · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /register · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /register · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plug-user | view | /register/with_email · render | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /register/with_email · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /register/with_email · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /register/with_email · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plug-user | view | /reset_password · render | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /reset_password · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /reset_password · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plug-user | view | /reset_password · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
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
| supbrd-plug-user | api | /_emdash/api/plugins/supbrd-plug-user/health · read | passed | docs/evidence/plugin-autonomy/retirement-api-health.txt |
| supbrd-plug-user | api | /_emdash/api/superboard/plugins/supbrd-plug-user/commands/supbrd-plug-user.command.application_sign_in · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-user.txt |
| supbrd-plug-user | api | /_emdash/api/superboard/plugins/supbrd-plug-user/commands/supbrd-plug-user.command.update_profile · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-user.txt |
| supbrd-plug-user | api | /_emdash/api/superboard/plugins/supbrd-plug-user/commands/supbrd-plug-user.command.suspend_member · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-user.txt |
| supbrd-plug-user | api | /_emdash/api/superboard/plugins/supbrd-plug-user/commands/supbrd-plug-user.command.link_provider · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-user.txt |
| supbrd-plug-user | api | /_emdash/api/superboard/plugins/supbrd-plug-user/commands/supbrd-plug-user.command.revoke_application_session · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-user.txt |
| supbrd-plug-user | api | /_emdash/api/superboard/plugins/supbrd-plug-user/data-sources/supbrd-plug-user.data_source.current_profile · read | passed | docs/evidence/plugin-autonomy/retirement-api-user.txt |
| supbrd-plug-user | api | /_emdash/api/superboard/plugins/supbrd-plug-user/data-sources/supbrd-plug-user.data_source.members · read | passed | docs/evidence/plugin-autonomy/retirement-api-user.txt |
| supbrd-plug-user | api | /_emdash/api/superboard/plugins/supbrd-plug-user/data-sources/supbrd-plug-user.data_source.linked_providers · read | passed | docs/evidence/plugin-autonomy/retirement-api-user.txt |
| supbrd-plug-user | api | /_emdash/api/superboard/plugins/supbrd-plug-user/data-sources/supbrd-plug-user.data_source.active_sessions · read | passed | docs/evidence/plugin-autonomy/retirement-api-user.txt |
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
| supbrd-plugmod-analytics | view | / · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plugmod-analytics | view | /analytics · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plugmod-analytics | view | /analytics/alerts · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/alerts · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/alerts · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/alerts · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plugmod-analytics | view | /analytics/cohorts · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/cohorts · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/cohorts · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/cohorts · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plugmod-analytics | view | /analytics/crashes · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/crashes · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/crashes · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/crashes · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plugmod-analytics | view | /analytics/dashboards · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/dashboards · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/dashboards · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/dashboards · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plugmod-analytics | view | /analytics/dimensions · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/dimensions · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/dimensions · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/dimensions · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plugmod-analytics | view | /analytics/events · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/events · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/events · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/events · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plugmod-analytics | view | /analytics/feedback · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/feedback · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/feedback · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/feedback · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plugmod-analytics | view | /analytics/insights · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/insights · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/insights · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/insights · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plugmod-analytics | view | /analytics/installations · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/installations · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/installations · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/installations · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plugmod-analytics | view | /analytics/purchases · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/purchases · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/purchases · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/purchases · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plugmod-analytics | view | /analytics/remote-config · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/remote-config · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/remote-config · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/remote-config · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plugmod-analytics | view | /analytics/reports · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/reports · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/reports · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/reports · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plugmod-analytics | view | /analytics/settings · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/settings · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/settings · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/settings · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plugmod-analytics | view | /analytics/users · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/users · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/users · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/users · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plugmod-analytics | view | /analytics/views · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/views · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/views · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /analytics/views · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plugmod-analytics | view | /app · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /app · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /app · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /app · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plugmod-analytics | view | /dashboard · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /dashboard · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /dashboard · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-analytics | view | /dashboard · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
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
| supbrd-plugmod-analytics | api | /_emdash/api/plugins/supbrd-plugmod-analytics/health · read | passed | docs/evidence/plugin-autonomy/retirement-api-health.txt |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/commands/supbrd-plugmod-analytics.command.create_analytics_report · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-analytics.txt |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/commands/supbrd-plugmod-analytics.command.update_analytics_report · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-analytics.txt |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/commands/supbrd-plugmod-analytics.command.delete_analytics_report · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-analytics.txt |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/commands/supbrd-plugmod-analytics.command.create_analytics_operation · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-analytics.txt |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/commands/supbrd-plugmod-analytics.command.create_analytics_dashboard · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-analytics.txt |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/commands/supbrd-plugmod-analytics.command.update_analytics_dashboard · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-analytics.txt |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/commands/supbrd-plugmod-analytics.command.delete_analytics_dashboard · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-analytics.txt |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/commands/supbrd-plugmod-analytics.command.create_analytics_cohort · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-analytics.txt |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/commands/supbrd-plugmod-analytics.command.evaluate_analytics_cohort · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-analytics.txt |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/commands/supbrd-plugmod-analytics.command.upsert_analytics_remote_config · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-analytics.txt |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/commands/supbrd-plugmod-analytics.command.create_analytics_alert · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-analytics.txt |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/commands/supbrd-plugmod-analytics.command.update_analytics_settings · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-analytics.txt |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/data-sources/supbrd-plugmod-analytics.data_source.analytics_overview · read | passed | docs/evidence/plugin-autonomy/retirement-api-analytics.txt |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/data-sources/supbrd-plugmod-analytics.data_source.analytics_events · read | passed | docs/evidence/plugin-autonomy/retirement-api-analytics.txt |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/data-sources/supbrd-plugmod-analytics.data_source.analytics_event_analysis · read | passed | docs/evidence/plugin-autonomy/retirement-api-analytics.txt |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/data-sources/supbrd-plugmod-analytics.data_source.analytics_installations · read | passed | docs/evidence/plugin-autonomy/retirement-api-analytics.txt |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/data-sources/supbrd-plugmod-analytics.data_source.analytics_purchases · read | passed | docs/evidence/plugin-autonomy/retirement-api-analytics.txt |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/data-sources/supbrd-plugmod-analytics.data_source.analytics_retention · read | passed | docs/evidence/plugin-autonomy/retirement-api-analytics.txt |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/data-sources/supbrd-plugmod-analytics.data_source.analytics_reports · read | passed | docs/evidence/plugin-autonomy/retirement-api-analytics.txt |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/data-sources/supbrd-plugmod-analytics.data_source.analytics_dashboards · read | passed | docs/evidence/plugin-autonomy/retirement-api-analytics.txt |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/data-sources/supbrd-plugmod-analytics.data_source.analytics_sessions · read | passed | docs/evidence/plugin-autonomy/retirement-api-analytics.txt |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/data-sources/supbrd-plugmod-analytics.data_source.analytics_profiles · read | passed | docs/evidence/plugin-autonomy/retirement-api-analytics.txt |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/data-sources/supbrd-plugmod-analytics.data_source.analytics_views · read | passed | docs/evidence/plugin-autonomy/retirement-api-analytics.txt |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/data-sources/supbrd-plugmod-analytics.data_source.analytics_dimensions · read | passed | docs/evidence/plugin-autonomy/retirement-api-analytics.txt |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/data-sources/supbrd-plugmod-analytics.data_source.analytics_crashes · read | passed | docs/evidence/plugin-autonomy/retirement-api-analytics.txt |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/data-sources/supbrd-plugmod-analytics.data_source.analytics_feedback · read | passed | docs/evidence/plugin-autonomy/retirement-api-analytics.txt |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/data-sources/supbrd-plugmod-analytics.data_source.analytics_cohorts · read | passed | docs/evidence/plugin-autonomy/retirement-api-analytics.txt |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/data-sources/supbrd-plugmod-analytics.data_source.analytics_remote_config · read | passed | docs/evidence/plugin-autonomy/retirement-api-analytics.txt |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/data-sources/supbrd-plugmod-analytics.data_source.analytics_alerts · read | passed | docs/evidence/plugin-autonomy/retirement-api-analytics.txt |
| supbrd-plugmod-analytics | api | /_emdash/api/superboard/plugins/supbrd-plugmod-analytics/data-sources/supbrd-plugmod-analytics.data_source.analytics_settings · read | passed | docs/evidence/plugin-autonomy/retirement-api-analytics.txt |
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
| supbrd-plugmod-billing | view | /products/customers · functional | passed | docs/evidence/plugin-autonomy/retirement-billing-customers-browser.json |
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
| supbrd-plugmod-billing | api | /_emdash/api/plugins/supbrd-plugmod-billing/health · read | passed | docs/evidence/plugin-autonomy/retirement-api-health.txt |
| supbrd-plugmod-billing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-billing/commands/supbrd-plugmod-billing.command.create_purchase · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-billing.txt |
| supbrd-plugmod-billing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-billing/commands/supbrd-plugmod-billing.command.create_refund · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-billing.txt |
| supbrd-plugmod-billing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-billing/commands/supbrd-plugmod-billing.command.update_refund · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-billing.txt |
| supbrd-plugmod-billing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-billing/commands/supbrd-plugmod-billing.command.update_subscription · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-billing.txt |
| supbrd-plugmod-billing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-billing/commands/supbrd-plugmod-billing.command.reconcile_store · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-billing.txt |
| supbrd-plugmod-billing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-billing/data-sources/supbrd-plugmod-billing.data_source.purchases · read | passed | docs/evidence/plugin-autonomy/retirement-api-billing.txt |
| supbrd-plugmod-billing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-billing/data-sources/supbrd-plugmod-billing.data_source.purchase · read | passed | docs/evidence/plugin-autonomy/retirement-api-billing.txt |
| supbrd-plugmod-billing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-billing/data-sources/supbrd-plugmod-billing.data_source.refunds · read | passed | docs/evidence/plugin-autonomy/retirement-api-billing.txt |
| supbrd-plugmod-billing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-billing/data-sources/supbrd-plugmod-billing.data_source.subscriptions · read | passed | docs/evidence/plugin-autonomy/retirement-api-billing.txt |
| supbrd-plugmod-billing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-billing/data-sources/supbrd-plugmod-billing.data_source.financial_customer_entitlements · read | passed | docs/evidence/plugin-autonomy/retirement-api-billing.txt |
| supbrd-plugmod-billing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-billing/data-sources/supbrd-plugmod-billing.data_source.billing_ledger · read | passed | docs/evidence/plugin-autonomy/retirement-api-billing.txt |
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
| supbrd-plugmod-dynamic-links | view | /dynamic-links/campaigns · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/campaigns/:id · render | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json, docs/evidence/plugin-autonomy/campaign-functional-complete.json |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/campaigns/:id · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json, docs/evidence/plugin-autonomy/campaign-functional-complete.json |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/campaigns/:id · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json, docs/evidence/plugin-autonomy/campaign-functional-complete.json |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/campaigns/:id · functional | passed | docs/evidence/plugin-autonomy/campaign-functional-complete.json |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/domain · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/domain · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/domain · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/domain · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/links · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/links · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/links · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/links · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/redirect-rules · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/redirect-rules · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/redirect-rules · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/redirect-rules · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/social-media-preview · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/social-media-preview · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/social-media-preview · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/social-media-preview · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/tracking · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/tracking · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/tracking · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-dynamic-links | view | /dynamic-links/tracking · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
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
| supbrd-plugmod-dynamic-links | api | /_emdash/api/plugins/supbrd-plugmod-dynamic-links/health · read | passed | docs/evidence/plugin-autonomy/retirement-api-health.txt |
| supbrd-plugmod-dynamic-links | api | /_emdash/api/superboard/plugins/supbrd-plugmod-dynamic-links/commands/supbrd-plugmod-dynamic-links.command.create_link · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-dynamic-links.txt |
| supbrd-plugmod-dynamic-links | api | /_emdash/api/superboard/plugins/supbrd-plugmod-dynamic-links/commands/supbrd-plugmod-dynamic-links.command.update_link · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-dynamic-links.txt |
| supbrd-plugmod-dynamic-links | api | /_emdash/api/superboard/plugins/supbrd-plugmod-dynamic-links/commands/supbrd-plugmod-dynamic-links.command.delete_link · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-dynamic-links.txt |
| supbrd-plugmod-dynamic-links | api | /_emdash/api/superboard/plugins/supbrd-plugmod-dynamic-links/commands/supbrd-plugmod-dynamic-links.command.create_link_campaign · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-dynamic-links.txt |
| supbrd-plugmod-dynamic-links | api | /_emdash/api/superboard/plugins/supbrd-plugmod-dynamic-links/commands/supbrd-plugmod-dynamic-links.command.delete_link_campaign · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-dynamic-links.txt |
| supbrd-plugmod-dynamic-links | api | /_emdash/api/superboard/plugins/supbrd-plugmod-dynamic-links/commands/supbrd-plugmod-dynamic-links.command.create_redirect_rule · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-dynamic-links.txt |
| supbrd-plugmod-dynamic-links | api | /_emdash/api/superboard/plugins/supbrd-plugmod-dynamic-links/commands/supbrd-plugmod-dynamic-links.command.update_redirect_rule · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-dynamic-links.txt |
| supbrd-plugmod-dynamic-links | api | /_emdash/api/superboard/plugins/supbrd-plugmod-dynamic-links/commands/supbrd-plugmod-dynamic-links.command.delete_redirect_rule · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-dynamic-links.txt |
| supbrd-plugmod-dynamic-links | api | /_emdash/api/superboard/plugins/supbrd-plugmod-dynamic-links/commands/supbrd-plugmod-dynamic-links.command.create_domain · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-dynamic-links.txt |
| supbrd-plugmod-dynamic-links | api | /_emdash/api/superboard/plugins/supbrd-plugmod-dynamic-links/commands/supbrd-plugmod-dynamic-links.command.verify_domain · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-dynamic-links.txt |
| supbrd-plugmod-dynamic-links | api | /_emdash/api/superboard/plugins/supbrd-plugmod-dynamic-links/commands/supbrd-plugmod-dynamic-links.command.delete_domain · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-dynamic-links.txt |
| supbrd-plugmod-dynamic-links | api | /_emdash/api/superboard/plugins/supbrd-plugmod-dynamic-links/commands/supbrd-plugmod-dynamic-links.command.save_social_preview · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-dynamic-links.txt |
| supbrd-plugmod-dynamic-links | api | /_emdash/api/superboard/plugins/supbrd-plugmod-dynamic-links/commands/supbrd-plugmod-dynamic-links.command.save_tracking · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-dynamic-links.txt |
| supbrd-plugmod-dynamic-links | api | /_emdash/api/superboard/plugins/supbrd-plugmod-dynamic-links/data-sources/supbrd-plugmod-dynamic-links.data_source.links · read | passed | docs/evidence/plugin-autonomy/retirement-api-dynamic-links.txt |
| supbrd-plugmod-dynamic-links | api | /_emdash/api/superboard/plugins/supbrd-plugmod-dynamic-links/data-sources/supbrd-plugmod-dynamic-links.data_source.resolved_link · read | passed | docs/evidence/plugin-autonomy/retirement-api-dynamic-links.txt |
| supbrd-plugmod-dynamic-links | api | /_emdash/api/superboard/plugins/supbrd-plugmod-dynamic-links/data-sources/supbrd-plugmod-dynamic-links.data_source.link_campaigns · read | passed | docs/evidence/plugin-autonomy/retirement-api-dynamic-links.txt |
| supbrd-plugmod-dynamic-links | api | /_emdash/api/superboard/plugins/supbrd-plugmod-dynamic-links/data-sources/supbrd-plugmod-dynamic-links.data_source.link_campaign_analytics · read | passed | docs/evidence/plugin-autonomy/retirement-api-dynamic-links.txt |
| supbrd-plugmod-dynamic-links | api | /_emdash/api/superboard/plugins/supbrd-plugmod-dynamic-links/data-sources/supbrd-plugmod-dynamic-links.data_source.redirect_rules · read | passed | docs/evidence/plugin-autonomy/retirement-api-dynamic-links.txt |
| supbrd-plugmod-dynamic-links | api | /_emdash/api/superboard/plugins/supbrd-plugmod-dynamic-links/data-sources/supbrd-plugmod-dynamic-links.data_source.domains · read | passed | docs/evidence/plugin-autonomy/retirement-api-dynamic-links.txt |
| supbrd-plugmod-dynamic-links | api | /_emdash/api/superboard/plugins/supbrd-plugmod-dynamic-links/data-sources/supbrd-plugmod-dynamic-links.data_source.social_preview · read | passed | docs/evidence/plugin-autonomy/retirement-api-dynamic-links.txt |
| supbrd-plugmod-dynamic-links | api | /_emdash/api/superboard/plugins/supbrd-plugmod-dynamic-links/data-sources/supbrd-plugmod-dynamic-links.data_source.tracking · read | passed | docs/evidence/plugin-autonomy/retirement-api-dynamic-links.txt |
| supbrd-plugmod-dynamic-links | api | /_emdash/api/superboard/plugins/supbrd-plugmod-dynamic-links/data-sources/supbrd-plugmod-dynamic-links.data_source.link_statistics · read | passed | docs/evidence/plugin-autonomy/retirement-api-dynamic-links.txt |
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
| supbrd-plugmod-email | api | /_emdash/api/plugins/supbrd-plugmod-email/health · read | passed | docs/evidence/plugin-autonomy/retirement-api-health.txt |
| supbrd-plugmod-email | api | /_emdash/api/superboard/plugins/supbrd-plugmod-email/commands/supbrd-plugmod-email.command.send_transactional_email · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-email.txt |
| supbrd-plugmod-email | api | /_emdash/api/superboard/plugins/supbrd-plugmod-email/commands/supbrd-plugmod-email.command.save_smtp_settings · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-email.txt |
| supbrd-plugmod-email | api | /_emdash/api/superboard/plugins/supbrd-plugmod-email/commands/supbrd-plugmod-email.command.delete_smtp_settings · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-email.txt |
| supbrd-plugmod-email | api | /_emdash/api/superboard/plugins/supbrd-plugmod-email/commands/supbrd-plugmod-email.command.test_smtp_settings · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-email.txt |
| supbrd-plugmod-email | api | /_emdash/api/superboard/plugins/supbrd-plugmod-email/commands/supbrd-plugmod-email.command.verify_smtp_domain · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-email.txt |
| supbrd-plugmod-email | api | /_emdash/api/superboard/plugins/supbrd-plugmod-email/commands/supbrd-plugmod-email.command.retry_delivery_outbox · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-email.txt |
| supbrd-plugmod-email | api | /_emdash/api/superboard/plugins/supbrd-plugmod-email/commands/supbrd-plugmod-email.command.replay_dead_letter · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-email.txt |
| supbrd-plugmod-email | api | /_emdash/api/superboard/plugins/supbrd-plugmod-email/commands/supbrd-plugmod-email.command.discard_dead_letter · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-email.txt |
| supbrd-plugmod-email | api | /_emdash/api/superboard/plugins/supbrd-plugmod-email/data-sources/supbrd-plugmod-email.data_source.smtp_settings · read | passed | docs/evidence/plugin-autonomy/retirement-api-email.txt |
| supbrd-plugmod-email | api | /_emdash/api/superboard/plugins/supbrd-plugmod-email/data-sources/supbrd-plugmod-email.data_source.delivery_outbox · read | passed | docs/evidence/plugin-autonomy/retirement-api-email.txt |
| supbrd-plugmod-email | api | /_emdash/api/superboard/plugins/supbrd-plugmod-email/data-sources/supbrd-plugmod-email.data_source.dead_letters · read | passed | docs/evidence/plugin-autonomy/retirement-api-email.txt |
| supbrd-plugmod-email | api | /_emdash/api/superboard/plugins/supbrd-plugmod-email/data-sources/supbrd-plugmod-email.data_source.provider_webhooks · read | passed | docs/evidence/plugin-autonomy/retirement-api-email.txt |
| supbrd-plugmod-email | api | /_emdash/api/superboard/plugins/supbrd-plugmod-email/data-sources/supbrd-plugmod-email.data_source.provider_events · read | passed | docs/evidence/plugin-autonomy/retirement-api-email.txt |
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
| supbrd-plugmod-files | api | /_emdash/api/plugins/supbrd-plugmod-files/health · read | passed | docs/evidence/plugin-autonomy/retirement-api-health.txt |
| supbrd-plugmod-files | api | /_emdash/api/superboard/plugins/supbrd-plugmod-files/commands/supbrd-plugmod-files.command.create_upload_ticket · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-files.txt |
| supbrd-plugmod-files | api | /_emdash/api/superboard/plugins/supbrd-plugmod-files/commands/supbrd-plugmod-files.command.complete_upload · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-files.txt |
| supbrd-plugmod-files | api | /_emdash/api/superboard/plugins/supbrd-plugmod-files/commands/supbrd-plugmod-files.command.delete_object · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-files.txt |
| supbrd-plugmod-files | api | /_emdash/api/superboard/plugins/supbrd-plugmod-files/commands/supbrd-plugmod-files.command.collect_garbage · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-files.txt |
| supbrd-plugmod-files | api | /_emdash/api/superboard/plugins/supbrd-plugmod-files/data-sources/supbrd-plugmod-files.data_source.objects · read | passed | docs/evidence/plugin-autonomy/retirement-api-files.txt |
| supbrd-plugmod-files | api | /_emdash/api/superboard/plugins/supbrd-plugmod-files/data-sources/supbrd-plugmod-files.data_source.object_metadata · read | passed | docs/evidence/plugin-autonomy/retirement-api-files.txt |
| supbrd-plugmod-files | api | /_emdash/api/superboard/plugins/supbrd-plugmod-files/data-sources/supbrd-plugmod-files.data_source.download_ticket · read | passed | docs/evidence/plugin-autonomy/retirement-api-files.txt |
| supbrd-plugmod-files | api | /_emdash/api/superboard/plugins/supbrd-plugmod-files/data-sources/supbrd-plugmod-files.data_source.storage_usage · read | passed | docs/evidence/plugin-autonomy/retirement-api-files.txt |
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
| supbrd-plugmod-flows | view | /flows · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plugmod-flows | view | /flows/components · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/components · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/components · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/components · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plugmod-flows | view | /flows/launchpad · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/launchpad · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/launchpad · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/launchpad · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plugmod-flows | view | /flows/settings/environments · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/settings/environments · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/settings/environments · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/settings/environments · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plugmod-flows | view | /flows/settings/localization · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/settings/localization · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/settings/localization · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/settings/localization · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plugmod-flows | view | /flows/settings/sdk · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/settings/sdk · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/settings/sdk · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/settings/sdk · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plugmod-flows | view | /flows/users · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/users · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/users · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/users · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plugmod-flows | view | /flows/users/:id · render | passed | docs/evidence/plugin-autonomy/flows-user-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/users/:id · reload | passed | docs/evidence/plugin-autonomy/flows-user-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/users/:id · navigation | passed | docs/evidence/plugin-autonomy/flows-user-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/users/:id · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plugmod-flows | view | /flows/workflows · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/workflows · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/workflows · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/workflows · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plugmod-flows | view | /flows/workflows/:id · render | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/workflows/:id · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/workflows/:id · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-flows | view | /flows/workflows/:id · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
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
| supbrd-plugmod-flows | api | /_emdash/api/plugins/supbrd-plugmod-flows/health · read | passed | docs/evidence/plugin-autonomy/retirement-api-health.txt |
| supbrd-plugmod-flows | api | /_emdash/api/superboard/plugins/supbrd-plugmod-flows/commands/supbrd-plugmod-flows.command.create_workflow · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-flows.txt |
| supbrd-plugmod-flows | api | /_emdash/api/superboard/plugins/supbrd-plugmod-flows/commands/supbrd-plugmod-flows.command.update_workflow · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-flows.txt |
| supbrd-plugmod-flows | api | /_emdash/api/superboard/plugins/supbrd-plugmod-flows/commands/supbrd-plugmod-flows.command.publish_workflow · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-flows.txt |
| supbrd-plugmod-flows | api | /_emdash/api/superboard/plugins/supbrd-plugmod-flows/commands/supbrd-plugmod-flows.command.activate_version · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-flows.txt |
| supbrd-plugmod-flows | api | /_emdash/api/superboard/plugins/supbrd-plugmod-flows/commands/supbrd-plugmod-flows.command.create_environment · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-flows.txt |
| supbrd-plugmod-flows | api | /_emdash/api/superboard/plugins/supbrd-plugmod-flows/commands/supbrd-plugmod-flows.command.rotate_environment_key · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-flows.txt |
| supbrd-plugmod-flows | api | /_emdash/api/superboard/plugins/supbrd-plugmod-flows/commands/supbrd-plugmod-flows.command.save_localization · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-flows.txt |
| supbrd-plugmod-flows | api | /_emdash/api/superboard/plugins/supbrd-plugmod-flows/data-sources/supbrd-plugmod-flows.data_source.overview · read | passed | docs/evidence/plugin-autonomy/retirement-api-flows.txt |
| supbrd-plugmod-flows | api | /_emdash/api/superboard/plugins/supbrd-plugmod-flows/data-sources/supbrd-plugmod-flows.data_source.components · read | passed | docs/evidence/plugin-autonomy/retirement-api-flows.txt |
| supbrd-plugmod-flows | api | /_emdash/api/superboard/plugins/supbrd-plugmod-flows/data-sources/supbrd-plugmod-flows.data_source.workflows · read | passed | docs/evidence/plugin-autonomy/retirement-api-flows.txt |
| supbrd-plugmod-flows | api | /_emdash/api/superboard/plugins/supbrd-plugmod-flows/data-sources/supbrd-plugmod-flows.data_source.workflow · read | passed | docs/evidence/plugin-autonomy/retirement-api-flows.txt |
| supbrd-plugmod-flows | api | /_emdash/api/superboard/plugins/supbrd-plugmod-flows/data-sources/supbrd-plugmod-flows.data_source.environments · read | passed | docs/evidence/plugin-autonomy/retirement-api-flows.txt |
| supbrd-plugmod-flows | api | /_emdash/api/superboard/plugins/supbrd-plugmod-flows/data-sources/supbrd-plugmod-flows.data_source.localization · read | passed | docs/evidence/plugin-autonomy/retirement-api-flows.txt |
| supbrd-plugmod-flows | api | /_emdash/api/superboard/plugins/supbrd-plugmod-flows/data-sources/supbrd-plugmod-flows.data_source.users · read | passed | docs/evidence/plugin-autonomy/retirement-api-flows.txt |
| supbrd-plugmod-flows | api | /_emdash/api/superboard/plugins/supbrd-plugmod-flows/data-sources/supbrd-plugmod-flows.data_source.user_details · read | passed | docs/evidence/plugin-autonomy/retirement-api-flows.txt |
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
| supbrd-plugmod-gateway | view | /system/gateway · functional | passed | docs/evidence/plugin-autonomy/retirement-system-tools-browser.json |
| supbrd-plugmod-gateway | api | /_emdash/api/plugins/supbrd-plugmod-gateway/health · read | passed | docs/evidence/plugin-autonomy/retirement-api-health.txt |
| supbrd-plugmod-gateway | api | /_emdash/api/superboard/plugins/supbrd-plugmod-gateway/commands/supbrd-plugmod-gateway.command.publish_gateway_manifest · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-gateway.txt |
| supbrd-plugmod-gateway | api | /_emdash/api/superboard/plugins/supbrd-plugmod-gateway/commands/supbrd-plugmod-gateway.command.update_gateway_route · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-gateway.txt |
| supbrd-plugmod-gateway | api | /_emdash/api/superboard/plugins/supbrd-plugmod-gateway/commands/supbrd-plugmod-gateway.command.rotate_access_policy · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-gateway.txt |
| supbrd-plugmod-gateway | api | /_emdash/api/superboard/plugins/supbrd-plugmod-gateway/data-sources/supbrd-plugmod-gateway.data_source.active_gateway_manifest · read | passed | docs/evidence/plugin-autonomy/retirement-api-gateway.txt |
| supbrd-plugmod-gateway | api | /_emdash/api/superboard/plugins/supbrd-plugmod-gateway/data-sources/supbrd-plugmod-gateway.data_source.gateway_routes · read | passed | docs/evidence/plugin-autonomy/retirement-api-gateway.txt |
| supbrd-plugmod-gateway | api | /_emdash/api/superboard/plugins/supbrd-plugmod-gateway/data-sources/supbrd-plugmod-gateway.data_source.rate_limits · read | passed | docs/evidence/plugin-autonomy/retirement-api-gateway.txt |
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
| supbrd-plugmod-marketing | view | /marketing/campaigns · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plugmod-marketing | view | /marketing/channels · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-marketing | view | /marketing/channels · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-marketing | view | /marketing/channels · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-marketing | view | /marketing/channels · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plugmod-marketing | view | /marketing/email · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-marketing | view | /marketing/email · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-marketing | view | /marketing/email · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-marketing | view | /marketing/email · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plugmod-marketing | view | /marketing/in-app-messages · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-marketing | view | /marketing/in-app-messages · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-marketing | view | /marketing/in-app-messages · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-marketing | view | /marketing/in-app-messages · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plugmod-marketing | view | /marketing/journeys · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-marketing | view | /marketing/journeys · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-marketing | view | /marketing/journeys · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-marketing | view | /marketing/journeys · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plugmod-marketing | view | /marketing/settings · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-marketing | view | /marketing/settings · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-marketing | view | /marketing/settings · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-marketing | view | /marketing/settings · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plugmod-marketing | view | /marketing/statistics · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-marketing | view | /marketing/statistics · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-marketing | view | /marketing/statistics · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-marketing | view | /marketing/statistics · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
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
| supbrd-plugmod-marketing | api | /_emdash/api/plugins/supbrd-plugmod-marketing/health · read | passed | docs/evidence/plugin-autonomy/retirement-api-health.txt |
| supbrd-plugmod-marketing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-marketing/commands/supbrd-plugmod-marketing.command.create_email_campaign · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-marketing.txt |
| supbrd-plugmod-marketing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-marketing/commands/supbrd-plugmod-marketing.command.update_email_campaign · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-marketing.txt |
| supbrd-plugmod-marketing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-marketing/commands/supbrd-plugmod-marketing.command.transition_email_campaign · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-marketing.txt |
| supbrd-plugmod-marketing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-marketing/commands/supbrd-plugmod-marketing.command.schedule_email_campaign · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-marketing.txt |
| supbrd-plugmod-marketing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-marketing/commands/supbrd-plugmod-marketing.command.create_marketing_journey · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-marketing.txt |
| supbrd-plugmod-marketing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-marketing/commands/supbrd-plugmod-marketing.command.update_marketing_journey · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-marketing.txt |
| supbrd-plugmod-marketing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-marketing/commands/supbrd-plugmod-marketing.command.transition_marketing_journey · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-marketing.txt |
| supbrd-plugmod-marketing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-marketing/commands/supbrd-plugmod-marketing.command.create_marketing_channel_connector · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-marketing.txt |
| supbrd-plugmod-marketing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-marketing/commands/supbrd-plugmod-marketing.command.update_marketing_channel_connector · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-marketing.txt |
| supbrd-plugmod-marketing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-marketing/commands/supbrd-plugmod-marketing.command.delete_marketing_channel_connector · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-marketing.txt |
| supbrd-plugmod-marketing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-marketing/data-sources/supbrd-plugmod-marketing.data_source.email_subscribers · read | passed | docs/evidence/plugin-autonomy/retirement-api-marketing.txt |
| supbrd-plugmod-marketing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-marketing/data-sources/supbrd-plugmod-marketing.data_source.subscriber_lists · read | passed | docs/evidence/plugin-autonomy/retirement-api-marketing.txt |
| supbrd-plugmod-marketing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-marketing/data-sources/supbrd-plugmod-marketing.data_source.subscriber_segments · read | passed | docs/evidence/plugin-autonomy/retirement-api-marketing.txt |
| supbrd-plugmod-marketing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-marketing/data-sources/supbrd-plugmod-marketing.data_source.email_templates · read | passed | docs/evidence/plugin-autonomy/retirement-api-marketing.txt |
| supbrd-plugmod-marketing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-marketing/data-sources/supbrd-plugmod-marketing.data_source.email_campaigns · read | passed | docs/evidence/plugin-autonomy/retirement-api-marketing.txt |
| supbrd-plugmod-marketing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-marketing/data-sources/supbrd-plugmod-marketing.data_source.marketing_statistics · read | passed | docs/evidence/plugin-autonomy/retirement-api-marketing.txt |
| supbrd-plugmod-marketing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-marketing/data-sources/supbrd-plugmod-marketing.data_source.marketing_journeys · read | passed | docs/evidence/plugin-autonomy/retirement-api-marketing.txt |
| supbrd-plugmod-marketing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-marketing/data-sources/supbrd-plugmod-marketing.data_source.journey_enrollments · read | passed | docs/evidence/plugin-autonomy/retirement-api-marketing.txt |
| supbrd-plugmod-marketing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-marketing/data-sources/supbrd-plugmod-marketing.data_source.journey_statistics · read | passed | docs/evidence/plugin-autonomy/retirement-api-marketing.txt |
| supbrd-plugmod-marketing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-marketing/data-sources/supbrd-plugmod-marketing.data_source.marketing_channel_connectors · read | passed | docs/evidence/plugin-autonomy/retirement-api-marketing.txt |
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
| supbrd-plugmod-mcp | api | /_emdash/api/plugins/supbrd-plugmod-mcp/health · read | passed | docs/evidence/plugin-autonomy/retirement-api-health.txt |
| supbrd-plugmod-mcp | api | /_emdash/api/superboard/plugins/supbrd-plugmod-mcp/commands/supbrd-plugmod-mcp.command.approve_consent · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-mcp.txt |
| supbrd-plugmod-mcp | api | /_emdash/api/superboard/plugins/supbrd-plugmod-mcp/commands/supbrd-plugmod-mcp.command.revoke_token · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-mcp.txt |
| supbrd-plugmod-mcp | api | /_emdash/api/superboard/plugins/supbrd-plugmod-mcp/commands/supbrd-plugmod-mcp.command.invoke_tool · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-mcp.txt |
| supbrd-plugmod-mcp | api | /_emdash/api/superboard/plugins/supbrd-plugmod-mcp/data-sources/supbrd-plugmod-mcp.data_source.tokens · read | passed | docs/evidence/plugin-autonomy/retirement-api-mcp.txt |
| supbrd-plugmod-mcp | api | /_emdash/api/superboard/plugins/supbrd-plugmod-mcp/data-sources/supbrd-plugmod-mcp.data_source.sessions · read | passed | docs/evidence/plugin-autonomy/retirement-api-mcp.txt |
| supbrd-plugmod-mcp | api | /_emdash/api/superboard/plugins/supbrd-plugmod-mcp/data-sources/supbrd-plugmod-mcp.data_source.tool_receipts · read | passed | docs/evidence/plugin-autonomy/retirement-api-mcp.txt |
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
| supbrd-plugmod-observability | view | /infrastructure · functional | passed | docs/evidence/plugin-autonomy/retirement-infrastructure-browser.json |
| supbrd-plugmod-observability | api | /_emdash/api/plugins/supbrd-plugmod-observability/health · read | passed | docs/evidence/plugin-autonomy/retirement-api-health.txt |
| supbrd-plugmod-observability | api | /_emdash/api/superboard/plugins/supbrd-plugmod-observability/commands/supbrd-plugmod-observability.command.acknowledge_incident · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-observability.txt |
| supbrd-plugmod-observability | api | /_emdash/api/superboard/plugins/supbrd-plugmod-observability/commands/supbrd-plugmod-observability.command.resolve_incident · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-observability.txt |
| supbrd-plugmod-observability | api | /_emdash/api/superboard/plugins/supbrd-plugmod-observability/commands/supbrd-plugmod-observability.command.retry_custom_job · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-observability.txt |
| supbrd-plugmod-observability | api | /_emdash/api/superboard/plugins/supbrd-plugmod-observability/commands/supbrd-plugmod-observability.command.replay_email_dead_letter · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-observability-email.txt |
| supbrd-plugmod-observability | api | /_emdash/api/superboard/plugins/supbrd-plugmod-observability/commands/supbrd-plugmod-observability.command.discard_email_dead_letter · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-observability-email.txt |
| supbrd-plugmod-observability | api | /_emdash/api/superboard/plugins/supbrd-plugmod-observability/data-sources/supbrd-plugmod-observability.data_source.platform_status · read | passed | docs/evidence/plugin-autonomy/retirement-api-observability.txt |
| supbrd-plugmod-observability | api | /_emdash/api/superboard/plugins/supbrd-plugmod-observability/data-sources/supbrd-plugmod-observability.data_source.runtime_metrics · read | passed | docs/evidence/plugin-autonomy/retirement-api-observability.txt |
| supbrd-plugmod-observability | api | /_emdash/api/superboard/plugins/supbrd-plugmod-observability/data-sources/supbrd-plugmod-observability.data_source.service_health · read | passed | docs/evidence/plugin-autonomy/retirement-api-observability.txt |
| supbrd-plugmod-observability | api | /_emdash/api/superboard/plugins/supbrd-plugmod-observability/data-sources/supbrd-plugmod-observability.data_source.incidents · read | passed | docs/evidence/plugin-autonomy/retirement-api-observability.txt |
| supbrd-plugmod-observability | api | /_emdash/api/superboard/plugins/supbrd-plugmod-observability/data-sources/supbrd-plugmod-observability.data_source.platform_custom_jobs · read | passed | docs/evidence/plugin-autonomy/retirement-api-observability.txt |
| supbrd-plugmod-observability | api | /_emdash/api/superboard/plugins/supbrd-plugmod-observability/data-sources/supbrd-plugmod-observability.data_source.platform_email_operations · read | passed | docs/evidence/plugin-autonomy/retirement-api-observability-email.txt |
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
| supbrd-plugmod-onboardings | view | /onboardings/statistics · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plugmod-onboardings | api | /_emdash/api/plugins/supbrd-plugmod-onboardings/health · read | passed | docs/evidence/plugin-autonomy/retirement-api-health.txt |
| supbrd-plugmod-onboardings | api | /_emdash/api/superboard/plugins/supbrd-plugmod-onboardings/commands/supbrd-plugmod-onboardings.command.create_onboarding · mutation | passed | docs/evidence/plugin-autonomy/onboardings-functional.txt |
| supbrd-plugmod-onboardings | api | /_emdash/api/superboard/plugins/supbrd-plugmod-onboardings/commands/supbrd-plugmod-onboardings.command.update_onboarding · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-onboardings.txt |
| supbrd-plugmod-onboardings | api | /_emdash/api/superboard/plugins/supbrd-plugmod-onboardings/commands/supbrd-plugmod-onboardings.command.delete_onboarding · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-onboardings.txt |
| supbrd-plugmod-onboardings | api | /_emdash/api/superboard/plugins/supbrd-plugmod-onboardings/commands/supbrd-plugmod-onboardings.command.create_onboarding_version · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-onboardings.txt |
| supbrd-plugmod-onboardings | api | /_emdash/api/superboard/plugins/supbrd-plugmod-onboardings/commands/supbrd-plugmod-onboardings.command.publish_onboarding · mutation | passed | docs/evidence/plugin-autonomy/onboardings-functional.txt |
| supbrd-plugmod-onboardings | api | /_emdash/api/superboard/plugins/supbrd-plugmod-onboardings/commands/supbrd-plugmod-onboardings.command.save_onboarding_placement · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-onboardings.txt |
| supbrd-plugmod-onboardings | api | /_emdash/api/superboard/plugins/supbrd-plugmod-onboardings/commands/supbrd-plugmod-onboardings.command.create_onboarding_targeting_rule · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-onboardings.txt |
| supbrd-plugmod-onboardings | api | /_emdash/api/superboard/plugins/supbrd-plugmod-onboardings/commands/supbrd-plugmod-onboardings.command.create_onboarding_experience · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-onboardings.txt |
| supbrd-plugmod-onboardings | api | /_emdash/api/superboard/plugins/supbrd-plugmod-onboardings/commands/supbrd-plugmod-onboardings.command.set_onboarding_experience_status · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-onboardings.txt |
| supbrd-plugmod-onboardings | api | /_emdash/api/superboard/plugins/supbrd-plugmod-onboardings/data-sources/supbrd-plugmod-onboardings.data_source.onboardings · read | passed | docs/evidence/plugin-autonomy/retirement-api-onboardings.txt |
| supbrd-plugmod-onboardings | api | /_emdash/api/superboard/plugins/supbrd-plugmod-onboardings/data-sources/supbrd-plugmod-onboardings.data_source.onboarding_versions · read | passed | docs/evidence/plugin-autonomy/retirement-api-onboardings.txt |
| supbrd-plugmod-onboardings | api | /_emdash/api/superboard/plugins/supbrd-plugmod-onboardings/data-sources/supbrd-plugmod-onboardings.data_source.onboarding_placements · read | passed | docs/evidence/plugin-autonomy/retirement-api-onboardings.txt |
| supbrd-plugmod-onboardings | api | /_emdash/api/superboard/plugins/supbrd-plugmod-onboardings/data-sources/supbrd-plugmod-onboardings.data_source.onboarding_targeting_rules · read | passed | docs/evidence/plugin-autonomy/retirement-api-onboardings.txt |
| supbrd-plugmod-onboardings | api | /_emdash/api/superboard/plugins/supbrd-plugmod-onboardings/data-sources/supbrd-plugmod-onboardings.data_source.onboarding_experiences · read | passed | docs/evidence/plugin-autonomy/retirement-api-onboardings.txt |
| supbrd-plugmod-onboardings | api | /_emdash/api/superboard/plugins/supbrd-plugmod-onboardings/data-sources/supbrd-plugmod-onboardings.data_source.onboarding_statistics · read | passed | docs/evidence/plugin-autonomy/retirement-api-onboardings.txt |
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
| supbrd-plugmod-paywalls | view | /paywalls · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plugmod-paywalls | view | /paywalls/statistics · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-paywalls | view | /paywalls/statistics · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-paywalls | view | /paywalls/statistics · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-paywalls | view | /paywalls/statistics · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plugmod-paywalls | api | /_emdash/api/plugins/supbrd-plugmod-paywalls/health · read | passed | docs/evidence/plugin-autonomy/retirement-api-health.txt |
| supbrd-plugmod-paywalls | api | /_emdash/api/superboard/plugins/supbrd-plugmod-paywalls/commands/supbrd-plugmod-paywalls.command.create_paywall · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-paywalls.txt |
| supbrd-plugmod-paywalls | api | /_emdash/api/superboard/plugins/supbrd-plugmod-paywalls/commands/supbrd-plugmod-paywalls.command.update_paywall · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-paywalls.txt |
| supbrd-plugmod-paywalls | api | /_emdash/api/superboard/plugins/supbrd-plugmod-paywalls/commands/supbrd-plugmod-paywalls.command.archive_paywall · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-paywalls.txt |
| supbrd-plugmod-paywalls | api | /_emdash/api/superboard/plugins/supbrd-plugmod-paywalls/commands/supbrd-plugmod-paywalls.command.create_paywall_version · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-paywalls.txt |
| supbrd-plugmod-paywalls | api | /_emdash/api/superboard/plugins/supbrd-plugmod-paywalls/commands/supbrd-plugmod-paywalls.command.publish_paywall_version · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-paywalls.txt |
| supbrd-plugmod-paywalls | api | /_emdash/api/superboard/plugins/supbrd-plugmod-paywalls/commands/supbrd-plugmod-paywalls.command.save_paywall_placement · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-paywalls.txt |
| supbrd-plugmod-paywalls | api | /_emdash/api/superboard/plugins/supbrd-plugmod-paywalls/commands/supbrd-plugmod-paywalls.command.create_paywall_experience · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-paywalls.txt |
| supbrd-plugmod-paywalls | api | /_emdash/api/superboard/plugins/supbrd-plugmod-paywalls/commands/supbrd-plugmod-paywalls.command.update_paywall_experience · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-paywalls.txt |
| supbrd-plugmod-paywalls | api | /_emdash/api/superboard/plugins/supbrd-plugmod-paywalls/commands/supbrd-plugmod-paywalls.command.archive_paywall_experience · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-paywalls.txt |
| supbrd-plugmod-paywalls | api | /_emdash/api/superboard/plugins/supbrd-plugmod-paywalls/data-sources/supbrd-plugmod-paywalls.data_source.paywalls · read | passed | docs/evidence/plugin-autonomy/retirement-api-paywalls.txt |
| supbrd-plugmod-paywalls | api | /_emdash/api/superboard/plugins/supbrd-plugmod-paywalls/data-sources/supbrd-plugmod-paywalls.data_source.paywall_versions · read | passed | docs/evidence/plugin-autonomy/retirement-api-paywalls.txt |
| supbrd-plugmod-paywalls | api | /_emdash/api/superboard/plugins/supbrd-plugmod-paywalls/data-sources/supbrd-plugmod-paywalls.data_source.paywall_placements · read | passed | docs/evidence/plugin-autonomy/retirement-api-paywalls.txt |
| supbrd-plugmod-paywalls | api | /_emdash/api/superboard/plugins/supbrd-plugmod-paywalls/data-sources/supbrd-plugmod-paywalls.data_source.paywall_experiences · read | passed | docs/evidence/plugin-autonomy/retirement-api-paywalls.txt |
| supbrd-plugmod-paywalls | api | /_emdash/api/superboard/plugins/supbrd-plugmod-paywalls/data-sources/supbrd-plugmod-paywalls.data_source.paywall_statistics · read | passed | docs/evidence/plugin-autonomy/retirement-api-paywalls.txt |
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
| supbrd-plugmod-support | view | /support/automations · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plugmod-support | view | /support/captain · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/captain · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/captain · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/captain · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plugmod-support | view | /support/channels · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/channels · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/channels · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/channels · functional | passed | docs/evidence/plugin-autonomy/retirement-support-management-browser.json |
| supbrd-plugmod-support | view | /support/configuration · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/configuration · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/configuration · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/configuration · functional | passed | docs/evidence/plugin-autonomy/retirement-support-management-browser.json |
| supbrd-plugmod-support | view | /support/contacts · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/contacts · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/contacts · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/contacts · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plugmod-support | view | /support/help-center · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/help-center · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/help-center · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/help-center · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
| supbrd-plugmod-support | view | /support/inbox · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/inbox · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/inbox · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/inbox · functional | passed | docs/evidence/plugin-autonomy/retirement-support-completion-browser.json |
| supbrd-plugmod-support | view | /support/integrations · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/integrations · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/integrations · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/integrations · functional | passed | docs/evidence/plugin-autonomy/retirement-support-management-browser.json |
| supbrd-plugmod-support | view | /support/proactive-support · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/proactive-support · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/proactive-support · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/proactive-support · functional | passed | docs/evidence/plugin-autonomy/retirement-support-completion-browser.json |
| supbrd-plugmod-support | view | /support/quality · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/quality · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/quality · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/quality · functional | passed | docs/evidence/plugin-autonomy/retirement-support-completion-browser.json |
| supbrd-plugmod-support | view | /support/reports · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/reports · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/reports · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/reports · functional | passed | docs/evidence/plugin-autonomy/retirement-support-completion-browser.json |
| supbrd-plugmod-support | view | /support/settings · render | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/settings · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/settings · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/settings · functional | passed | docs/evidence/plugin-autonomy/retirement-support-management-browser.json |
| supbrd-plugmod-support | view | /support/workforce · render | passed | docs/evidence/plugin-autonomy/browser-route-mounts.json, docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/workforce · reload | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/workforce · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-support | view | /support/workforce · functional | passed | docs/evidence/plugin-autonomy/retirement-e2e-functional.json |
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
| supbrd-plugmod-support | api | /_emdash/api/plugins/supbrd-plugmod-support/health · read | passed | docs/evidence/plugin-autonomy/retirement-api-health.txt |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/commands/supbrd-plugmod-support.command.update_support_settings · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-support.txt |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/commands/supbrd-plugmod-support.command.create_support_configuration · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-support.txt |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/commands/supbrd-plugmod-support.command.update_support_configuration · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-support.txt |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/commands/supbrd-plugmod-support.command.delete_support_configuration · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-support.txt |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/commands/supbrd-plugmod-support.command.rotate_support_webhook_secret · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-support.txt |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/commands/supbrd-plugmod-support.command.revoke_support_webhook_secret · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-support.txt |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/commands/supbrd-plugmod-support.command.send_inbox_message · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-support.txt |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/commands/supbrd-plugmod-support.command.update_inbox_conversation · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-support.txt |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/commands/supbrd-plugmod-support.command.create_support_provider · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-support.txt |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/commands/supbrd-plugmod-support.command.update_support_provider · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-support.txt |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/commands/supbrd-plugmod-support.command.delete_support_provider · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-support.txt |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/commands/supbrd-plugmod-support.command.create_support_integration · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-support.txt |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/commands/supbrd-plugmod-support.command.update_support_integration · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-support.txt |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/commands/supbrd-plugmod-support.command.delete_support_integration · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-support.txt |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/commands/supbrd-plugmod-support.command.publish_support_article · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-support.txt |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/data-sources/supbrd-plugmod-support.data_source.support_settings · read | passed | docs/evidence/plugin-autonomy/retirement-api-support.txt |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/data-sources/supbrd-plugmod-support.data_source.unified_inbox_items · read | passed | docs/evidence/plugin-autonomy/retirement-api-support.txt |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/data-sources/supbrd-plugmod-support.data_source.inbox_conversations · read | passed | docs/evidence/plugin-autonomy/retirement-api-support.txt |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/data-sources/supbrd-plugmod-support.data_source.inbox_messages · read | passed | docs/evidence/plugin-autonomy/retirement-api-support.txt |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/data-sources/supbrd-plugmod-support.data_source.support_channels · read | passed | docs/evidence/plugin-autonomy/retirement-api-support.txt |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/data-sources/supbrd-plugmod-support.data_source.support_providers · read | passed | docs/evidence/plugin-autonomy/retirement-api-support.txt |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/data-sources/supbrd-plugmod-support.data_source.support_integrations · read | passed | docs/evidence/plugin-autonomy/retirement-api-support.txt |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/data-sources/supbrd-plugmod-support.data_source.support_portals · read | passed | docs/evidence/plugin-autonomy/retirement-api-support.txt |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/data-sources/supbrd-plugmod-support.data_source.support_categories · read | passed | docs/evidence/plugin-autonomy/retirement-api-support.txt |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/data-sources/supbrd-plugmod-support.data_source.support_folders · read | passed | docs/evidence/plugin-autonomy/retirement-api-support.txt |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/data-sources/supbrd-plugmod-support.data_source.support_articles · read | passed | docs/evidence/plugin-autonomy/retirement-api-support.txt |
| supbrd-plugmod-support | api | /_emdash/api/superboard/plugins/supbrd-plugmod-support/data-sources/supbrd-plugmod-support.data_source.support_assistant_tasks · read | passed | docs/evidence/plugin-autonomy/retirement-api-support.txt |
| supbrd-plugmod-mcp | view | /mcp · render | passed | docs/evidence/plugin-autonomy/targeted-functional-results.json |
| supbrd-plugmod-mcp | view | /mcp · reload | passed | docs/evidence/plugin-autonomy/targeted-functional-results.json |
| supbrd-plugmod-mcp | view | /mcp · navigation | passed | docs/evidence/plugin-autonomy/browser-route-continuity.json |
| supbrd-plugmod-mcp | view | /mcp · functional | passed | docs/evidence/plugin-autonomy/targeted-functional-results.json |
| supbrd-plugmod-billing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-billing/commands/supbrd-plugmod-billing.command.migrate_products · mutation | passed | docs/evidence/plugin-autonomy/retirement-api-billing.txt |
| supbrd-plugmod-billing | api | /_emdash/api/superboard/plugins/supbrd-plugmod-billing/data-sources/supbrd-plugmod-billing.data_source.migration_status · read | passed | docs/evidence/plugin-autonomy/retirement-api-billing.txt |
