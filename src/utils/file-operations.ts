import { App, TFile, TFolder, Notice } from "obsidian";
import { AstroComposerSettings, PostType, FileCreationOptions, RenameOptions, CustomContentType } from "../types";

export class FileOperations {
	constructor(private app: App, private settings: AstroComposerSettings, private plugin?: any) {}

	toKebabCase(str: string): string {
		return str
			.toLowerCase()
			// Remove or replace problematic characters for filenames
			.replace(/[<>:"/\\|?*]/g, "") // Remove Windows/Unix invalid filename characters
			.replace(/['"]/g, "") // Remove quotes
			.replace(/[^\w\s-]/g, "") // Remove other special characters but keep letters, numbers, spaces, hyphens
			.trim()
			.replace(/\s+/g, "-")
			.replace(/-+/g, "-")
			.replace(/^-|-$/g, "");
	}

	generateFilename(title: string): string {
		const kebabTitle = this.toKebabCase(title);
		// If kebab case results in empty string, use a fallback
		const safeKebabTitle = kebabTitle || "untitled";
		const prefix = this.settings.enableUnderscorePrefix ? "_" : "";
		return `${prefix}${safeKebabTitle}`;
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
		let isPage = false;
		if (this.settings.enablePages) {
			if (pagesFolder) {
				// If pagesFolder is specified, check if file is in that folder
				isPage = filePath.startsWith(pagesFolder + "/") || filePath === pagesFolder;
			} else {
				// If pagesFolder is blank, only treat files in vault root as pages
				isPage = !filePath.includes("/");
			}
		}
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
			// Get the directory where the user created the file
			const originalDir = file.parent?.path || "";
			
			// For custom content types, respect the user's chosen location (subfolder)
			// Only use the configured folder if the user created the file in the vault root
			if (originalDir === "" || originalDir === "/") {
				targetFolder = customType ? customType.folder : "";
			} else {
				targetFolder = originalDir;
			}
		} else {
			// For posts and pages, respect where the user created the file
			const postsFolder = this.settings.postsFolder || "";
			const pagesFolder = this.settings.pagesFolder || "";
			
			// Get the directory where the user created the file
			const originalDir = file.parent?.path || "";
			
			// If the file is in vault root, don't set a target folder (keep it in root)
			if (originalDir === "" || originalDir === "/") {
				targetFolder = "";
			} else {
				targetFolder = originalDir;
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
					const fileTree = (fileExplorer.view as { tree?: { revealFile?: (file: TFile) => void } }).tree;
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
			// Use fileManager.renameFile() which respects user settings and handles all link formats
			await this.app.fileManager.renameFile(file, newPath);
			
			const newFile = this.app.vault.getAbstractFileByPath(newPath);
			if (!(newFile instanceof TFile)) {
				new Notice("Failed to locate renamed file.");
				return null;
			}

			// Track that this file was created by the plugin to avoid triggering the create event
			if (this.plugin && 'pluginCreatedFiles' in this.plugin) {
				(this.plugin as { pluginCreatedFiles?: Set<string> }).pluginCreatedFiles?.add(newPath);
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
		console.log('FileOperations: Starting renameFile');
		console.log('FileOperations: Original file:', file.path);
		console.log('FileOperations: New title:', title);
		console.log('FileOperations: Type:', type);
		
		if (!title) {
			console.log('FileOperations: No title provided');
			new Notice(`Title is required to rename the content.`);
			return null;
		}

		const kebabTitle = this.toKebabCase(title);
		console.log('FileOperations: Kebab title:', kebabTitle);
		const prefix = "";

		if (this.settings.creationMode === "folder") {
			console.log('FileOperations: Using folder structure rename');
			return this.renameFolderStructure(file, kebabTitle, prefix, type);
		} else {
			console.log('FileOperations: Using file structure rename');
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
			// Fix path construction to avoid double slashes
			let newFolderPath: string;
			if (parentFolder.path === "" || parentFolder.path === "/") {
				// Parent is vault root
				newFolderPath = newFolderName;
			} else {
				// Parent is in a subfolder
				newFolderPath = `${parentFolder.path}/${newFolderName}`;
			}

			const existingFolder = this.app.vault.getAbstractFileByPath(newFolderPath);
			if (existingFolder instanceof TFolder) {
				new Notice(`Folder already exists at ${newFolderPath}.`);
				return null;
			}

			try {
				await this.app.fileManager.renameFile(file.parent, newFolderPath);
			} catch (error) {
				new Notice(`Failed to rename folder: ${(error as Error).message}.`);
				return null;
			}
			
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

			// Store old paths for link updating
			const oldPath = file.path;
			const oldName = file.name;
			
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
		console.log('FileOperations: renameFileStructure called');
		console.log('FileOperations: File path:', file.path);
		console.log('FileOperations: Kebab title:', kebabTitle);
		
		if (!file.parent) {
			console.log('FileOperations: No parent folder');
			new Notice("Cannot rename: File has no parent folder.");
			return null;
		}
		
		// Check if this is an index file - if so, rename the parent folder instead
		// Smart detection: only treat as index if indexFileName is specified and matches
		const isIndex = this.settings.indexFileName && 
			this.settings.indexFileName.trim() !== "" && 
			file.basename === this.settings.indexFileName;
		
		console.log('FileOperations: Is index file:', isIndex);
		console.log('FileOperations: Index file name setting:', this.settings.indexFileName);
		console.log('FileOperations: File basename:', file.basename);
		
		if (isIndex) {
			console.log('FileOperations: Renaming folder structure');
			prefix = file.parent.name.startsWith("_") ? "_" : "";
			const newFolderName = `${prefix}${kebabTitle}`;
			const parentFolder = file.parent.parent;
			if (!parentFolder) {
				console.log('FileOperations: No parent folder parent');
				new Notice("Cannot rename: Parent folder has no parent.");
				return null;
			}
			// Fix path construction to avoid double slashes
			let newFolderPath: string;
			if (parentFolder.path === "" || parentFolder.path === "/") {
				// Parent is vault root
				newFolderPath = newFolderName;
			} else {
				// Parent is in a subfolder
				newFolderPath = `${parentFolder.path}/${newFolderName}`;
			}
			console.log('FileOperations: New folder path:', newFolderPath);

			const existingFolder = this.app.vault.getAbstractFileByPath(newFolderPath);
			if (existingFolder instanceof TFolder) {
				console.log('FileOperations: Folder already exists');
				new Notice(`Folder already exists at ${newFolderPath}.`);
				return null;
			}

			// Store old values before rename
			const oldPath = file.path;
			const oldName = file.name;
			
			try {
				console.log('FileOperations: Attempting to rename folder from', file.parent.path, 'to', newFolderPath);
				await this.app.fileManager.renameFile(file.parent, newFolderPath);
				console.log('FileOperations: Folder rename successful');
			} catch (error) {
				console.error('FileOperations: Folder rename failed:', error);
				new Notice(`Failed to rename folder: ${(error as Error).message}.`);
				return null;
			}
			
			const newFilePath = `${newFolderPath}/${file.name}`;
			console.log('FileOperations: Looking for renamed file at:', newFilePath);
			const newFile = this.app.vault.getAbstractFileByPath(newFilePath);
			if (!(newFile instanceof TFile)) {
				console.log('FileOperations: Could not locate renamed file');
				new Notice("Failed to locate renamed file.");
				return null;
			}
			
			console.log('FileOperations: Folder rename completed successfully');
			return newFile;
		}
		
		// For non-index files, rename the file itself
		console.log('FileOperations: Renaming file directly');
		prefix = file.basename.startsWith("_") ? "_" : "";
		const newName = `${prefix}${kebabTitle}.md`;
		
		// Fix path construction to avoid double slashes
		let newPath: string;
		if (file.parent.path === "" || file.parent.path === "/") {
			// File is in vault root
			newPath = newName;
		} else {
			// File is in a subfolder
			newPath = `${file.parent.path}/${newName}`;
		}
		console.log('FileOperations: New file path:', newPath);

		const existingFile = this.app.vault.getAbstractFileByPath(newPath);
		if (existingFile instanceof TFile && existingFile !== file) {
			console.log('FileOperations: File already exists at new path');
			new Notice(`File already exists at ${newPath}.`);
			return null;
		}

		try {
			console.log('FileOperations: Attempting to rename file from', file.path, 'to', newPath);
			await this.app.fileManager.renameFile(file, newPath);
			console.log('FileOperations: File rename successful');
		} catch (error) {
			console.error('FileOperations: File rename failed:', error);
			new Notice(`Failed to rename file: ${(error as Error).message}.`);
			return null;
		}
		
		const newFile = this.app.vault.getAbstractFileByPath(newPath);
		if (!(newFile instanceof TFile)) {
			console.log('FileOperations: Could not locate renamed file');
			new Notice("Failed to locate renamed file.");
			return null;
		}
		
		console.log('FileOperations: File rename completed successfully');
		return newFile;
	}
}
