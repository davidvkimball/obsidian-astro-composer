import {
	Plugin,
	TFile,
	Notice,
} from "obsidian";

import { AstroComposerSettings, DEFAULT_SETTINGS, CONSTANTS } from "./settings";
import { AstroComposerPluginInterface } from "./types";
import { registerCommands } from "./commands";
import { AstroComposerSettingTab } from "./ui/settings-tab";
import { TitleModal } from "./ui/title-modal";
import { FileOperations } from "./utils/file-operations";
import { TemplateParser } from "./utils/template-parsing";
import { HeadingLinkGenerator } from "./utils/heading-link-generator";

export default class AstroComposerPlugin extends Plugin implements AstroComposerPluginInterface {
	settings!: AstroComposerSettings;
	private createEvent!: (file: TFile) => void;
	private fileOps!: FileOperations;
	private templateParser!: TemplateParser;
	private headingLinkGenerator!: HeadingLinkGenerator;
	private pluginCreatedFiles: Set<string> = new Set();

	async onload() {
		await this.loadSettings();

		// Initialize utilities
		this.fileOps = new FileOperations(this.app, this.settings, this);
		this.templateParser = new TemplateParser(this.app, this.settings);
		this.headingLinkGenerator = new HeadingLinkGenerator(this.settings);

		// Wait for the vault to be fully loaded before registering the create event
		this.app.workspace.onLayoutReady(() => {
			this.registerCreateEvent();
		});

		// Register commands
		registerCommands(this, this.settings);

		// Add settings tab
		this.addSettingTab(new AstroComposerSettingTab(this.app, this));

		// Register context menu for copy heading links
		this.registerContextMenu();
	}

