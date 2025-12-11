import { App, Modal, TFile, Notice, Platform } from "obsidian";
import { AstroComposerPluginInterface, ContentTypeId } from "../types";
import { FileOperations } from "../utils/file-operations";
import { TemplateParser } from "../utils/template-parsing";

export class TitleModal extends Modal {
	file: TFile | null;
	plugin: AstroComposerPluginInterface;
	type: ContentTypeId;
	isRename: boolean;
	isNewNote: boolean;
	titleInput!: HTMLInputElement;
	private fileOps: FileOperations;
	private templateParser: TemplateParser;

	constructor(app: App, file: TFile | null, plugin: AstroComposerPluginInterface, type: ContentTypeId, isRename = false, isNewNote = false) {
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
		if (this.file.parent && this.type !== "note") {
			const contentType = this.fileOps.getContentType(this.type);
			const indexFileName = contentType?.indexFileName || "";
			if (indexFileName.trim() !== "" && basename === indexFileName) {
				basename = this.file.parent.name;
			}
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

	/**
	 * Extracts a suggested title from the file basename for newly created files.
	 * This is used when a file is created from a link (e.g., [[sEfsleif]]).
	 * Preserves the original text as much as possible.
	 */
	getSuggestedTitleFromBasename(): string {
		if (!this.file) {
			return "";
		}

		let basename = this.file.basename;

		// Handle index file names - use parent folder name instead
		if (this.file.parent && this.type !== "note") {
			const contentType = this.fileOps.getContentType(this.type);
			const indexFileName = contentType?.indexFileName || "";
			if (indexFileName.trim() !== "" && basename === indexFileName) {
				basename = this.file.parent.name;
			}
		}

		// Remove leading underscore if present
		if (basename.startsWith("_")) {
			basename = basename.slice(1);
		}

		// Return the basename as-is to preserve user's original input
		// (e.g., "sEfsleif" stays as "sEfsleif")
		return basename;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		
		// Add mobile-friendly positioning class - check both width and platform
		const isMobile = window.innerWidth <= 768 || Platform.isMobile;
		if (isMobile) {
			this.modalEl.addClass('astro-composer-mobile-modal');
		}

		if (this.isRename) {
			const typeName = this.getTypeDisplayName();
			
			if (this.type === "note") {
				// For generic notes outside of any known content type
				contentEl.createEl("h2", { text: "Rename content" });
				contentEl.createEl("p", { text: "Enter a title for this content:" });
			} else {
				contentEl.createEl("h2", { text: `Rename ${typeName} content` });
				contentEl.createEl("p", { text: `Enter new title for your ${typeName} content:` });
			}
			
			this.titleInput = contentEl.createEl("input", {
				type: "text",
				placeholder: "New Title",
				cls: "astro-composer-title-input"
			});
			this.titleInput.value = this.getCurrentTitle();
		} else if (this.isNewNote) {
			const typeName = this.getTypeDisplayName();
			
			if (this.type === "note") {
				contentEl.createEl("h2", { text: "New content" });
				contentEl.createEl("p", { text: "Enter a title for this content:" });
			} else {
				contentEl.createEl("h2", { text: `Create new ${typeName} content` });
				contentEl.createEl("p", { text: `Enter a title for your new ${typeName} content:` });
			}
			
			this.titleInput = contentEl.createEl("input", {
				type: "text",
				placeholder: "New Title",
				cls: "astro-composer-title-input"
			});
			// Leave input empty for new notes - user can type directly
		} else {
			const typeName = this.getTypeDisplayName();
			
			if (this.type === "note") {
				contentEl.createEl("h2", { text: "New content" });
				contentEl.createEl("p", { text: "Enter a title for this content:" });
			} else {
				contentEl.createEl("h2", { text: `Create new ${typeName} content` });
				contentEl.createEl("p", { text: `Enter a title for your new ${typeName} content:` });
			}
			
			this.titleInput = contentEl.createEl("input", {
				type: "text",
				placeholder: "New Title",
				cls: "astro-composer-title-input"
			});
			// Pre-populate with suggested title from basename if available
			// This handles files created from links (e.g., [[sEfsleif]])
			if (this.file) {
				const suggestedTitle = this.getSuggestedTitleFromBasename();
				if (suggestedTitle) {
					this.titleInput.value = suggestedTitle;
				}
			}
		}
		this.titleInput.focus();
		// For new notes, ensure cursor is at the start (position 0)
		if (this.isNewNote) {
			setTimeout(() => {
				this.titleInput.setSelectionRange(0, 0);
			}, 0);
		}

		const buttonContainer = contentEl.createDiv({ cls: "astro-composer-button-container" });

		const cancelButton = buttonContainer.createEl("button", { text: "Cancel", cls: "astro-composer-cancel-button" });
		cancelButton.onclick = () => this.close();

		const submitButton = buttonContainer.createEl("button", { text: this.isRename ? "Rename" : "Create", cls: ["astro-composer-create-button", "mod-cta"] });
		submitButton.onclick = () => this.submit();

		this.titleInput.addEventListener("keypress", (e) => {
			if (e.key === "Enter") void this.submit();
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
				} else {
					// renameFile already showed an error notice, close modal and return
					this.close();
					return;
				}
			} else if (this.isNewNote) {
				// Process the "Untitled" file - rename it and add properties
				// This respects creationMode (folder vs file) and doesn't require deletion
				if (this.file) {
					newFile = await this.fileOps.createFile({ file: this.file, title, type: this.type });
					// Always insert properties when autoInsertProperties is enabled
					const shouldInsertProperties = this.plugin.settings.autoInsertProperties;
					
					if (newFile && shouldInsertProperties) {
						await this.addPropertiesToFile(newFile, title, this.type);
					}
				}
			} else if (this.file) {
				// We have an existing file, process it
				newFile = await this.fileOps.createFile({ file: this.file, title, type: this.type });
				// Always insert properties when autoInsertProperties is enabled
				const shouldInsertProperties = this.plugin.settings.autoInsertProperties;
				
				if (newFile && shouldInsertProperties) {
					await this.addPropertiesToFile(newFile, title, this.type);
				}
			} else {
				// Fallback - create new file
				newFile = await this.createNewFile(title);
			}
			
			if (!newFile) {
				new Notice(`Failed to ${this.isRename ? "rename" : "create"} ${this.type}.`);
				this.close();
				return;
			}
		} catch (error) {
			console.error('TitleModal: Error during process:', error);
			const errorMessage = error instanceof Error ? error.message : String(error);
			new Notice(`Error ${this.isRename ? "renaming" : "creating"} ${this.type}: ${errorMessage}.`);
			this.close();
			return;
		}

		this.close();
	}

	private getTypeDisplayName(): string {
		if (this.type === "note") {
			return "Content";
		}
		const contentType = this.fileOps.getContentType(this.type);
		return contentType ? contentType.name : "Content";
	}

	private async createNewFile(title: string): Promise<TFile | null> {
		// Determine the appropriate folder based on where the user created the file
		let targetFolder: string;
		
		// Get the directory where the user created the file
		const originalDir = this.file?.parent?.path || "";
		
		if (this.type !== "note") {
			const contentType = this.fileOps.getContentType(this.type);
			// For content types, respect the user's chosen location (subfolder)
			// Only use the configured folder if the user created the file in the vault root
			if (originalDir === "" || originalDir === "/") {
				targetFolder = contentType?.folder || "";
			} else {
				targetFolder = originalDir;
			}
		} else {
			// For notes, use the original directory
			targetFolder = originalDir;
		}

		// Create the filename from the title
		const filename = this.fileOps.generateFilename(title);
		const filePath = targetFolder ? `${targetFolder}/${filename}.md` : `${filename}.md`;

		// Track that this file will be created by the plugin BEFORE creating it
		// This prevents the create event from triggering another modal
		if (this.plugin && 'pluginCreatedFiles' in this.plugin) {
			(this.plugin as { pluginCreatedFiles?: Set<string> }).pluginCreatedFiles?.add(filePath);
		}

		// Create the file with initial content
		let initialContent = "";
		// Always insert properties when autoInsertProperties is enabled
		if (this.plugin.settings.autoInsertProperties) {
			initialContent = this.generateInitialContent(title);
		}

		try {
			const newFile = await this.app.vault.create(filePath, initialContent);
			
			// Open the new file
			await this.app.workspace.getLeaf().openFile(newFile);
			
			return newFile;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			throw new Error(`Failed to create file: ${errorMessage}`);
		}
	}

	private generateInitialContent(title: string): string {
		const now = new Date();
		const dateString = window.moment(now).format(this.plugin.settings.dateFormat);

		let template: string;
		if (this.type === "note") {
			// For generic notes, use a simple template
			// Properly escape the title for YAML
			const escapedTitle = this.escapeYamlString(title);
			template = `---\ntitle: ${escapedTitle}\ndate: ${dateString}\n---\n`;
		} else {
			const contentType = this.fileOps.getContentType(this.type);
			if (!contentType) {
				const escapedTitle = this.escapeYamlString(title);
				template = `---\ntitle: ${escapedTitle}\ndate: ${dateString}\n---\n`;
			} else {
				template = contentType.template;
			}
		}
		
		template = template.replace(/\{\{title\}\}/g, title);
		template = template.replace(/\{\{date\}\}/g, dateString);

		return template;
	}

	private async addPropertiesToFile(file: TFile, title: string, type: ContentTypeId) {
		const now = new Date();
		const dateString = window.moment(now).format(this.plugin.settings.dateFormat);

		let template: string;
		if (type === "note") {
			// For generic notes, use a simple template
			// Properly escape the title for YAML
			const escapedTitle = this.escapeYamlString(title);
			template = `---\ntitle: ${escapedTitle}\ndate: ${dateString}\n---\n`;
		} else {
			const contentType = this.fileOps.getContentType(type);
			if (!contentType) {
				const escapedTitle = this.escapeYamlString(title);
				template = `---\ntitle: ${escapedTitle}\ndate: ${dateString}\n---\n`;
			} else {
				template = contentType.template;
			}
		}
		
		template = template.replace(/\{\{title\}\}/g, title);
		template = template.replace(/\{\{date\}\}/g, dateString);

		// Ensure no extra newlines or --- are added beyond the template
		await this.app.vault.modify(file, template);
	}

	private escapeYamlString(str: string): string {
		// Properly escape YAML string values
		// YAML strings with quotes need to be wrapped in single quotes or escaped properly
		if (str.includes('"') || str.includes("'") || str.includes('\n') || str.includes('\\')) {
			// For strings with quotes, newlines, or backslashes, use single quotes and escape single quotes
			return `'${str.replace(/'/g, "''")}'`;
		} else if (str.includes(" ") || str.includes(":") || str.includes("#") || str.includes("@")) {
			// For strings with spaces or special YAML characters, wrap in double quotes and escape double quotes
			return `"${str.replace(/"/g, '\\"')}"`;
		} else {
			// For simple strings, no quotes needed
			return str;
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
