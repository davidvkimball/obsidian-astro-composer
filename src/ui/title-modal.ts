import { App, Modal, TFile, Notice } from "obsidian";
import { Plugin } from "obsidian";
import { PostType, AstroComposerPluginInterface } from "../types";
import { FileOperations } from "../utils/file-operations";
import { TemplateParser } from "../utils/template-parsing";

export class TitleModal extends Modal {
	file: TFile;
	plugin: AstroComposerPluginInterface;
	type: PostType | string;
	isRename: boolean;
	titleInput!: HTMLInputElement;
	private fileOps: FileOperations;
	private templateParser: TemplateParser;

	constructor(app: App, file: TFile, plugin: AstroComposerPluginInterface, type: PostType | string = "post", isRename = false) {
		super(app);
		this.file = file;
		this.plugin = plugin;
		this.type = type;
		this.isRename = isRename;
		
		// Initialize utilities with current settings
		const settings = plugin.settings;
		this.fileOps = new FileOperations(app, settings);
		this.templateParser = new TemplateParser(app, settings);
	}

	getCurrentTitle(): string {
		const titleKey = this.fileOps.getTitleKey(this.type);
		const cache = this.app.metadataCache.getFileCache(this.file);
		let basename = this.file.basename;
		if (this.file.parent && basename === this.plugin.settings.indexFileName) {
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

		if (this.isRename) {
			const typeName = this.getTypeDisplayName();
			const isCustomType = this.fileOps.isCustomContentType(this.type);
			
			if (isCustomType) {
				contentEl.createEl("h2", { text: `Rename Custom Type: ${typeName}` });
				contentEl.createEl("p", { text: "Enter a new title for this content type:" });
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
		} else {
			const typeName = this.getTypeDisplayName();
			contentEl.createEl("h2", { text: `New ${typeName}` });
			contentEl.createEl("p", { text: `Enter a title for your ${typeName.toLowerCase()}:` });
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
				newFile = await this.fileOps.renameFile({ file: this.file, title, type: this.type });
				if (newFile) {
					await this.templateParser.updateTitleInFrontmatter(newFile, title, this.type);
				}
			} else {
				newFile = await this.fileOps.createFile({ file: this.file, title, type: this.type });
				if (newFile && this.plugin.settings.autoInsertProperties) {
					await this.addPropertiesToFile(newFile, title, this.type);
				}
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

	private async addPropertiesToFile(file: TFile, title: string, type: PostType | string = "post") {
		const now = new Date();
		const dateString = window.moment(now).format(this.plugin.settings.dateFormat);

		let template: string;
		if (this.fileOps.isCustomContentType(type)) {
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
