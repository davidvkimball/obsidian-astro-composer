import { Editor, TFile, Notice } from "obsidian";
import { AstroComposerSettings } from "../types";

import { matchesFolderPattern, sortByPatternSpecificity } from "./path-matching";

export class LinkConverter {
	constructor(private settings: AstroComposerSettings, private plugin?: { settings?: AstroComposerSettings }) {}
	
	// Get fresh settings from plugin if available, otherwise use stored settings
	private getSettings(): AstroComposerSettings {
		// Always prefer plugin settings (they're kept up to date)
		if (this.plugin?.settings) {
			return this.plugin.settings;
		}
		return this.settings;
	}

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
		path = path.replace(/\.(md|mdx)$/, "");

		// Determine content type and appropriate base path using pattern specificity
		// Support both .md and .mdx extensions
		const fileExtension = link.endsWith('.mdx') ? '.mdx' : '.md';
		const contentTypeInfo = this.getContentTypeForPath(path + fileExtension);
		let basePath = contentTypeInfo.basePath || "";
		let contentFolder = contentTypeInfo.contentFolder || "";
		let indexFileName = contentTypeInfo.indexFileName || "";


		// Strip content folder if present
		if (contentFolder) {
			path = path.slice(contentFolder.length + 1);
		}

		let addTrailingSlash = false;
		
		// Smart detection: if the filename matches the index file name (regardless of creation mode),
		// treat it as folder-based logic
		// Note: We only set addTrailingSlash here; the final check will prevent it if there's an anchor
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
		// CRITICAL: Never add trailing slash before an anchor (e.g., /about#heading not /about/#heading)
		// This is especially important for anchor links from copy heading URL functionality
		// Anchor links should NEVER have trailing slashes, regardless of settings
		const settings = this.getSettings();
		const shouldAddTrailingSlash = (settings.addTrailingSlashToLinks || addTrailingSlash) && !anchor;

