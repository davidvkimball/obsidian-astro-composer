import { App, TFile, TFolder, Notice } from "obsidian";
import { AstroComposerSettings, FileCreationOptions, RenameOptions, ContentType, ContentTypeId, AstroComposerPluginInterface } from "../types";
import { matchesFolderPattern, sortByPatternSpecificity } from "./path-matching";
import { toKebabCase } from "./string-utils";

export class FileOperations {
	constructor(private app: App, private settings: AstroComposerSettings, private plugin?: AstroComposerPluginInterface) { }

	// Get fresh settings from plugin if available, otherwise use stored settings
	private getSettings(): AstroComposerSettings {
		// Always prefer plugin settings (they're kept up to date)
		if (this.plugin?.settings) {
			return this.plugin.settings;
		}
		return this.settings;
	}

	private createSafeStem(title: string): string {
		return toKebabCase(title) || "untitled";
	}

	private getUniqueFilePath(path: string, currentPathToIgnore?: string): string {
		const extIndex = path.lastIndexOf(".");
		const hasExt = extIndex > path.lastIndexOf("/");
		const extension = hasExt ? path.slice(extIndex) : "";
		const pathWithoutExt = hasExt ? path.slice(0, extIndex) : path;
		const slashIndex = pathWithoutExt.lastIndexOf("/");
		const baseDir = slashIndex >= 0 ? pathWithoutExt.slice(0, slashIndex + 1) : "";
		const baseName = slashIndex >= 0 ? pathWithoutExt.slice(slashIndex + 1) : pathWithoutExt;
		let candidate = `${baseDir}${baseName}${extension}`;
		let suffix = 2;

		while (true) {
			const existing = this.app.vault.getAbstractFileByPath(candidate);
			const isCurrentPath = currentPathToIgnore && candidate === currentPathToIgnore;
			if (!existing || isCurrentPath) {
				return candidate;
			}
			candidate = `${baseDir}${baseName}-${suffix}${extension}`;
			suffix += 1;
		}
	}

	private getUniqueFolderPath(path: string, currentPathToIgnore?: string): string {
		const slashIndex = path.lastIndexOf("/");
		const baseDir = slashIndex >= 0 ? path.slice(0, slashIndex + 1) : "";
		const baseName = slashIndex >= 0 ? path.slice(slashIndex + 1) : path;
		let candidate = `${baseDir}${baseName}`;
		let suffix = 2;

		while (true) {
			const existing = this.app.vault.getAbstractFileByPath(candidate);
			const isCurrentPath = currentPathToIgnore && candidate === currentPathToIgnore;
			if (!existing || isCurrentPath) {
				return candidate;
			}
			candidate = `${baseDir}${baseName}-${suffix}`;
			suffix += 1;
		}
	}

	generateFilename(title: string, enableUnderscorePrefix: boolean = false): string {
		const safeKebabTitle = this.createSafeStem(title);
		const prefix = enableUnderscorePrefix ? "_" : "";
		return `${prefix}${safeKebabTitle}`;
	}

	determineType(file: TFile): ContentTypeId {
		const filePath = file.path;
		const settings = this.getSettings();

		// Check all content types, sorted by pattern specificity (more specific first)
		const contentTypes = settings.contentTypes || [];
		const sortedTypes = sortByPatternSpecificity(contentTypes);

		for (const contentType of sortedTypes) {
			if (!contentType.enabled) continue;

			// Handle blank folder (root) - matches files in vault root only
			if (!contentType.folder || contentType.folder.trim() === "") {
				if (!filePath.includes("/") || filePath.split("/").length === 1) {
					return contentType.id;
				}
			} else if (matchesFolderPattern(filePath, contentType.folder)) {
				// Check ignoreSubfolders if folder is specified
				if (contentType.ignoreSubfolders) {
					const pathSegments = filePath.split("/");
					const pathDepth = pathSegments.length;
					const patternSegments = contentType.folder.split("/");
					const expectedDepth = patternSegments.length;

					if (contentType.creationMode === "folder") {
						// For folder-based creation, files are one level deeper (e.g., test/my-file/index.md)
						// So we need to allow one extra level beyond the pattern depth
						const folderDepth = pathDepth - 1; // Subtract 1 for the index.md file
						if (folderDepth === expectedDepth || folderDepth === expectedDepth + 1) {
							return contentType.id;
						}
					} else {
						// For file-based creation, files are at the same depth as the pattern
						if (pathDepth === expectedDepth) {
							return contentType.id;
						}
					}
				} else {
					return contentType.id;
				}
			}
		}

		// If no content type matches, return "note" as fallback
		return "note";
	}

