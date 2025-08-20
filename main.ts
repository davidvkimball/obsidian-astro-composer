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

interface AstroCompanionSettings {
	draftStyle: "frontmatter" | "filename";
	defaultTemplate: string;
	linkBasePath: string;
	postsFolder: string;
	enableAutoRename: boolean;
	creationMode: "file" | "folder";
	indexFileName: string;
}

const DEFAULT_SETTINGS: AstroCompanionSettings = {
	draftStyle: "frontmatter",
	defaultTemplate:
		'---\ntitle: "{{title}}"\ndate: "{{date}}"\ndescription: ""\ntags: []\ndraft: true\n---\n\n',
	linkBasePath: "/blog/",
	postsFolder: "posts",
	enableAutoRename: true,
	creationMode: "file",
	indexFileName: "index",
};

export default class AstroComposerPlugin extends Plugin {
	settings: AstroCompanionSettings;

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
					!isVaultLoading
				) {
					// Only show modal for truly new files (empty or very small)
					// Small delay to ensure file is fully created
					setTimeout(async () => {
						const content = await this.app.vault.read(file);
						// Only trigger for completely empty files or files with minimal content
						if (
							content.trim().length === 0 &&
							(this.settings.enableAutoRename ||
								(this.settings.postsFolder &&
									file.path.startsWith(this.settings.postsFolder)))
						) {
							// Check if this is already an "Untitled" file in the right location
							const isAlreadyUntitled =
								file.name === "Untitled.md" &&
								file.path.startsWith(this.settings.postsFolder);

							if (!isAlreadyUntitled) {
								// Move to posts folder first as "Untitled"
								await this.moveToPostsFolder(file);
							}

							// Find the moved file and open modal
							const untitledPath = this.settings.postsFolder
								? `${this.settings.postsFolder}/Untitled.md`
								: "Untitled.md";
							const untitledFile = this.app.vault.getAbstractFileByPath(
								untitledPath,
							) as TFile;

							if (untitledFile) {
								new PostTitleModal(this.app, untitledFile, this).open();
							}
						}
					}, 150);
				}
			}),
		);

		// Add commands
		this.addCommand({
			id: "standardize-frontmatter",
			name: "Standardize Frontmatter",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.standardizeFrontmatter(view.file);
			},
		});

		this.addCommand({
			id: "convert-wikilinks-astro",
			name: "Convert Wikilinks for Astro",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.convertWikilinksForAstro(editor, view.file);
			},
		});

		// Add settings tab
		this.addSettingTab(new AstroCompanionSettingTab(this.app, this));
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

	async moveToPostsFolder(file: TFile): Promise<TFile | null> {
		if (!this.settings.postsFolder) {
			return file; // No posts folder specified, keep original file
		}

		const targetPath = `${this.settings.postsFolder}/Untitled.md`;

		// Check if target already exists
		const existingFile = this.app.vault.getAbstractFileByPath(targetPath);
		if (existingFile) {
			return existingFile as TFile; // Use existing untitled file
		}

		try {
			// Ensure posts folder exists
			const postsFolder = this.app.vault.getAbstractFileByPath(
				this.settings.postsFolder,
			);
			if (!postsFolder) {
				await this.app.vault.createFolder(this.settings.postsFolder);
			}

			await this.app.vault.rename(file, targetPath);
			return this.app.vault.getAbstractFileByPath(targetPath) as TFile;
		} catch (error) {
			new Notice(`Failed to move file to posts folder: ${error.message}`);
			return file;
		}
	}

	async createPostFile(file: TFile, title: string): Promise<TFile | null> {
		const kebabTitle = this.toKebabCase(title);
		const isDraft = this.settings.draftStyle === "filename";

		if (this.settings.creationMode === "folder") {
			// Create folder-based structure
			const prefix = isDraft ? "_" : "";
			const folderName = `${prefix}${kebabTitle}`;
			const folderPath = this.settings.postsFolder
				? `${this.settings.postsFolder}/${folderName}`
				: folderName;

			// Create the folder
			try {
				await this.app.vault.createFolder(folderPath);
			} catch (error) {
				// Folder might already exist, that's okay
			}

			const fileName = `${this.settings.indexFileName}.md`;
			const newPath = `${folderPath}/${fileName}`;

			// Check if file already exists
			const existingFile = this.app.vault.getAbstractFileByPath(newPath);
			if (existingFile) {
				new Notice(`File already exists at ${newPath}`);
				return null;
			}

			try {
				// Delete the original empty file
				await this.app.vault.delete(file);
				// Create new file in folder
				const newFile = await this.app.vault.create(newPath, "");

				// Reveal the new file in the file explorer with multiple attempts
				const folder = this.app.vault.getAbstractFileByPath(
					folderPath,
				) as TFolder;
				if (folder) {
					// Multiple attempts to ensure folder is revealed and expanded
					this.app.workspace.trigger("reveal-active-file", folder);
					setTimeout(() => {
						this.app.workspace.trigger("reveal-active-file", newFile);
					}, 50);
					setTimeout(() => {
						this.app.workspace.trigger("reveal-active-file", newFile);
					}, 200);
					setTimeout(() => {
						this.app.workspace.trigger("reveal-active-file", newFile);
					}, 500);
				}

				// Open the new file in the editor
				const leaf = this.app.workspace.getLeaf(false);
				await leaf.openFile(newFile);

				return newFile;
			} catch (error) {
				new Notice(`Failed to create folder structure: ${error.message}`);
				return null;
			}
		} else {
			// File-based creation
			const prefix = isDraft ? "_" : "";
			const newName = `${prefix}${kebabTitle}.md`;
			const targetFolder = this.settings.postsFolder || "";
			const newPath = targetFolder ? `${targetFolder}/${newName}` : newName;

			// Check if file with new name already exists
			const existingFile = this.app.vault.getAbstractFileByPath(newPath);
			if (existingFile && existingFile !== file) {
				new Notice(`File with name "${newName}" already exists`);
				return null;
			}

			try {
				await this.app.vault.rename(file, newPath);
				const newFile = this.app.vault.getAbstractFileByPath(newPath) as TFile;

				// Open the renamed file in the editor
				const leaf = this.app.workspace.getLeaf(false);
				await leaf.openFile(newFile);

				return newFile;
			} catch (error) {
				new Notice(`Failed to rename file: ${error.message}`);
				return null;
			}
		}
	}

	async addFrontmatterToFile(file: TFile, title: string, slug?: string) {
		// Use a format that Obsidian recognizes as a Date property type
		const now = new Date();
		const date =
			now.getFullYear() +
			"-" +
			String(now.getMonth() + 1).padStart(2, "0") +
			"-" +
			String(now.getDate()).padStart(2, "0");

		// Get the template and replace variables
		let template = this.settings.defaultTemplate;
		template = template.replace(/\{\{title\}\}/g, title);
		template = template.replace(/\{\{date\}\}/g, date);

		// Ensure template ends with newlines for proper formatting
		if (!template.endsWith("\n\n")) {
			template = template.replace(/\n*$/, "\n\n");
		}

		// For new files created through modal, just replace entire content with template
		// This ensures clean injection without content parsing issues
		await this.app.vault.modify(file, template);
	}

	async standardizeFrontmatter(file: TFile | null) {
		if (!file) {
			new Notice("No active file");
			return;
		}

		const content = await this.app.vault.read(file);
		const title = file.basename.replace(/^_/, ""); // Remove draft prefix if present

		// Parse existing frontmatter or create new
		let frontmatterEnd = 0;
		let existingFrontmatter: any = {};

		if (content.startsWith("---")) {
			const secondDelimiter = content.indexOf("\n---", 3);
			if (secondDelimiter !== -1) {
				frontmatterEnd = secondDelimiter + 4;
				const frontmatterText = content.slice(4, secondDelimiter);
				try {
					// Simple YAML parsing for basic fields
					frontmatterText.split("\n").forEach((line) => {
						const match = line.match(/^(\w+):\s*(.+)$/);
						if (match) {
							const [, key, value] = match;
							existingFrontmatter[key] = value.replace(
								/^["'\[\]]|["'\[\]]$/g,
								"",
							);
						}
					});
				} catch (error) {
					new Notice("Failed to parse existing frontmatter");
				}
			}
		}

		// Use template from settings and replace variables
		let template = this.settings.defaultTemplate;
		template = template.replace(
			/\{\{title\}\}/g,
			existingFrontmatter.title || title,
		);

		// Use Obsidian-friendly date format
		const now = new Date();
		const dateFormat =
			now.getFullYear() +
			"-" +
			String(now.getMonth() + 1).padStart(2, "0") +
			"-" +
			String(now.getDate()).padStart(2, "0");
		template = template.replace(
			/\{\{date\}\}/g,
			existingFrontmatter.date || dateFormat,
		);

		// Handle draft status based on settings
		const draftValue =
			this.settings.draftStyle === "frontmatter" ? "true" : "false";
		template = template.replace(
			/draft:\s*true/g,
			`draft: ${existingFrontmatter.draft || draftValue}`,
		);

		const bodyContent = content.slice(frontmatterEnd);
		const newContent =
			template + (template.endsWith("\n") ? "" : "\n") + bodyContent;

		await this.app.vault.modify(file, newContent);
		new Notice("Frontmatter standardized using template");
	}

	async convertWikilinksForAstro(editor: Editor, file: TFile | null) {
		if (!file) {
			new Notice("No active file");
			return;
		}

		const content = editor.getValue();
		let newContent = content;

		// Convert regular wikilinks [[Title]] or [[Title|Display Text]] but NOT image wikilinks ![[
		// Use negative lookbehind to exclude patterns preceded by !
		newContent = newContent.replace(
			/(?<!\!)\[\[([^\]|]+)(\|([^\]]+))?\]\]/g,
			(match, linkText, _, displayText) => {
				const display = displayText || linkText;
				const slug = this.toKebabCase(linkText);

				// Ensure leading slash and trailing slash
				let basePath = this.settings.linkBasePath;
				if (!basePath.startsWith("/")) {
					basePath = "/" + basePath;
				}
				if (!basePath.endsWith("/")) {
					basePath = basePath + "/";
				}

				// For folder-based links, URL should be just /linkBasePath/slug/
				// Don't include postsFolder in the URL path
				return `[${display}](${basePath}${slug}/)`;
			},
		);

		// Convert image wikilinks ![[image.png]] to Astro-compatible format
		newContent = newContent.replace(
			/!\[\[([^\]]+)\]\]/g,
			(match, imageName) => {
				const cleanName = imageName.replace(/\.[^/.]+$/, ""); // Remove extension

				let basePath = this.settings.linkBasePath;
				if (!basePath.startsWith("/")) {
					basePath = "/" + basePath;
				}
				if (!basePath.endsWith("/")) {
					basePath = basePath + "/";
				}

				return `![${cleanName}](${basePath}images/${imageName})`;
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
		new Notice("Wikilinks converted for Astro");
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
			new Notice("Please enter a title");
			return;
		}

		try {
			// First, create/move the file to the right location
			const newFile = await this.plugin.createPostFile(this.file, title);

			if (newFile) {
				// Then add the frontmatter template
				await this.plugin.addFrontmatterToFile(newFile, title);
			}
		} catch (error) {
			new Notice(`Error creating post: ${error.message}`);
		}

		this.close();
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class AstroCompanionSettingTab extends PluginSettingTab {
	plugin: AstroComposerPlugin;

	constructor(app: App, plugin: AstroComposerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Draft Style")
			.setDesc("How to mark posts as drafts.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("frontmatter", "Frontmatter (draft: true)")
					.addOption("filename", "Filename prefix (_post-name.md)")
					.setValue(this.plugin.settings.draftStyle)
					.onChange(async (value: "frontmatter" | "filename") => {
						this.plugin.settings.draftStyle = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Posts Folder")
			.setDesc(
				"Folder name for blog posts (leave blank to use the root folder).",
			)
			.addText((text) =>
				text
					.setPlaceholder("posts")
					.setValue(this.plugin.settings.postsFolder)
					.onChange(async (value) => {
						this.plugin.settings.postsFolder = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Link Base Path")
			.setDesc(
				"Base path for converted links (leave blank to use the root domain).",
			)
			.addText((text) =>
				text
					.setPlaceholder("/blog/")
					.setValue(this.plugin.settings.linkBasePath)
					.onChange(async (value) => {
						this.plugin.settings.linkBasePath = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Auto-rename Files")
			.setDesc("Automatically show title dialog for new .md files.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableAutoRename)
					.onChange(async (value) => {
						this.plugin.settings.enableAutoRename = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Creation Mode")
			.setDesc(
				"How to create new posts: file-based or folder-based with index.md.",
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption("file", "File-based (post-title.md)")
					.addOption("folder", "Folder-based (post-title/index.md)")
					.setValue(this.plugin.settings.creationMode)
					.onChange(async (value: "file" | "folder") => {
						this.plugin.settings.creationMode = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Index File Name")
			.setDesc(
				"Name for the main file in folder-based mode (without .md extension).",
			)
			.addText((text) =>
				text
					.setPlaceholder("index")
					.setValue(this.plugin.settings.indexFileName)
					.onChange(async (value) => {
						this.plugin.settings.indexFileName = value || "index";
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Default Frontmatter Template")
			.setDesc("Template for new post frontmatter (use {{title}}, {{date}}).")
			.addTextArea((text) => {
				text
					.setPlaceholder(
						'---\ntitle: "{{title}}"\ndate: "{{date}}"\ndescription: ""\ntags: []\ndraft: true\n---\n',
					)
					.setValue(this.plugin.settings.defaultTemplate)
					.onChange(async (value) => {
						this.plugin.settings.defaultTemplate = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.style.height = "200px";
				text.inputEl.style.width = "100%";
			});
	}
}
