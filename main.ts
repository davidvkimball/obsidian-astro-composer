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
	dateFormat: string;
	excludedDirectories: string;
	onlyAutomateInPostsFolder: boolean;
	enablePages: boolean;
	pagesFolder: string;
	pageTemplate: string;
}

const DEFAULT_SETTINGS: AstroComposerSettings = {
	enableUnderscorePrefix: false,
	defaultTemplate:
		'---\ntitle: "{{title}}"\ndate: {{date}}\ntags: []\n---\n',
	linkBasePath: "/blog/",
	postsFolder: "posts",
	automatePostCreation: true,
	autoInsertProperties: true,
	creationMode: "file",
	indexFileName: "index",
	dateFormat: "YYYY-MM-DD",
	excludedDirectories: "",
	onlyAutomateInPostsFolder: false,
	enablePages: false,
	pagesFolder: "pages",
	pageTemplate:
		'---\ntitle: "{{title}}"\ndescription: ""\n---\n',
};

export default class AstroComposerPlugin extends Plugin {
	settings: AstroComposerSettings;
	private createEvent: (file: TFile) => void;

	async onload() {
		await this.loadSettings();

		// Wait for the vault to be fully loaded before registering the create event
		this.app.workspace.onLayoutReady(() => {
			this.registerCreateEvent();
		});

		// Add commands with icons
		this.addCommand({
			id: "standardize-properties",
			name: "Standardize Properties",
			icon: "file-check",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				if (view.file instanceof TFile) {
					this.standardizeProperties(view.file);
				}
			},
		});

