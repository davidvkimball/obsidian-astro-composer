import { App, Modal, TFile, Notice } from "obsidian";
import { PostType, AstroComposerPluginInterface } from "../types";
import { FileOperations } from "../utils/file-operations";
import { TemplateParser } from "../utils/template-parsing";

export class TitleModal extends Modal {
	file: TFile | null;
	plugin: AstroComposerPluginInterface;
	type: PostType | string;
	isRename: boolean;
	isNewNote: boolean;
	titleInput!: HTMLInputElement;
	private fileOps: FileOperations;
	private templateParser: TemplateParser;

	constructor(app: App, file: TFile | null, plugin: AstroComposerPluginInterface, type: PostType | string = "post", isRename = false, isNewNote = false) {
		super(app);
		this.file = file;
		this.plugin = plugin;
		this.type = type;
		this.isRename = isRename;
		this.isNewNote = isNewNote;
		
		// Initialize utilities with current settings
		const settings = plugin.settings;
		this.fileOps = new FileOperations(app, settings);
		this.templateParser = new TemplateParser(app, settings);
	}

	getCurrentTitle(): string {
		if (!this.file) {
			return "";
		}
		
		const titleKey = this.fileOps.getTitleKey(this.type);
		const cache = this.app.metadataCache.getFileCache(this.file);
		let basename = this.file.basename;
		if (this.file.parent && 
			this.plugin.settings.indexFileName && 
			this.plugin.settings.indexFileName.trim() !== "" && 
			basename === this.plugin.settings.indexFileName) {
			basename = this.file.parent.name;
		}
		if (basename.startsWith("_")) {
			basename = basename.slice(1);
		}
		const fallbackTitle = basename.replace(/-/g, " ").split(" ").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");

		if (cache?.frontmatter && cache.frontmatter[titleKey]) {
			return cache.frontmatter[titleKey];
		}
		return fallbackTitle;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		
		// Add mobile-friendly positioning class - check both width and user agent
		const isMobile = window.innerWidth <= 768 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
		if (isMobile) {
			this.modalEl.addClass('astro-composer-mobile-modal');
		}

		if (this.isRename) {
			const typeName = this.getTypeDisplayName();
			const isCustomType = this.fileOps.isCustomContentType(this.type);
			
			if (isCustomType) {
				contentEl.createEl("h2", { text: `Rename Custom Type: ${typeName}` });
				contentEl.createEl("p", { text: "Enter a new title for this content type:" });
			} else if (this.type === "note") {
				// For generic notes outside of any known content type
				contentEl.createEl("h2", { text: "Rename Custom Content Type" });
				contentEl.createEl("p", { text: "Enter a title for this content type:" });
			} else {
				contentEl.createEl("h2", { text: `Rename ${typeName}` });
				contentEl.createEl("p", { text: `Enter new title for your ${typeName.toLowerCase()}:` });
			}
			
			this.titleInput = contentEl.createEl("input", {
				type: "text",
				placeholder: `My Renamed ${typeName}`,
				cls: "astro-composer-title-input"
			});
			this.titleInput.value = this.getCurrentTitle();
		} else if (this.isNewNote) {
			const typeName = this.getTypeDisplayName();
			const isCustomType = this.fileOps.isCustomContentType(this.type);
			
			if (isCustomType) {
				contentEl.createEl("h2", { text: `New Custom Type: ${typeName}` });
				contentEl.createEl("p", { text: "Enter a title for this content type:" });
			} else {
				contentEl.createEl("h2", { text: `Create New ${typeName}` });
				contentEl.createEl("p", { text: `Enter a title for your new ${typeName.toLowerCase()}:` });
			}
			
			this.titleInput = contentEl.createEl("input", {
				type: "text",
				placeholder: `My Awesome ${typeName}`,
				cls: "astro-composer-title-input"
			});
		} else {
			const typeName = this.getTypeDisplayName();
			const isCustomType = this.fileOps.isCustomContentType(this.type);
			
			if (isCustomType) {
				contentEl.createEl("h2", { text: `New Custom Type: ${typeName}` });
				contentEl.createEl("p", { text: "Enter a title for this content type:" });
			} else {
				contentEl.createEl("h2", { text: `New ${typeName}` });
				contentEl.createEl("p", { text: `Enter a title for your ${typeName.toLowerCase()}:` });
			}
			
			this.titleInput = contentEl.createEl("input", {
				type: "text",
				placeholder: `My Awesome ${typeName}`,
				cls: "astro-composer-title-input"
			});
		}
		this.titleInput.focus();

		const buttonContainer = contentEl.createDiv({ cls: "astro-composer-button-container" });

		const cancelButton = buttonContainer.createEl("button", { text: "Cancel", cls: "astro-composer-cancel-button" });
		cancelButton.onclick = () => this.close();

		const submitButton = buttonContainer.createEl("button", { text: this.isRename ? "Rename" : "Create", cls: ["astro-composer-create-button", "mod-cta"] });
		submitButton.onclick = () => this.submit();

		this.titleInput.addEventListener("keypress", (e) => {
			if (e.key === "Enter") this.submit();
		});
	}

