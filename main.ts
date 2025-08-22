import {
	App,
	Editor,
	MarkdownView,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	TFolder,
} from "obsidian";

interface AstroComposerSettings {
	enableUnderscorePrefix: boolean;
	defaultTemplate: string;
	linkBasePath: string;
	postsFolder: string;
	automatePostCreation: boolean;
	autoInsertProperties: boolean;
	creationMode: "file" | "folder";
	indexFileName: string;
	dateFormat: string; // Custom date format setting
	excludedDirectories: string; // New setting for excluded directories
	onlyAutomateInPostsFolder: boolean; // New toggle to restrict automation
}

const DEFAULT_SETTINGS: AstroComposerSettings = {
	enableUnderscorePrefix: false, // OFF by default
	defaultTemplate:
		'---\ntitle: "{{title}}"\ndate: {{date}}\ndescription: ""\ntags: []\n---\n\n',
	linkBasePath: "/blog/", // Restored with default value
	postsFolder: "posts",
	automatePostCreation: true,
	autoInsertProperties: true, // ON by default
	creationMode: "file",
	indexFileName: "index",
	dateFormat: "YYYY-MM-DD", // Default to a parseable format
	excludedDirectories: "", // Default to no exclusions
	onlyAutomateInPostsFolder: false, // Off by default
};

export default class AstroComposerPlugin extends Plugin {
	settings: AstroComposerSettings;
	private createEvent: (file: TFile) => void; // Updated type to match event handler

	async onload() {
		await this.loadSettings();

		// Initial event registration
		this.registerCreateEvent();

		// Add commands
		this.addCommand({
			id: "standardize-properties",
			name: "Standardize Properties",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.standardizeProperties(view.file);
			},
		});

