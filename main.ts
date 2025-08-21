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
	draftStyle: "frontmatter" | "filename";
	defaultTemplate: string;
	linkBasePath: string;
	postsFolder: string;
	enableAutoRename: boolean;
	creationMode: "file" | "folder";
	indexFileName: string;
	dateFormat: string; // Custom date format setting
}

const DEFAULT_SETTINGS: AstroComposerSettings = {
	draftStyle: "frontmatter",
	defaultTemplate:
		'---\ntitle: "{{title}}"\ndate: {{date}}\ndescription: ""\ntags: []\ndraft: true\n---\n\n',
	linkBasePath: "/blog/",
	postsFolder: "posts",
	enableAutoRename: true,
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
					!isVaultLoading
				) {
					// Only show modal for truly new files (empty or very small)
					// Small delay to ensure file is fully created
					setTimeout(async () => {
						const content = await this.app.vault.read(file);
						if (
							content.trim().length === 0 &&
							(this.settings.enableAutoRename ||
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
		const isDraft = this.settings.draftStyle === "filename";
		const prefix = isDraft ? "_" : "";

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
				new Notice(`File already exists at ${newPath}`);
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

				return newFile;
			} catch (error) {
				new Notice(`Failed to create folder structure: ${error.message}`);
				return null;
			}
		} else {
			// File-based creation
			const newName = `${prefix}${kebabTitle}.md`;
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
		// Use the plugin's custom date format with Obsidian's built-in moment
		const now = new Date();
		const dateString = window.moment(now).format(this.settings.dateFormat);

		// Get the template and replace variables
		let template = this.settings.defaultTemplate;
		template = template.replace(/\{\{title\}\}/g, title); // Revert to simple replacement, no hardcoded quotes
		template = template.replace(/\{\{date\}\}/g, dateString); // Keep unquoted date

		// Ensure template ends with newlines as per defaultTemplate
		if (!template.endsWith("\n\n")) {
			template = template.replace(/\n*$/, "\n\n");
		}

		// For new files created through modal, just replace entire content with template
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
		template = template.replace(/\{\{title\}\}/g, existingFrontmatter.title || title); // Revert to simple replacement
		template = template.replace(
			/\{\{date\}\}/g,
			existingFrontmatter.date || window.moment(new Date()).format(this.settings.dateFormat), // Keep unquoted date
		);

		// Handle draft status based on settings
		const draftValue =
			this.settings.draftStyle === "frontmatter" ? "true" : "false";
		template = template.replace(
			/draft:\s*true/g,
			`draft: ${existingFrontmatter.draft || draftValue}`,
		);

		// Ensure template ends with newlines as per defaultTemplate
		if (!template.endsWith("\n\n")) {
			template = template.replace(/\n*$/, "\n\n");
		}

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
		new Notice("Wikilinks and Markdown links converted for Astro");
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
			// Process the file creation based on title
			const newFile = await this.plugin.createPostFile(this.file, title);

			if (newFile) {
				// Add frontmatter to the new file
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

class AstroComposerSettingTab extends PluginSettingTab {
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
					.addOption("frontmatter", "Frontmatter (draft: true or published: false)")
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
			.setName("Date Format")
			.setDesc("Format for the date in frontmatter (e.g., YYYY-MM-DD, MMMM D, YYYY, YYYY-MM-DD HH:mm).")
			.addText((text) =>
				text
					.setPlaceholder("YYYY-MM-DD")
					.setValue(this.plugin.settings.dateFormat)
					.onChange(async (value) => {
						this.plugin.settings.dateFormat = value || "YYYY-MM-DD";
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Default Frontmatter Template")
			.setDesc("Template for new post frontmatter, including {{title}} and {{date}}).")
			.addTextArea((text) => {
				text
					.setPlaceholder(
						'---\ntitle: "{{title}}"\ndate: {{date}}\ndescription: ""\ntags: []\ndraft: true\n---\n',
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