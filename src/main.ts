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

					// Check custom content types first
					for (const customType of this.settings.customContentTypes) {
						if (customType.enabled && customType.folder && 
							(filePath.startsWith(customType.folder + "/") || filePath === customType.folder)) {
							customTypeId = customType.id;
							shouldProcess = true;
							break;
						}
					}

					if (!customTypeId && pagesFolder && (filePath.startsWith(pagesFolder + "/") || filePath === pagesFolder)) {
						isPage = true;
						shouldProcess = true;
					}

					// Check posts folder
					if (!shouldProcess && this.settings.automatePostCreation && postsFolder && 
						(filePath.startsWith(postsFolder + "/") || filePath === postsFolder)) {
						shouldProcess = true;
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