		this.addCommand({
			id: "convert-wikilinks-astro",
			name: "Convert internal links for Astro",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.convertWikilinksForAstro(editor, view.file);
			},
		});

		// Add settings tab
		this.addSettingTab(new AstroComposerSettingTab(this.app, this));
	}

	public registerCreateEvent() { // Changed from protected to public
		// Unregister existing event if it exists
		if (this.createEvent) {
			this.app.vault.off("create", this.createEvent);
		}

		// Register new event only if automatePostCreation is true
		if (this.settings.automatePostCreation) {
			this.createEvent = (file: TFile) => {
				if (file instanceof TFile && file.extension === "md") {
					const filePath = file.path;
					const postsFolder = this.settings.postsFolder || "";

					if (this.settings.onlyAutomateInPostsFolder) {
						if (
							!postsFolder ||
							filePath.startsWith(postsFolder + "/") ||
							filePath === postsFolder
						) {
							const cache = this.app.metadataCache.getCache(file.path);
							if (!cache || !cache.sections || cache.sections.length === 0) {
								new PostTitleModal(this.app, file, this).open();
							}
						}
					} else {
						const excludedDirs = this.settings.excludedDirectories
							.split("|")
							.map((dir) => dir.trim())
							.filter((dir) => dir.length > 0);
						const isExcluded = excludedDirs.some((dir) =>
							filePath.startsWith(dir + "/") || filePath === dir
						);

						if (!isExcluded) {
							const cache = this.app.metadataCache.getCache(file.path);
							if (!cache || !cache.sections || cache.sections.length === 0) {
								new PostTitleModal(this.app, file, this).open();
							}
						}
					}
				}
			};
			this.registerEvent(this.app.vault.on("create", this.createEvent));
		}
	}

	toKebabCase(str: string): string {
		return str
			.toLowerCase()
			.replace(/[^a-z0-9\s-]/g, "") // Remove invalid characters
			.trim()
			.replace(/\s+/g, "-") // Replace spaces with hyphens
			.replace(/-+/g, "-") // Remove multiple consecutive hyphens
			.replace(/^-|-$/g, ""); // Remove leading/trailing hyphens
	}

	async createPostFile(file: TFile, title: string): Promise<TFile | null> {
		if (!title) {
			new Notice("Title is required to create a post.");
			return null;
		}

		const kebabTitle = this.toKebabCase(title);
		const prefix = this.settings.enableUnderscorePrefix ? "_" : "";

		let targetFolder = this.settings.postsFolder || "";
		if (targetFolder) {
			const postsFolder = this.app.vault.getAbstractFileByPath(targetFolder);
			if (!postsFolder) {
				await this.app.vault.createFolder(targetFolder);
			}
		}

		if (this.settings.creationMode === "folder") {
			const folderName = `${prefix}${kebabTitle}`;
			const folderPath = targetFolder ? `${targetFolder}/${folderName}` : folderName;

			try {
				await this.app.vault.createFolder(folderPath);
			} catch (error) {
				// Folder might already exist, proceed
			}

			const fileName = `${this.settings.indexFileName}.md`;
			const newPath = `${folderPath}/${fileName}`;

			const existingFile = this.app.vault.getAbstractFileByPath(newPath);
			if (existingFile) {
				new Notice(`File already exists at ${newPath}.`);
				return null;
			}

			try {
				await this.app.vault.rename(file, newPath);
				const newFile = this.app.vault.getAbstractFileByPath(newPath) as TFile;

				// @ts-ignore
				setTimeout(() => {
					const fileExplorer = this.app.workspace.getLeavesOfType("file-explorer")[0];
					if (fileExplorer && fileExplorer.view) {
						// @ts-ignore
						const fileTree = fileExplorer.view.tree;
						if (fileTree) {
							fileTree.revealFile(newFile);
						}
					}
				}, 200);

				const leaf = this.app.workspace.getLeaf(false);
				await leaf.openFile(newFile);

				if (this.settings.autoInsertProperties) {
					await this.addPropertiesToFile(newFile, title);
				}

				return newFile;
			} catch (error) {
				new Notice(`Failed to create folder structure: ${error.message}.`);
				return null;
			}
		} else {
			const newName = `${prefix}${kebabTitle}.md`;
			const newPath = targetFolder ? `${targetFolder}/${newName}` : newName;

			const existingFile = this.app.vault.getAbstractFileByPath(newPath);
			if (existingFile && existingFile !== file) {
				new Notice(`File with name "${newName}" already exists.`);
				return null;
			}

			try {
				await this.app.vault.rename(file, newPath);
				const newFile = this.app.vault.getAbstractFileByPath(newPath) as TFile;

				const leaf = this.app.workspace.getLeaf(false);
				await leaf.openFile(newFile);

				if (this.settings.autoInsertProperties) {
					await this.addPropertiesToFile(newFile, title);
				}

				return newFile;
			} catch (error) {
				new Notice(`Failed to rename file: ${error.message}.`);
				return null;
			}
		}
	}

	async addPropertiesToFile(file: TFile, title: string, slug?: string) {
		const now = new Date();
		const dateString = window.moment(now).format(this.settings.dateFormat);

		let template = this.settings.defaultTemplate;
		template = template.replace(/\{\{title\}\}/g, title);
		template = template.replace(/\{\{date\}\}/g, dateString);

		if (!template.endsWith("\n\n")) {
			template = template.replace(/\n*$/, "\n\n");
		}

		await this.app.vault.modify(file, template);
	}

	async standardizeProperties(file: TFile | null) {
		if (!file) {
			new Notice("No active file.");
			return;
		}

		const content = await this.app.vault.read(file);
		const title = file.basename.replace(/^_/, "");

		let propertiesEnd = 0;
		let existingProperties: any = {};

		if (content.startsWith("---")) {
			const secondDelimiter = content.indexOf("\n---", 3);
			if (secondDelimiter !== -1) {
				propertiesEnd = secondDelimiter + 4;
				const propertiesText = content.slice(4, secondDelimiter);
				try {
					propertiesText.split("\n").forEach((line) => {
						const match = line.match(/^(\w+):\s*(.+)$/);
						if (match) {
							const [, key, value] = match;
							existingProperties[key] = value.replace(/^["'\[\]]|["'\[\]]$/g, "");
						}
					});
				} catch (error) {
					new Notice("Failed to parse existing properties.");
				}
			}
		}

		let template = this.settings.defaultTemplate;
		template = template.replace(/\{\{title\}\}/g, existingProperties.title || title);
		template = template.replace(
			/\{\{date\}\}/g,
			existingProperties.date || window.moment(new Date()).format(this.settings.dateFormat)
		);

		if (!template.endsWith("\n\n")) {
			template = template.replace(/\n*$/, "\n\n");
		}

		const bodyContent = content.slice(propertiesEnd);
		const newContent = template + (template.endsWith("\n") ? "" : "\n") + bodyContent;

		await this.app.vault.modify(file, newContent);
		new Notice("Properties standardized using template.");
	}

	async convertWikilinksForAstro(editor: Editor, file: TFile | null) {
		if (!file) {
			new Notice("No active file.");
			return;
		}

		const content = editor.getValue();
		let newContent = content;

		newContent = newContent.replace(
			/(?<!\!)\[\[([^\]|]+)(\|([^\]]+))?\]\]/g,
			(match, linkText, _, displayText) => {
				const display = displayText || linkText;

				let basePath = this.settings.linkBasePath;
				if (!basePath.startsWith("/")) basePath = "/" + basePath;
				if (!basePath.endsWith("/")) basePath = basePath + "/";

				const postsPrefix = this.settings.postsFolder ? `${this.settings.postsFolder}/` : "";
				const indexFileName = this.settings.indexFileName || "index";

				if (postsPrefix && linkText.startsWith(postsPrefix) && linkText.endsWith(`/${indexFileName}`)) {
					const folderPath = linkText.slice(postsPrefix.length, -(indexFileName.length + 1));
					return `[${display}](${basePath}${folderPath}/)`;
				} else {
					const slug = this.toKebabCase(linkText);
					return `[${display}](${basePath}${slug}/)`;
				}
			}
		);

		newContent = newContent.replace(
			/(?<!\!)\[(.*?)\]\(([^)]+\.md)\)/g,
			(match, displayText, linkPath) => {
				let basePath = this.settings.linkBasePath;
				if (!basePath.startsWith("/")) basePath = "/" + basePath;
				if (!basePath.endsWith("/")) basePath = basePath + "/";

				let normalizedPath = linkPath
					.replace(/^\.\.?\//, "")
					.replace(/\.md$/, "")
					.replace(/^\/|\/$/, "");

				const indexFileName = this.settings.indexFileName || "index";
				if (normalizedPath.endsWith(`/${indexFileName}`)) {
					const folderPath = normalizedPath.slice(0, -(indexFileName.length + 1));
					return `[${displayText}](${basePath}${folderPath}/)`;
				} else {
					const slug = this.toKebabCase(normalizedPath);
					return `[${displayText}](${basePath}${slug}/)`;
				}
			}
		);

		newContent = newContent.replace(/\{\{([^}]+)\}\}/g, (match, fileName) => {
			const slug = this.toKebabCase(fileName.replace(".md", ""));

			let basePath = this.settings.linkBasePath;
			if (!basePath.startsWith("/")) basePath = "/" + basePath;
			if (!basePath.endsWith("/")) basePath = basePath + "/";

			return `[Embedded: ${fileName}](${basePath}${slug}/)`;
		});

		editor.setValue(newContent);
		new Notice("All internal links converted for Astro.");
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class PostTitleModal extends Modal {
	file: TFile;
	plugin: AstroComposerPlugin;
	titleInput: HTMLInputElement;

	constructor(app: App, file: TFile, plugin: AstroComposerPlugin) {
		super(app);
		this.file = file;
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: "New Blog Post" });
		contentEl.createEl("p", { text: "Enter a title for your blog post:" });

		this.titleInput = contentEl.createEl("input", {
			type: "text",
			placeholder: "My Awesome Blog Post",
		});
		this.titleInput.style.width = "100%";
		this.titleInput.style.marginBottom = "16px";
		this.titleInput.focus();

		const buttonContainer = contentEl.createDiv();
		buttonContainer.style.display = "flex";
		buttonContainer.style.gap = "8px";
		buttonContainer.style.justifyContent = "flex-end";

		const cancelButton = buttonContainer.createEl("button", { text: "Cancel" });
		cancelButton.onclick = () => this.close();

		const createButton = buttonContainer.createEl("button", { text: "Create" });
		createButton.classList.add("mod-cta");
		createButton.onclick = () => this.createPost();

		this.titleInput.addEventListener("keypress", (e) => {
			if (e.key === "Enter") this.createPost();
		});
	}

	async createPost() {
		const title = this.titleInput.value.trim();
		if (!title) {
			new Notice("Please enter a title.");
			return;
		}

		try {
			const newFile = await this.plugin.createPostFile(this.file, title);
			if (newFile && this.plugin.settings.autoInsertProperties) {
				await this.plugin.addPropertiesToFile(newFile, title);
			}
		} catch (error) {
			new Notice(`Error creating post: ${error.message}.`);
		}

		this.close();
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class AstroComposerSettingTab extends PluginSettingTab {
	plugin: AstroComposerPlugin;
	autoRenameContainer: HTMLElement | null = null;
	postsFolderContainer: HTMLElement | null = null;
	onlyAutomateContainer: HTMLElement | null = null;
	creationModeContainer: HTMLElement | null = null;
	indexFileContainer: HTMLElement | null = null;
	excludedDirsContainer: HTMLElement | null = null;
	underscorePrefixContainer: HTMLElement | null = null;
	autoInsertContainer: HTMLElement | null = null;

	constructor(app: App, plugin: AstroComposerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// Automate post creation (top-level toggle)
		new Setting(containerEl)
			.setName("Automate post creation")
			.setDesc("Automatically show title dialog for new .md files, rename them based on the title, and insert properties if enabled.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.automatePostCreation)
					.onChange(async (value: boolean) => {
						this.plugin.settings.automatePostCreation = value;
						this.plugin.settings.autoInsertProperties = value; // Sync with automatePostCreation
						await this.plugin.saveSettings();
						this.plugin.registerCreateEvent(); // Re-register event based on new setting
						this.updateConditionalFields();
					})
			);

		// Container for conditionally displayed settings
		this.autoRenameContainer = containerEl.createDiv({ cls: "auto-rename-fields" });
		this.autoRenameContainer.style.display = this.plugin.settings.automatePostCreation ? "block" : "none";

		// Auto-insert properties (nested and conditional toggle)
		this.autoInsertContainer = this.autoRenameContainer.createDiv();
		new Setting(this.autoInsertContainer)
			.setName("Auto-insert properties")
			.setDesc("Automatically insert the properties template when creating new files (requires 'Automate post creation' to be enabled).")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoInsertProperties)
					.setDisabled(!this.plugin.settings.automatePostCreation)
					.onChange(async (value: boolean) => {
						this.plugin.settings.autoInsertProperties = value;
						await this.plugin.saveSettings();
					})
			);

		// Posts folder
		this.postsFolderContainer = this.autoRenameContainer.createDiv();
		new Setting(this.postsFolderContainer)
			.setName("Posts folder")
			.setDesc("Folder name for blog posts (leave blank to use the vault folder).")
			.addText((text) =>
				text
					.setPlaceholder("posts")
					.setValue(this.plugin.settings.postsFolder)
					.onChange(async (value: string) => {
						this.plugin.settings.postsFolder = value;
						await this.plugin.saveSettings();
					})
			);

		// Only automate in this folder toggle
		this.onlyAutomateContainer = this.autoRenameContainer.createDiv();
		new Setting(this.onlyAutomateContainer)
			.setName("Only automate in this folder")
			.setDesc("When enabled, automation will only trigger for new .md files within the specified Posts folder and subfolders.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.onlyAutomateInPostsFolder)
					.onChange(async (value: boolean) => {
						this.plugin.settings.onlyAutomateInPostsFolder = value;
						await this.plugin.saveSettings();
						this.updateExcludedDirsField();
					})
			);

		// Excluded directories field
		this.excludedDirsContainer = this.autoRenameContainer.createDiv({ cls: "excluded-dirs-field" });
		this.excludedDirsContainer.style.display = !this.plugin.settings.onlyAutomateInPostsFolder ? "block" : "none";

		new Setting(this.excludedDirsContainer)
			.setName("Excluded directories")
			.setDesc("Directories to exclude from automatic post creation (e.g., pages|posts/example). Excluded directories and their child folders will be ignored. Use '|' to separate multiple directories.")
			.addText((text) =>
				text
					.setPlaceholder("pages|posts/example")
					.setValue(this.plugin.settings.excludedDirectories)
					.onChange(async (value: string) => {
						this.plugin.settings.excludedDirectories = value;
						await this.plugin.saveSettings();
					})
			);

		// Creation mode
		this.creationModeContainer = this.autoRenameContainer.createDiv();
		new Setting(this.creationModeContainer)
			.setName("Creation mode")
			.setDesc("How to create new posts: file-based or folder-based with index.md.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("file", "File-based (post-title.md)")
					.addOption("folder", "Folder-based (post-title/index.md)")
					.setValue(this.plugin.settings.creationMode)
					.onChange(async (value: "file" | "folder") => {
						this.plugin.settings.creationMode = value;
						await this.plugin.saveSettings();
						this.updateIndexFileField();
					})
			);

		// Index File Name field (initially hidden)
		this.indexFileContainer = this.autoRenameContainer.createDiv({ cls: "index-file-field" });
		this.indexFileContainer.style.display = this.plugin.settings.creationMode === "folder" ? "block" : "none";

		new Setting(this.indexFileContainer)
			.setName("Index file name")
			.setDesc("Name for the main file in folder-based mode (without .md extension).")
			.addText((text) =>
				text
					.setPlaceholder("index")
					.setValue(this.plugin.settings.indexFileName)
					.onChange(async (value: string) => {
						this.plugin.settings.indexFileName = value || "index";
						await this.plugin.saveSettings();
					})
			);

		// Use underscore prefix for drafts
		this.underscorePrefixContainer = this.autoRenameContainer.createDiv();
		new Setting(this.underscorePrefixContainer)
			.setName("Use underscore prefix for drafts")
			.setDesc("Add an underscore prefix (_post-title) to new notes by default when enabled. This hides them from Astro, which can be helpful for post drafts. Disable to skip prefixing.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableUnderscorePrefix)
					.onChange(async (value: boolean) => {
						this.plugin.settings.enableUnderscorePrefix = value;
						await this.plugin.saveSettings();
					})
			);

		// Link base path (always visible)
		new Setting(containerEl)
			.setName("Link base path")
			.setDesc("Base path for converted links (e.g., /blog/, leave blank for root domain).")
			.addText((text) =>
				text
					.setPlaceholder("/blog/")
					.setValue(this.plugin.settings.linkBasePath)
					.onChange(async (value: string) => {
						this.plugin.settings.linkBasePath = value;
						await this.plugin.saveSettings();
					})
			);

		// Always visible settings
		new Setting(containerEl)
			.setName("Date format")
			.setDesc("Format for the date in properties (e.g., YYYY-MM-DD, MMMM D, YYYY, YYYY-MM-DD hh:mm a).")
			.addText((text) =>
				text
					.setPlaceholder("YYYY-MM-DD")
					.setValue(this.plugin.settings.dateFormat)
					.onChange(async (value: string) => {
						this.plugin.settings.dateFormat = value || "YYYY-MM-DD";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Properties template")
			.setDesc("Used for new posts and when standardizing properties.")
			.addTextArea((text) => {
				const plugin = this.plugin;
				text
					.setPlaceholder(
						'---\ntitle: "{{title}}"\ndate: {{date}}\ndescription: ""\ntags: []\n---\n',
					)
					.setValue(plugin.settings.defaultTemplate)
					.onChange(async (value: string) => {
						plugin.settings.defaultTemplate = value;
						await plugin.saveSettings();
					});
				text.inputEl.style.height = "200px";
				text.inputEl.style.width = "100%";
			});

		// Initial updates
		this.updateConditionalFields();
		this.updateIndexFileField();
		this.updateExcludedDirsField();
	}

	updateConditionalFields() {
		if (this.autoRenameContainer) {
			this.autoRenameContainer.style.display = this.plugin.settings.automatePostCreation ? "block" : "none";
		}
	}

	updateIndexFileField() {
		if (this.indexFileContainer) {
			this.indexFileContainer.style.display = this.plugin.settings.creationMode === "folder" ? "block" : "none";
		}
	}

	updateExcludedDirsField() {
		if (this.excludedDirsContainer) {
			this.excludedDirsContainer.style.display = !this.plugin.settings.onlyAutomateInPostsFolder ? "block" : "none";
		}
	}
}