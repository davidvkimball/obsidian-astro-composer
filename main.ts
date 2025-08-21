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
};

export default class AstroComposerPlugin extends Plugin {
	settings: AstroComposerSettings;

	async onload() {
		await this.loadSettings();

		// Track if we're in the initial vault load phase
		let isVaultLoading = true;

		// After a delay, consider vault loading complete
		setTimeout(() => {
			isVaultLoading = false;
		}, 2000);

		// Register file creation event
		this.registerEvent(
			this.app.vault.on("create", (file) => {
				if (
					file instanceof TFile &&
					file.extension === "md" &&
					!isVaultLoading &&
					this.settings.automatePostCreation // Only proceed if automate post creation is enabled
				) {
					// Only show modal for truly new files (empty or very small)
					// Small delay to ensure file is fully created
					setTimeout(async () => {
						const content = await this.app.vault.read(file);
						if (
							content.trim().length === 0 &&
							(this.settings.automatePostCreation ||
								(this.settings.postsFolder &&
									file.path.startsWith(this.settings.postsFolder)))
						) {
							// Open modal without moving the file yet
							new PostTitleModal(this.app, file, this).open();
						}
					}, 300); // Increased delay to ensure file is ready
				}
			}),
		);

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

		// Ensure posts folder exists if specified
		let targetFolder = this.settings.postsFolder || "";
		if (targetFolder) {
			const postsFolder = this.app.vault.getAbstractFileByPath(targetFolder);
			if (!postsFolder) {
				await this.app.vault.createFolder(targetFolder);
			}
		}

		if (this.settings.creationMode === "folder") {
			// Create folder-based structure
			const folderName = `${prefix}${kebabTitle}`;
			const folderPath = targetFolder ? `${targetFolder}/${folderName}` : folderName;

			try {
				await this.app.vault.createFolder(folderPath);
			} catch (error) {
				// Folder might already exist, proceed
			}

			const fileName = `${this.settings.indexFileName}.md`;
			const newPath = `${folderPath}/${fileName}`;

			// Check if file already exists
			const existingFile = this.app.vault.getAbstractFileByPath(newPath);
			if (existingFile) {
				new Notice(`File already exists at ${newPath}.`);
				return null;
			}

			try {
				// Move the original file to the new location
				await this.app.vault.rename(file, newPath);
				const newFile = this.app.vault.getAbstractFileByPath(newPath) as TFile;

				// Reveal the new file in the file explorer
				setTimeout(() => {
					// @ts-ignore - Access the file explorer leaf
					const fileExplorer = this.app.workspace.getLeavesOfType("file-explorer")[0];
					if (fileExplorer && fileExplorer.view) {
						// @ts-ignore - Access the file tree
						const fileTree = fileExplorer.view.tree;
						if (fileTree) {
							// @ts-ignore - Reveal the file
							fileTree.revealFile(newFile);
						}
					}
				}, 200);

				// Open the new file in the editor
				const leaf = this.app.workspace.getLeaf(false);
				await leaf.openFile(newFile);

				// Add properties only if enabled
				if (this.settings.autoInsertProperties) {
					await this.addPropertiesToFile(newFile, title);
				}

				return newFile;
			} catch (error) {
				new Notice(`Failed to create folder structure: ${error.message}.`);
				return null;
			}
		} else {
			// File-based creation
			const newName = `${prefix}${kebabTitle}.md`;
			const newPath = targetFolder ? `${targetFolder}/${newName}` : newName;

			// Check if file with new name already exists
			const existingFile = this.app.vault.getAbstractFileByPath(newPath);
			if (existingFile && existingFile !== file) {
				new Notice(`File with name "${newName}" already exists.`);
				return null;
			}

			try {
				await this.app.vault.rename(file, newPath);
				const newFile = this.app.vault.getAbstractFileByPath(newPath) as TFile;

				// Open the renamed file in the editor
				const leaf = this.app.workspace.getLeaf(false);
				await leaf.openFile(newFile);

				// Add properties only if enabled
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
		// Use the plugin's custom date format with Obsidian's built-in moment
		const now = new Date();
		const dateString = window.moment(now).format(this.settings.dateFormat);

		// Get the template and replace variables
		let template = this.settings.defaultTemplate;
		template = template.replace(/\{\{title\}\}/g, title); // Simple replacement, quotes from template
		template = template.replace(/\{\{date\}\}/g, dateString); // Keep unquoted date

		// Ensure template ends with newlines as per defaultTemplate
		if (!template.endsWith("\n\n")) {
			template = template.replace(/\n*$/, "\n\n");
		}

		// For new files created through modal, just replace entire content with template
		await this.app.vault.modify(file, template);
	}

	async standardizeProperties(file: TFile | null) {
		if (!file) {
			new Notice("No active file.");
			return;
		}

		const content = await this.app.vault.read(file);
		const title = file.basename.replace(/^_/, ""); // Remove draft prefix if present

		// Parse existing properties or create new
		let propertiesEnd = 0;
		let existingProperties: any = {};

		if (content.startsWith("---")) {
			const secondDelimiter = content.indexOf("\n---", 3);
			if (secondDelimiter !== -1) {
				propertiesEnd = secondDelimiter + 4;
				const propertiesText = content.slice(4, secondDelimiter);
				try {
					// Simple YAML parsing for basic fields
					propertiesText.split("\n").forEach((line) => {
						const match = line.match(/^(\w+):\s*(.+)$/);
						if (match) {
							const [, key, value] = match;
							existingProperties[key] = value.replace(
								/^["'\[\]]|["'\[\]]$/g,
								"",
							);
						}
					});
				} catch (error) {
					new Notice("Failed to parse existing properties.");
				}
			}
		}

		// Always use the user-defined template for standardization
		let template = this.settings.defaultTemplate;
		template = template.replace(/\{\{title\}\}/g, existingProperties.title || title); // Simple replacement
		template = template.replace(
			/\{\{date\}\}/g,
			existingProperties.date || window.moment(new Date()).format(this.settings.dateFormat), // Keep unquoted date
		);

		// Ensure template ends with newlines as per defaultTemplate
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

		// Convert wikilinks [[Title]] or [[Title|Display Text]]
		newContent = newContent.replace(
			/(?<!\!)\[\[([^\]|]+)(\|([^\]]+))?\]\]/g,
			(match, linkText, _, displayText) => {
				const display = displayText || linkText;

				// Ensure leading slash and trailing slash for base path
				let basePath = this.settings.linkBasePath;
				if (!basePath.startsWith("/")) {
					basePath = "/" + basePath;
				}
				if (!basePath.endsWith("/")) {
					basePath = basePath + "/";
				}

				// Check if this is a folder-based link (contains posts folder and index filename)
				const postsPrefix = this.settings.postsFolder ? `${this.settings.postsFolder}/` : "";
				const indexFileName = this.settings.indexFileName || "index";
				
				if (postsPrefix && linkText.startsWith(postsPrefix) && linkText.endsWith(`/${indexFileName}`)) {
					// This is a folder-based link like "posts/bigg-cheese/index"
					// Extract just the folder name between postsPrefix and /index
					const folderPath = linkText.slice(postsPrefix.length, -(indexFileName.length + 1));
					return `[${display}](${basePath}${folderPath}/)`;
				} else {
					// This is a regular file-based link
					const slug = this.toKebabCase(linkText);
					return `[${display}](${basePath}${slug}/)`;
				}
			},
		);

		// Convert Markdown links [text](path)
		newContent = newContent.replace(
			/(?<!\!)\[(.*?)\]\(([^)]+\.md)\)/g,
			(match, displayText, linkPath) => {
				// Ensure leading slash and trailing slash for base path
				let basePath = this.settings.linkBasePath;
				if (!basePath.startsWith("/")) {
					basePath = "/" + basePath;
				}
				if (!basePath.endsWith("/")) {
					basePath = basePath + "/";
				}

				// Normalize the link path (remove leading/trailing slashes, handle relative paths)
				let normalizedPath = linkPath
					.replace(/^\.\.?\//, "") // Remove leading ../ or ./
					.replace(/\.md$/, "") // Remove .md extension
					.replace(/^\/|\/$/, ""); // Remove leading/trailing slashes

				// Check if this is a folder-based link (ends with /index)
				const indexFileName = this.settings.indexFileName || "index";
				if (normalizedPath.endsWith(`/${indexFileName}`)) {
					// Extract the folder path
					const folderPath = normalizedPath.slice(0, -(indexFileName.length + 1));
					return `[${displayText}](${basePath}${folderPath}/)`;
				} else {
					// This is a file-based link, convert to kebab case if needed
					const slug = this.toKebabCase(normalizedPath);
					return `[${displayText}](${basePath}${slug}/)`;
				}
			},
		);

		// Convert embedded files {{embed.md}} to include format
		newContent = newContent.replace(/\{\{([^}]+)\}\}/g, (match, fileName) => {
			const slug = this.toKebabCase(fileName.replace(".md", ""));

			let basePath = this.settings.linkBasePath;
			if (!basePath.startsWith("/")) {
				basePath = "/" + basePath;
			}
			if (!basePath.endsWith("/")) {
				basePath = basePath + "/";
			}

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

		// Handle Enter key
		this.titleInput.addEventListener("keypress", (e) => {
			if (e.key === "Enter") {
				this.createPost();
			}
		});
	}

	async createPost() {
		const title = this.titleInput.value.trim();
		if (!title) {
			new Notice("Please enter a title.");
			return;
		}

		try {
			// Process the file creation based on title
			const newFile = await this.plugin.createPostFile(this.file, title);

			if (newFile) {
				// Add properties to the new file
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
	underscorePrefixContainer: HTMLElement | null = null;
	creationModeContainer: HTMLElement | null = null;
	indexFileContainer: HTMLElement | null = null;

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
						await this.plugin.saveSettings();
						this.updateConditionalFields();
					})
			);

		// Auto-insert properties (independent toggle)
		new Setting(containerEl)
			.setName("Auto-insert properties")
			.setDesc("Automatically insert the properties template when creating new files (requires 'Automate post creation' to be enabled).")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoInsertProperties)
					.onChange(async (value: boolean) => {
						this.plugin.settings.autoInsertProperties = value;
						await this.plugin.saveSettings();
					})
			);

		// Container for conditionally displayed settings
		this.autoRenameContainer = containerEl.createDiv({ cls: "auto-rename-fields" });
		this.autoRenameContainer.style.display = this.plugin.settings.automatePostCreation ? "block" : "none";

		// Posts folder
		this.postsFolderContainer = this.autoRenameContainer.createDiv();
		new Setting(this.postsFolderContainer)
			.setName("Posts folder")
			.setDesc("Folder name for blog posts (leave blank to use the root folder).")
			.addText((text) =>
				text
					.setPlaceholder("posts")
					.setValue(this.plugin.settings.postsFolder)
					.onChange(async (value: string) => {
						this.plugin.settings.postsFolder = value;
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
				const plugin = this.plugin; // Capture plugin instance
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
}