		this.addCommand({
			id: "convert-wikilinks-astro",
			name: "Convert internal links for Astro",
			icon: "link-2",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				if (view.file instanceof TFile) {
					this.convertWikilinksForAstro(editor, view.file);
				}
			},
		});

		// Add settings tab
		this.addSettingTab(new AstroComposerSettingTab(this.app, this));
	}

	public registerCreateEvent() {
		if (this.createEvent) {
			this.app.vault.off("create", this.createEvent);
		}

		if (this.settings.automatePostCreation || this.settings.enablePages) {
			// Debounce to prevent multiple modals from rapid file creations
			let lastProcessedTime = 0;
			const DEBOUNCE_MS = 500;

			this.createEvent = async (file: TFile) => {
				const now = Date.now();
				if (now - lastProcessedTime < DEBOUNCE_MS) {
					return; // Skip if within debounce period
				}
				lastProcessedTime = now;

				if (file instanceof TFile && file.extension === "md") {
					const filePath = file.path;

					// Check if file is newly created by user (recent creation time and empty content)
					const stat = await this.app.vault.adapter.stat(file.path);
					const isNewNote = stat?.mtime && (now - stat.mtime < 1000); // Created within last second
					const content = await this.app.vault.read(file);
					const isEmpty = content.trim() === "";

					if (!isNewNote || !isEmpty) {
						return; // Skip if not a user-initiated new note
					}

					// Check folder restrictions
					const postsFolder = this.settings.postsFolder || "";
					const pagesFolder = this.settings.enablePages ? (this.settings.pagesFolder || "") : "";
					let isPage = false;

					if (pagesFolder && (filePath.startsWith(pagesFolder + "/") || filePath === pagesFolder)) {
						isPage = true;
					}

					const cache = this.app.metadataCache.getCache(file.path);
					if (!cache || !cache.sections || cache.sections.length === 0) {
						if (isPage) {
							if (this.settings.enablePages) {
								new TitleModal(this.app, file, this, "page").open();
							}
						} else {
							if (this.settings.onlyAutomateInPostsFolder) {
								if (
									!postsFolder ||
									(filePath.startsWith(postsFolder + "/") || filePath === postsFolder)
								) {
									new TitleModal(this.app, file, this, "post").open();
								}
							} else {
								let excludedDirs = this.settings.excludedDirectories
									.split("|")
									.map((dir) => dir.trim())
									.filter((dir) => dir.length > 0);
								if (pagesFolder) {
									excludedDirs.push(pagesFolder);
								}
								const isExcluded = excludedDirs.some((dir) =>
									filePath.startsWith(dir + "/") || filePath === dir
								);

								if (!isExcluded) {
									new TitleModal(this.app, file, this, "post").open();
								}
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
			.replace(/[^a-z0-9\s-]/g, "")
			.trim()
			.replace(/\s+/g, "-")
			.replace(/-+/g, "-")
			.replace(/^-|-$/g, "");
	}

	async createFile(file: TFile, title: string, type: "post" | "page"): Promise<TFile | null> {
		if (!title) {
			new Notice(`Title is required to create a ${type}.`);
			return null;
		}

		const kebabTitle = this.toKebabCase(title);
		const prefix = this.settings.enableUnderscorePrefix ? "_" : "";

		let targetFolder = type === "post" ? this.settings.postsFolder || "" : this.settings.pagesFolder || "";
		if (targetFolder) {
			const folder = this.app.vault.getAbstractFileByPath(targetFolder);
			if (!(folder instanceof TFolder)) {
				await this.app.vault.createFolder(targetFolder);
			}
		}

		if (this.settings.creationMode === "folder") {
			const folderName = `${prefix}${kebabTitle}`;
			const folderPath = targetFolder ? `${targetFolder}/${folderName}` : folderName;

			try {
				const folder = this.app.vault.getAbstractFileByPath(folderPath);
				if (!(folder instanceof TFolder)) {
					await this.app.vault.createFolder(folderPath);
				}
			} catch (error) {
				// Folder might already exist, proceed
			}

			const fileName = `${this.settings.indexFileName}.md`;
			const newPath = `${folderPath}/${fileName}`;

			const existingFile = this.app.vault.getAbstractFileByPath(newPath);
			if (existingFile instanceof TFile) {
				new Notice(`File already exists at ${newPath}.`);
				return null;
			}

			try {
				await this.app.vault.rename(file, newPath);
				const newFile = this.app.vault.getAbstractFileByPath(newPath);
				if (!(newFile instanceof TFile)) {
					return null;
				}

				setTimeout(() => {
					const fileExplorer = this.app.workspace.getLeavesOfType("file-explorer")[0];
					if (fileExplorer && fileExplorer.view) {
						const fileTree = (fileExplorer.view as any).tree;
						if (fileTree && newFile instanceof TFile) {
							fileTree.revealFile(newFile);
						}
					}
				}, 200);

				const leaf = this.app.workspace.getLeaf(false);
				await leaf.openFile(newFile);

				if (this.settings.autoInsertProperties) {
					await this.addPropertiesToFile(newFile, title, type);
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
			if (existingFile instanceof TFile && existingFile !== file) {
				new Notice(`File with name "${newName}" already exists.`);
				return null;
			}

			try {
				await this.app.vault.rename(file, newPath);
				const newFile = this.app.vault.getAbstractFileByPath(newPath);
				if (!(newFile instanceof TFile)) {
					return null;
				}

				const leaf = this.app.workspace.getLeaf(false);
				await leaf.openFile(newFile);

				if (this.settings.autoInsertProperties) {
					await this.addPropertiesToFile(newFile, title, type);
				}

				return newFile;
			} catch (error) {
				new Notice(`Failed to rename file: ${error.message}.`);
				return null;
			}
		}
	}

	async addPropertiesToFile(file: TFile, title: string, type: "post" | "page" = "post") {
		const now = new Date();
		const dateString = window.moment(now).format(this.settings.dateFormat);

		let template = type === "post" ? this.settings.defaultTemplate : this.settings.pageTemplate;
		template = template.replace(/\{\{title\}\}/g, title);
		template = template.replace(/\{\{date\}\}/g, dateString);

		// Ensure no extra newlines or --- are added beyond the template
		await this.app.vault.modify(file, template);
	}

	async standardizeProperties(file: TFile | null) {
		if (!(file instanceof TFile)) {
			new Notice("No active file.");
			return;
		}

		// Determine if it's a page or post
		const filePath = file.path;
		const pagesFolder = this.settings.pagesFolder || "";
		const isPage = this.settings.enablePages && pagesFolder && (filePath.startsWith(pagesFolder + "/") || filePath === pagesFolder);
		const templateString = isPage ? this.settings.pageTemplate : this.settings.defaultTemplate;

		// Wait briefly to allow editor state to stabilize
		await new Promise(resolve => setTimeout(resolve, 100));

		// Re-read content to ensure latest state after editor changes
		const content = await this.app.vault.read(file);
		const title = file.basename.replace(/^_/, "");
		let propertiesEnd = 0;
		let propertiesText = "";
		const existingProperties: Record<string, string[]> = {};
		const knownArrayKeys = ['tags', 'aliases', 'cssclasses'];

		// Parse existing properties with fallback for missing second ---
		if (content.startsWith("---")) {
			propertiesEnd = content.indexOf("\n---", 3);
			if (propertiesEnd === -1) {
				propertiesEnd = content.length; // Treat entire content as frontmatter if no second ---
			} else {
				propertiesEnd += 4; // Move past the second ---
			}
			propertiesText = content.slice(4, propertiesEnd - 4).trim();
			try {
				let currentKey: string | null = null;
				propertiesText.split("\n").forEach((line) => {
					const match = line.match(/^(\w+):\s*(.+)?$/);
					if (match) {
						const [, key, value] = match;
						currentKey = key;
						if (knownArrayKeys.includes(key)) {
							existingProperties[key] = [];
						} else {
							existingProperties[key] = [value ? value.trim() : ""];
						}
					} else if (currentKey && knownArrayKeys.includes(currentKey) && line.trim().startsWith("- ")) {
						const item = line.trim().replace(/^-\s*/, "");
						if (item) existingProperties[currentKey].push(item);
					} else if (line.trim() && !line.trim().startsWith("- ")) {
						// Handle unrecognized properties
						const keyMatch = line.match(/^(\w+):/);
						if (keyMatch) {
							const key = keyMatch[1];
							const value = line.slice(line.indexOf(":") + 1).trim();
							if (!existingProperties[key]) {
								existingProperties[key] = [value || ""];
							}
						}
					}
				});
				// Preserve array keys if they exist without values
				knownArrayKeys.forEach(key => {
					if (propertiesText.includes(key + ':') && !existingProperties[key]) {
						existingProperties[key] = [];
					}
				});
			} catch (error) {
				// Fallback to template if parsing fails
				new Notice("Falling back to template due to parsing error.");
			}
		}

		// Parse template to get required fields and defaults
		const templateLines = templateString.split("\n");
		const templateProps: string[] = [];
		const templateValues: Record<string, string[]> = {};
		let inProperties = false;

		for (let i = 0; i < templateLines.length; i++) {
			const line = templateLines[i].trim();
			if (line === "---") {
				inProperties = !inProperties;
				if (!inProperties) {
					break; // Stop at second --- to exclude post-property content
				}
				continue;
			}
			if (inProperties) {
				const match = line.match(/^(\w+):\s*(.+)?$/);
				if (match) {
					const [, key, value] = match;
					templateProps.push(key);
					if (knownArrayKeys.includes(key)) {
						// Handle template array keys
						if (value && value.startsWith("[")) {
							const items = value
								.replace(/[\[\]]/g, "")
								.split(",")
								.map(t => t.trim())
								.filter(t => t);
							templateValues[key] = items;
						} else {
							templateValues[key] = [];
							// Look ahead for item list
							for (let j = i + 1; j < templateLines.length; j++) {
								const nextLine = templateLines[j].trim();
								if (nextLine.startsWith("- ")) {
									const item = nextLine.replace(/^-\s*/, "").trim();
									if (item) templateValues[key].push(item);
								} else if (nextLine === "---") {
									break;
								}
							}
						}
					} else {
						templateValues[key] = [ (value || "").replace(/\{\{title\}\}/g, title).replace(/\{\{date\}\}/g, window.moment(new Date()).format(this.settings.dateFormat)) ];
					}
				}
			}
		}

		// Merge template properties with existing ones, preserving all existing
		const finalProps: Record<string, string[]> = { ...existingProperties };
		for (const key of templateProps) {
			if (!(key in existingProperties)) {
				finalProps[key] = templateValues[key] || (knownArrayKeys.includes(key) ? [] : [""]);
			} else if (knownArrayKeys.includes(key) && templateValues[key]?.length > 0) {
				// Merge items, appending new ones without duplicates
				const existingItems = existingProperties[key] || [];
				const newItems = templateValues[key].filter(item => !existingItems.includes(item));
				finalProps[key] = [...existingItems, ...newItems];
			}
		}

		// Build new property content
		let newContent = "---\n";

		// First, add template props in their order
		templateProps.forEach(key => {
			const value = finalProps[key];
			if (knownArrayKeys.includes(key)) {
				newContent += `${key}:\n`;
				value.forEach(item => {
					newContent += `  - ${item}\n`;
				});
			} else {
				newContent += `${key}: ${value[0] || ""}\n`;
			}
		});

		// Then, add extra props in their original order
		Object.keys(existingProperties).forEach(key => {
			if (!templateProps.includes(key)) {
				const value = existingProperties[key];
				if (knownArrayKeys.includes(key)) {
					newContent += `${key}:\n`;
					value.forEach(item => {
						newContent += `  - ${item}\n`;
					});
				} else {
					newContent += `${key}: ${value[0] || ""}\n`;
				}
			}
		});

		newContent += "---";

		// Append the original body content, preserving exact trailing newlines
		const bodyContent = content.slice(propertiesEnd);
		newContent += bodyContent;

		await this.app.vault.modify(file, newContent);
		new Notice("Properties standardized using template.");
	}

	async convertWikilinksForAstro(editor: Editor, file: TFile | null) {
		if (!(file instanceof TFile)) {
			new Notice("No active file.");
			return;
		}

		const content = editor.getValue();
		let newContent = content;

		// Define common image extensions
		const imageExtensions = /\.(png|jpg|jpeg|gif|svg)$/i;

		// Handle regular Wikilinks (non-image)
		newContent = newContent.replace(
			/\[\[([^\]|]+)(\|([^\]]+))?\]\]/g,
			(match, linkText, _pipe, displayText) => {
				// Check if it's an image Wikilink
				if (imageExtensions.test(linkText)) {
					return match; // Ignore and return original image Wikilink
				}

				const display = displayText || linkText.replace(/\.md$/, "");
				const slug = this.toKebabCase(linkText.replace(/\.md$/, ""));

				let basePath = this.settings.linkBasePath;
				if (!basePath.startsWith("/")) basePath = "/" + basePath;
				if (!basePath.endsWith("/")) basePath = basePath + "/";

				return `[${display}](${basePath}${slug}/)`;
			}
		);

		// Handle standard Markdown links (non-image, non-external)
		newContent = newContent.replace(
			/\[([^\]]+)\]\(([^)]+\.md)\)/g,
			(match, displayText, linkPath) => {
				// Check if it's an image link or external link
				if (imageExtensions.test(linkPath) || linkPath.match(/^https?:\/\//)) {
					return match; // Ignore image or external links
				}

				const slug = this.toKebabCase(linkPath.replace(/\.md$/, ""));

				let basePath = this.settings.linkBasePath;
				if (!basePath.startsWith("/")) basePath = "/" + basePath;
				if (!basePath.endsWith("/")) basePath = basePath + "/";

				return `[${displayText}](${basePath}${slug}/)`;
			}
		);

		// Handle image links in Markdown format (e.g., ![Image](mountains.png))
		newContent = newContent.replace(
			/!\[(.*?)\]\(([^)]+)\)/g,
			(match) => {
				return match; // Ignore all image links
			}
		);

		// Handle {{embed}} syntax
		newContent = newContent.replace(/\{\{([^}]+)\}\}/g, (match, fileName) => {
			if (imageExtensions.test(fileName)) {
				return match; // Ignore embedded images
			}
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

class TitleModal extends Modal {
	file: TFile;
	plugin: AstroComposerPlugin;
	type: "post" | "page";
	titleInput: HTMLInputElement;

	constructor(app: App, file: TFile, plugin: AstroComposerPlugin, type: "post" | "page" = "post") {
		super(app);
		this.file = file;
		this.plugin = plugin;
		this.type = type;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h2", { text: this.type === "post" ? "New Blog Post" : "New Page" });
		contentEl.createEl("p", { text: `Enter a title for your ${this.type}:` });

		this.titleInput = contentEl.createEl("input", {
			type: "text",
			placeholder: this.type === "post" ? "My Awesome Blog Post" : "My Awesome Page",
			cls: "astro-composer-title-input"
		});
		this.titleInput.focus();

		const buttonContainer = contentEl.createDiv({ cls: "astro-composer-button-container" });

		const cancelButton = buttonContainer.createEl("button", { text: "Cancel", cls: "astro-composer-cancel-button" });
		cancelButton.onclick = () => this.close();

		const createButton = buttonContainer.createEl("button", { text: "Create", cls: ["astro-composer-create-button", "mod-cta"] });
		createButton.onclick = () => this.createEntry();

		this.titleInput.addEventListener("keypress", (e) => {
			if (e.key === "Enter") this.createEntry();
		});
	}

	async createEntry() {
		const title = this.titleInput.value.trim();
		if (!title) {
			new Notice("Please enter a title.");
			return;
		}

		try {
			const newFile = await this.plugin.createFile(this.file, title, this.type);
			if (newFile && this.plugin.settings.autoInsertProperties) {
				await this.plugin.addPropertiesToFile(newFile, title, this.type);
			}
		} catch (error) {
			new Notice(`Error creating ${this.type}: ${error.message}.`);
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
	pagesFieldsContainer: HTMLElement | null = null;

	constructor(app: App, plugin: AstroComposerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Automate post creation")
			.setDesc("Automatically show title dialog for new .md files, rename them based on the title, and insert properties if enabled.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.automatePostCreation)
					.onChange(async (value: boolean) => {
						this.plugin.settings.automatePostCreation = value;
						this.plugin.settings.autoInsertProperties = value;
						await this.plugin.saveSettings();
						this.plugin.registerCreateEvent();
						this.updateConditionalFields();
					})
			);

		this.autoRenameContainer = containerEl.createDiv({ cls: "auto-rename-fields" });
		this.autoRenameContainer.style.display = this.plugin.settings.automatePostCreation ? "block" : "none";

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

		this.postsFolderContainer = this.autoRenameContainer.createDiv();
		new Setting(this.postsFolderContainer)
			.setName("Posts folder")
			.setDesc("Folder name for blog posts (leave blank to use the vault folder). You can specify the default location for new notes in Obsidian's 'Files and links' settings.")
			.addText((text) =>
				text
					.setPlaceholder("Enter folder path")
					.setValue(this.plugin.settings.postsFolder)
					.onChange(async (value: string) => {
						this.plugin.settings.postsFolder = value;
						await this.plugin.saveSettings();
					})
			);

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

		new Setting(containerEl)
			.setName("Date format")
			.setDesc("Format for the date in properties (e.g., YYYY-MM-DD, MMMM D, YYYY, YYYY-MM-DD HH:mm).")
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
			.addTextArea((text) => {
				const plugin = this.plugin;
				text
					.setPlaceholder(
						'---\ntitle: "{{title}}"\ndate: {{date}}\ntags: []\n---\n',
					)
					.setValue(plugin.settings.defaultTemplate)
					.onChange(async (value: string) => {
						plugin.settings.defaultTemplate = value;
						await plugin.saveSettings();
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
					.setValue(this.plugin.settings.enablePages)
					.onChange(async (value: boolean) => {
						this.plugin.settings.enablePages = value;
						await this.plugin.saveSettings();
						this.plugin.registerCreateEvent();
						this.updatePagesFields();
					})
			);

		this.pagesFieldsContainer = containerEl.createDiv();
		this.pagesFieldsContainer.style.display = this.plugin.settings.enablePages ? "block" : "none";

		new Setting(this.pagesFieldsContainer)
			.setName("Pages folder")
			.setDesc("Folder for pages (leave blank to disable). Posts automation will exclude this folder.")
			.addText((text) =>
				text
					.setPlaceholder("Enter folder path")
					.setValue(this.plugin.settings.pagesFolder)
					.onChange(async (value: string) => {
						this.plugin.settings.pagesFolder = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(this.pagesFieldsContainer)
			.setName("Page properties template")
			.addTextArea((text) => {
				const plugin = this.plugin;
				text
					.setPlaceholder(
						'---\ntitle: "{{title}}"\ndescription: ""\n---\n',
					)
					.setValue(plugin.settings.pageTemplate)
					.onChange(async (value: string) => {
						plugin.settings.pageTemplate = value;
						await plugin.saveSettings();
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

	updatePagesFields() {
		if (this.pagesFieldsContainer) {
			this.pagesFieldsContainer.style.display = this.plugin.settings.enablePages ? "block" : "none";
		}
	}
}