	getContentType(typeId: ContentTypeId): ContentType | null {
		const settings = this.getSettings();
		const contentTypes = settings.contentTypes || [];
		return contentTypes.find(ct => ct.id === typeId) || null;
	}

	/**
	 * Helper to get content type for a given file path
	 */
	getContentTypeByPath(filePath: string): ContentType | null {
		// Create a dummy TFile for determineType
		const dummyFile = { path: filePath } as TFile;
		const typeId = this.determineType(dummyFile);
		if (typeId === "note") return null;
		return this.getContentType(typeId);
	}

	getTitleKey(type: ContentTypeId): string {
		// For generic notes, always use "title"
		if (type === "note") return "title";

		const contentType = this.getContentType(type);
		if (!contentType) return "title";

		const template = contentType.template;
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

		// Get content type settings
		const contentType = this.getContentType(type);
		if (!contentType && type !== "note") {
			new Notice(`Content type ${type} not found.`);
			return null;
		}

		const kebabTitle = this.createSafeStem(title);
		const enableUnderscorePrefix = contentType?.enableUnderscorePrefix || false;
		const prefix = enableUnderscorePrefix ? "_" : "";

		let targetFolder = "";
		if (type === "note") {
			// For generic notes, keep them in their current location
			targetFolder = "";
		} else if (contentType) {
			// Get the directory where the user created the file
			const originalDir = file.parent?.path || "";

			// Respect the user's chosen location (subfolder)
			// Only use the configured folder if the user created the file in the vault root
			if (originalDir === "" || originalDir === "/") {
				targetFolder = contentType.folder || "";
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

		const creationMode = contentType?.creationMode || "file";
		if (creationMode === "folder") {
			return this.createFolderStructure(file, kebabTitle, prefix, targetFolder, type, contentType);
		} else {
			return this.createFileStructure(file, kebabTitle, prefix, targetFolder, contentType);
		}
	}

	private async createFolderStructure(file: TFile, kebabTitle: string, prefix: string, targetFolder: string, type: ContentTypeId, contentType: ContentType | null): Promise<TFile | null> {
		const folderName = `${prefix}${kebabTitle || "untitled"}`;
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

		folderPath = this.getUniqueFolderPath(folderPath);

		try {
			const folder = this.app.vault.getAbstractFileByPath(folderPath);
			if (!(folder instanceof TFolder)) {
				await this.app.vault.createFolder(folderPath);
			}
		} catch {
			// Folder might already exist, proceed
		}

		const indexFileName = contentType?.indexFileName || "index";
		const extension = contentType?.useMdxExtension ? ".mdx" : ".md";
		const fileName = `${indexFileName}${extension}`;
		const desiredPath = `${folderPath}/${fileName}`;
		const newPath = this.getUniqueFilePath(desiredPath);

		// Track that this file will be created by the plugin BEFORE renaming
		// This prevents the create event from triggering another modal
		if (this.plugin) {
			this.plugin.pluginCreatedFiles.set(newPath, Date.now());
		}

		try {
			await this.app.fileManager.renameFile(file, newPath);
			const newFile = this.app.vault.getAbstractFileByPath(newPath);
			if (!(newFile instanceof TFile)) {
				return null;
			}

			setTimeout(() => {
				const fileExplorer = this.app.workspace.getLeavesOfType("file-explorer")[0];
				if (fileExplorer && fileExplorer.view) {
					const view = fileExplorer.view;
					if (view && typeof view === 'object' && 'tree' in view) {
						const fileTree = (view as { tree?: { revealFile?: (file: TFile) => void } }).tree;
						if (fileTree && newFile instanceof TFile && typeof fileTree.revealFile === 'function') {
							fileTree.revealFile(newFile);
						}
					}
				}
			}, 200);

			const leaf = this.app.workspace.getLeaf(false);
			await leaf.openFile(newFile);

			// Position cursor at the end of content after editor is ready
			const positionCursor = () => {
				const view = leaf.view;
				if (view && 'editor' in view) {
					const editor = (view as { editor?: { setCursor: (pos: { line: number; ch: number }) => void; getValue: () => string; focus: () => void } }).editor;
					if (editor) {
						const content = editor.getValue();
						if (content) {
							const lines = content.split('\n');
							const lastLine = lines.length - 1;
							const lastLineLength = lines[lastLine]?.length || 0;
							editor.setCursor({ line: lastLine, ch: lastLineLength });
							editor.focus();
							return true;
						}
					}
				}
				return false;
			};

			setTimeout(() => {
				if (!positionCursor()) {
					setTimeout(() => {
						positionCursor();
					}, 200);
				}
			}, 100);

			return newFile;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			new Notice(`Failed to create folder structure: ${errorMessage}.`);
			return null;
		}
	}

	private async createFileStructure(file: TFile, kebabTitle: string, prefix: string, targetFolder: string, contentType: ContentType | null): Promise<TFile | null> {
		const extension = contentType?.useMdxExtension ? ".mdx" : ".md";
		const safeStem = kebabTitle || "untitled";
		const newName = `${prefix}${safeStem}${extension}`;
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

		newPath = this.getUniqueFilePath(newPath, file.path);

		// Track that this file will be created by the plugin BEFORE renaming
		// This prevents the create event from triggering another modal
		if (this.plugin) {
			this.plugin.pluginCreatedFiles.set(newPath, Date.now());
		}

		try {
			// Use fileManager.renameFile() which respects user settings and handles all link formats
			await this.app.fileManager.renameFile(file, newPath);

			const newFile = this.app.vault.getAbstractFileByPath(newPath);
			if (!(newFile instanceof TFile)) {
				new Notice("Failed to locate renamed file.");
				return null;
			}

			const leaf = this.app.workspace.getLeaf(false);
			await leaf.openFile(newFile);

			// Position cursor at the end of content after editor is ready
			const positionCursor = () => {
				const view = leaf.view;
				if (view && 'editor' in view) {
					const editor = (view as { editor?: { setCursor: (pos: { line: number; ch: number }) => void; getValue: () => string; focus: () => void } }).editor;
					if (editor) {
						const content = editor.getValue();
						if (content) {
							const lines = content.split('\n');
							const lastLine = lines.length - 1;
							const lastLineLength = lines[lastLine]?.length || 0;
							editor.setCursor({ line: lastLine, ch: lastLineLength });
							editor.focus();
							return true;
						}
					}
				}
				return false;
			};

			setTimeout(() => {
				if (!positionCursor()) {
					setTimeout(() => {
						positionCursor();
					}, 200);
				}
			}, 100);

			return newFile;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			new Notice(`Failed to rename file: ${errorMessage}.`);
			return null;
		}
	}


	async renameFile(options: RenameOptions): Promise<TFile | null> {
		const { file, title, type } = options;

		if (!title) {
			new Notice(`Title is required to rename the content.`);
			return null;
		}

		const contentType = this.getContentType(type);
		if (!contentType && type !== "note") {
			new Notice(`Content type ${type} not found.`);
			return null;
		}

		const kebabTitle = this.createSafeStem(title);
		const prefix = "";

		const creationMode = contentType?.creationMode || "file";
		if (creationMode === "folder") {
			return this.renameFolderStructure(file, kebabTitle, prefix, type, contentType);
		} else {
			return this.renameFileStructure(file, kebabTitle, prefix, contentType);
		}
	}

	private async renameFolderStructure(file: TFile, kebabTitle: string, prefix: string, type: ContentTypeId, contentType: ContentType | null): Promise<TFile | null> {
		// Smart detection: treat as index if filename matches the index file name
		// Default to "index" when indexFileName is blank
		const indexFileName = contentType?.indexFileName || "index";
		const isIndex = file.basename === indexFileName;
		if (isIndex) {
			if (!file.parent) {
				new Notice("Cannot rename: file has no parent folder.");
				return null;
			}
			prefix = file.parent.name.startsWith("_") ? "_" : "";
			const newFolderName = `${prefix}${kebabTitle || "untitled"}`;
			const parentFolder = file.parent.parent;
			if (!parentFolder) {
				new Notice("Cannot rename: parent folder has no parent.");
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

			newFolderPath = this.getUniqueFolderPath(newFolderPath, file.parent.path);

			try {
				await this.app.fileManager.renameFile(file.parent, newFolderPath);
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				new Notice(`Failed to rename folder: ${errorMessage}.`);
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
				new Notice("Cannot rename: file has no parent folder.");
				return null;
			}
			prefix = file.basename.startsWith("_") ? "_" : "";
			// Preserve the original file extension
			const extension = file.extension;
			const safeStem = kebabTitle || "untitled";
			const newName = `${prefix}${safeStem}.${extension}`;
			const desiredPath = `${file.parent.path}/${newName}`;
			const newPath = this.getUniqueFilePath(desiredPath, file.path);

			// Use fileManager.renameFile() which automatically updates links
			await this.app.fileManager.renameFile(file, newPath);
			const newFile = this.app.vault.getAbstractFileByPath(newPath);
			if (!(newFile instanceof TFile)) {
				new Notice("Failed to locate renamed file.");
				return null;
			}


			return newFile;
		}
	}

	private async renameFileStructure(file: TFile, kebabTitle: string, prefix: string, contentType: ContentType | null): Promise<TFile | null> {
		if (!file.parent) {
			new Notice("Cannot rename: file has no parent folder.");
			return null;
		}

		// Check if this is an index file - if so, rename the parent folder instead
		// Smart detection: only treat as index if indexFileName is specified and matches
		const indexFileName = contentType?.indexFileName || "";
		const isIndex = indexFileName &&
			indexFileName.trim() !== "" &&
			file.basename === indexFileName;

		if (isIndex) {
			prefix = file.parent.name.startsWith("_") ? "_" : "";
			const newFolderName = `${prefix}${kebabTitle || "untitled"}`;
			const parentFolder = file.parent.parent;
			if (!parentFolder) {
				new Notice("Cannot rename: parent folder has no parent.");
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

			newFolderPath = this.getUniqueFolderPath(newFolderPath, file.parent.path);

			// Calculate the new file path before renaming
			const newFilePath = `${newFolderPath}/${file.name}`;

			// Track that this file will be created by the plugin BEFORE renaming
			// This prevents the create event from triggering another modal
			if (this.plugin) {
				this.plugin.pluginCreatedFiles.set(newFilePath, Date.now());
			}

			try {
				await this.app.fileManager.renameFile(file.parent, newFolderPath);
			} catch (error) {
				console.error('FileOperations: Folder rename failed:', error);
				const errorMessage = error instanceof Error ? error.message : String(error);
				new Notice(`Failed to rename folder: ${errorMessage}.`);
				return null;
			}

			const newFile = this.app.vault.getAbstractFileByPath(newFilePath);
			if (!(newFile instanceof TFile)) {
				new Notice("Failed to locate renamed file.");
				return null;
			}

			return newFile;
		}

		// For non-index files, rename the file itself
		prefix = file.basename.startsWith("_") ? "_" : "";
		// Preserve the original file extension
		const extension = file.extension;
		const safeStem = kebabTitle || "untitled";
		const newName = `${prefix}${safeStem}.${extension}`;

		// Fix path construction to avoid double slashes
		let newPath: string;
		if (file.parent.path === "" || file.parent.path === "/") {
			// File is in vault root
			newPath = newName;
		} else {
			// File is in a subfolder
			newPath = `${file.parent.path}/${newName}`;
		}

		newPath = this.getUniqueFilePath(newPath, file.path);

		// Track that this file will be created by the plugin BEFORE renaming
		// This prevents the create event from triggering another modal
		if (this.plugin) {
			this.plugin.pluginCreatedFiles.set(newPath, Date.now());
		}

		try {
			await this.app.fileManager.renameFile(file, newPath);
		} catch (error) {
			console.error('FileOperations: File rename failed:', error);
			const errorMessage = error instanceof Error ? error.message : String(error);
			new Notice(`Failed to rename file: ${errorMessage}.`);
			return null;
		}

		const newFile = this.app.vault.getAbstractFileByPath(newPath);
		if (!(newFile instanceof TFile)) {
			new Notice("Failed to locate renamed file.");
			return null;
		}

		return newFile;
	}
}