	public registerCreateEvent() {
		if (this.createEvent) {
			this.app.vault.off("create", this.createEvent as any);
		}

		// Register create event for automation
		const hasCustomContentTypes = this.settings.customContentTypes.some(ct => ct.enabled);
		const shouldUseCreateEvent = this.settings.automatePostCreation || this.settings.enablePages || hasCustomContentTypes;
		
		if (shouldUseCreateEvent) {
			// Debounce to prevent multiple modals from rapid file creations
			let lastProcessedTime = 0;

			this.createEvent = async (file: TFile) => {
				const now = Date.now();
				if (now - lastProcessedTime < CONSTANTS.DEBOUNCE_MS) {
					return; // Skip if within debounce period
				}
				lastProcessedTime = now;

				if (file instanceof TFile && file.extension === "md") {
					const filePath = file.path;

					// Skip if this file was created by the plugin itself
					if (this.pluginCreatedFiles.has(filePath)) {
						this.pluginCreatedFiles.delete(filePath); // Clean up
						return;
					}

					// Check folder restrictions FIRST - only proceed if file is in a relevant folder
					const postsFolder = this.settings.postsFolder || "";
					const pagesFolder = this.settings.enablePages ? (this.settings.pagesFolder || "") : "";
					let isPage = false;
					let customTypeId: string | null = null;
					let shouldProcess = false;

					// Check exclusions FIRST - before any content type matching
					// Only check exclusions when Posts folder is specified (when exclusions make sense)
					let isExcluded = false;
					if (postsFolder && this.settings.excludedDirectories) {
						const excludedDirs = this.settings.excludedDirectories.split("|").map(dir => dir.trim()).filter(dir => dir);
						for (const excludedDir of excludedDirs) {
							// Check if the file is in the excluded directory (exact path match only)
							if (filePath === excludedDir || filePath.startsWith(excludedDir + "/")) {
								isExcluded = true;
								break;
							}
						}
					}

					// If file is excluded, skip entirely
					if (isExcluded) {
						return;
					}

					// Check for folder conflicts only if the file is in a conflicting location
					const fileDir = file.parent?.path || "";
					const isInVaultRoot = fileDir === "" || fileDir === "/";
					
					// Find which content types would process this file
					const applicableContentTypes: string[] = [];
					
					// Check if file would be processed as post
					if (this.settings.automatePostCreation) {
						if (!postsFolder && isInVaultRoot) {
							applicableContentTypes.push("Posts");
						} else if (postsFolder && (filePath.startsWith(postsFolder + "/") || filePath === postsFolder)) {
							applicableContentTypes.push("Posts");
						}
					}
					
					// Check if file would be processed as page
					if (this.settings.enablePages) {
						if (!pagesFolder && isInVaultRoot) {
							applicableContentTypes.push("Pages");
						} else if (pagesFolder && (filePath.startsWith(pagesFolder + "/") || filePath === pagesFolder)) {
							applicableContentTypes.push("Pages");
						}
					}
					
					// Check if file would be processed as custom content type
					for (const customType of this.settings.customContentTypes) {
						if (customType.enabled) {
							if (!customType.folder && isInVaultRoot) {
								applicableContentTypes.push(customType.name || "Custom Content");
							} else if (customType.folder && (filePath.startsWith(customType.folder + "/") || filePath === customType.folder)) {
								applicableContentTypes.push(customType.name || "Custom Content");
							}
						}
					}
					
					// Only show conflict if multiple content types would process this specific file
					if (applicableContentTypes.length > 1) {
						new Notice(`⚠️ Folder conflict detected! Multiple content types (${applicableContentTypes.join(", ")}) would process this file. Please specify different folders in settings.`);
						return;
					}

					// Check custom content types first
					for (const customType of this.settings.customContentTypes) {
						if (customType.enabled) {
							if (customType.folder && 
								(filePath.startsWith(customType.folder + "/") || filePath === customType.folder)) {
								customTypeId = customType.id;
								shouldProcess = true;
								break;
							} else if (!customType.folder) {
								// Custom content type folder is blank - treat all files as this type
								customTypeId = customType.id;
								shouldProcess = true;
								break;
							}
						}
					}

					if (!customTypeId) {
						if (pagesFolder && (filePath.startsWith(pagesFolder + "/") || filePath === pagesFolder)) {
							isPage = true;
							shouldProcess = true;
						} else if (!pagesFolder && this.settings.enablePages && isInVaultRoot) {
							// Pages folder is blank - only treat files in vault root as pages
							isPage = true;
							shouldProcess = true;
						}
					}

					// Check posts folder - but only if not already matched as page or custom content type
					if (!shouldProcess && this.settings.automatePostCreation) {
						// Only process as post if meets posts folder criteria
						if (postsFolder) {
							// Posts folder is specified
							if (this.settings.onlyAutomateInPostsFolder) {
								// Only automate in posts folder and one level down
								const pathDepth = filePath.split("/").length;
								const postsDepth = postsFolder.split("/").length;
								
								if (filePath.startsWith(postsFolder + "/") || filePath === postsFolder) {
									// Allow files in posts folder and exactly one level down
									if (pathDepth <= postsDepth + 1) {
										shouldProcess = true;
									}
								}
							} else {
								// Normal automation - check if file is in posts folder
								if (filePath.startsWith(postsFolder + "/") || filePath === postsFolder) {
									shouldProcess = true;
								}
							}
						} else {
							// Posts folder is blank - treat all files as posts (like pages)
							shouldProcess = true;
						}
					}

					// If not in any relevant folder, skip entirely
					if (!shouldProcess) {
						return;
					}

					// Check if file is newly created by user (recent creation time)
					const stat = await this.app.vault.adapter.stat(file.path);
					const isNewNote = stat?.mtime && (now - stat.mtime < CONSTANTS.STAT_MTIME_THRESHOLD);

					// Skip if not a user-initiated new note
					if (!isNewNote) {
						return;
					}

					// Check if file already has frontmatter that looks like it was created by another plugin
					const cache = this.app.metadataCache.getFileCache(file);
					if (cache?.frontmatter) {
						// If it already has frontmatter, it might have been created by another plugin
						// Only proceed if it's a very basic frontmatter (like just a title)
						const frontmatterKeys = Object.keys(cache.frontmatter);
						if (frontmatterKeys.length > 1 || !frontmatterKeys.includes('title')) {
							// This looks like it was created by another plugin with a full template
							return;
						}
					}

					// Show the appropriate modal
					if (customTypeId) {
						new TitleModal(this.app, file, this, customTypeId).open();
					} else if (isPage) {
						new TitleModal(this.app, file, this, "page").open();
					} else {
						// This is a post
						new TitleModal(this.app, file, this, "post").open();
					}
				}
			};
			this.registerEvent(this.app.vault.on("create", this.createEvent as any));
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private registerContextMenu() {
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu, editor, view) => {
				// Only show menu if the feature is enabled
				if (!this.settings.enableCopyHeadingLink) {
					return;
				}

				const cursor = editor.getCursor();
				const file = view.file;
				
				if (!(file instanceof TFile)) {
					return;
				}

				// Find the heading at the current cursor position
				const heading = this.headingLinkGenerator.findHeadingAtLine(this.app, file, cursor.line);
				
				if (heading) {
					// Main copy button - uses the default format and respects Obsidian settings
					menu.addItem((item) => {
						item
							.setTitle('Copy Heading Link')
							.setIcon('link-2')
							.onClick(async () => {
								const link = this.headingLinkGenerator.generateLink(this.app, file, heading);
								await navigator.clipboard.writeText(link);
								new Notice('Heading link copied to clipboard');
							});
					});
				}
			})
		);
	}
}
