import { App, PluginSettingTab, Setting } from "obsidian";
import { Plugin } from "obsidian";
import { AstroComposerSettings } from "../types";

export class AstroComposerSettingTab extends PluginSettingTab {
	plugin: Plugin;
	autoRenameContainer: HTMLElement | null = null;
	postsFolderContainer: HTMLElement | null = null;
	onlyAutomateContainer: HTMLElement | null = null;
	creationModeContainer: HTMLElement | null = null;
	indexFileContainer: HTMLElement | null = null;
	excludedDirsContainer: HTMLElement | null = null;
	underscorePrefixContainer: HTMLElement | null = null;
	autoInsertContainer: HTMLElement | null = null;
	pagesFieldsContainer: HTMLElement | null = null;
	copyHeadingContainer: HTMLElement | null = null;

	constructor(app: App, plugin: Plugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		const settings = (this.plugin as any).settings as AstroComposerSettings;

		new Setting(containerEl)
			.setName("Automate post creation")
			.setDesc("Automatically show title dialog for new .md files, rename them based on the title, and insert properties if enabled.")
			.addToggle((toggle) =>
				toggle
					.setValue(settings.automatePostCreation)
					.onChange(async (value: boolean) => {
						settings.automatePostCreation = value;
						settings.autoInsertProperties = value;
						await (this.plugin as any).saveSettings();
						(this.plugin as any).registerCreateEvent();
						this.updateConditionalFields();
					})
			);

		this.autoRenameContainer = containerEl.createDiv({ cls: "auto-rename-fields" });
		this.autoRenameContainer.style.display = settings.automatePostCreation ? "block" : "none";

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
						await (this.plugin as any).saveSettings();
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
						await (this.plugin as any).saveSettings();
					})
			);

		this.onlyAutomateContainer = this.autoRenameContainer.createDiv();
		new Setting(this.onlyAutomateContainer)
			.setName("Only automate in this folder")
			.setDesc("When enabled, automation will only trigger for new .md files within the specified Posts folder and subfolders.")
			.addToggle((toggle) =>
				toggle
					.setValue(settings.onlyAutomateInPostsFolder)
					.onChange(async (value: boolean) => {
						settings.onlyAutomateInPostsFolder = value;
						await (this.plugin as any).saveSettings();
						this.updateExcludedDirsField();
					})
			);

		this.excludedDirsContainer = this.autoRenameContainer.createDiv({ cls: "excluded-dirs-field" });
		this.excludedDirsContainer.style.display = !settings.onlyAutomateInPostsFolder ? "block" : "none";

		new Setting(this.excludedDirsContainer)
			.setName("Excluded directories")
			.setDesc("Directories to exclude from automatic post creation (e.g., pages|posts/example). Excluded directories and their child folders will be ignored. Use '|' to separate multiple directories.")
			.addText((text) =>
				text
					.setPlaceholder("pages|posts/example")
					.setValue(settings.excludedDirectories)
					.onChange(async (value: string) => {
						settings.excludedDirectories = value;
						await (this.plugin as any).saveSettings();
					})
			);

		this.creationModeContainer = this.autoRenameContainer.createDiv();
		new Setting(this.creationModeContainer)
			.setName("Creation mode")
			.setDesc("How to create new posts: file-based or folder-based with index.md.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("file", "File-based (post-title.md)")
					.addOption("folder", "Folder-based (post-title/index.md)")
					.setValue(settings.creationMode)
					.onChange(async (value: string) => {
						settings.creationMode = value as "file" | "folder";
						await (this.plugin as any).saveSettings();
						this.updateIndexFileField();
					})
			);

		this.indexFileContainer = this.autoRenameContainer.createDiv({ cls: "index-file-field" });
		this.indexFileContainer.style.display = settings.creationMode === "folder" ? "block" : "none";

		new Setting(this.indexFileContainer)
			.setName("Index file name")
			.setDesc("Name for the main file in folder-based mode (without .md extension).")
			.addText((text) =>
				text
					.setPlaceholder("index")
					.setValue(settings.indexFileName)
					.onChange(async (value: string) => {
						settings.indexFileName = value || "index";
						await (this.plugin as any).saveSettings();
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
						await (this.plugin as any).saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Link base path")
			.setDesc("Base path for converted links (e.g., /blog/, leave blank for root domain).")
			.addText((text) =>
				text
					.setPlaceholder("/blog/")
					.setValue(settings.linkBasePath)
					.onChange(async (value: string) => {
						settings.linkBasePath = value;
						await (this.plugin as any).saveSettings();
					})
			);

		// Copy Heading Link Settings
		new Setting(containerEl)
			.setName("Enable copy heading links")
			.setDesc("Add right-click context menu option to copy heading links in various formats.")
			.addToggle((toggle) =>
				toggle
					.setValue(settings.enableCopyHeadingLink)
					.onChange(async (value: boolean) => {
						settings.enableCopyHeadingLink = value;
						await (this.plugin as any).saveSettings();
						this.updateCopyHeadingFields();
					})
			);

		this.copyHeadingContainer = containerEl.createDiv({ cls: "copy-heading-fields" });
		this.copyHeadingContainer.style.display = settings.enableCopyHeadingLink ? "block" : "none";

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
						await (this.plugin as any).saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Date format")
			.setDesc("Format for the date in properties (e.g., YYYY-MM-DD, MMMM D, YYYY, YYYY-MM-DD HH:mm).")
			.addText((text) =>
				text
					.setPlaceholder("YYYY-MM-DD")
					.setValue(settings.dateFormat)
					.onChange(async (value: string) => {
						settings.dateFormat = value || "YYYY-MM-DD";
						await (this.plugin as any).saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Properties template")
			.addTextArea((text) => {
				text
					.setPlaceholder(
						'---\ntitle: "{{title}}"\ndate: {{date}}\ntags: []\n---\n',
					)
					.setValue(settings.defaultTemplate)
					.onChange(async (value: string) => {
						settings.defaultTemplate = value;
						await (this.plugin as any).saveSettings();
					});
				text.inputEl.classList.add("astro-composer-template-textarea");
				return text;
			})
			.then((setting) => {
				setting.descEl.empty();
				const descDiv = setting.descEl.createEl("div");
				descDiv.innerHTML = 
					"Used for new posts and when standardizing properties.<br />" +
					"Variables include {{title}} and {{date}}.<br />" +
					"Do not wrap {{date}} in quotes as it represents a datetime value, not a string.<br />" +
					"The 'standardize properties' command ignores anything below the second '---' line.";
			});

		new Setting(containerEl)
			.setName("Automate page creation")
			.setDesc("Enable automatic page creation in a specified folder.")
			.addToggle((toggle) =>
				toggle
					.setValue(settings.enablePages)
					.onChange(async (value: boolean) => {
						settings.enablePages = value;
						await (this.plugin as any).saveSettings();
						(this.plugin as any).registerCreateEvent();
						this.updatePagesFields();
					})
			);

		this.pagesFieldsContainer = containerEl.createDiv();
		this.pagesFieldsContainer.style.display = settings.enablePages ? "block" : "none";

		new Setting(this.pagesFieldsContainer)
			.setName("Pages folder")
			.setDesc("Folder for pages (leave blank to disable). Posts automation will exclude this folder.")
			.addText((text) =>
				text
					.setPlaceholder("Enter folder path")
					.setValue(settings.pagesFolder)
					.onChange(async (value: string) => {
						settings.pagesFolder = value;
						await (this.plugin as any).saveSettings();
					})
			);

		new Setting(this.pagesFieldsContainer)
			.setName("Page properties template")
			.addTextArea((text) => {
				text
					.setPlaceholder(
						'---\ntitle: "{{title}}"\ndescription: ""\n---\n',
					)
					.setValue(settings.pageTemplate)
					.onChange(async (value: string) => {
						settings.pageTemplate = value;
						await (this.plugin as any).saveSettings();
					});
				text.inputEl.classList.add("astro-composer-template-textarea");
				return text;
			})
			.then((setting) => {
				setting.descEl.empty();
				const descDiv = setting.descEl.createEl("div");
				descDiv.innerHTML = 
					"Used for new pages and when standardizing properties.<br />" +
					"Variables include {{title}} and {{date}}.<br />" +
					"Do not wrap {{date}} in quotes as it represents a datetime value, not a string.<br />" +
					"The 'standardize properties' command ignores anything below the second '---' line.";
			});


		this.updateConditionalFields();
		this.updateIndexFileField();
		this.updateExcludedDirsField();
		this.updatePagesFields();
		this.updateCopyHeadingFields();
	}

	updateConditionalFields() {
		if (this.autoRenameContainer) {
			const settings = (this.plugin as any).settings as AstroComposerSettings;
			this.autoRenameContainer.style.display = settings.automatePostCreation ? "block" : "none";
		}
	}

	updateIndexFileField() {
		if (this.indexFileContainer) {
			const settings = (this.plugin as any).settings as AstroComposerSettings;
			this.indexFileContainer.style.display = settings.creationMode === "folder" ? "block" : "none";
		}
	}

	updateExcludedDirsField() {
		if (this.excludedDirsContainer) {
			const settings = (this.plugin as any).settings as AstroComposerSettings;
			this.excludedDirsContainer.style.display = !settings.onlyAutomateInPostsFolder ? "block" : "none";
		}
	}

	updatePagesFields() {
		if (this.pagesFieldsContainer) {
			const settings = (this.plugin as any).settings as AstroComposerSettings;
			this.pagesFieldsContainer.style.display = settings.enablePages ? "block" : "none";
		}
	}

	updateCopyHeadingFields() {
		if (this.copyHeadingContainer) {
			const settings = (this.plugin as any).settings as AstroComposerSettings;
			this.copyHeadingContainer.style.display = settings.enableCopyHeadingLink ? "block" : "none";
		}
	}
}
