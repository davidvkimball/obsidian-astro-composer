import { App, PluginSettingTab, Setting } from "obsidian";
import { Plugin } from "obsidian";
import { CustomContentType, AstroComposerPluginInterface } from "../types";

export class AstroComposerSettingTab extends PluginSettingTab {
	plugin: AstroComposerPluginInterface;
	autoRenameContainer: HTMLElement | null = null;
	postsFolderContainer: HTMLElement | null = null;
	onlyAutomateContainer: HTMLElement | null = null;
	creationModeContainer: HTMLElement | null = null;
	indexFileContainer: HTMLElement | null = null;
	excludedDirsContainer: HTMLElement | null = null;
	underscorePrefixContainer: HTMLElement | null = null;
	autoInsertContainer: HTMLElement | null = null;
	pagesFieldsContainer: HTMLElement | null = null;
	pagesIndexFileContainer: HTMLElement | null = null;
	copyHeadingContainer: HTMLElement | null = null;
	terminalCommandContainer: HTMLElement | null = null;
	configCommandContainer: HTMLElement | null = null;
	customContentTypesContainer: HTMLElement | null = null;
	terminalRibbonToggle: Setting | null = null;
	configRibbonToggle: Setting | null = null;
	private terminalRibbonToggleComponent: any = null;
	private configRibbonToggleComponent: any = null;

