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
}

const DEFAULT_SETTINGS: AstroComposerSettings = {
	enableUnderscorePrefix: false,
	defaultTemplate:
		'---\ntitle: "{{title}}"\ndate: {{date}}\n---\n',
	linkBasePath: "/blog/",
	postsFolder: "posts",
	automatePostCreation: true,
	autoInsertProperties: true,
	creationMode: "file",
	indexFileName: "index",
	dateFormat: "YYYY-MM-DD",
	excludedDirectories: "",
	onlyAutomateInPostsFolder: false,
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

		if (this.settings.automatePostCreation) {
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
					const postsFolder = this.settings.postsFolder || "";

					// Check if file is newly created by user (recent creation time and empty content)
					const stat = await this.app.vault.adapter.stat(file.path);
					const isNewNote = stat?.mtime && (now - stat.mtime < 1000); // Created within last second
					const content = await this.app.vault.read(file);
					const isEmpty = content.trim() === "";

					if (!isNewNote || !isEmpty) {
						return; // Skip if not a user-initiated new note
					}

					// Check folder restrictions
					if (this.settings.onlyAutomateInPostsFolder) {
						if (
							!postsFolder ||
							(filePath.startsWith(postsFolder + "/") || filePath === postsFolder)
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
			.replace(/[^a-z0-9\s-]/g, "")
			.trim()
			.replace(/\s+/g, "-")
			.replace(/-+/g, "-")
			.replace(/^-|-$/g, "");
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
			if (!(postsFolder instanceof TFolder)) {
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

		// Ensure no extra newlines or --- are added beyond the template
		await this.app.vault.modify(file, template);
	}

	async standardizeProperties(file: TFile | null) {
		if (!(file instanceof TFile)) {
			new Notice("No active file.");
			return;
		}

		// Wait briefly to allow editor state to stabilize
		await new Promise(resolve => setTimeout(resolve, 100));

		// Re-read content to ensure latest state after editor changes
		const content = await this.app.vault.read(file);
		const title = file.basename.replace(/^_/, "");
		let propertiesEnd = 0;
		const existingProperties: Record<string, string[]> = {};

		// Parse existing properties with fallback for missing second ---
		if (content.startsWith("---")) {
			propertiesEnd = content.indexOf("\n---", 3);
			if (propertiesEnd === -1) {
				propertiesEnd = content.length; // Treat entire content as frontmatter if no second ---
			} else {
				propertiesEnd += 4; // Move past the second ---
			}
			const propertiesText = content.slice(4, propertiesEnd - 4).trim();
			try {
				let currentKey: string | null = null;
				propertiesText.split("\n").forEach((line) => {
					const match = line.match(/^(\w+):\s*(.+)?$/);
					if (match) {
						const [, key, value] = match;
						currentKey = key;
						if (key === "tags") {
							existingProperties[key] = [];
						} else if (value) {
							existingProperties[key] = [value.trim()];
						}
					} else if (currentKey === "tags" && line.trim().startsWith("- ")) {
						const tag = line.trim().replace(/^-\s*/, "");
						if (tag) existingProperties["tags"].push(tag);
					}
				});
			} catch (error) {
				// Fallback to template if parsing fails
				new Notice("Falling back to template due to parsing error.");
			}
		}

		// Parse template to get required fields and defaults
		const templateLines = this.settings.defaultTemplate.split("\n");
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
					if (key === "tags") {
						// Handle template tags as YAML list or array
						if (value && value.startsWith("[")) {
							// Parse JSON-style array [tag1, tag2]
							const tags = value
								.replace(/[\[\]]/g, "")
								.split(",")
								.map(t => t.trim())
								.filter(t => t);
							templateValues[key] = tags.length ? tags : [];
						} else {
							templateValues[key] = [];
							// Look ahead for tag list
							for (let j = i + 1; j < templateLines.length; j++) {
								const nextLine = templateLines[j].trim();
								if (nextLine.startsWith("- ")) {
									const tag = nextLine.replace(/^-\s*/, "").trim();
									if (tag) templateValues[key].push(tag);
								} else if (nextLine === "---") {
									break;
								}
							}
						}
					} else if (value) {
						templateValues[key] = [value.replace(/\{\{title\}\}/g, title).replace(/\{\{date\}\}/g, window.moment(new Date()).format(this.settings.dateFormat))];
					}
				}
			}
		}

		// Preserve all existing properties, merge missing or template tags
		const finalProps: Record<string, string[]> = { ...existingProperties };
		for (const key of templateProps) {
			if (!(key in existingProperties)) {
				finalProps[key] = templateValues[key] || [];
			} else if (key === "tags" && templateValues[key] && templateValues[key].length > 0) {
				// Preserve all existing tags and ensure all template tags are included
				const allTags = [...existingProperties[key], ...templateValues[key].filter(tag => !existingProperties[key].includes(tag))];
				finalProps[key] = allTags;
			}
		}

		// Build new property content
		let newContent = "---\n";
		for (const key in finalProps) {
			if (finalProps[key].length > 0) {
				if (key === "tags") {
					newContent += "tags:\n";
					finalProps[key].forEach(tag => {
						newContent += `  - ${tag}\n`;
					});
				} else {
					newContent += `${key}: ${finalProps[key][0]}\n`;
				}
			}
		}
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
			cls: "astro-composer-title-input"
		});
		this.titleInput.focus();

		const buttonContainer = contentEl.createDiv({ cls: "astro-composer-button-container" });

		const cancelButton = buttonContainer.createEl("button", { text: "Cancel", cls: "astro-composer-cancel-button" });
		cancelButton.onclick = () => this.close();

		const createButton = buttonContainer.createEl("button", { text: "Create", cls: ["astro-composer-create-button", "mod-cta"] });
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
					'---\ntitle: "{{title}}"\ndate: {{date}}\n---\n',
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