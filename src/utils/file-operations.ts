import { App, TFile, TFolder, Notice } from "obsidian";
import { AstroComposerSettings, PostType, FileCreationOptions, RenameOptions, CustomContentType } from "../types";

export class FileOperations {
	constructor(private app: App, private settings: AstroComposerSettings, private plugin?: any) {}

	toKebabCase(str: string): string {
		return str
			.toLowerCase()
			.replace(/[^a-z0-9\s-]/g, "")
			.trim()
			.replace(/\s+/g, "-")
			.replace(/-+/g, "-")
			.replace(/^-|-$/g, "");
	}

	generateFilename(title: string): string {
		const kebabTitle = this.toKebabCase(title);
		const prefix = this.settings.enableUnderscorePrefix ? "_" : "";
		return `${prefix}${kebabTitle}`;
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
		if (isPage) return "page";
		
		// Check posts
		const postsFolder = this.settings.postsFolder || "";
		let isPost = false;
		if (this.settings.automatePostCreation) {
			if (postsFolder) {
				// If postsFolder is specified, check if file is in that folder
				isPost = filePath.startsWith(postsFolder + "/") || filePath === postsFolder;
		} else {
			// If postsFolder is blank, only treat files in vault root as posts
			isPost = !filePath.includes("/");
		}
		}
		if (isPost) return "post";
		
		// If no folder structure matches, return "note" as fallback
		return "note";
	}

	getCustomContentType(typeId: string): CustomContentType | null {
		return this.settings.customContentTypes.find(ct => ct.id === typeId) || null;
	}

	isCustomContentType(type: PostType | string): boolean {
		return type !== "post" && type !== "page";
	}

	getTitleKey(type: PostType | string): string {
		// For generic notes, always use "title"
		if (type === "note") return "title";
		
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
		if (type === "note") {
			// For generic notes, keep them in their current location
			targetFolder = "";
		} else if (this.isCustomContentType(type)) {
			const customType = this.getCustomContentType(type);
			targetFolder = customType ? customType.folder : "";
		} else {
			// For posts and pages, only move if target folder is specified
			const postsFolder = this.settings.postsFolder || "";
			const pagesFolder = this.settings.pagesFolder || "";
			if (type === "post") {
				targetFolder = postsFolder; // Will be empty string if blank
			} else {
				targetFolder = pagesFolder; // Will be empty string if blank
			}
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
		let folderPath: string;
		
		if (targetFolder) {
			// Move to target folder
			folderPath = `${targetFolder}/${folderName}`;
		} else {
			// Keep in current location
			const currentDir = file.parent ? file.parent.path : "";
			if (currentDir && currentDir !== "/") {
				folderPath = `${currentDir}/${folderName}`;
			} else {
				// File is in vault root, just use folder name
				folderPath = folderName;
			}
		}

		try {
			const folder = this.app.vault.getAbstractFileByPath(folderPath);
			if (!(folder instanceof TFolder)) {
				await this.app.vault.createFolder(folderPath);
			}
		} catch (error) {
			// Folder might already exist, proceed
		}

		const indexFileName = this.settings.indexFileName || "index";
		const fileName = `${indexFileName}.md`;
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
					if (fileTree && newFile instanceof TFile && typeof fileTree.revealFile === 'function') {
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
		let newPath: string;
		
		if (targetFolder) {
			// Move to target folder
			newPath = `${targetFolder}/${newName}`;
		} else {
			// Keep in current location, just rename the file
			const currentDir = file.parent ? file.parent.path : "";
			if (currentDir && currentDir !== "/") {
				newPath = `${currentDir}/${newName}`;
			} else {
				// File is in vault root, just use new name
				newPath = newName;
			}
		}

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

			// Track that this file was created by the plugin to avoid triggering the create event
			if (this.plugin && 'pluginCreatedFiles' in this.plugin) {
				(this.plugin as any).pluginCreatedFiles.add(newPath);
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
			new Notice(`Title is required to rename the content.`);
			return null;
		}

		const kebabTitle = this.toKebabCase(title);
		const prefix = "";

		if (this.settings.creationMode === "folder") {
			return this.renameFolderStructure(file, kebabTitle, prefix, type);
		} else {
			return this.renameFileStructure(file, kebabTitle, prefix);
		}
	}

	private async renameFolderStructure(file: TFile, kebabTitle: string, prefix: string, type: PostType | string): Promise<TFile | null> {
		// Smart detection: treat as index if filename matches the index file name
		// Default to "index" when indexFileName is blank
		const indexFileName = this.settings.indexFileName || "index";
		const isIndex = file.basename === indexFileName;
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

			console.log("Renaming folder from", file.parent.path, "to", newFolderPath);
			await this.app.vault.rename(file.parent, newFolderPath);
			const newFilePath = `${newFolderPath}/${file.name}`;
			console.log("Looking for new file at:", newFilePath);
			const newFile = this.app.vault.getAbstractFileByPath(newFilePath);
			if (!(newFile instanceof TFile)) {
				console.log("Failed to locate renamed file at:", newFilePath);
				new Notice("Failed to locate renamed file.");
				return null;
			}
			console.log("Successfully found renamed file:", newFile.path);
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
		
		// Check if this is an index file - if so, rename the parent folder instead
		// Smart detection: only treat as index if indexFileName is specified and matches
		const isIndex = this.settings.indexFileName && 
			this.settings.indexFileName.trim() !== "" && 
			file.basename === this.settings.indexFileName;
		if (isIndex) {
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
		}
		
		// For non-index files, rename the file itself
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