	constructor(app: App, plugin: Plugin) {
		super(app, plugin);
		this.plugin = plugin as unknown as AstroComposerPluginInterface;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		const settings = this.plugin.settings;

		// Global settings
		new Setting(containerEl)
			.setName("Date format")
			.setDesc("Format for the date in properties (e.g., YYYY-MM-DD, MMMM D, YYYY, YYYY-MM-DD HH:mm).")
			.addText((text) =>
				text
					.setPlaceholder("YYYY-MM-DD")
					.setValue(settings.dateFormat)
					.onChange(async (value: string) => {
						settings.dateFormat = value || "YYYY-MM-DD";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Enable copy heading links")
			.setDesc("Add right-click context menu option to copy heading links in various formats.")
			.addToggle((toggle) =>
				toggle
					.setValue(settings.enableCopyHeadingLink)
					.onChange(async (value: boolean) => {
						settings.enableCopyHeadingLink = value;
						await this.plugin.saveSettings();
						this.updateCopyHeadingFields();
					})
			);

		this.copyHeadingContainer = containerEl.createDiv({ cls: "copy-heading-fields" });
		this.copyHeadingContainer.classList.toggle("astro-composer-setting-container-visible", settings.enableCopyHeadingLink);
		this.copyHeadingContainer.classList.toggle("astro-composer-setting-container-hidden", !settings.enableCopyHeadingLink);

		new Setting(this.copyHeadingContainer)
			.setName("Default heading link format")
			.setDesc("Choose the default format for copied heading links. Obsidian format respects your Obsidian settings for wikilink vs markdown preference. Astro link uses your Link base path from above and converts the heading into kebab-case format as an anchor link.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("obsidian", "Obsidian link")
					.addOption("astro", "Astro link")
					.setValue(settings.copyHeadingLinkFormat)
					.onChange(async (value: string) => {
						settings.copyHeadingLinkFormat = value as "obsidian" | "astro";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Add trailing slash to links")
			.setDesc("Add trailing slashes to all converted internal links (e.g., /about/ instead of /about).")
			.addToggle((toggle) =>
				toggle
					.setValue(settings.addTrailingSlashToLinks)
					.onChange(async (value: boolean) => {
						settings.addTrailingSlashToLinks = value;
						await this.plugin.saveSettings();
					})
			);

		// Post settings
		new Setting(containerEl)
			.setName("Posts")
			.setDesc("")
			.setHeading();

		new Setting(containerEl)
			.setName("Automate post creation")
			.setDesc("Automatically show title dialog for new .md files in the posts folder, rename them based on the title, and insert properties if enabled. This setting only applies to posts, not custom content types or pages.")
			.addToggle((toggle) =>
				toggle
					.setValue(settings.automatePostCreation)
					.onChange(async (value: boolean) => {
						settings.automatePostCreation = value;
						settings.autoInsertProperties = value;
						await this.plugin.saveSettings();
						this.plugin.registerCreateEvent();
						this.updateConditionalFields();
					})
			);

		this.autoRenameContainer = containerEl.createDiv({ cls: "auto-rename-fields" });
		this.autoRenameContainer.classList.toggle("astro-composer-setting-container-visible", settings.automatePostCreation);
		this.autoRenameContainer.classList.toggle("astro-composer-setting-container-hidden", !settings.automatePostCreation);

		this.autoInsertContainer = this.autoRenameContainer.createDiv();
		new Setting(this.autoInsertContainer)
			.setName("Auto-insert properties")
			.setDesc("Automatically insert the properties template when creating new files (requires 'Automate post creation' to be enabled).")
			.addToggle((toggle) =>
				toggle
					.setValue(settings.autoInsertProperties)
					.setDisabled(!settings.automatePostCreation)
					.onChange(async (value: boolean) => {
						settings.autoInsertProperties = value;
						await this.plugin.saveSettings();
					})
			);

		this.postsFolderContainer = this.autoRenameContainer.createDiv();
		new Setting(this.postsFolderContainer)
			.setName("Posts folder")
			.setDesc("Folder name for blog posts (leave blank to use the vault folder). You can specify the default location for new notes in Obsidian's 'Files and links' settings.")
			.addText((text) =>
				text
					.setPlaceholder("Enter folder path")
					.setValue(settings.postsFolder)
					.onChange(async (value: string) => {
						settings.postsFolder = value;
						await this.plugin.saveSettings();
						this.updateOnlyAutomateField();
						this.updateExcludedDirsField();
					})
			);


		this.onlyAutomateContainer = this.autoRenameContainer.createDiv();
		new Setting(this.onlyAutomateContainer)
			.setName("Ignore subfolders")
			.setDesc("When enabled, automation will only trigger for new .md files within the Posts folder and one level down (for folder-based posts). Files in deeper subfolders will be ignored.")
			.addToggle((toggle) =>
				toggle
					.setValue(settings.onlyAutomateInPostsFolder)
					.onChange(async (value: boolean) => {
						settings.onlyAutomateInPostsFolder = value;
						await this.plugin.saveSettings();
						this.updateExcludedDirsField();
					})
			);

		this.excludedDirsContainer = this.autoRenameContainer.createDiv({ cls: "excluded-dirs-field" });
		this.excludedDirsContainer.classList.toggle("astro-composer-setting-container-visible", !settings.onlyAutomateInPostsFolder);
		this.excludedDirsContainer.classList.toggle("astro-composer-setting-container-hidden", settings.onlyAutomateInPostsFolder);

		new Setting(this.excludedDirsContainer)
			.setName("Excluded directories")
			.setDesc("Directories to exclude from automatic post creation (e.g., pages|posts/example). Excluded directories and their child folders will be ignored. Use '|' to separate multiple directories.")
			.addText((text) =>
				text
					.setPlaceholder("pages|posts/example")
					.setValue(settings.excludedDirectories)
					.onChange(async (value: string) => {
						settings.excludedDirectories = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(this.autoRenameContainer)
			.setName("Posts link base path")
			.setDesc("Base path for converted links in posts (e.g., /blog/, leave blank for root /).")
			.addText((text) =>
				text
					.setPlaceholder("/blog/")
					.setValue(settings.postsLinkBasePath)
					.onChange(async (value: string) => {
						settings.postsLinkBasePath = value;
						await this.plugin.saveSettings();
					})
			);

		this.creationModeContainer = this.autoRenameContainer.createDiv();
		new Setting(this.creationModeContainer)
			.setName("Creation mode")
			.setDesc("How to create new entries: file-based or folder-based with an index file.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("file", "File-based (post-title.md)")
					.addOption("folder", "Folder-based (post-title/index.md)")
					.setValue(settings.creationMode)
					.onChange(async (value: string) => {
						settings.creationMode = value as "file" | "folder";
						await this.plugin.saveSettings();
						this.updateIndexFileField();
					})
			);

		this.indexFileContainer = this.autoRenameContainer.createDiv({ cls: "index-file-field" });
		this.indexFileContainer.classList.toggle("astro-composer-setting-container-visible", settings.creationMode === "folder");
		this.indexFileContainer.classList.toggle("astro-composer-setting-container-hidden", settings.creationMode !== "folder");

		new Setting(this.indexFileContainer)
			.setName("Index file name")
			.setDesc("Name for index files in folder-based content (without .md extension). Defaults to 'index' if left blank.")
			.addText((text) =>
				text
					.setPlaceholder("index")
					.setValue(settings.indexFileName)
					.onChange(async (value: string) => {
						settings.indexFileName = value;
						await this.plugin.saveSettings();
					})
			);

		this.underscorePrefixContainer = this.autoRenameContainer.createDiv();
		new Setting(this.underscorePrefixContainer)
			.setName("Use underscore prefix for drafts")
			.setDesc("Add an underscore prefix (_post-title) to new notes by default when enabled. This hides them from Astro, which can be helpful for post drafts. Disable to skip prefixing.")
			.addToggle((toggle) =>
				toggle
					.setValue(settings.enableUnderscorePrefix)
					.onChange(async (value: boolean) => {
						settings.enableUnderscorePrefix = value;
						await this.plugin.saveSettings();
					})
			);





		new Setting(containerEl)
			.setName("Post properties template")
			.addTextArea((text) => {
				text
					.setPlaceholder(
						'---\ntitle: "{{title}}"\ndate: {{date}}\ntags: []\n---\n',
					)
					.setValue(settings.defaultTemplate)
					.onChange(async (value: string) => {
						settings.defaultTemplate = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.classList.add("astro-composer-template-textarea");
				return text;
			})
			.then((setting) => {
			setting.descEl.empty();
			const descDiv = setting.descEl.createEl("div");
			descDiv.createEl("div", { text: "Used for new posts and when standardizing properties." });
			descDiv.createEl("div", { text: "Variables include {{title}} and {{date}}." });
			descDiv.createEl("div", { text: "Do not wrap {{date}} in quotes as it represents a datetime value, not a string." });
			descDiv.createEl("div", { text: "The 'standardize properties' command ignores anything below the second '---' line." });
			});

		// Pages settings
		new Setting(containerEl)
			.setName("Pages")
			.setDesc("")
			.setHeading();

		new Setting(containerEl)
			.setName("Enable pages")
			.setDesc("Enable page content type for static pages.")
			.addToggle((toggle) =>
				toggle
					.setValue(settings.enablePages)
					.onChange(async (value: boolean) => {
						settings.enablePages = value;
						await this.plugin.saveSettings();
						this.plugin.registerCreateEvent();
						this.updatePagesFields();
					})
			);

		this.pagesFieldsContainer = containerEl.createDiv({ cls: "pages-fields" });
		this.pagesFieldsContainer.classList.toggle("astro-composer-setting-container-visible", settings.enablePages);
		this.pagesFieldsContainer.classList.toggle("astro-composer-setting-container-hidden", !settings.enablePages);

		new Setting(this.pagesFieldsContainer)
			.setName("Pages folder")
			.setDesc("Folder name for pages (leave blank to use the vault folder).")
			.addText((text) =>
				text
					.setPlaceholder("Enter folder path")
					.setValue(settings.pagesFolder)
					.onChange(async (value: string) => {
						settings.pagesFolder = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(this.pagesFieldsContainer)
			.setName("Pages link base path")
			.setDesc("Base path for converted links in pages (e.g., /about/, leave blank for root /).")
			.addText((text) =>
				text
					.setPlaceholder("/")
					.setValue(settings.pagesLinkBasePath)
					.onChange(async (value: string) => {
						settings.pagesLinkBasePath = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(this.pagesFieldsContainer)
			.setName("Creation mode")
			.setDesc("How to create new entries: file-based or folder-based with an index file.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("file", "File-based (page-title.md)")
					.addOption("folder", "Folder-based (page-title/index.md)")
					.setValue(settings.pagesCreationMode || "file")
					.onChange(async (value: string) => {
						settings.pagesCreationMode = value as "file" | "folder";
						await this.plugin.saveSettings();
						this.updatePagesIndexFileField();
					})
			);

		this.pagesIndexFileContainer = this.pagesFieldsContainer.createDiv({ cls: "pages-index-file-field" });
		this.pagesIndexFileContainer.classList.toggle("astro-composer-setting-container-visible", (settings.pagesCreationMode || "file") === "folder");
		this.pagesIndexFileContainer.classList.toggle("astro-composer-setting-container-hidden", (settings.pagesCreationMode || "file") !== "folder");

		new Setting(this.pagesIndexFileContainer)
			.setName("Index file name")
			.setDesc("Name for index files in folder-based content (without .md extension). Defaults to 'index' if left blank.")
			.addText((text) =>
				text
					.setPlaceholder("index")
					.setValue(settings.pagesIndexFileName || "")
					.onChange(async (value: string) => {
						settings.pagesIndexFileName = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(this.pagesFieldsContainer)
			.setName("Page properties template")
			.setDesc("Template for new page files. Variables include {{title}} and {{date}}.")
			.addTextArea((text) => {
				text
					.setPlaceholder('---\ntitle: "{{title}}"\ndescription: ""\n---\n')
					.setValue(settings.pageTemplate)
					.onChange(async (value: string) => {
						settings.pageTemplate = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.classList.add("astro-composer-template-textarea");
				return text;
			});

		// Custom content types
		new Setting(containerEl)
			.setName("Custom content types")
			.setDesc("")
			.setHeading();

		this.customContentTypesContainer = containerEl.createDiv({ cls: "custom-content-types-container" });
		this.renderCustomContentTypes();

		// Developer commands
		new Setting(containerEl)
			.setName("Developer commands")
			.setDesc("")
			.setHeading();

		// Terminal command settings
		new Setting(containerEl)
			.setName("Enable open terminal command")
			.setDesc("Enable command to open terminal in project root directory.")
			.addToggle((toggle) =>
				toggle
					.setValue(settings.enableOpenTerminalCommand)
					.onChange(async (value: boolean) => {
						settings.enableOpenTerminalCommand = value;
						await this.plugin.saveSettings();
						this.updateTerminalCommandFields();
						// registerRibbonIcons checks both command and icon settings
						// If command is enabled AND icon is enabled, it will show; otherwise it will hide
						if ((this.plugin as any).registerRibbonIcons) {
							(this.plugin as any).registerRibbonIcons();
						}
					})
			);

		this.terminalCommandContainer = containerEl.createDiv({ cls: "terminal-command-fields" });
		this.terminalCommandContainer.classList.toggle("astro-composer-setting-container-visible", settings.enableOpenTerminalCommand);
		this.terminalCommandContainer.classList.toggle("astro-composer-setting-container-hidden", !settings.enableOpenTerminalCommand);

		const projectPathSetting = new Setting(this.terminalCommandContainer)
			.setName("Project root directory path")
			.setDesc("Path relative to the Obsidian vault root folder. Use ../.. for two levels up. Leave blank to use the vault folder. This is where the terminal will open.")
			.addText((text) =>
				text
					.setPlaceholder("../..")
					.setValue(settings.terminalProjectRootPath)
					.onChange(async (value: string) => {
						settings.terminalProjectRootPath = value;
						await this.plugin.saveSettings();
					})
			);

		const terminalRibbonToggle = new Setting(this.terminalCommandContainer)
			.setName("Show open terminal ribbon icon")
			.setDesc("Add a ribbon icon to launch the terminal command.")
			.addToggle((toggle) => {
				this.terminalRibbonToggleComponent = toggle;
				toggle
					.setValue(settings.enableTerminalRibbonIcon)
					.setDisabled(!settings.enableOpenTerminalCommand)
					.onChange(async (value: boolean) => {
						// Update settings directly on plugin instance
						(this.plugin as any).settings.enableTerminalRibbonIcon = value;
						settings.enableTerminalRibbonIcon = value;
						await this.plugin.saveSettings();
						// Small delay to ensure settings are saved, then re-register
						setTimeout(() => {
							if ((this.plugin as any).registerRibbonIcons) {
								(this.plugin as any).registerRibbonIcons();
							}
						}, 50);
					});
			});
		// Store reference for updating disabled state
		this.terminalRibbonToggle = terminalRibbonToggle;

		// Config file command settings
		new Setting(containerEl)
			.setName("Enable edit config file command")
			.setDesc("Enable command to open Astro config file in default editor.")
			.addToggle((toggle) =>
				toggle
					.setValue(settings.enableOpenConfigFileCommand)
					.onChange(async (value: boolean) => {
						settings.enableOpenConfigFileCommand = value;
						await this.plugin.saveSettings();
						this.updateConfigCommandFields();
						// registerRibbonIcons checks both command and icon settings
						// If command is enabled AND icon is enabled, it will show; otherwise it will hide
						if ((this.plugin as any).registerRibbonIcons) {
							(this.plugin as any).registerRibbonIcons();
						}
					})
			);

		this.configCommandContainer = containerEl.createDiv({ cls: "config-command-fields" });
		this.configCommandContainer.classList.toggle("astro-composer-setting-container-visible", settings.enableOpenConfigFileCommand);
		this.configCommandContainer.classList.toggle("astro-composer-setting-container-hidden", !settings.enableOpenConfigFileCommand);

		const configPathSetting = new Setting(this.configCommandContainer)
			.setName("Config file path")
			.setDesc("Path to the config file relative to the vault root. Use ../config.ts or ../../astro.config.mjs. This setting is required.")
			.addText((text) =>
				text
					.setPlaceholder("../config.ts")
					.setValue(settings.configFilePath)
					.onChange(async (value: string) => {
						settings.configFilePath = value;
						await this.plugin.saveSettings();
					})
			);

		const configRibbonToggle = new Setting(this.configCommandContainer)
			.setName("Show open config ribbon icon")
			.setDesc("Add a ribbon icon to launch the config file command.")
			.addToggle((toggle) => {
				this.configRibbonToggleComponent = toggle;
				toggle
					.setValue(settings.enableConfigRibbonIcon)
					.setDisabled(!settings.enableOpenConfigFileCommand)
					.onChange(async (value: boolean) => {
						// Update settings directly on plugin instance
						(this.plugin as any).settings.enableConfigRibbonIcon = value;
						settings.enableConfigRibbonIcon = value;
						await this.plugin.saveSettings();
						// Small delay to ensure settings are saved, then re-register
						setTimeout(() => {
							if ((this.plugin as any).registerRibbonIcons) {
								(this.plugin as any).registerRibbonIcons();
							}
						}, 50);
					});
			});
		// Store reference for updating disabled state
		this.configRibbonToggle = configRibbonToggle;

		this.updateConditionalFields();
		this.updateIndexFileField();
		this.updateExcludedDirsField();
		this.updateOnlyAutomateField();
		this.updatePagesFields();
		this.updateCopyHeadingFields();
		this.updateTerminalCommandFields();
		this.updateConfigCommandFields();
	}

	updateConditionalFields() {
		if (this.autoRenameContainer) {
			const settings = this.plugin.settings;
			this.autoRenameContainer.classList.toggle("astro-composer-setting-container-visible", settings.automatePostCreation);
		this.autoRenameContainer.classList.toggle("astro-composer-setting-container-hidden", !settings.automatePostCreation);
		}
	}

	updateIndexFileField() {
		if (this.indexFileContainer) {
			const settings = this.plugin.settings;
			this.indexFileContainer.classList.toggle("astro-composer-setting-container-visible", settings.creationMode === "folder");
		this.indexFileContainer.classList.toggle("astro-composer-setting-container-hidden", settings.creationMode !== "folder");
		}
	}

	updateOnlyAutomateField() {
		if (this.onlyAutomateContainer) {
			const settings = this.plugin.settings;
			// Hide "Ignore subfolders" when Posts folder is blank
			this.onlyAutomateContainer.classList.toggle("astro-composer-setting-container-visible", !!settings.postsFolder);
			this.onlyAutomateContainer.classList.toggle("astro-composer-setting-container-hidden", !settings.postsFolder);
		}
	}

	updateExcludedDirsField() {
		if (this.excludedDirsContainer) {
			const settings = this.plugin.settings;
			// Hide "Excluded directories" when Posts folder is blank OR when "Ignore subfolders" is enabled
			this.excludedDirsContainer.classList.toggle("astro-composer-setting-container-visible", !!settings.postsFolder && !settings.onlyAutomateInPostsFolder);
			this.excludedDirsContainer.classList.toggle("astro-composer-setting-container-hidden", !(!!settings.postsFolder && !settings.onlyAutomateInPostsFolder));
		}
	}

	updatePagesFields() {
		if (this.pagesFieldsContainer) {
			const settings = this.plugin.settings;
			this.pagesFieldsContainer.classList.toggle("astro-composer-setting-container-visible", settings.enablePages);
		this.pagesFieldsContainer.classList.toggle("astro-composer-setting-container-hidden", !settings.enablePages);
		}
	}

	updateCopyHeadingFields() {
		if (this.copyHeadingContainer) {
			const settings = this.plugin.settings;
			this.copyHeadingContainer.classList.toggle("astro-composer-setting-container-visible", settings.enableCopyHeadingLink);
			this.copyHeadingContainer.classList.toggle("astro-composer-setting-container-hidden", !settings.enableCopyHeadingLink);
		}
	}

	updateTerminalCommandFields() {
		if (this.terminalCommandContainer) {
			const settings = this.plugin.settings;
			this.terminalCommandContainer.classList.toggle("astro-composer-setting-container-visible", settings.enableOpenTerminalCommand);
			this.terminalCommandContainer.classList.toggle("astro-composer-setting-container-hidden", !settings.enableOpenTerminalCommand);
		}
		// Update ribbon toggle disabled state using the toggle component
		if (this.terminalRibbonToggleComponent) {
			this.terminalRibbonToggleComponent.setDisabled(!this.plugin.settings.enableOpenTerminalCommand);
		}
	}

	updateConfigCommandFields() {
		if (this.configCommandContainer) {
			const settings = this.plugin.settings;
			this.configCommandContainer.classList.toggle("astro-composer-setting-container-visible", settings.enableOpenConfigFileCommand);
			this.configCommandContainer.classList.toggle("astro-composer-setting-container-hidden", !settings.enableOpenConfigFileCommand);
		}
		// Update ribbon toggle disabled state using the toggle component
		if (this.configRibbonToggleComponent) {
			this.configRibbonToggleComponent.setDisabled(!this.plugin.settings.enableOpenConfigFileCommand);
		}
	}

	checkForFolderConflicts() {
		const settings = this.plugin.settings;
		const blankFolders: string[] = [];
		const folderConflicts: { [folder: string]: string[] } = {};
		
		// Check posts folder
		if (!settings.postsFolder && settings.automatePostCreation) {
			blankFolders.push("Posts");
		} else if (settings.postsFolder && settings.automatePostCreation) {
			if (!folderConflicts[settings.postsFolder]) {
				folderConflicts[settings.postsFolder] = [];
			}
			folderConflicts[settings.postsFolder].push("Posts");
		}
		
		// Check pages folder
		if (!settings.pagesFolder && settings.enablePages) {
			blankFolders.push("Pages");
		} else if (settings.pagesFolder && settings.enablePages) {
			if (!folderConflicts[settings.pagesFolder]) {
				folderConflicts[settings.pagesFolder] = [];
			}
			folderConflicts[settings.pagesFolder].push("Pages");
		}
		
		// Check custom content types
		for (const customType of settings.customContentTypes) {
			if (customType.enabled) {
				if (!customType.folder) {
					blankFolders.push(customType.name || "Custom Content");
				} else {
					if (!folderConflicts[customType.folder]) {
						folderConflicts[customType.folder] = [];
					}
					folderConflicts[customType.folder].push(customType.name || "Custom Content");
				}
			}
		}
		
		// Check for conflicts
		// Warning box removed - conflicts are still detected at runtime
	}

	private addCustomContentType() {
		const settings = this.plugin.settings;
		const newType: CustomContentType = {
			id: `custom-${Date.now()}`,
			name: `Custom ${settings.customContentTypes.length + 1}`,
			folder: "",
			linkBasePath: "",
			template: '---\ntitle: "{{title}}"\ndate: {{date}}\n---\n',
			enabled: true,
			creationMode: "file",
			indexFileName: "",
		};
		settings.customContentTypes.push(newType);
		void this.plugin.saveSettings();
		this.renderCustomContentTypes();
		this.plugin.registerCreateEvent();
	}

	private renderCustomContentTypes() {
		if (!this.customContentTypesContainer) return;
		
		this.customContentTypesContainer.empty();
		const settings = this.plugin.settings;

		settings.customContentTypes.forEach((customType: CustomContentType, index: number) => {
			if (!this.customContentTypesContainer) return;
			const typeContainer = this.customContentTypesContainer.createDiv({ 
				cls: "custom-content-type-item",
				attr: { "data-type-id": customType.id }
			});

			// Header with name and toggle on the far right
			const header = typeContainer.createDiv({ cls: "custom-content-type-header" });
			header.classList.add("astro-composer-custom-type-header");
			
			// Left side - just the name
			const headerName = header.createDiv();
			headerName.createEl("div", { text: `Custom ${index + 1}`, cls: "setting-item-name" });
			
			// Right side - toggle
			const toggleContainer = header.createDiv({ cls: "checkbox-container" });
			if (customType.enabled) {
				toggleContainer.classList.add("is-enabled");
			}
			
			const toggle = toggleContainer.createEl("input", { type: "checkbox", cls: "checkbox-input" });
			toggle.checked = customType.enabled;
			
			// Add click event to the container as well
			toggleContainer.addEventListener("click", (e) => {
				void (async () => {
					e.preventDefault();
					const newValue = !customType.enabled;
					customType.enabled = newValue;
					toggle.checked = newValue;
					
					await this.plugin.saveSettings();
					this.plugin.registerCreateEvent();
					
					// Update the container class for visual feedback
					if (newValue) {
						toggleContainer.classList.add("is-enabled");
					} else {
						toggleContainer.classList.remove("is-enabled");
					}
					
					// Update visibility
					this.updateCustomContentTypeVisibility(customType.id, newValue);
					
					// Conflict checking removed from settings UI
				})();
			});
			
			// Also add change event as backup
			toggle.addEventListener("change", (e) => {
				void (async () => {
					const value = (e.target as HTMLInputElement).checked;
					customType.enabled = value;
					await this.plugin.saveSettings();
					this.plugin.registerCreateEvent();
					
					// Update the container class for visual feedback
					if (value) {
						toggleContainer.classList.add("is-enabled");
					} else {
						toggleContainer.classList.remove("is-enabled");
					}
					
					// Update visibility
					this.updateCustomContentTypeVisibility(customType.id, value);
				})();
			});

			// Settings container that can be collapsed
			const settingsContainer = typeContainer.createDiv({ 
				cls: "custom-content-type-settings",
				attr: { "data-type-id": customType.id }
			});

			// Content type name
			const nameContainer = settingsContainer.createDiv();
			new Setting(nameContainer)
				.setName("Content type name")
				.setDesc("Display name for this content type (e.g., 'Projects', 'Notes', 'Tutorials')")
				.addText((text) => {
					text
						.setPlaceholder("Enter content type name")
						.setValue(customType.name)
						.onChange(async (value: string) => {
							customType.name = value;
							await this.plugin.saveSettings();
						});
				});

			// Folder location
			const folderContainer = settingsContainer.createDiv();
			new Setting(folderContainer)
				.setName("Folder location")
				.setDesc("Folder path where this content type will be created (e.g., 'projects', 'notes/tutorials')")
				.addText((text) => {
					text
						.setPlaceholder("Enter folder path")
						.setValue(customType.folder)
						.onChange(async (value: string) => {
							customType.folder = value;
							await this.plugin.saveSettings();
							this.plugin.registerCreateEvent();
						});
				});

			// Link base path
			const linkContainer = settingsContainer.createDiv();
			new Setting(linkContainer)
				.setName("Link base path")
				.setDesc("Base path for converted links (e.g., '/projects/', '/notes/tutorials/', leave blank for root /).")
				.addText((text) => {
					text
						.setPlaceholder("Enter link base path")
						.setValue(customType.linkBasePath || "")
						.onChange(async (value: string) => {
							customType.linkBasePath = value;
							await this.plugin.saveSettings();
						});
				});

			// Creation mode
			const creationModeContainer = settingsContainer.createDiv();
			new Setting(creationModeContainer)
				.setName("Creation mode")
				.setDesc("How to create new entries: file-based or folder-based with an index file.")
				.addDropdown((dropdown) =>
					dropdown
						.addOption("file", "File-based (content-title.md)")
						.addOption("folder", "Folder-based (content-title/index.md)")
						.setValue(customType.creationMode)
						.onChange(async (value: string) => {
							customType.creationMode = value as "file" | "folder";
							await this.plugin.saveSettings();
							this.updateCustomContentTypeIndexFileField(customType.id);
						})
				);

			// Index file name (only show for folder-based)
			const indexFileContainer = settingsContainer.createDiv({ cls: "custom-index-file-field" });
			indexFileContainer.classList.toggle("astro-composer-setting-container-visible", customType.creationMode === "folder");
		indexFileContainer.classList.toggle("astro-composer-setting-container-hidden", customType.creationMode !== "folder");
			new Setting(indexFileContainer)
				.setName("Index file name")
				.setDesc("Name for index files in folder-based content (without .md extension). Defaults to 'index' if left blank.")
				.addText((text) =>
					text
						.setPlaceholder("index")
						.setValue(customType.indexFileName)
						.onChange(async (value: string) => {
							customType.indexFileName = value;
							await this.plugin.saveSettings();
						})
				);

			// Template
			const templateContainer = settingsContainer.createDiv();
			new Setting(templateContainer)
				.setName("Properties template")
				.addTextArea((text) => {
					text
						.setPlaceholder('---\ntitle: "{{title}}"\ndate: {{date}}\n---\n')
						.setValue(customType.template)
						.onChange(async (value: string) => {
							customType.template = value;
							await this.plugin.saveSettings();
						});
					text.inputEl.classList.add("astro-composer-template-textarea");
					return text;
				})
				.then((setting) => {
				setting.descEl.empty();
				const descDiv = setting.descEl.createEl("div");
				descDiv.createEl("div", { text: "Template for new files of this content type." });
				descDiv.createEl("div", { text: "Variables include {{title}} and {{date}}." });
				descDiv.createEl("div", { text: "Do not wrap {{date}} in quotes as it represents a datetime value, not a string." });
				});

			// Remove button at the bottom (no divider)
			const removeContainer = settingsContainer.createDiv();
			const removeSetting = new Setting(removeContainer)
				.setName("")
				.addButton((button) => {
					button
						.setButtonText("Remove")
						.setWarning()
						.onClick(() => {
							this.removeCustomContentType(customType.id);
						});
				});
			
			// Hide the divider line for the remove button
			removeSetting.settingEl.classList.add("astro-composer-remove-setting");

			// Set initial visibility
			this.updateCustomContentTypeVisibility(customType.id, customType.enabled);
		});

		// Add button for creating new custom content types
		const addButtonContainer = this.customContentTypesContainer.createDiv();
		const addButtonSetting = new Setting(addButtonContainer)
			.setName("")
			.addButton((button) => {
				button
					.setButtonText("Add custom content type")
					.setCta()
					.onClick(() => {
						this.addCustomContentType();
					});
			});
		
		// Hide the divider line for the add button
		addButtonSetting.settingEl.classList.add("astro-composer-add-button");
	}

	private updateCustomContentTypeVisibility(typeId: string, enabled: boolean) {
		const settingsContainer = this.customContentTypesContainer?.querySelector(`[data-type-id="${typeId}"].custom-content-type-settings`) as HTMLElement;
		if (settingsContainer) {
			settingsContainer.classList.toggle("astro-composer-setting-container-visible", enabled);
			settingsContainer.classList.toggle("astro-composer-setting-container-hidden", !enabled);
		}
	}

	private updateCustomContentTypeIndexFileField(typeId: string) {
		const customType = this.plugin.settings.customContentTypes.find(type => type.id === typeId);
		if (!customType) return;

		const indexFileContainer = this.customContentTypesContainer?.querySelector(`[data-type-id="${typeId}"] .custom-index-file-field`) as HTMLElement;
		if (indexFileContainer) {
			indexFileContainer.classList.toggle("astro-composer-setting-container-visible", customType.creationMode === "folder");
		indexFileContainer.classList.toggle("astro-composer-setting-container-hidden", customType.creationMode !== "folder");
		}
	}

	private updatePagesIndexFileField() {
		if (this.pagesIndexFileContainer) {
			this.pagesIndexFileContainer.classList.toggle("astro-composer-setting-container-visible", this.plugin.settings.pagesCreationMode === "folder");
			this.pagesIndexFileContainer.classList.toggle("astro-composer-setting-container-hidden", this.plugin.settings.pagesCreationMode !== "folder");
		}
	}

	private removeCustomContentType(typeId: string) {
		const settings = this.plugin.settings;
		settings.customContentTypes = settings.customContentTypes.filter((ct: CustomContentType) => ct.id !== typeId);
		void this.plugin.saveSettings();
		this.renderCustomContentTypes();
		this.plugin.registerCreateEvent();
	}
}
