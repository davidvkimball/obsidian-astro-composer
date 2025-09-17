import { App, TFile, TFolder, Notice } from "obsidian";
import { AstroComposerSettings, PostType, FileCreationOptions, RenameOptions, CustomContentType } from "../types";

export class FileOperations {
	constructor(private app: App, private settings: AstroComposerSettings) {}

	toKebabCase(str: string): string {
		return str
			.toLowerCase()
			.replace(/[^a-z0-9\s-]/g, "")
			.trim()
			.replace(/\s+/g, "-")
			.replace(/-+/g, "-")
			.replace(/^-|-$/g, "");
	}

	determineType(file: TFile): PostType | string {
		const filePath = file.path;
		
		// Check custom content types first
		for (const customType of this.settings.customContentTypes) {
			if (customType.enabled && customType.folder && 
				(filePath.startsWith(customType.folder + "/") || filePath === customType.folder)) {
				return customType.id;
			}
		}
		
		// Check pages
		const pagesFolder = this.settings.pagesFolder || "";
		const isPage = this.settings.enablePages && pagesFolder && (filePath.startsWith(pagesFolder + "/") || filePath === pagesFolder);
		return isPage ? "page" : "post";
	}

	getCustomContentType(typeId: string): CustomContentType | null {
		return this.settings.customContentTypes.find(ct => ct.id === typeId) || null;
	}

	isCustomContentType(type: PostType | string): boolean {
		return type !== "post" && type !== "page";
	}

	getTitleKey(type: PostType | string): string {
		let template: string;
		
		if (this.isCustomContentType(type)) {
			const customType = this.getCustomContentType(type);
			if (!customType) return "title";
			template = customType.template;
		} else {
			template = type === "post" ? this.settings.defaultTemplate : this.settings.pageTemplate;
		}
		
		const lines = template.split("\n");
		let inProperties = false;
		for (const line of lines) {
			const trimmed = line.trim();
			if (trimmed === "---") {
				inProperties = !inProperties;
				continue;
			}
			if (inProperties) {
				const match = trimmed.match(/^(\w+):\s*(.+)$/);
				if (match) {
					const key = match[1];
					const value = match[2];
					if (value.includes("{{title}}")) {
						return key;
					}
				}
			}
		}
		return "title";
	}

	async createFile(options: FileCreationOptions): Promise<TFile | null> {
		const { file, title, type } = options;
		
		if (!title) {
			new Notice(`Title is required to create a ${type}.`);
			return null;
		}

		const kebabTitle = this.toKebabCase(title);
		const prefix = this.settings.enableUnderscorePrefix ? "_" : "";

		let targetFolder = "";
		if (this.isCustomContentType(type)) {
			const customType = this.getCustomContentType(type);
			targetFolder = customType ? customType.folder : "";
		} else {
			targetFolder = type === "post" ? this.settings.postsFolder || "" : this.settings.pagesFolder || "";
		}
		
		if (targetFolder) {
			const folder = this.app.vault.getAbstractFileByPath(targetFolder);
			if (!(folder instanceof TFolder)) {
				await this.app.vault.createFolder(targetFolder);
			}
		}

		if (this.settings.creationMode === "folder") {
			return this.createFolderStructure(file, kebabTitle, prefix, targetFolder, type);
		} else {
			return this.createFileStructure(file, kebabTitle, prefix, targetFolder);
		}
	}

	private async createFolderStructure(file: TFile, kebabTitle: string, prefix: string, targetFolder: string, type: PostType | string): Promise<TFile | null> {
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

			return newFile;
		} catch (error) {
			new Notice(`Failed to create folder structure: ${(error as Error).message}.`);
			return null;
		}
	}

	private async createFileStructure(file: TFile, kebabTitle: string, prefix: string, targetFolder: string): Promise<TFile | null> {
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

			return newFile;
		} catch (error) {
			new Notice(`Failed to rename file: ${(error as Error).message}.`);
			return null;
		}
	}

	async renameFile(options: RenameOptions): Promise<TFile | null> {
		const { file, title, type } = options;
		
		if (!title) {
			new Notice(`Title is required to rename the note.`);
			return null;
		}

		const kebabTitle = this.toKebabCase(title);
		let prefix = "";

		if (this.settings.creationMode === "folder") {
			return this.renameFolderStructure(file, kebabTitle, prefix, type);
		} else {
			return this.renameFileStructure(file, kebabTitle, prefix);
		}
	}

	private async renameFolderStructure(file: TFile, kebabTitle: string, prefix: string, type: PostType | string): Promise<TFile | null> {
		const isIndex = file.basename === this.settings.indexFileName;
		if (isIndex) {
			if (!file.parent) {
				new Notice("Cannot rename: File has no parent folder.");
				return null;
			}
			prefix = file.parent.name.startsWith("_") ? "_" : "";
			const newFolderName = `${prefix}${kebabTitle}`;
			const parentFolder = file.parent.parent;
			if (!parentFolder) {
				new Notice("Cannot rename: Parent folder has no parent.");
				return null;
			}
			const newFolderPath = `${parentFolder.path}/${newFolderName}`;

			const existingFolder = this.app.vault.getAbstractFileByPath(newFolderPath);
			if (existingFolder instanceof TFolder) {
				new Notice(`Folder already exists at ${newFolderPath}.`);
				return null;
			}

			await this.app.vault.rename(file.parent, newFolderPath);
			const newFilePath = `${newFolderPath}/${file.name}`;
			const newFile = this.app.vault.getAbstractFileByPath(newFilePath);
			if (!(newFile instanceof TFile)) {
				new Notice("Failed to locate renamed file.");
				return null;
			}
			return newFile;
		} else {
			if (!file.parent) {
				new Notice("Cannot rename: File has no parent folder.");
				return null;
			}
			prefix = file.basename.startsWith("_") ? "_" : "";
			const newName = `${prefix}${kebabTitle}.md`;
			const newPath = `${file.parent.path}/${newName}`;

			const existingFile = this.app.vault.getAbstractFileByPath(newPath);
			if (existingFile instanceof TFile && existingFile !== file) {
				new Notice(`File already exists at ${newPath}.`);
				return null;
			}

			await this.app.vault.rename(file, newPath);
			const newFile = this.app.vault.getAbstractFileByPath(newPath);
			if (!(newFile instanceof TFile)) {
				new Notice("Failed to locate renamed file.");
				return null;
			}
			return newFile;
		}
	}

	private async renameFileStructure(file: TFile, kebabTitle: string, prefix: string): Promise<TFile | null> {
		if (!file.parent) {
			new Notice("Cannot rename: File has no parent folder.");
			return null;
		}
		prefix = file.basename.startsWith("_") ? "_" : "";
		const newName = `${prefix}${kebabTitle}.md`;
		const newPath = `${file.parent.path}/${newName}`;

		const existingFile = this.app.vault.getAbstractFileByPath(newPath);
		if (existingFile instanceof TFile && existingFile !== file) {
			new Notice(`File already exists at ${newPath}.`);
			return null;
		}

		await this.app.vault.rename(file, newPath);
		const newFile = this.app.vault.getAbstractFileByPath(newPath);
		if (!(newFile instanceof TFile)) {
			new Notice("Failed to locate renamed file.");
			return null;
		}
		return newFile;
	}
}