	async submit() {
		const title = this.titleInput.value.trim();
		if (!title) {
			new Notice("Please enter a title.");
			return;
		}

		try {
			let newFile: TFile | null = null;
			if (this.isRename) {
				newFile = await this.fileOps.renameFile({ file: this.file!, title, type: this.type });
				if (newFile) {
					await this.templateParser.updateTitleInFrontmatter(newFile, title, this.type);
				}
			} else if (this.isNewNote) {
				// Create a new file from scratch
				newFile = await this.createNewFile(title);
			} else if (this.file) {
				// We have an existing file, process it
				newFile = await this.fileOps.createFile({ file: this.file, title, type: this.type });
				if (newFile && this.plugin.settings.autoInsertProperties) {
					await this.addPropertiesToFile(newFile, title, this.type);
				}
			} else {
				// Fallback - create new file
				newFile = await this.createNewFile(title);
			}
			if (!newFile) {
				throw new Error("Failed to process the content.");
			}
		} catch (error) {
			new Notice(`Error ${this.isRename ? "renaming" : "creating"} ${this.type}: ${(error as Error).message}.`);
		}

		this.close();
	}

	private getTypeDisplayName(): string {
		if (this.fileOps.isCustomContentType(this.type)) {
			const customType = this.fileOps.getCustomContentType(this.type);
			return customType ? customType.name : "Content";
		}
		return this.type === "post" ? "Blog Post" : "Page";
	}

	private async createNewFile(title: string): Promise<TFile | null> {
		// Determine the appropriate folder based on where the user created the file
		let targetFolder: string;
		
		// Get the directory where the user created the file
		const originalDir = this.file?.parent?.path || "";
		
		if (this.fileOps.isCustomContentType(this.type)) {
			const customType = this.fileOps.getCustomContentType(this.type);
			// For custom content types, respect the user's chosen location (subfolder)
			// Only use the configured folder if the user created the file in the vault root
			if (originalDir === "" || originalDir === "/") {
				targetFolder = customType?.folder || "";
			} else {
				targetFolder = originalDir;
			}
		} else if (this.type === "page") {
			// For pages, use the configured pages folder if it exists, otherwise respect user's choice
			targetFolder = this.plugin.settings.pagesFolder || originalDir;
		} else {
			// For posts, use the configured posts folder if it exists, otherwise respect user's choice
			targetFolder = this.plugin.settings.postsFolder || originalDir;
		}

		// Create the filename from the title
		const filename = this.fileOps.generateFilename(title);
		const filePath = targetFolder ? `${targetFolder}/${filename}.md` : `${filename}.md`;

		// Create the file with initial content
		let initialContent = "";
		if (this.plugin.settings.autoInsertProperties) {
			initialContent = await this.generateInitialContent(title);
		}

		try {
			const newFile = await this.app.vault.create(filePath, initialContent);
			
			// Track that this file was created by the plugin to avoid triggering the create event
			if (this.plugin && 'pluginCreatedFiles' in this.plugin) {
				(this.plugin as { pluginCreatedFiles?: Set<string> }).pluginCreatedFiles?.add(filePath);
			}
			
			// Open the new file
			await this.app.workspace.getLeaf().openFile(newFile);
			
			return newFile;
		} catch (error) {
			throw new Error(`Failed to create file: ${(error as Error).message}`);
		}
	}

	private async generateInitialContent(title: string): Promise<string> {
		const now = new Date();
		const dateString = window.moment(now).format(this.plugin.settings.dateFormat);

		let template: string;
		if (this.type === "note") {
			// For generic notes, use a simple template
			template = `---\ntitle: "${title}"\ndate: ${dateString}\n---\n`;
		} else if (this.fileOps.isCustomContentType(this.type)) {
			const customType = this.fileOps.getCustomContentType(this.type);
			template = customType ? customType.template : this.plugin.settings.defaultTemplate;
		} else {
			template = this.type === "post" ? this.plugin.settings.defaultTemplate : this.plugin.settings.pageTemplate;
		}
		
		template = template.replace(/\{\{title\}\}/g, title);
		template = template.replace(/\{\{date\}\}/g, dateString);

		return template;
	}

	private async addPropertiesToFile(file: TFile, title: string, type: PostType | string = "post") {
		const now = new Date();
		const dateString = window.moment(now).format(this.plugin.settings.dateFormat);

		let template: string;
		if (type === "note") {
			// For generic notes, use a simple template
			template = `---\ntitle: "${title}"\ndate: ${dateString}\n---\n`;
		} else if (this.fileOps.isCustomContentType(type)) {
			const customType = this.fileOps.getCustomContentType(type);
			template = customType ? customType.template : this.plugin.settings.defaultTemplate;
		} else {
			template = type === "post" ? this.plugin.settings.defaultTemplate : this.plugin.settings.pageTemplate;
		}
		
		template = template.replace(/\{\{title\}\}/g, title);
		template = template.replace(/\{\{date\}\}/g, dateString);

		// Ensure no extra newlines or --- are added beyond the template
		await this.app.vault.modify(file, template);
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
