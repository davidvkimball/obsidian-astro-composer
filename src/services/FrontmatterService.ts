import { App, TFile, moment, TAbstractFile } from "obsidian";
import { AstroComposerPluginInterface, ContentType } from "../types";

export class FrontmatterService {
    private lastProcessedFile: string = "";
    private lastProcessedTime: number = 0;
    private debounceTimeout: number | null = null;
    private draftStatusMap: Map<string, boolean> = new Map();
    private contentHashCache: Map<string, string> = new Map();

    constructor(private app: App, private plugin: AstroComposerPluginInterface) {
        this.registerEvents();

        // Also re-initialize when layout is ready just in case
        this.app.workspace.onLayoutReady(() => {
            this.initializeDraftStatusMap();
        });
    }

    public initializeDraftStatusMap() {
        this.draftStatusMap.clear();
        const settings = this.plugin.settings;
        const draftProp = settings.draftProperty || "draft";
        // Include both .md and .mdx files
        const files = this.app.vault.getFiles().filter(f => f instanceof TFile && (f.extension === 'md' || f.extension === 'mdx')) as TFile[];

        for (const file of files) {
            const cache = this.app.metadataCache.getFileCache(file);
            const rawValue = cache?.frontmatter?.[draftProp];
            this.draftStatusMap.set(file.path, this.calculateIsDraft(rawValue, settings));

            // Populate initial content hashes to prevent unnecessary updates on first change
            void (async () => {
                try {
                    const content = await this.app.vault.read(file);
                    this.contentHashCache.set(file.path, this.getContentHash(content));
                } catch (e) {
                    console.error(`Failed to initialize content hash for ${file.path}:`, e);
                }
            })();
        }
    }

    private calculateIsDraft(rawValue: any, settings: any): boolean {
        // If undefined/null, assume it's NOT a draft unless logic says otherwise
        if (rawValue === undefined || rawValue === null) return false;

        // Convert to string for easier matching if it's not a boolean
        const val = String(rawValue).toLowerCase();

        if (settings.draftLogic === 'false-is-draft') {
            // "False = Published", so it's a draft if it is false, "false", "0", etc.
            return val === 'false' || val === '0' || rawValue === false;
        } else {
            // "True = Draft", so it's a draft if it is true, "true", "1", etc.
            return val === 'true' || val === '1' || rawValue === true;
        }
    }

    private registerEvents() {
        // Watch for metadata changes (property-based draft sync)
        this.plugin.registerEvent(
            this.app.metadataCache.on("changed", (file) => {
                if (file instanceof TFile) {
                    this.onMetadataChange(file);
                }
            })
        );

        // Watch for renames (underscore-prefix draft sync)
        this.plugin.registerEvent(
            this.app.vault.on("rename", (file, oldPath) => {
                if (file instanceof TFile) {
                    this.onRename(file, oldPath);
                }
            })
        );
    }

    private onRename(file: TFile, oldPath: string) {
        const settings = this.plugin.settings;
        if (!settings.syncDraftDate) return;

        const oldName = oldPath.split("/").pop() || "";
        const newName = file.name;

        // Check if it was an underscore draft and is now not
        if (oldName.startsWith("_") && !newName.startsWith("_")) {
            // Need to check content type to see if underscore prefix is enabled
            const contentType = this.plugin.fileOps?.getContentTypeByPath(file.path);
            if (contentType?.enableUnderscorePrefix) {
                void this.updateDate(file);
            }
        }
    }

