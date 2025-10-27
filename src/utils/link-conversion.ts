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

		// Check custom content types first (highest priority)
		let foundCustomType = false;
		for (const customType of this.settings.customContentTypes) {
			if (customType.enabled && customType.folder && path.startsWith(customType.folder + '/')) {
				contentFolder = customType.folder;
				basePath = customType.linkBasePath || "";
				creationMode = customType.creationMode;
				indexFileName = customType.indexFileName;
				foundCustomType = true;
				break;
			}
		}
		
		// Check pages folder (second priority)
		if (!foundCustomType && this.settings.enablePages && this.settings.pagesFolder && path.startsWith(this.settings.pagesFolder + '/')) {
			contentFolder = this.settings.pagesFolder;
			basePath = this.settings.pagesLinkBasePath;
			creationMode = this.settings.pagesCreationMode || "file";
			indexFileName = this.settings.pagesIndexFileName || "";
		}
		// Check posts folder (third priority)
		else if (!foundCustomType && this.settings.postsFolder && path.startsWith(this.settings.postsFolder + '/')) {
			contentFolder = this.settings.postsFolder;
			basePath = this.settings.postsLinkBasePath;
			creationMode = this.settings.creationMode;
			indexFileName = this.settings.indexFileName || "index";
		}
		// If posts folder is blank and "Ignore subfolders" is NOT checked, treat as post unless excluded
		else if (!foundCustomType && !this.settings.postsFolder && !this.settings.onlyAutomateInPostsFolder) {
			// Only treat files in vault root as posts when posts folder is blank
			// This includes both direct files and folder-based posts in vault root
			if (!path.includes('/') || (path.includes('/') && !path.startsWith('/') && path.split('/').length === 2)) {
				// Check if file should be excluded from post processing
				let shouldExcludeFromPosts = false;
				
				// Exclude if in pages folder
				if (this.settings.enablePages && this.settings.pagesFolder && path.startsWith(this.settings.pagesFolder + '/')) {
					shouldExcludeFromPosts = true;
				}
				
				// Exclude if in excluded directories
				if (this.settings.excludedDirectories) {
					const excludedDirs = this.settings.excludedDirectories.split("|").map(dir => dir.trim()).filter(dir => dir);
					for (const excludedDir of excludedDirs) {
						if (path.startsWith(excludedDir + '/') || path === excludedDir) {
							shouldExcludeFromPosts = true;
							break;
						}
					}
				}
				
				// If not excluded, treat as post
				if (!shouldExcludeFromPosts) {
					basePath = this.settings.postsLinkBasePath;
					creationMode = this.settings.creationMode;
					indexFileName = this.settings.indexFileName || "index";
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
		const parts = path.split('/');
		const lastPart = parts[parts.length - 1];
		
		// Check if the last part matches the specified index file name
		if (indexFileName && indexFileName.trim() !== "" && lastPart === indexFileName) {
			parts.pop();
			path = parts.join('/');
			addTrailingSlash = true;
		}
		// Check if the last part matches the default "index" (when no indexFileName is specified)
		else if ((!indexFileName || indexFileName.trim() === "") && lastPart === "index") {
			parts.pop();
			path = parts.join('/');
			addTrailingSlash = true;
		}

		const slugParts = path.split('/').map(part => this.toKebabCase(part));
		const slug = slugParts.join('/');

		// Format base path
		if (basePath) {
			// Add leading slash if not present to make it absolute from root
			if (!basePath.startsWith("/")) {
				basePath = "/" + basePath;
			}
			// Add trailing slash if not present
			if (!basePath.endsWith("/")) {
				basePath += "/";
			}
		} else {
			// When no base path is specified, add leading slash to make it absolute from root
			basePath = "/";
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

		// Use the same logic as getContentTypeForPath but for the target link
		const targetContentType = this.getContentTypeForPath(path + '.md');
		
		// If target link doesn't have a clear content type (no folder path), use current file's content type
		if (!targetContentType.basePath && currentFileContentType.basePath) {
			basePath = currentFileContentType.basePath;
			creationMode = currentFileContentType.creationMode;
			indexFileName = currentFileContentType.indexFileName;
		} else {
			basePath = targetContentType.basePath;
			creationMode = targetContentType.creationMode;
			indexFileName = targetContentType.indexFileName;
		}
		
		// Determine content folder from the target path
		const targetPath = path + '.md';
		for (const customType of this.settings.customContentTypes) {
			if (customType.enabled && customType.folder && targetPath.startsWith(customType.folder + '/')) {
				contentFolder = customType.folder;
				break;
			}
		}
		if (!contentFolder && this.settings.enablePages && this.settings.pagesFolder && targetPath.startsWith(this.settings.pagesFolder + '/')) {
			contentFolder = this.settings.pagesFolder;
		}
		if (!contentFolder && this.settings.postsFolder && targetPath.startsWith(this.settings.postsFolder + '/')) {
			contentFolder = this.settings.postsFolder;
		}

		// Strip content folder if present
		if (contentFolder) {
			path = path.slice(contentFolder.length + 1);
		}

		let addTrailingSlash = false;
		
		// Smart detection: if the filename matches the index file name (regardless of creation mode),
		// treat it as folder-based logic
		const parts = path.split('/');
		const lastPart = parts[parts.length - 1];
		
		// Check if the last part matches the specified index file name
		if (indexFileName && indexFileName.trim() !== "" && lastPart === indexFileName) {
			parts.pop();
			path = parts.join('/');
			addTrailingSlash = true;
		}
		// Check if the last part matches the default "index" (when no indexFileName is specified)
		else if ((!indexFileName || indexFileName.trim() === "") && lastPart === "index") {
			parts.pop();
			path = parts.join('/');
			addTrailingSlash = true;
		}

		const slugParts = path.split('/').map(part => this.toKebabCase(part));
		const slug = slugParts.join('/');

		// Format base path
		if (basePath) {
			// Add leading slash if not present to make it absolute from root
			if (!basePath.startsWith("/")) {
				basePath = "/" + basePath;
			}
			// Add trailing slash if not present
			if (!basePath.endsWith("/")) {
				basePath += "/";
			}
		} else {
			// When no base path is specified, add leading slash to make it absolute from root
			basePath = "/";
		}

		// Determine if we should add trailing slash
		const shouldAddTrailingSlash = this.settings.addTrailingSlashToLinks || addTrailingSlash;

		return `${basePath}${slug}${shouldAddTrailingSlash ? '/' : ''}${anchor}`;
	}

	private isInConfiguredContentDirectory(filePath: string): boolean {
		// Check custom content types
		for (const customType of this.settings.customContentTypes) {
			if (customType.enabled && customType.folder && filePath.startsWith(customType.folder + '/')) {
				return true;
			}
		}
		
		// Check pages folder
		if (this.settings.enablePages) {
			if (this.settings.pagesFolder && filePath.startsWith(this.settings.pagesFolder + '/')) {
				return true;
			} else if (!this.settings.pagesFolder && !filePath.includes('/')) {
				return true; // Files in vault root when pages folder is blank
			}
		}
		
		// Check posts folder
		if (this.settings.postsFolder && filePath.startsWith(this.settings.postsFolder + '/')) {
			return true;
		} else if (!this.settings.postsFolder && this.settings.automatePostCreation && !filePath.includes('/')) {
			return true; // Files in vault root when posts folder is blank
		}
		
		return false;
	}

	private getContentTypeForPath(filePath: string): { basePath: string; creationMode: "file" | "folder"; indexFileName: string } {
		
		// Check custom content types FIRST (highest priority)
		for (const customType of this.settings.customContentTypes) {
			if (customType.enabled && customType.folder && filePath.startsWith(customType.folder + '/')) {
				return {
					basePath: customType.linkBasePath || "",
					creationMode: customType.creationMode,
					indexFileName: customType.indexFileName
				};
			}
		}
		
		// Check pages folder
		if (this.settings.enablePages) {
			if (this.settings.pagesFolder && filePath.startsWith(this.settings.pagesFolder + '/')) {
				return {
					basePath: this.settings.pagesLinkBasePath,
					creationMode: this.settings.pagesCreationMode || "file",
					indexFileName: this.settings.pagesIndexFileName || ""
				};
			} else if (!this.settings.pagesFolder && !filePath.includes('/')) {
				// If pagesFolder is blank, only treat files in vault root as pages
				return {
					basePath: this.settings.pagesLinkBasePath,
					creationMode: this.settings.pagesCreationMode || "file",
					indexFileName: this.settings.pagesIndexFileName || ""
				};
			}
		}
		
		// Check posts folder
		if (this.settings.postsFolder && filePath.startsWith(this.settings.postsFolder + '/')) {
			return {
				basePath: this.settings.postsLinkBasePath,
				creationMode: this.settings.creationMode,
				indexFileName: this.settings.indexFileName || "index"
			};
		}
		
		// Check if posts folder is blank - treat files in vault root as posts (only if automation is enabled)
		if (!this.settings.postsFolder && this.settings.automatePostCreation && !filePath.includes('/')) {
			return {
				basePath: this.settings.postsLinkBasePath,
				creationMode: this.settings.creationMode,
				indexFileName: this.settings.indexFileName || "index"
			};
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
		let convertedCount = 0;
		let skippedCount = 0;
		const skippedLinks: string[] = [];

		// Determine the current file's content type for relative links
		const currentFileContentType = this.getContentTypeForPath(file.path);

		// Define common image extensions
		const imageExtensions = /\.(png|jpg|jpeg|gif|svg)$/i;

		// Helper function to check if a link can be reliably converted
		const canConvertLink = (linkText: string): boolean => {
			// Don't convert if it's an image
			if (imageExtensions.test(linkText)) {
				return false;
			}

			// Don't convert external links
			if (linkText.match(/^https?:\/\//)) {
				return false;
			}

			// Don't convert if it's not a .md file and doesn't look like a valid internal link
			if (!linkText.includes('.md') && !linkText.match(/^[a-zA-Z0-9_-]+(\/[a-zA-Z0-9_-]+)*$/)) {
				return false;
			}

			// Check if the target file is in any configured content directory
			const targetPath = linkText.endsWith('.md') ? linkText : linkText + '.md';
			
			// Check if it's in a configured content directory
			const isInConfiguredDirectory = this.isInConfiguredContentDirectory(targetPath);
			
			// Also check if it's a simple filename (no path) and current file has a content type
			const isSimpleFilename = !targetPath.includes('/');
			const hasCurrentContentType = currentFileContentType.basePath !== "" || currentFileContentType.creationMode !== "file" || currentFileContentType.indexFileName !== "";
			
			return isInConfiguredDirectory || (isSimpleFilename && hasCurrentContentType);
		};

		// Handle regular Wikilinks (non-image)
		newContent = newContent.replace(
			/\[\[([^\]|]+)(\|([^\]]+))?\]\]/g,
			(match, linkText, _pipe, displayText) => {
				// Check if it's an image Wikilink
				if (imageExtensions.test(linkText)) {
					skippedCount++;
					skippedLinks.push(linkText);
					return match; // Ignore and return original image Wikilink
				}

				// Check if we can reliably convert this link
				if (!canConvertLink(linkText)) {
					skippedCount++;
					skippedLinks.push(linkText);
					return match; // Return original if we can't convert reliably
				}

				const display = displayText || linkText.replace(/\.md$/, "");

				// For relative links (no folder path), use current file's content type
				const url = this.getAstroUrlFromInternalLinkWithContext(linkText, file.path, currentFileContentType);

				convertedCount++;
				return `[${display}](${url})`;
			}
		);

		// Handle standard Markdown links (non-image, non-external)
		// Only process links that contain .md to avoid processing already-converted links
		newContent = newContent.replace(
			/\[([^\]]+)\]\(([^)]+\.md[^)]*)\)/g,
			(match, displayText, link) => {
				// Check if it's an image link or external link
				if (link.match(/^https?:\/\//) || imageExtensions.test(link)) {
					skippedCount++;
					skippedLinks.push(link);
					return match; // Ignore external or image links
				}

				// Check if we can reliably convert this link
				if (!canConvertLink(link)) {
					skippedCount++;
					skippedLinks.push(link);
					return match; // Return original if we can't convert reliably
				}

				const url = this.getAstroUrlFromInternalLinkWithContext(link, file.path, currentFileContentType);

				convertedCount++;
				return `[${displayText}](${url})`;
			}
		);

		// Handle image links in Markdown format (e.g., ![Image](mountains.png))
		newContent = newContent.replace(
			/!\[(.*?)\]\(([^)]+)\)/g,
			(match) => {
				skippedCount++;
				return match; // Ignore all image links
			}
		);

		// Handle {{embed}} syntax
		newContent = newContent.replace(/\{\{([^}]+)\}\}/g, (match, fileName) => {
			if (imageExtensions.test(fileName)) {
				skippedCount++;
				skippedLinks.push(fileName);
				return match; // Ignore embedded images
			}

			// Check if we can reliably convert this link
			if (!canConvertLink(fileName)) {
				skippedCount++;
				skippedLinks.push(fileName);
				return match; // Return original if we can't convert reliably
			}

			const url = this.getAstroUrlFromInternalLinkWithContext(fileName, file.path, currentFileContentType);

			convertedCount++;
			return `[Embedded: ${fileName}](${url})`;
		});

		editor.setValue(newContent);
		
		// Show appropriate notice based on results
		if (convertedCount > 0 && skippedCount === 0) {
			new Notice(`Converted ${convertedCount} internal link${convertedCount > 1 ? 's' : ''} for Astro.`);
		} else if (convertedCount > 0 && skippedCount > 0) {
			new Notice(`Converted ${convertedCount} link${convertedCount > 1 ? 's' : ''} for Astro. Skipped ${skippedCount} link${skippedCount > 1 ? 's' : ''} outside configured content directories.`);
		} else if (skippedCount > 0) {
			new Notice(`No links converted. All ${skippedCount} link${skippedCount > 1 ? 's' : ''} are outside configured content directories or are images/external links.`);
		} else {
			new Notice("No internal links found to convert.");
		}
	}
}
