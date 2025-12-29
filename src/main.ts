import {
	Plugin,
	TFile,
	Notice,
	setIcon,
	Platform,
} from "obsidian";

import { AstroComposerSettings, DEFAULT_SETTINGS, CONSTANTS } from "./settings";
import { AstroComposerPluginInterface, ContentType } from "./types";
import { registerCommands, renameContentByPath as renameContentByPathFunction, openTerminalInProjectRoot, openConfigFile } from "./commands";
import { AstroComposerSettingTab } from "./ui/settings-tab";
import { TitleModal } from "./ui/title-modal";
import { MigrationModal, MigrationConflictResult } from "./ui/components/MigrationModal";
import { FileOperations } from "./utils/file-operations";
import { TemplateParser } from "./utils/template-parsing";
import { HeadingLinkGenerator } from "./utils/heading-link-generator";
import { matchesFolderPattern, sortByPatternSpecificity } from "./utils/path-matching";

export default class AstroComposerPlugin extends Plugin implements AstroComposerPluginInterface {
	settings!: AstroComposerSettings;
	private createEvent!: (file: TFile) => void;
	private fileOps!: FileOperations;
	private templateParser!: TemplateParser;
	private headingLinkGenerator!: HeadingLinkGenerator;
	private pluginCreatedFiles: Set<string> = new Set();
	private terminalRibbonIcon: HTMLElement | null = null;
	private configRibbonIcon: HTMLElement | null = null;
	private ribbonContextMenuObserver?: MutationObserver;
	private helpButtonObserver?: MutationObserver;
	private helpButtonElement?: HTMLElement;
	private customHelpButton?: HTMLElement;
	private settingsTab?: AstroComposerSettingTab;

