import { App, Notice } from "obsidian";
import { ContentType, AstroComposerPluginInterface } from "../types";
import { MigrationModal, MigrationConflictResult } from "../ui/components/MigrationModal";
import { AstroComposerSettingTab } from "../ui/settings-tab";

export class MigrationService {
    constructor(private app: App, private plugin: AstroComposerPluginInterface) { }

    /**
     * Migrate old posts/pages settings to unified content types
     */
    public async migrateSettingsIfNeeded(): Promise<void> {
        const settings = this.plugin.settings;

        // Check if migration is already completed
        if (settings.migrationCompleted) {
            return;
        }

        // Check if there are old settings to migrate
        const hasPostsSettings = settings.automatePostCreation !== undefined && settings.automatePostCreation;
        const hasPagesSettings = settings.enablePages !== undefined && settings.enablePages;

        if (!hasPostsSettings && !hasPagesSettings) {
            // No old settings to migrate, mark as completed
            settings.migrationCompleted = true;
            await this.plugin.saveSettings();
            return;
        }

        // Check for naming conflicts
        const legacyContentTypes = (settings as unknown as { customContentTypes?: ContentType[] }).customContentTypes;
        const existingContentTypes = settings.contentTypes || legacyContentTypes || [];
        const conflicts: string[] = [];
        if (existingContentTypes.some((ct: ContentType) => ct.name === "Posts")) {
            conflicts.push("Posts");
        }
        if (existingContentTypes.some((ct: ContentType) => ct.name === "Pages")) {
            conflicts.push("Pages");
        }

        let shouldMigrate = true;

        // If conflicts exist, prompt user
        if (conflicts.length > 0) {
            await new Promise<void>((resolve) => {
                setTimeout(() => {
                    void (async () => {
                        try {
                            const modal = new MigrationModal(this.app, conflicts);
                            const timeoutPromise = new Promise<MigrationConflictResult>((timeoutResolve) => {
                                setTimeout(() => {
                                    timeoutResolve({ action: "skip" });
                                }, 30000); // 30 second timeout
                            });

                            const result = await Promise.race([
                                modal.waitForResult(),
                                timeoutPromise
                            ]);

                            if (result.action === "skip") {
                                shouldMigrate = false;
                                new Notice("Migration skipped. Old posts/pages settings will be ignored.");
                            }
                        } catch (error) {
                            console.warn("Migration modal error:", error);
                            shouldMigrate = false;
                            new Notice("Migration skipped due to error. You can migrate manually in settings.");
                        }
                        resolve();
                    })();
                }, 500); // Small delay to ensure UI is ready
            });
        }

        if (!shouldMigrate) {
            settings.migrationCompleted = true;
            await this.plugin.saveSettings();
            return;
        }

        // Perform migration
        const migratedTypes: ContentType[] = [];

        // Migrate Posts
        if (hasPostsSettings && !conflicts.includes("Posts")) {
            const postsType: ContentType = {
                id: `posts-${Date.now()}`,
                name: "Posts",
                folder: settings.postsFolder || "",
                linkBasePath: settings.postsLinkBasePath || "",
                template: settings.defaultTemplate || '---\ntitle: "{{title}}"\ndate: {{date}}\ntags: []\n---\n',
                enabled: true,
                creationMode: settings.creationMode || "file",
                indexFileName: settings.indexFileName || "",
                ignoreSubfolders: settings.onlyAutomateInPostsFolder || false,
                enableUnderscorePrefix: settings.enableUnderscorePrefix || false,
                useMdxExtension: false,
            };
            migratedTypes.push(postsType);
        }

        // Migrate Pages
        if (hasPagesSettings && !conflicts.includes("Pages")) {
            const pagesType: ContentType = {
                id: `pages-${Date.now()}`,
                name: "Pages",
                folder: settings.pagesFolder || "",
                linkBasePath: settings.pagesLinkBasePath || "",
                template: settings.pageTemplate || '---\ntitle: "{{title}}"\ndescription: ""\n---\n',
                enabled: true,
                creationMode: settings.pagesCreationMode || "file",
                indexFileName: settings.pagesIndexFileName || "",
                ignoreSubfolders: settings.onlyAutomateInPagesFolder || false,
                enableUnderscorePrefix: false,
                useMdxExtension: false,
            };
            migratedTypes.push(pagesType);
        }

        const existingFromNew = settings.contentTypes || [];
        const existingFromLegacy = legacyContentTypes || [];

        let existingTypes: ContentType[] = existingFromNew.length > 0 ? existingFromNew : existingFromLegacy;
        let finalTypes: ContentType[] = [...existingTypes];

        if (migratedTypes.length > 0) {
            const existingNames = new Set(existingTypes.map(ct => ct.name));
            const newMigratedTypes = migratedTypes.filter(mt => !existingNames.has(mt.name));

            if (newMigratedTypes.length > 0) {
                finalTypes = [...existingTypes, ...newMigratedTypes];
            }
        }

        settings.contentTypes = finalTypes;

        // Clean up legacy fields
        const legacyFields = [
            'customContentTypes', 'enableUnderscorePrefix', 'postsFolder', 'postsLinkBasePath',
            'automatePostCreation', 'creationMode', 'indexFileName', 'excludedDirectories',
            'onlyAutomateInPostsFolder', 'enablePages', 'pagesFolder', 'pagesLinkBasePath',
            'pagesCreationMode', 'pagesIndexFileName', 'pageTemplate', 'onlyAutomateInPagesFolder'
        ];

        const settingsRecord = settings as unknown as Record<string, unknown>;
        for (const field of legacyFields) {
            delete settingsRecord[field];
        }

        settings.migrationCompleted = true;
        await this.plugin.saveSettings();
        await this.plugin.loadSettings();

        if (migratedTypes.length > 0) {
            new Notice(`Migration completed: ${migratedTypes.length} content type(s) migrated.`);

            setTimeout(() => {
                if (this.plugin.settingsTab instanceof AstroComposerSettingTab) {
                    const settingsTab = this.plugin.settingsTab;
                    try {
                        if (settingsTab.customContentTypesContainer || settingsTab.containerEl) {
                            settingsTab.display();
                        }
                    } catch (e) {
                        console.warn("Could not refresh settings tab after migration:", e);
                    }
                }
            }, 300);
        }
    }
}
