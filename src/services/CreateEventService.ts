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

            // Pre-emptively suppress Obsidian's auto-rename modal. When the
            // user has both "Show inline title" and "Show tab title bar"
            // disabled in Appearance, Obsidian opens its own rename modal as
            // soon as a new file gets focus — that collides with our
            // TitleModal (both stack visibly). We install a MutationObserver
            // *before* the 100ms wait so we can yank Obsidian's modal during
            // the same microtask it's added in. Since MutationObserver fires
            // before the next render frame, the user never sees it paint.
            // Our own TitleModal is identified by the
            // `astro-composer-title-modal` class on its modalEl and passes
            // through untouched.
            const suppressor = this.installRenameModalSuppressor();

            // Primary check: Is this an "Untitled" file? (user clicked new note)
            // Git-synced files always have real names, so this reliably distinguishes
            // user-created notes from background sync.
            const fileName = file.basename;
            const isUntitled = /^Untitled(\s\d+)?$/.test(fileName);

            if (!isUntitled) {
                // Not an Untitled file. Only process if background processing is enabled.
                if (!this.plugin.settings.processBackgroundFileChanges) {
                    suppressor.dispose();
                    return;
                }

                // Even with background processing, skip files that have real content
                // (they were synced from git, not freshly created)
                const stat = await this.app.vault.adapter.stat(file.path);
                const isRecent = stat?.mtime && (now - stat.mtime < CONSTANTS.STAT_MTIME_THRESHOLD);
                if (!isRecent) {
                    suppressor.dispose();
                    return;
                }

                let content: string;
                try {
                    content = await this.app.vault.read(file);
                } catch {
                    suppressor.dispose();
                    return;
                }

                // If file has content beyond an empty template, it's not new
                if (content.trim().length > 0) {
                    const contentWithoutFrontmatter = content.startsWith('---')
                        ? content.slice(content.indexOf('\n---', 3) + 4).trim()
                        : content.trim();
                    if (contentWithoutFrontmatter.length > 0) {
                        suppressor.dispose();
                        return;
                    }
                }
            }

            // Small delay to let Obsidian finish switching to the file
            await new Promise(resolve => window.setTimeout(resolve, 100));

            this.lastProcessedFiles.set(file.path, now);

            window.setTimeout(() => {
                this.lastProcessedFiles.delete(file.path);
            }, CONSTANTS.DEBOUNCE_MS + 100);

            new TitleModal(this.app, file, this.plugin, matchedContentTypeId, false, true).open();
            // suppressor auto-disconnects when it sees AC's modal added; the
            // 2s safety timer in installRenameModalSuppressor catches anything
            // weird (no need to manually dispose on the happy path).
        })();
    }

    /**
     * Install a MutationObserver that intercepts and removes any
     * `.modal-container` added to the document body, *except* our own
     * TitleModal (identified by the `astro-composer-title-modal` class on its
     * inner modalEl). Used to suppress Obsidian's auto-rename modal that
     * fires when both inline title and tab title bar are disabled in
     * Appearance settings.
     *
     * The observer runs synchronously during DOM mutation, so a colliding
     * modal is yanked before the browser paints — no visible flash.
     *
     * Returns a `dispose` hook for early returns; on the happy path the
     * observer self-disconnects after our modal is seen, with a 2s safety
     * timer as a backstop.
     */
    private installRenameModalSuppressor(): { dispose: () => void } {
        let acModalSeen = false;
        const observer = new MutationObserver((muts) => {
            for (const m of muts) {
                m.addedNodes.forEach((node) => {
                    if (!node.instanceOf(HTMLElement)) return;
                    if (!node.matches('.modal-container')) return;
                    // Our TitleModal puts the marker class on its modalEl,
                    // which lives as a child of the modal-container in the
                    // DOM (Obsidian's Modal class wraps modalEl in containerEl
                    // before append). Match by descendant query.
                    const isOurs = node.querySelector('.astro-composer-title-modal') !== null;
                    if (isOurs) {
                        acModalSeen = true;
                        observer.disconnect();
                        window.clearTimeout(timeoutId);
                        return;
                    }
                    if (acModalSeen) return; // ours already through; leave others alone
                    // It's Obsidian's auto-rename modal — yank it pre-paint
                    node.remove();
                });
            }
        });
        observer.observe(activeDocument.body, { childList: true });
        const timeoutId = window.setTimeout(() => observer.disconnect(), 2000);
        return {
            dispose: () => {
                observer.disconnect();
                window.clearTimeout(timeoutId);
            },
        };
    }
}
