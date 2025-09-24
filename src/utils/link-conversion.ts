import { Editor, TFile, Notice } from "obsidian";
import { AstroComposerSettings } from "../types";

export class LinkConverter {
	constructor(private settings: AstroComposerSettings) {}

	toKebabCase(str: string): string {
		return str
			.toLowerCase()
			.replace(/[^a-z0-9\s-]/g, "")
			.trim()
			.replace(/\s+/g, "-")
			.replace(/-+/g, "-")
			.replace(/^-|-$/g, "");
	}

	getAstroUrlFromInternalLink(link: string): string {
		const hashIndex = link.indexOf('#');
		let path = hashIndex >= 0 ? link.slice(0, hashIndex) : link;
		const anchor = hashIndex >= 0 ? link.slice(hashIndex) : '';

		// URL decode the path to handle encoded characters like %20
		path = decodeURIComponent(path);
		path = path.replace(/\.md$/, "");

		// Determine content type and appropriate base path
		let basePath = "";
		let contentFolder = "";
		let creationMode: "file" | "folder" = "file";
		let indexFileName = "";

		// Check posts folder
		if (this.settings.postsFolder && path.startsWith(this.settings.postsFolder + '/')) {
			contentFolder = this.settings.postsFolder;
			basePath = this.settings.postsLinkBasePath;
			creationMode = this.settings.creationMode;
			indexFileName = this.settings.indexFileName;
		}
		// Check pages folder
		else if (this.settings.enablePages && this.settings.pagesFolder && path.startsWith(this.settings.pagesFolder + '/')) {
			contentFolder = this.settings.pagesFolder;
			basePath = this.settings.pagesLinkBasePath;
			creationMode = this.settings.pagesCreationMode || "file";
			indexFileName = this.settings.pagesIndexFileName || "";
		}
		// Check custom content types
		else {
			for (const customType of this.settings.customContentTypes) {
				if (customType.enabled && customType.folder && path.startsWith(customType.folder + '/')) {
					contentFolder = customType.folder;
					basePath = customType.linkBasePath || "";
					creationMode = customType.creationMode;
					indexFileName = customType.indexFileName;
					break;
				}
			}
		}


		// Strip content folder if present
		if (contentFolder) {
			path = path.slice(contentFolder.length + 1);
		}

		let addTrailingSlash = false;
		
		// Smart detection: if the filename matches the index file name (regardless of creation mode),
		// treat it as folder-based logic
		if (indexFileName && indexFileName.trim() !== "") {
			const parts = path.split('/');
			if (parts[parts.length - 1] === indexFileName) {
				parts.pop();
				path = parts.join('/');
				addTrailingSlash = true;
			}
		} else if (creationMode === "folder") {
			// Fallback to original logic if no index file name is specified
			const parts = path.split('/');
			if (parts[parts.length - 1] === indexFileName) {
				parts.pop();
				path = parts.join('/');
				addTrailingSlash = true;
			}
		}

		const slugParts = path.split('/').map(part => this.toKebabCase(part));
		const slug = slugParts.join('/');

		// Format base path
		if (basePath) {
			if (!basePath.startsWith("/")) basePath = "/" + basePath;
			if (!basePath.endsWith("/")) basePath += "/";
		}

		// Determine if we should add trailing slash
		const shouldAddTrailingSlash = this.settings.addTrailingSlashToLinks || addTrailingSlash;

		return `${basePath}${slug}${shouldAddTrailingSlash ? '/' : ''}${anchor}`;
	}

	private getAstroUrlFromInternalLinkWithContext(link: string, currentFilePath: string, currentFileContentType: { basePath: string; creationMode: "file" | "folder"; indexFileName: string }): string {
		const hashIndex = link.indexOf('#');
		let path = hashIndex >= 0 ? link.slice(0, hashIndex) : link;
		const anchor = hashIndex >= 0 ? link.slice(hashIndex) : '';

		// URL decode the path to handle encoded characters like %20
		path = decodeURIComponent(path);
		path = path.replace(/\.md$/, "");

		// Determine content type and appropriate base path
		let basePath = "";
		let contentFolder = "";
		let creationMode: "file" | "folder" = "file";
		let indexFileName = "";

		// Check if the link has a folder path (absolute link)
		if (path.includes('/')) {
			// Use the original logic for absolute paths
			// Check posts folder
			if (this.settings.postsFolder && path.startsWith(this.settings.postsFolder + '/')) {
				contentFolder = this.settings.postsFolder;
				basePath = this.settings.postsLinkBasePath;
				creationMode = this.settings.creationMode;
				indexFileName = this.settings.indexFileName;
			}
			// Check pages folder
			else if (this.settings.enablePages && this.settings.pagesFolder && path.startsWith(this.settings.pagesFolder + '/')) {
				contentFolder = this.settings.pagesFolder;
				basePath = this.settings.pagesLinkBasePath;
				creationMode = this.settings.pagesCreationMode || "file";
				indexFileName = this.settings.pagesIndexFileName || "";
			}
			// Check custom content types
			else {
				for (const customType of this.settings.customContentTypes) {
					if (customType.enabled && customType.folder && path.startsWith(customType.folder + '/')) {
						contentFolder = customType.folder;
						basePath = customType.linkBasePath || "";
						creationMode = customType.creationMode;
						indexFileName = customType.indexFileName;
						break;
					}
				}
			}
		} else {
			// Relative link - use current file's content type
			basePath = currentFileContentType.basePath;
			creationMode = currentFileContentType.creationMode;
			indexFileName = currentFileContentType.indexFileName;
		}


		// Strip content folder if present
		if (contentFolder) {
			path = path.slice(contentFolder.length + 1);
		}

		let addTrailingSlash = false;
		
		// Smart detection: if the filename matches the index file name (regardless of creation mode),
		// treat it as folder-based logic
		if (indexFileName && indexFileName.trim() !== "") {
			const parts = path.split('/');
			if (parts[parts.length - 1] === indexFileName) {
				parts.pop();
				path = parts.join('/');
				addTrailingSlash = true;
			}
		} else if (creationMode === "folder") {
			// Fallback to original logic if no index file name is specified
			const parts = path.split('/');
			if (parts[parts.length - 1] === indexFileName) {
				parts.pop();
				path = parts.join('/');
				addTrailingSlash = true;
			}
		}

		const slugParts = path.split('/').map(part => this.toKebabCase(part));
		const slug = slugParts.join('/');

		// Format base path
		if (basePath) {
			if (!basePath.startsWith("/")) basePath = "/" + basePath;
			if (!basePath.endsWith("/")) basePath += "/";
		}

		// Determine if we should add trailing slash
		const shouldAddTrailingSlash = this.settings.addTrailingSlashToLinks || addTrailingSlash;

		return `${basePath}${slug}${shouldAddTrailingSlash ? '/' : ''}${anchor}`;
	}

