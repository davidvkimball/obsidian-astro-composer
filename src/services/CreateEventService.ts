import { App, TFile, Notice } from "obsidian";
import { ContentType, AstroComposerPluginInterface } from "../types";
import { CONSTANTS } from "../settings";
import { matchesFolderPattern, sortByPatternSpecificity } from "../utils/path-matching";
import { TitleModal } from "../ui/title-modal";

export class CreateEventService {
    private lastProcessedFiles: Map<string, number> = new Map();

    constructor(
        private app: App,
        private plugin: AstroComposerPluginInterface
    ) { }

    public handleCreate(file: TFile): void {
        void (async () => {
            const now = Date.now();

            if (!(file instanceof TFile) || (file.extension !== "md" && file.extension !== "mdx")) {
                return;
            }

            const filePath = file.path;

            // Skip if this file was created by the plugin itself (TTL check)
            const createdTime = this.plugin.pluginCreatedFiles.get(filePath);
            if (createdTime && now - createdTime < 5 * 60 * 1000) { // 5 minutes TTL
                return;
            }

            // Per-file debounce check
            const lastProcessed = this.lastProcessedFiles.get(filePath) || 0;
            if (lastProcessed > 0 && now - lastProcessed < CONSTANTS.DEBOUNCE_MS) {
                return;
            }

            // Clean up old entries in local debounce map
            if (lastProcessed > 0 && now - lastProcessed > 2000) {
                this.lastProcessedFiles.delete(filePath);
            }

            // Periodic cleanup of debounce map
            const periodicCutoff = now - CONSTANTS.DEBOUNCE_MS * 2;
            for (const [path, time] of this.lastProcessedFiles.entries()) {
                if (time < periodicCutoff) {
                    this.lastProcessedFiles.delete(path);
                }
            }

            // Reload settings to ensure we have the latest
            await this.plugin.loadSettings();

            // Check background processing
            const activeFile = this.app.workspace.getActiveFile();
            const isActiveFile = activeFile && activeFile.path === file.path;
            if (!this.plugin.settings.processBackgroundFileChanges && !isActiveFile) {
                return;
            }

            const contentTypes = this.plugin.settings.contentTypes || [];
            const hasEnabledContentTypes = contentTypes.some(ct => ct.enabled);

            if (!hasEnabledContentTypes) {
                return;
            }

            const sortedContentTypes = sortByPatternSpecificity(contentTypes);
            let matchedContentTypeId: string | null = null;
            const matchingTypes: ContentType[] = [];

            for (const contentType of sortedContentTypes) {
                if (!contentType.enabled) continue;

                let matches = false;

                if (!contentType.folder || contentType.folder.trim() === "") {
                    if (!filePath.includes("/") || filePath.split("/").length === 1) {
                        matches = true;
                    }
                } else if (matchesFolderPattern(filePath, contentType.folder)) {
                    if (contentType.ignoreSubfolders) {
                        const pathSegments = filePath.split("/");
                        const pathDepth = pathSegments.length;
                        const patternSegments = contentType.folder.split("/");
                        const expectedDepth = patternSegments.length;

                        if (contentType.creationMode === "folder") {
                            const folderDepth = pathDepth - 1;
                            if (folderDepth === expectedDepth || folderDepth === expectedDepth + 1) {
                                matches = true;
                            }
                        } else {
                            if (pathDepth === expectedDepth) {
                                matches = true;
                            }
                        }
                    } else {
                        matches = true;
                    }
                }

                if (matches) {
                    matchingTypes.push(contentType);
                    if (!matchedContentTypeId) {
                        matchedContentTypeId = contentType.id;
                    }
                }
            }

            if (matchingTypes.length > 1) {
                const typeNames = matchingTypes.map(ct => ct.name || "Unnamed").join(", ");
                new Notice(`Multiple content types (${typeNames}) match this file. Using most specific: ${matchingTypes[0].name || "Unnamed"}`);
            }

            if (!matchedContentTypeId) {
                return;
            }

            const stat = await this.app.vault.adapter.stat(file.path);
            const isNewNote = stat?.mtime && (now - stat.mtime < CONSTANTS.STAT_MTIME_THRESHOLD);

            if (!isNewNote) {
                return;
            }

            await new Promise(resolve => setTimeout(resolve, 50));

            let content: string;
            try {
                content = await this.app.vault.read(file);
            } catch (error) {
                console.error("Error reading file for create detection:", error);
                return;
            }

            if (content.trim().length > 0) {
                if (content.startsWith('---')) {
                    const frontmatterEnd = content.indexOf('\n---', 3);
                    if (frontmatterEnd !== -1) {
                        const frontmatterText = content.slice(4, frontmatterEnd).trim();
                        const lines = frontmatterText.split('\n').filter(line => line.trim().length > 0);

                        if (!this.plugin.settings.processBackgroundFileChanges && lines.length > 0) {
                            return;
                        }

                        if (lines.length > 1 || (lines.length === 1 && !lines[0].startsWith('title:'))) {
                            return;
                        }
                    }
                }
                const contentWithoutFrontmatter = content.startsWith('---')
                    ? content.slice(content.indexOf('\n---', 3) + 4).trim()
                    : content.trim();
                if (contentWithoutFrontmatter.length > 0) {
                    return;
                }
            }

            this.lastProcessedFiles.set(file.path, now);

            setTimeout(() => {
                this.lastProcessedFiles.delete(file.path);
            }, CONSTANTS.DEBOUNCE_MS + 100);

            new TitleModal(this.app, file, this.plugin, matchedContentTypeId, false, true).open();
        })();
    }
}