		return `${basePath}${slug}${shouldAddTrailingSlash ? '/' : ''}${anchor}`;
	}

	private getAstroUrlFromInternalLinkWithContext(link: string, currentFilePath: string, currentFileContentType: { basePath: string; creationMode: "file" | "folder"; indexFileName: string; contentFolder: string }): string {
		
		const hashIndex = link.indexOf('#');
		let path = hashIndex >= 0 ? link.slice(0, hashIndex) : link;
		const anchor = hashIndex >= 0 ? link.slice(hashIndex) : '';

		// URL decode the path to handle encoded characters like %20
		path = decodeURIComponent(path);
		path = path.replace(/\.(md|mdx)$/, "");
		

		// Determine content type and appropriate base path
		let basePath = "";
		let contentFolder = "";
		let indexFileName = "";

		// Use the same logic as getContentTypeForPath but for the target link
		// Support both .md and .mdx extensions - try .mdx first if link suggests it
		const fileExtension = link.endsWith('.mdx') ? '.mdx' : '.md';
		const targetContentType = this.getContentTypeForPath(path + fileExtension);
		
		// If target link doesn't have a clear content type (no folder path), use current file's content type
		if (!targetContentType.basePath && currentFileContentType.basePath) {
			basePath = currentFileContentType.basePath;
			indexFileName = currentFileContentType.indexFileName;
			contentFolder = currentFileContentType.contentFolder;
		} else {
			basePath = targetContentType.basePath;
			indexFileName = targetContentType.indexFileName;
			contentFolder = targetContentType.contentFolder;
		}

		// Strip content folder if present
		if (contentFolder) {
			path = path.slice(contentFolder.length + 1);
		}

		let addTrailingSlash = false;
		
		// Smart detection: if the filename matches the index file name (regardless of creation mode),
		// treat it as folder-based logic
		// Note: We only set addTrailingSlash here; the final check will prevent it if there's an anchor
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
		// CRITICAL: Never add trailing slash before an anchor (e.g., /about#heading not /about/#heading)
		// This is especially important for anchor links from copy heading URL functionality
		// Anchor links should NEVER have trailing slashes, regardless of settings
		const settings = this.getSettings();
		const shouldAddTrailingSlash = (settings.addTrailingSlashToLinks || addTrailingSlash) && !anchor;

		return `${basePath}${slug}${shouldAddTrailingSlash ? '/' : ''}${anchor}`;
	}

	private isInConfiguredContentDirectory(filePath: string): boolean {
		// Check all content types, sorted by pattern specificity (more specific first)
		const settings = this.getSettings();
		const contentTypes = settings.contentTypes || [];
		const sortedTypes = sortByPatternSpecificity(contentTypes);
		
		for (const contentType of sortedTypes) {
			if (!contentType.enabled) continue;
			
			// Handle blank folder (root) - matches files in vault root only
			if (!contentType.folder || contentType.folder.trim() === "") {
				if (!filePath.includes("/") || filePath.split("/").length === 1) {
					return true;
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
							return true;
						}
					} else {
						// For file-based creation, files are at the same depth as the pattern
						if (pathDepth === expectedDepth) {
							return true;
						}
					}
				} else {
					return true;
				}
			}
		}
		
		return false;
	}

	private getContentTypeForPath(filePath: string): { basePath: string; creationMode: "file" | "folder"; indexFileName: string; contentFolder: string } {
		// Check all content types, sorted by pattern specificity (more specific first)
		const settings = this.getSettings();
		const contentTypes = settings.contentTypes || [];
		const sortedTypes = sortByPatternSpecificity(contentTypes);
		
		for (const contentType of sortedTypes) {
			if (!contentType.enabled) continue;
			
			// Handle blank folder (root) - matches files in vault root only
			if (!contentType.folder || contentType.folder.trim() === "") {
				if (!filePath.includes("/") || filePath.split("/").length === 1) {
					return {
						basePath: contentType.linkBasePath || "",
						creationMode: contentType.creationMode,
						indexFileName: contentType.indexFileName || "",
						contentFolder: ""
					};
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
							return {
								basePath: contentType.linkBasePath || "",
								creationMode: contentType.creationMode,
								indexFileName: contentType.indexFileName || "",
								contentFolder: contentType.folder
							};
						}
					} else {
						// For file-based creation, files are at the same depth as the pattern
						if (pathDepth === expectedDepth) {
							return {
								basePath: contentType.linkBasePath || "",
								creationMode: contentType.creationMode,
								indexFileName: contentType.indexFileName || "",
								contentFolder: contentType.folder
							};
						}
					}
				} else {
					return {
						basePath: contentType.linkBasePath || "",
						creationMode: contentType.creationMode,
						indexFileName: contentType.indexFileName || "",
						contentFolder: contentType.folder
					};
				}
			}
		}
		
		// Default fallback
		return {
			basePath: "",
			creationMode: "file",
			indexFileName: "",
			contentFolder: ""
		};
	}

	convertWikilinksForAstro(editor: Editor, file: TFile | null): void {
		if (!(file instanceof TFile)) {
			new Notice("No active file.");
			return;
		}

		// Preserve cursor position before modifying content
		const cursor = editor.getCursor();
		const originalLine = cursor.line;
		const originalCh = cursor.ch;
		const originalContent = editor.getValue();
		const originalLineCount = originalContent.split('\n').length;
		const originalLineLength = originalContent.split('\n')[originalLine]?.length || 0;

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

			// Don't convert if it's not a .md or .mdx file and doesn't look like a valid internal link
			if (!linkText.includes('.md') && !linkText.includes('.mdx') && !linkText.match(/^[a-zA-Z0-9_-]+(\/[a-zA-Z0-9_-]+)*$/)) {
				return false;
			}

			// Check if the target file is in any configured content directory
			// Support both .md and .mdx extensions
			let targetPath: string;
			if (linkText.endsWith('.md') || linkText.endsWith('.mdx')) {
				targetPath = linkText;
			} else {
				// Default to .md if no extension specified
				targetPath = linkText + '.md';
			}
			
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
			(match: string, linkText: string, _pipe: string | undefined, displayText: string | undefined) => {
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

				const display = displayText || linkText.replace(/\.(md|mdx)$/, "");

				// For relative links (no folder path), use current file's content type
				const url = this.getAstroUrlFromInternalLinkWithContext(linkText, file.path, currentFileContentType);

				convertedCount++;
				return `[${display}](${url})`;
			}
		);

		// Handle standard Markdown links (non-image, non-external)
		// Only process links that contain .md or .mdx to avoid processing already-converted links
		newContent = newContent.replace(
			/\[([^\]]+)\]\(([^)]+\.(md|mdx)[^)]*)\)/g,
			(match: string, displayText: string, link: string) => {
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
			(match: string) => {
				skippedCount++;
				return match; // Ignore all image links
			}
		);

		// Handle {{embed}} syntax
		newContent = newContent.replace(/\{\{([^}]+)\}\}/g, (match: string, fileName: string) => {
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
		
		// Restore cursor position, adjusting for content changes
		const newLineCount = newContent.split('\n').length;
		const newLineLength = newContent.split('\n')[originalLine]?.length || 0;
		
		// Calculate new cursor position
		let newLine = originalLine;
		let newCh = originalCh;
		
		// If content length changed, adjust cursor position
		if (newLineCount !== originalLineCount) {
			// If lines were added/removed before cursor, adjust line number
			// For simplicity, keep same line if it still exists, otherwise clamp to end
			if (newLine >= newLineCount) {
				newLine = Math.max(0, newLineCount - 1);
			}
		}
		
		// Adjust column position if line length changed
		if (newLineLength !== originalLineLength) {
			// If line got shorter, clamp to end of line
			if (newCh > newLineLength) {
				newCh = Math.max(0, newLineLength);
			}
		}
		
		// Restore cursor position
		editor.setCursor({ line: newLine, ch: newCh });
		
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