    private onMetadataChange(file: TFile) {
        const settings = this.plugin.settings;

        // Need to check content type to see if modified date is enabled for THIS type
        const contentType = this.plugin.fileOps?.getContentTypeByPath(file.path);
        const hasModifiedField = !!contentType?.modifiedDateField;

        if (!settings.syncDraftDate && !hasModifiedField) {
            return;
        }

        // Track draft status changes
        const cache = this.app.metadataCache.getFileCache(file);
        const draftProp = settings.draftProperty || "draft";
        const rawValue = cache?.frontmatter?.[draftProp];

        // Logic: true-is-draft vs false-is-draft
        const isCurrentlyDraft = this.calculateIsDraft(rawValue, settings);

        // If it's the first time we see this file, just record it and skip
        if (!this.draftStatusMap.has(file.path)) {
            this.draftStatusMap.set(file.path, isCurrentlyDraft);
            return;
        }

        const previousDraftStatus = this.draftStatusMap.get(file.path);

        let draftStatusChangedToPublished = false;
        // Transition from draft to non-draft
        if (previousDraftStatus === true && isCurrentlyDraft === false) {
            draftStatusChangedToPublished = true;
        }

        // Update the map for next time
        this.draftStatusMap.set(file.path, isCurrentlyDraft);

        // If no publication change and no modified field to update, skip processing
        if (!draftStatusChangedToPublished && !hasModifiedField) {
            return;
        }

        // Prevent infinite loops and redundant processing
        const now = Date.now();
        if (this.lastProcessedFile === file.path && now - this.lastProcessedTime < 2000) {
            return;
        }

        // Use a debounce to wait for writing to finish
        if (this.debounceTimeout) {
            window.clearTimeout(this.debounceTimeout);
        }

        this.debounceTimeout = window.setTimeout(async () => {
            // Check if content (excluding frontmatter) has actually changed
            try {
                const content = await this.app.vault.read(file);
                const currentHash = this.getContentHash(content);
                const previousHash = this.contentHashCache.get(file.path);

                // Update cache immediately to prevent re-processing even if we skip
                this.contentHashCache.set(file.path, currentHash);

                if (previousHash === currentHash) {
                    // Only sub-publication changes (like metadata) happened, skip modified date update
                    if (!draftStatusChangedToPublished) {
                        return;
                    }
                }
            } catch (e) {
                console.error(`Failed to check content hash for ${file.path}:`, e);
                // Fallback to processing if read fails, or return? 
                // Better to return to be safe against accidental updates
                return;
            }

            void this.processFile(file, draftStatusChangedToPublished, contentType);
        }, 500);
    }

    private getContentHash(content: string): string {
        // 1. Strip frontmatter
        let body = content;
        if (content.startsWith('---')) {
            const end = content.indexOf('\n---', 3);
            if (end !== -1) {
                body = content.slice(end + 4);
            }
        }

        // 2. Normalize whitespace: collapse all whitespace into single spaces and trim
        const normalized = body.replace(/\s+/g, ' ').trim();

        // 3. Simple hashing (concatenating length and first/last bits is usually enough for local change detection, 
        // but let's do a slightly better one if we want to be robust, or just use the normalized string if memory allows)
        // Given Obsidian vaults can be large, a small hash is safer.
        return this.simpleHash(normalized);
    }

    private simpleHash(str: string): string {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0; // Convert to 32bit integer
        }
        return hash.toString() + "_" + str.length;
    }

    private async updateDate(file: TFile) {
        const settings = this.plugin.settings;
        const dateField = settings.publishDateField || "date";

        await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
            const today = moment().format(settings.dateFormat);
            if (frontmatter[dateField] !== today) {
                frontmatter[dateField] = today;
                this.lastProcessedFile = file.path;
                this.lastProcessedTime = Date.now();
            }
        });
    }

    private async processFile(file: TFile, draftStatusChangedToPublished: boolean, contentType: ContentType | null | undefined) {
        const settings = this.plugin.settings;
        const publishDateField = settings.publishDateField || "date";

        await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
            let changed = false;

            // Handle Draft Sync (triggered only on the specific transition)
            if (settings.syncDraftDate && draftStatusChangedToPublished) {
                const today = moment().format(settings.dateFormat);
                if (frontmatter[publishDateField] !== today) {
                    frontmatter[publishDateField] = today;
                    changed = true;
                }
            }

            // Handle Modified Date Sync
            const modifiedField = contentType?.modifiedDateField;
            if (modifiedField && frontmatter[modifiedField] !== undefined) {
                const now = moment().format(settings.dateFormat);
                if (frontmatter[modifiedField] !== now) {
                    frontmatter[modifiedField] = now;
                    changed = true;
                }
            }

            if (changed) {
                this.lastProcessedFile = file.path;
                this.lastProcessedTime = Date.now();
            }
        });
    }
}