	/**
	 * Migrate old posts/pages settings to unified content types
	 */
	private async migrateSettingsIfNeeded(): Promise<void> {
		// Check if migration is already completed
		// If true, return immediately - no reload/refresh needed, this only runs once per user
		if (this.settings.migrationCompleted) {
			return;
		}

		// Check if there are old settings to migrate
		const hasPostsSettings = this.settings.automatePostCreation !== undefined && this.settings.automatePostCreation;
		const hasPagesSettings = this.settings.enablePages !== undefined && this.settings.enablePages;

		if (!hasPostsSettings && !hasPagesSettings) {
			// No old settings to migrate, mark as completed
			this.settings.migrationCompleted = true;
			await this.saveSettings();
			return;
		}

		// Check for naming conflicts
		// Handle both new contentTypes and legacy customContentTypes
		const legacyContentTypes = (this.settings as unknown as { customContentTypes?: ContentType[] }).customContentTypes;
		const existingContentTypes = this.settings.contentTypes || legacyContentTypes || [];
		const conflicts: string[] = [];
		if (existingContentTypes.some((ct: ContentType) => ct.name === "Posts")) {
			conflicts.push("Posts");
		}
		if (existingContentTypes.some((ct: ContentType) => ct.name === "Pages")) {
			conflicts.push("Pages");
		}

		let shouldMigrate = true;

		// If conflicts exist, prompt user (but don't block - use setTimeout to show modal after UI is ready)
		if (conflicts.length > 0) {
			// Show modal asynchronously to avoid blocking plugin load
			await new Promise<void>((resolve) => {
				setTimeout(() => {
					void (async () => {
						try {
							const modal = new MigrationModal(this.app, conflicts);
							// Add timeout fallback - if user doesn't respond in 30 seconds, default to skip
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
							// If modal fails for any reason, default to skip to prevent blocking
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
			this.settings.migrationCompleted = true;
			await this.saveSettings();
			return;
		}

		// Perform migration
		const migratedTypes: ContentType[] = [];

		// Migrate Posts - skip if it already exists (don't overwrite user's existing config)
		if (hasPostsSettings && !conflicts.includes("Posts")) {
			const postsType: ContentType = {
				id: `posts-${Date.now()}`,
				name: "Posts",
				folder: this.settings.postsFolder || "",
				linkBasePath: this.settings.postsLinkBasePath || "",
				template: this.settings.defaultTemplate || '---\ntitle: "{{title}}"\ndate: {{date}}\ntags: []\n---\n',
				enabled: this.settings.automatePostCreation || false,
				creationMode: this.settings.creationMode || "file",
				indexFileName: this.settings.indexFileName || "",
				ignoreSubfolders: this.settings.onlyAutomateInPostsFolder || false,
				enableUnderscorePrefix: this.settings.enableUnderscorePrefix || false,
				useMdxExtension: false,
			};
			migratedTypes.push(postsType);
		}

		// Migrate Pages - skip if it already exists (don't overwrite user's existing config)
		if (hasPagesSettings && !conflicts.includes("Pages")) {
			const pagesType: ContentType = {
				id: `pages-${Date.now()}`,
				name: "Pages",
				folder: this.settings.pagesFolder || "",
				linkBasePath: this.settings.pagesLinkBasePath || "",
				template: this.settings.pageTemplate || '---\ntitle: "{{title}}"\ndescription: ""\n---\n',
				enabled: this.settings.enablePages || false,
				creationMode: this.settings.pagesCreationMode || "file",
				indexFileName: this.settings.pagesIndexFileName || "",
				ignoreSubfolders: this.settings.onlyAutomateInPagesFolder || false,
				enableUnderscorePrefix: false, // Pages didn't have this option before
				useMdxExtension: false,
			};
			migratedTypes.push(pagesType);
		}

		// Add migrated types to content types array
		// CRITICAL: Preserve ALL existing content types, don't overwrite them
		// Get existing types from both possible sources
		const existingFromNew = this.settings.contentTypes && Array.isArray(this.settings.contentTypes) 
			? this.settings.contentTypes 
			: [];
		const legacySettings = this.settings as unknown as { customContentTypes?: ContentType[] };
		const existingFromLegacy = legacySettings.customContentTypes && Array.isArray(legacySettings.customContentTypes)
			? legacySettings.customContentTypes
			: [];
		
		// Merge existing types, prioritizing new format but including legacy if new is empty
		// If both exist, use new format (it's more recent)
		let existingTypes: ContentType[] = [];
		if (existingFromNew.length > 0) {
			existingTypes = existingFromNew;
		} else if (existingFromLegacy.length > 0) {
			existingTypes = existingFromLegacy;
		}
		
		// Only add migrated types if we have any
		// CRITICAL: Check if migrated types already exist by name before adding them
		// This prevents re-adding content types that were deleted by the user
		let finalTypes: ContentType[] = [...existingTypes];
		if (migratedTypes.length > 0) {
			// Filter out any migrated types that already exist by name
			const existingNames = new Set(existingTypes.map(ct => ct.name));
			const newMigratedTypes = migratedTypes.filter(mt => !existingNames.has(mt.name));
			
			// Only add migrated types that don't already exist
			if (newMigratedTypes.length > 0) {
				finalTypes = [...existingTypes, ...newMigratedTypes];
			}
		}
		
		// Set the final content types array
		this.settings.contentTypes = finalTypes;
		
		// CRITICAL: Clean up all old legacy fields after migration to prevent them from causing issues
		// These fields are no longer needed and could cause content types to be recreated
		const legacyFields = [
			'customContentTypes', // Old name for contentTypes - must be removed
			'enableUnderscorePrefix',
			'postsFolder',
			'postsLinkBasePath',
			'automatePostCreation',
			'creationMode',
			'indexFileName',
			'excludedDirectories',
			'onlyAutomateInPostsFolder',
			'enablePages',
			'pagesFolder',
			'pagesLinkBasePath',
			'pagesCreationMode',
			'pagesIndexFileName',
			'pageTemplate',
			'onlyAutomateInPagesFolder',
		];
		const settingsRecord = this.settings as unknown as Record<string, unknown>;
		for (const field of legacyFields) {
			if (settingsRecord[field] !== undefined) {
				delete settingsRecord[field];
			}
		}

		// Mark migration as completed
		this.settings.migrationCompleted = true;
		// Save settings to ensure all legacy fields are permanently removed from disk
		await this.saveSettings();
		
		// NOTE: The reload and refresh below ONLY happen when migration actually runs
		// If migrationCompleted was already true, this function returns early (line 43)
		// So this code path only executes once per user during their first migration
		
		// Reload settings to ensure everything is in sync
		await this.loadSettings();

		if (migratedTypes.length > 0) {
			new Notice(`Migration completed: ${migratedTypes.length} content type(s) migrated.`);
			
			// Refresh settings tab if it exists - only runs when migration actually happened
			// Use a delay to ensure everything is synced and UI is ready
			setTimeout(() => {
				if (this.settingsTab) {
					// Always try to refresh the settings tab if it exists
					// If it's currently displayed, this will update it immediately
					// If it's not displayed yet, this is safe and won't cause issues
					try {
						// Check if settings tab container exists (means it's been displayed at least once)
						if (this.settingsTab.customContentTypesContainer || this.settingsTab.containerEl) {
							// Settings tab has been displayed - refresh it to show migrated types
							this.settingsTab.display();
						}
						// If container doesn't exist, settings tab hasn't been opened yet
						// It will show migrated types when user opens it (display() reads fresh settings)
					} catch (e) {
						// If refresh fails, that's okay - settings will show when user opens them
						console.warn("Could not refresh settings tab after migration:", e);
					}
				}
			}, 300);
		}
	}

	async onload() {
		await this.loadSettings();

		// Initialize utilities first (don't block on migration)
		this.fileOps = new FileOperations(this.app, this.settings, this as unknown as AstroComposerPluginInterface & { pluginCreatedFiles?: Set<string> });
		this.templateParser = new TemplateParser(this.app, this.settings);
		this.headingLinkGenerator = new HeadingLinkGenerator(this.settings);

		// Register MDX file visibility if enabled
		if (this.settings.showMdxFilesInExplorer) {
			this.registerExtensions(["mdx"], "markdown");
		}

		// Wait for the vault to be fully loaded before registering the create event
		this.app.workspace.onLayoutReady(() => {
			this.registerCreateEvent();
			// Initialize help button replacement (desktop only)
			if (!Platform.isMobile) {
				void this.updateHelpButton();
			}
			
			// Run migration after plugin is fully loaded (non-blocking)
			// This prevents the modal from blocking plugin initialization
			void this.migrateSettingsIfNeeded();
		});

		// Register commands
		registerCommands(this, this.settings);

		// Add settings tab and store reference for refresh after migration
		this.settingsTab = new AstroComposerSettingTab(this.app, this);
		this.addSettingTab(this.settingsTab);

		// Register context menu for copy heading links
		this.registerContextMenu();

		// Register ribbon icons if enabled
		this.registerRibbonIcons();
		
		// Setup ribbon context menu handling
		this.setupRibbonContextMenuHandling();
	}


	public registerCreateEvent() {
		// Always register the event listener, but check enabled content types dynamically
		// This ensures automation works even if content types are enabled after plugin load
		
		// Debounce to prevent multiple modals from rapid file creations
		// Use a Map to track per-file debouncing instead of global debouncing
		const lastProcessedFiles = new Map<string, number>();

		this.createEvent = (file: TFile) => {
			void (async () => {
			const now = Date.now();

			if (file instanceof TFile && (file.extension === "md" || file.extension === "mdx")) {
				const filePath = file.path;

				// Skip if this file was created by the plugin itself
				// Don't delete immediately - keep it for a bit to handle rapid events
				if (this.pluginCreatedFiles.has(filePath)) {
					return;
				}

				// Per-file debounce check - but only check, don't mark yet
				// We'll mark it as processed only AFTER we successfully show the modal
				// However, if the file was processed more than 2 seconds ago, clear it to allow new processing
				const lastProcessed = lastProcessedFiles.get(filePath) || 0;
				if (lastProcessed > 0 && now - lastProcessed < CONSTANTS.DEBOUNCE_MS) {
					return; // Skip if this specific file was just processed
				}
				// Clean up old entries (older than 2 seconds)
				if (lastProcessed > 0 && now - lastProcessed > 2000) {
					lastProcessedFiles.delete(filePath);
				}

				// CRITICAL: Reload settings from disk to ensure we have the latest data
				// This is necessary because other plugins might have modified data.json
				await this.loadSettings();

				// CRITICAL: Check if any content types are enabled AFTER reloading settings
				// This ensures automation works when content types are enabled by another plugin
				const contentTypes = this.settings.contentTypes || [];
				const hasEnabledContentTypes = contentTypes.some(ct => ct.enabled);
				
				// If no content types are enabled, skip processing
				if (!hasEnabledContentTypes) {
					return;
				}
					
					// Find matching content type using pattern specificity (most specific wins)
					// Sort by pattern specificity so more specific patterns are checked first
					const sortedContentTypes = sortByPatternSpecificity(contentTypes);
					let matchedContentTypeId: string | null = null;
					const matchingTypes: ContentType[] = []; // Track all matching types for conflict detection
					
					for (const contentType of sortedContentTypes) {
						if (!contentType.enabled) continue;
						
						let matches = false;
						
						// Handle blank folder (root) - matches files in vault root only
						if (!contentType.folder || contentType.folder.trim() === "") {
							if (!filePath.includes("/") || filePath.split("/").length === 1) {
								matches = true;
							}
						} else if (matchesFolderPattern(filePath, contentType.folder)) {
							// Check if ignore subfolders is enabled
							if (contentType.ignoreSubfolders) {
								const pathSegments = filePath.split("/");
								const pathDepth = pathSegments.length;
								const patternSegments = contentType.folder.split("/");
								const expectedDepth = patternSegments.length;
								
								if (contentType.creationMode === "folder") {
									// For folder-based creation, files are one level deeper (e.g., test/my-file/index.md)
									// So we need to allow one extra level beyond the pattern depth
									const folderDepth = pathDepth - 1; // Subtract 1 for the index.md file
									if (folderDepth === expectedDepth || folderDepth === expectedDepth + 1) {
										matches = true;
									}
								} else {
									// For file-based creation, files are at the same depth as the pattern
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
							// Use the first matching type (most specific due to sorting)
							if (!matchedContentTypeId) {
								matchedContentTypeId = contentType.id;
							}
						}
					}
					
					// Show conflict warning if multiple content types match
					if (matchingTypes.length > 1) {
						const typeNames = matchingTypes.map(ct => ct.name || "Unnamed").join(", ");
						new Notice(`Multiple content types (${typeNames}) match this file. Using most specific: ${matchingTypes[0].name || "Unnamed"}`);
					}

					// If no content type matches, skip entirely
					if (!matchedContentTypeId) {
						return;
					}

					// Check if file is newly created by user (recent creation time)
					const stat = await this.app.vault.adapter.stat(file.path);
					const isNewNote = stat?.mtime && (now - stat.mtime < CONSTANTS.STAT_MTIME_THRESHOLD);

					// Skip if not a user-initiated new note
					if (!isNewNote) {
						return;
					}

					// Wait a moment for the file to be fully written
					// This helps avoid race conditions where we read before Obsidian finishes writing
					await new Promise(resolve => setTimeout(resolve, 50));
					
					// Read file content directly for more reliable detection
					// (metadata cache might not be ready yet, especially for MDX files)
					let content: string;
					try {
						content = await this.app.vault.read(file);
					} catch (error) {
						console.error("Error reading file for create detection:", error);
						return;
					}
					
					// Skip if file already has substantial content or frontmatter
					if (content.trim().length > 0) {
						// Check if it has frontmatter created by another plugin
						if (content.startsWith('---')) {
							const frontmatterEnd = content.indexOf('\n---', 3);
							if (frontmatterEnd !== -1) {
								const frontmatterText = content.slice(4, frontmatterEnd).trim();
								const lines = frontmatterText.split('\n').filter(line => line.trim().length > 0);
								// If it has more than just a title line, skip
								if (lines.length > 1 || (lines.length === 1 && !lines[0].startsWith('title:'))) {
									return;
								}
							}
						}
						// If it has body content (after frontmatter), skip
						const contentWithoutFrontmatter = content.startsWith('---') 
							? content.slice(content.indexOf('\n---', 3) + 4).trim()
							: content.trim();
						if (contentWithoutFrontmatter.length > 0) {
							return;
						}
					}

					// Mark the original file as handled IMMEDIATELY to prevent it from triggering the create event again
					// This must happen before we show the modal, as the modal will rename the file
					// Keep it in the set for a while to handle any delayed events
					this.pluginCreatedFiles.add(file.path);
					
					// Clean up after a delay to prevent memory leaks
					setTimeout(() => {
						this.pluginCreatedFiles.delete(file.path);
					}, 2000);
					
					// Mark as processed in debounce map ONLY after we've confirmed we'll show the modal
					// This prevents marking files that we skip due to early returns
					// Use a shorter debounce time for CTRL+N (user-initiated) vs automatic creation
					lastProcessedFiles.set(file.path, now);
					
					// Clear the debounce entry after processing completes (when modal closes)
					// This allows the next CTRL+N to work immediately
					setTimeout(() => {
						lastProcessedFiles.delete(file.path);
					}, CONSTANTS.DEBOUNCE_MS + 100);
					
					// Clean up old entries to prevent memory leak
					if (lastProcessedFiles.size > 100) {
						const cutoff = now - CONSTANTS.DEBOUNCE_MS * 2;
						for (const [path, time] of lastProcessedFiles.entries()) {
							if (time < cutoff) {
								lastProcessedFiles.delete(path);
							}
						}
					}
					
					// Show the modal with the matched content type
					new TitleModal(this.app, file, this, matchedContentTypeId, false, true).open();
				}
				})();
			};
		
		// Always register the event listener - it will check enabled content types dynamically
		// Use vault.create event to detect new file creation
		this.registerEvent(this.app.vault.on("create", (file) => {
			if (file instanceof TFile) {
				// Always call createEvent - it will check for enabled content types after reloading settings
				this.createEvent(file);
			}
		}));
	}

	async loadSettings() {
		const loadedData = (await this.loadData()) as unknown;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData as Partial<AstroComposerSettings> | null | undefined);
		
		// Ensure contentTypes is always an array (never undefined or null)
		if (!this.settings.contentTypes || !Array.isArray(this.settings.contentTypes)) {
			this.settings.contentTypes = [];
		}
		
		// CRITICAL: Only migrate legacy customContentTypes to contentTypes if migration hasn't completed yet
		// After migration, all legacy fields should be deleted and we should never restore them
		if (!this.settings.migrationCompleted) {
			// Migrate legacy customContentTypes to contentTypes if needed (before migration runs)
			// Check if contentTypes is empty/undefined and customContentTypes exists
			const legacySettings = this.settings as unknown as { customContentTypes?: ContentType[] };
			const hasLegacyTypes = legacySettings.customContentTypes && Array.isArray(legacySettings.customContentTypes) && legacySettings.customContentTypes.length > 0;
			const hasNewTypes = this.settings.contentTypes && Array.isArray(this.settings.contentTypes) && this.settings.contentTypes.length > 0;
			
			if (hasLegacyTypes && !hasNewTypes) {
				// Preserve existing custom content types
				this.settings.contentTypes = legacySettings.customContentTypes || [];
			}
		} else {
			// After migration, clean up ALL legacy fields if they still exist
			// This is a one-time cleanup to remove any lingering legacy data from disk
			// CRITICAL: Always delete customContentTypes after migration to prevent deleted content types from being restored
			const legacyFields = [
				'customContentTypes', // Old name for contentTypes - MUST be removed to prevent restoring deleted types
				'enableUnderscorePrefix',
				'postsFolder',
				'postsLinkBasePath',
				'automatePostCreation',
				'creationMode',
				'indexFileName',
				'excludedDirectories',
				'onlyAutomateInPostsFolder',
				'enablePages',
				'pagesFolder',
				'pagesLinkBasePath',
				'pagesCreationMode',
				'pagesIndexFileName',
				'pageTemplate',
				'onlyAutomateInPagesFolder',
			];
			
			const settingsRecord = this.settings as unknown as Record<string, unknown>;
			for (const field of legacyFields) {
				if (settingsRecord[field] !== undefined) {
					delete settingsRecord[field];
				}
			}
			
			// Save immediately to remove any legacy fields from disk
			// This ensures deleted content types don't come back from legacy fields
			await this.saveSettings();
		}
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
					const fullLink = this.headingLinkGenerator.generateLink(this.app, file, heading);
					const urlOnly = this.headingLinkGenerator.extractUrl(fullLink);
					
					// Option 1: Copy URL only (for CTRL+K workflow)
					menu.addItem((item) => {
						item
							.setTitle('Copy heading link')
							.setIcon('link-2')
							.onClick(async () => {
								await navigator.clipboard.writeText(urlOnly);
								new Notice('Heading link copied to clipboard');
							});
					});
					
					// Option 2: Copy full link with text (for standalone pasting)
					menu.addItem((item) => {
						item
							.setTitle('Copy heading link with text')
							.setIcon('heading')
							.onClick(async () => {
								await navigator.clipboard.writeText(fullLink);
								new Notice('Heading link with text copied to clipboard');
							});
					});
				}
			})
		);
	}

	/**
	 * Rename a file by path (for programmatic use, e.g., from other plugins)
	 * This allows the rename modal to appear without opening the file first
	 */
	async renameContentByPath(filePath: string): Promise<void> {
		await renameContentByPathFunction(this.app, filePath, this.settings, this);
	}

	public registerRibbonIcons() {
		// Terminal and config features are desktop-only (not available on mobile)
		if (Platform.isMobile) {
			// Remove any existing icons on mobile
			if (this.terminalRibbonIcon) {
				try {
					if (this.terminalRibbonIcon.parentNode) {
						this.terminalRibbonIcon.remove();
					}
				} catch {
					// Silently handle errors
				}
				this.terminalRibbonIcon = null;
			}
			if (this.configRibbonIcon) {
				try {
					if (this.configRibbonIcon.parentNode) {
						this.configRibbonIcon.remove();
					}
				} catch {
					// Silently handle errors
				}
				this.configRibbonIcon = null;
			}
			// Remove from DOM
			try {
				const terminalIcons = document.querySelectorAll('.side-dock-ribbon-action[aria-label="Open project terminal"]');
				terminalIcons.forEach((icon: Element) => icon.remove());
				const configIcons = document.querySelectorAll('.side-dock-ribbon-action[aria-label="Edit astro config"]');
				configIcons.forEach((icon: Element) => icon.remove());
			} catch {
				// Silently handle errors
			}
			return; // Don't register icons on mobile
		}

		// Calculate what should exist FIRST (before DOM search)
		const terminalRibbonEnabled = this.settings.enableTerminalRibbonIcon === true;
		const terminalCommandEnabled = this.settings.enableOpenTerminalCommand === true;
		const terminalShouldExist = terminalRibbonEnabled && terminalCommandEnabled;

		const configRibbonEnabled = this.settings.enableConfigRibbonIcon === true;
		const configCommandEnabled = this.settings.enableOpenConfigFileCommand === true;
		const configShouldExist = configRibbonEnabled && configCommandEnabled;

		// ALWAYS remove all icons first, regardless of state - this ensures clean slate
		// Remove from our references first
		if (this.terminalRibbonIcon) {
			try {
				if (this.terminalRibbonIcon.parentNode) {
					this.terminalRibbonIcon.remove();
				}
			} catch {
				// Silently handle errors
			}
			this.terminalRibbonIcon = null;
		}
		
		if (this.configRibbonIcon) {
			try {
				if (this.configRibbonIcon.parentNode) {
					this.configRibbonIcon.remove();
				}
			} catch {
				// Silently handle errors
			}
			this.configRibbonIcon = null;
		}
		
		// Search DOM and remove ALL instances of our icons (by aria-label)
		// This catches any icons that might exist but aren't tracked
		try {
			// ALWAYS remove ALL terminal icons, regardless of settings
			const terminalIcons = document.querySelectorAll('.side-dock-ribbon-action[aria-label="Open project terminal"]');
			terminalIcons.forEach((icon: Element) => icon.remove());
			
			// ALWAYS remove ALL config icons, regardless of settings
			const configIcons = document.querySelectorAll('.side-dock-ribbon-action[aria-label="Edit astro config"]');
			configIcons.forEach((icon: Element) => icon.remove());
		} catch {
			// Silently handle errors
		}

		// Now add only the icons that should exist
		if (terminalShouldExist) {
			// Only add if icon doesn't exist in DOM
			const existingTerminal = document.querySelector('.side-dock-ribbon-action[aria-label="Open project terminal"]');
			if (!existingTerminal) {
				this.terminalRibbonIcon = this.addRibbonIcon('terminal-square', 'Open project terminal', async () => {
					if (!this.settings.enableOpenTerminalCommand) {
						new Notice("Open terminal command is disabled. Enable it in settings to use this command.");
						return;
					}
					await openTerminalInProjectRoot(this.app, this.settings);
				});
				// Add data attribute to identify our icon
				if (this.terminalRibbonIcon) {
					this.terminalRibbonIcon.setAttribute('data-astro-composer-terminal-ribbon', 'true');
				}
			} else {
				this.terminalRibbonIcon = existingTerminal as HTMLElement;
			}
			
			// Immediately check and remove config icon if it was re-added
			if (!configShouldExist) {
				const configIcons = document.querySelectorAll('.side-dock-ribbon-action[aria-label="Edit astro config"]');
				if (configIcons.length > 0) {
					configIcons.forEach((icon: Element) => icon.remove());
					this.configRibbonIcon = null;
				}
			}
		} else {
			this.terminalRibbonIcon = null;
		}

		if (configShouldExist) {
			// Only add if icon doesn't exist in DOM
			const existingConfig = document.querySelector('.side-dock-ribbon-action[aria-label="Edit astro config"]');
			if (!existingConfig) {
				this.configRibbonIcon = this.addRibbonIcon('wrench', 'Edit astro config', async () => {
					if (!this.settings.enableOpenConfigFileCommand) {
						new Notice("Edit config file command is disabled. Enable it in settings to use this command.");
						return;
					}
					await openConfigFile(this.app, this.settings);
				});
				// Add data attribute to identify our icon
				if (this.configRibbonIcon) {
					this.configRibbonIcon.setAttribute('data-astro-composer-config-ribbon', 'true');
				}
			} else {
				this.configRibbonIcon = existingConfig as HTMLElement;
			}
			
			// Immediately check and remove terminal icon if it was re-added
			if (!terminalShouldExist) {
				const terminalIcons = document.querySelectorAll('.side-dock-ribbon-action[aria-label="Open project terminal"]');
				if (terminalIcons.length > 0) {
					terminalIcons.forEach((icon: Element) => icon.remove());
					this.terminalRibbonIcon = null;
				}
			}
		} else {
			this.configRibbonIcon = null;
		}
		
		// Update context menu handling after icons are registered
		this.updateRibbonContextMenuCSS();
		this.setupRibbonContextMenuObserver();
		
		// Final cleanup pass - ensure no unwanted icons exist in DOM
		setTimeout(() => {
			if (!terminalShouldExist) {
				const terminalIcons = document.querySelectorAll('.side-dock-ribbon-action[aria-label="Open project terminal"]');
				terminalIcons.forEach((icon: Element) => icon.remove());
				this.terminalRibbonIcon = null;
			}
			if (!configShouldExist) {
				const configIcons = document.querySelectorAll('.side-dock-ribbon-action[aria-label="Edit astro config"]');
				configIcons.forEach((icon: Element) => icon.remove());
				this.configRibbonIcon = null;
			}
		}, 100);
	}

	onunload() {
		// Clean up ribbon icons
		if (this.terminalRibbonIcon) {
			this.terminalRibbonIcon.remove();
			this.terminalRibbonIcon = null;
		}
		if (this.configRibbonIcon) {
			this.configRibbonIcon.remove();
			this.configRibbonIcon = null;
		}
		
		// Cleanup ribbon context menu handling
		if (this.ribbonContextMenuObserver) {
			this.ribbonContextMenuObserver.disconnect();
			this.ribbonContextMenuObserver = undefined;
		}
		
		// Remove CSS classes
		document.body.removeClass('astro-composer-hide-terminal-icon');
		document.body.removeClass('astro-composer-hide-config-icon');

		// Cleanup help button replacement
		if (this.helpButtonObserver) {
			this.helpButtonObserver.disconnect();
			this.helpButtonObserver = undefined;
		}


		if (this.customHelpButton) {
			this.customHelpButton.remove();
			this.customHelpButton = undefined;
		}

		this.helpButtonElement = undefined;
	}

	// Ribbon context menu handling - based on Astro Modular Settings approach
	private setupRibbonContextMenuHandling() {
		this.updateRibbonContextMenuCSS();
		this.setupRibbonContextMenuObserver();
	}

	private updateRibbonContextMenuCSS() {
		// Check if either icon should be hidden
		const terminalShouldBeHidden = !this.settings.enableTerminalRibbonIcon || !this.settings.enableOpenTerminalCommand;
		const configShouldBeHidden = !this.settings.enableConfigRibbonIcon || !this.settings.enableOpenConfigFileCommand;

		// Use CSS classes on document body to control visibility
		if (terminalShouldBeHidden) {
			document.body.addClass('astro-composer-hide-terminal-icon');
		} else {
			document.body.removeClass('astro-composer-hide-terminal-icon');
		}
		
		if (configShouldBeHidden) {
			document.body.addClass('astro-composer-hide-config-icon');
		} else {
			document.body.removeClass('astro-composer-hide-config-icon');
		}
	}

	private setupRibbonContextMenuObserver() {
		// Disconnect existing observer if any
		if (this.ribbonContextMenuObserver) {
			this.ribbonContextMenuObserver.disconnect();
		}

		// Check if we need to hide any icons
		const terminalShouldBeHidden = !this.settings.enableTerminalRibbonIcon || !this.settings.enableOpenTerminalCommand;
		const configShouldBeHidden = !this.settings.enableConfigRibbonIcon || !this.settings.enableOpenConfigFileCommand;

		// Only set up observer if any icon should be hidden
		if (!terminalShouldBeHidden && !configShouldBeHidden) {
			return;
		}

		// Watch for context menu creation and remove our items
		this.ribbonContextMenuObserver = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				if (mutation.addedNodes.length > 0) {
					// Check if a menu was added
					for (const node of Array.from(mutation.addedNodes)) {
						if (node instanceof HTMLElement) {
							// Check if it's a menu
							if (node.classList.contains('menu') || node.querySelector('.menu')) {
								this.removeRibbonIconsFromContextMenu(node);
							}
						}
					}
				}
			}
		});

		// Observe the document body for menu additions
		this.ribbonContextMenuObserver.observe(document.body, {
			childList: true,
			subtree: true,
		});
	}

	private updateHelpButtonCSS() {
		// Use CSS class on document body to control visibility
		if (this.settings.helpButtonReplacement?.enabled) {
			document.body.addClass('astro-composer-hide-help-button');
		} else {
			document.body.removeClass('astro-composer-hide-help-button');
		}
	}

	public async updateHelpButton() {
		// Help button replacement is desktop-only (not available on mobile)
		if (Platform.isMobile) {
			// Clean up any existing help button replacement on mobile
			this.restoreHelpButton();
			return;
		}

		// Temporarily disconnect observer to prevent infinite loops
		if (this.helpButtonObserver) {
			this.helpButtonObserver.disconnect();
		}

		// Ensure we have the latest settings
		await this.loadSettings();

		// Update CSS first (this will hide the help button globally)
		this.updateHelpButtonCSS();

		// Check if replacement is enabled
		if (!this.settings.helpButtonReplacement?.enabled) {
			this.restoreHelpButton();
			// Still set up observer in case user enables it later
			this.setupHelpButtonObserver();
			return;
		}

		// Find the help button
		const vaultActions = document.querySelector('.workspace-drawer-vault-actions');
		if (!vaultActions) {
			// Vault actions not found yet - set up observer to catch it when it appears
			this.setupHelpButtonObserver();
			// Also retry after a short delay
			setTimeout(() => {
				if (this.settings.helpButtonReplacement?.enabled) {
					void this.updateHelpButton();
				}
			}, 500);
			return;
		}

		// Find the help button - it's the first clickable-icon that contains an SVG with class "help"
		const clickableIcons = Array.from(vaultActions.querySelectorAll('.clickable-icon'));
		let helpButton: HTMLElement | null = null;
		
		for (const icon of clickableIcons) {
			const svg = icon.querySelector('svg.help');
			if (svg) {
				helpButton = icon as HTMLElement;
				break;
			}
		}
		
		if (!helpButton) {
			// Help button not found yet - set up observer to catch it when it appears
			this.setupHelpButtonObserver();
			// Also retry after a short delay
			setTimeout(() => {
				if (this.settings.helpButtonReplacement?.enabled) {
					void this.updateHelpButton();
				}
			}, 500);
			return;
		}

		// Store reference to the button
		this.helpButtonElement = helpButton;

		// Remove existing custom button if it exists (always recreate to update icon/command)
		// Check if it's actually in the DOM and has our identifier before trying to remove it
		if (this.customHelpButton && 
			this.customHelpButton.parentElement && 
			document.body.contains(this.customHelpButton) &&
			this.customHelpButton.hasAttribute('data-astro-composer-help-replacement')) {
			this.customHelpButton.remove();
		}
		this.customHelpButton = undefined;

		// Create a new custom button
		const customButton = helpButton.cloneNode(true) as HTMLElement;
		customButton.addClass("astro-composer-help-replacement");
		customButton.removeAttribute('aria-label'); // Remove any existing aria-label
		
		// Add unique identifier to avoid conflicts with other plugins
		customButton.setAttribute('data-astro-composer-help-replacement', 'true');
		customButton.classList.add('astro-composer-help-replacement');
		
		// Clear any existing click handlers
		customButton.onclick = null;
		
		// Replace the icon using Obsidian's setIcon function
		const iconContainer = customButton.querySelector('svg')?.parentElement || customButton;
		try {
			if (iconContainer instanceof HTMLElement) {
				setIcon(iconContainer, this.settings.helpButtonReplacement.iconId);
			}
		} catch (error) {
			console.warn('[Astro Composer] Error setting icon:', error);
		}

		// Add our custom click handler
		customButton.addEventListener('click', (evt: MouseEvent) => {
			evt.preventDefault();
			evt.stopPropagation();
			
			const commandId = this.settings.helpButtonReplacement?.commandId;
			if (commandId) {
				void (async () => {
					try {
						const appWithCommands = this.app as unknown as { commands?: { executeCommandById?: (id: string) => Promise<void> } };
						if (appWithCommands.commands?.executeCommandById) {
							await appWithCommands.commands.executeCommandById(commandId);
						}
					} catch (error) {
						console.warn('[Astro Composer] Error executing command:', error);
						new Notice(`Failed to execute command: ${commandId}`);
					}
				})();
			}
		}, true); // Use capture phase to ensure we handle it first

		// Insert the custom button in the same position as the help button (before it)
		// This ensures it takes the help button's position without affecting other buttons
		helpButton.parentElement?.insertBefore(customButton, helpButton);
		
		// Store reference to custom button
		this.customHelpButton = customButton;

		// Set up observer after a delay to watch for changes
		setTimeout(() => {
			if (this.settings.helpButtonReplacement?.enabled) {
				this.setupHelpButtonObserver();
			}
		}, 1000);
	}

	private setupHelpButtonObserver() {
		// Disconnect existing observer if any
		if (this.helpButtonObserver) {
			this.helpButtonObserver.disconnect();
		}

		// Only set up observer if replacement is enabled
		if (!this.settings.helpButtonReplacement?.enabled) {
			return;
		}

		// Watch for changes to the vault profile area only (more targeted)
		let updateTimeout: number | null = null;
		this.helpButtonObserver = new MutationObserver(() => {
			// Debounce updates to prevent infinite loops
			if (updateTimeout) {
				clearTimeout(updateTimeout);
			}
			updateTimeout = window.setTimeout(() => {
				// Check if help button was recreated (CSS will hide it, but we need to inject our custom button)
				const vaultActions = document.querySelector('.workspace-drawer-vault-actions');
				if (!vaultActions) return;
				
			// Check if we have a custom button AND it's still in the DOM
			// The reference might exist but the button could have been removed
			// Also verify it has our unique identifier to avoid conflicts with other plugins
			const customButtonExists = this.customHelpButton && 
				this.customHelpButton.parentElement && 
				document.body.contains(this.customHelpButton) &&
				this.customHelpButton.hasAttribute('data-astro-composer-help-replacement');
			
			if (!customButtonExists) {
				// Clear stale reference if button was removed or doesn't have our identifier
				if (this.customHelpButton && (!document.body.contains(this.customHelpButton) || 
					!this.customHelpButton.hasAttribute('data-astro-composer-help-replacement'))) {
					this.customHelpButton = undefined;
				}
				void this.updateHelpButton();
			}
			}, 100); // Shorter debounce for better responsiveness
		});

		// Observe the vault actions area more specifically
		const vaultActions = document.querySelector('.workspace-drawer-vault-actions');
		if (vaultActions) {
			this.helpButtonObserver.observe(vaultActions, {
				childList: true,
				subtree: true, // Watch subtree to catch when buttons are recreated
			});
		}
		
		// Also observe the parent vault profile area
		const vaultProfile = document.querySelector('.workspace-sidedock-vault-profile');
		if (vaultProfile) {
			this.helpButtonObserver.observe(vaultProfile, {
				childList: true,
				subtree: true, // Watch subtree to catch when vault actions are added
			});
		}

		// Fallback: observe the workspace container if specific elements don't exist yet
		// This ensures we catch the button when it first appears
		if (!vaultActions && !vaultProfile) {
			const workspace = document.querySelector('.workspace-split');
			if (workspace) {
				this.helpButtonObserver.observe(workspace, {
					childList: true,
					subtree: true,
				});
			} else {
				// Last resort: observe document body (but with more specific checks)
				this.helpButtonObserver.observe(document.body, {
					childList: true,
					subtree: true,
				});
			}
		}
	}

	private restoreHelpButton() {
		// Remove CSS class that hides help button
		document.body.removeClass('astro-composer-hide-help-button');

		// Remove the custom button
		if (this.customHelpButton) {
			this.customHelpButton.remove();
			this.customHelpButton = undefined;
		}

		// Clear stored references
		this.helpButtonElement = undefined;
	}

	private removeRibbonIconsFromContextMenu(menuElement: HTMLElement) {
		const terminalShouldBeHidden = !this.settings.enableTerminalRibbonIcon || !this.settings.enableOpenTerminalCommand;
		const configShouldBeHidden = !this.settings.enableConfigRibbonIcon || !this.settings.enableOpenConfigFileCommand;

		// Find all menu items
		const menuItems = menuElement.querySelectorAll('.menu-item');
		for (const item of Array.from(menuItems)) {
			// Check if this menu item contains our icons
			const svg = item.querySelector('svg');
			if (svg) {
				const iconName = svg.getAttribute('data-lucide') || 
					svg.getAttribute('xmlns:lucide') ||
					(svg.classList.contains('lucide-terminal-square') ? 'terminal-square' : null) ||
					(svg.classList.contains('lucide-wrench') ? 'wrench' : null);
				
				// Remove terminal icon if it should be hidden
				if (terminalShouldBeHidden && iconName === 'terminal-square') {
					const itemText = item.textContent?.toLowerCase() || '';
					if (itemText.includes('terminal') || itemText.includes('project terminal')) {
						item.remove();
					}
				}
				
				// Remove config icon if it should be hidden
				if (configShouldBeHidden && iconName === 'wrench') {
					const itemText = item.textContent?.toLowerCase() || '';
					if (itemText.includes('config') || itemText.includes('astro config')) {
						item.remove();
					}
				}
			}
		}
	}
}