	private getContentTypeForPath(filePath: string): { basePath: string; creationMode: "file" | "folder"; indexFileName: string } {
		// Check posts folder
		if (this.settings.postsFolder && filePath.startsWith(this.settings.postsFolder + '/')) {
			return {
				basePath: this.settings.postsLinkBasePath,
				creationMode: this.settings.creationMode,
				indexFileName: this.settings.indexFileName
			};
		}
		// Check pages folder
		else if (this.settings.enablePages && this.settings.pagesFolder && filePath.startsWith(this.settings.pagesFolder + '/')) {
			return {
				basePath: this.settings.pagesLinkBasePath,
				creationMode: this.settings.pagesCreationMode || "file",
				indexFileName: this.settings.pagesIndexFileName || ""
			};
		}
		// Check custom content types
		else {
			for (const customType of this.settings.customContentTypes) {
				if (customType.enabled && customType.folder && filePath.startsWith(customType.folder + '/')) {
					return {
						basePath: customType.linkBasePath || "",
						creationMode: customType.creationMode,
						indexFileName: customType.indexFileName
					};
				}
			}
		}
		
		// Default fallback
		return {
			basePath: "",
			creationMode: "file",
			indexFileName: ""
		};
	}

	async convertWikilinksForAstro(editor: Editor, file: TFile | null): Promise<void> {
		if (!(file instanceof TFile)) {
			new Notice("No active file.");
			return;
		}

		const content = editor.getValue();
		let newContent = content;

		// Determine the current file's content type for relative links
		const currentFileContentType = this.getContentTypeForPath(file.path);

		// Define common image extensions
		const imageExtensions = /\.(png|jpg|jpeg|gif|svg)$/i;

		// Handle regular Wikilinks (non-image)
		newContent = newContent.replace(
			/\[\[([^\]|]+)(\|([^\]]+))?\]\]/g,
			(match, linkText, _pipe, displayText) => {
				// Check if it's an image Wikilink
				if (imageExtensions.test(linkText)) {
					return match; // Ignore and return original image Wikilink
				}

				const display = displayText || linkText.replace(/\.md$/, "");

				// For relative links (no folder path), use current file's content type
				const url = this.getAstroUrlFromInternalLinkWithContext(linkText, file.path, currentFileContentType);

				return `[${display}](${url})`;
			}
		);

		// Handle standard Markdown links (non-image, non-external)
		newContent = newContent.replace(
			/\[([^\]]+)\]\(([^)]+)\)/g,
			(match, displayText, link) => {
				// Check if it's an image link or external link
				if (link.match(/^https?:\/\//) || imageExtensions.test(link)) {
					return match; // Ignore external or image links
				}

				// Check if it's internal .md link
				if (!link.includes('.md')) {
					return match; // Ignore if not .md
				}

				const url = this.getAstroUrlFromInternalLinkWithContext(link, file.path, currentFileContentType);

				return `[${displayText}](${url})`;
			}
		);

		// Handle image links in Markdown format (e.g., ![Image](mountains.png))
		newContent = newContent.replace(
			/!\[(.*?)\]\(([^)]+)\)/g,
			(match) => {
				return match; // Ignore all image links
			}
		);

		// Handle {{embed}} syntax
		newContent = newContent.replace(/\{\{([^}]+)\}\}/g, (match, fileName) => {
			if (imageExtensions.test(fileName)) {
				return match; // Ignore embedded images
			}

			const url = this.getAstroUrlFromInternalLinkWithContext(fileName, file.path, currentFileContentType);

			return `[Embedded: ${fileName}](${url})`;
		});

		editor.setValue(newContent);
		new Notice("All internal links converted for Astro.");
	}
}
