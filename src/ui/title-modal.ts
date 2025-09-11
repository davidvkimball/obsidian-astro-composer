import { App, Modal, TFile, Notice } from "obsidian";
import { Plugin } from "obsidian";
import { PostType } from "../types";
import { FileOperations } from "../utils/file-operations";
import { TemplateParser } from "../utils/template-parsing";

export class TitleModal extends Modal {
	file: TFile;
	plugin: Plugin;
	type: PostType;
	isRename: boolean;
	titleInput!: HTMLInputElement;
	private fileOps: FileOperations;
	private templateParser: TemplateParser;

	constructor(app: App, file: TFile, plugin: Plugin, type: PostType = "post", isRename: boolean = false) {
		super(app);
		this.file = file;
		this.plugin = plugin;
		this.type = type;
		this.isRename = isRename;
		
		// Initialize utilities with current settings
		const settings = (plugin as any).settings;
		this.fileOps = new FileOperations(app, settings);
		this.templateParser = new TemplateParser(app, settings);
	}

	getCurrentTitle(): string {
		const titleKey = this.fileOps.getTitleKey(this.type);
		const cache = this.app.metadataCache.getFileCache(this.file);
		let basename = this.file.basename;
		if (this.file.parent && basename === (this.plugin as any).settings.indexFileName) {
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
			contentEl.createEl("h2", { text: "Rename Note" });
			contentEl.createEl("p", { text: "Enter new title for your note:" });
			this.titleInput = contentEl.createEl("input", {
				type: "text",
				placeholder: "My Renamed Note",
				cls: "astro-composer-title-input"
			});
			this.titleInput.value = this.getCurrentTitle();
		} else {
			contentEl.createEl("h2", { text: this.type === "post" ? "New Blog Post" : "New Page" });
			contentEl.createEl("p", { text: `Enter a title for your ${this.type}:` });
			this.titleInput = contentEl.createEl("input", {
				type: "text",
				placeholder: this.type === "post" ? "My Awesome Blog Post" : "My Awesome Page",
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
				if (newFile && (this.plugin as any).settings.autoInsertProperties) {
					await this.addPropertiesToFile(newFile, title, this.type);
				}
			}
			if (!newFile) {
				throw new Error("Failed to process the note.");
			}
		} catch (error) {
			new Notice(`Error ${this.isRename ? "renaming" : "creating"} ${this.type}: ${(error as Error).message}.`);
		}

		this.close();
	}

	private async addPropertiesToFile(file: TFile, title: string, type: PostType = "post") {
		const now = new Date();
		const dateString = window.moment(now).format((this.plugin as any).settings.dateFormat);

		let template = type === "post" ? (this.plugin as any).settings.defaultTemplate : (this.plugin as any).settings.pageTemplate;
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
