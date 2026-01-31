import { TFile, HeadingCache, App } from "obsidian";
import { AstroComposerSettings } from "../types";
import { matchesFolderPattern, sortByPatternSpecificity } from "./path-matching";
import { toKebabCase } from "./string-utils";

export class HeadingLinkGenerator {
	constructor(private settings: AstroComposerSettings) { }

	/**
	 * Converts text to kebab-case slug for URLs
	 */
	// Local toKebabCase removed, using imported one instead

	/**
	 * Gets the Astro-compatible URL from an internal link (copied from LinkConverter)
	 */
	private getAstroUrlFromInternalLink(link: string): string {
		const hashIndex = link.indexOf('#');
		let path = hashIndex >= 0 ? link.slice(0, hashIndex) : link;
		const anchor = hashIndex >= 0 ? link.slice(hashIndex) : '';

		path = path.replace(/\.md$/, "");

		// Determine content type and appropriate base path
		let basePath = "";
		let contentFolder = "";
		let creationMode: "file" | "folder" = "file";
		let indexFileName = "";

		// Check all content types, sorted by pattern specificity (more specific first)
		const contentTypes = this.settings.contentTypes || [];
		const sortedTypes = sortByPatternSpecificity(contentTypes);

		for (const contentType of sortedTypes) {
			if (!contentType.enabled) continue;

			let matches = false;

			// Handle blank folder (root) - matches files in vault root only
			if (!contentType.folder || contentType.folder.trim() === "") {
				if (!path.includes("/") || path.split("/").length === 1) {
					matches = true;
				}
			} else if (matchesFolderPattern(path, contentType.folder)) {
				matches = true;
			}

			if (matches) {
				contentFolder = contentType.folder || "";
				basePath = contentType.linkBasePath || "";
				creationMode = contentType.creationMode;
				indexFileName = contentType.indexFileName || "";
				break; // Most specific pattern wins
			}
		}

		// Strip content folder if present
		if (contentFolder) {
			path = path.slice(contentFolder.length + 1);
		}

		let addTrailingSlash = false;

		// Smart detection: if the filename matches the index file name (regardless of creation mode),
		// treat it as folder-based logic
		// Note: We only set addTrailingSlash here; the final check will prevent it if there's an anchor
		if (indexFileName && indexFileName.trim() !== "") {
			const parts = path.split('/');
			if (parts[parts.length - 1] === indexFileName) {
				parts.pop();
				path = parts.join('/');
				addTrailingSlash = true;
			}
		} else if (creationMode === "folder") {
			// Fallback to original logic if no index file name is specified
			// Default to "index" when indexFileName is blank
			const defaultIndexName = "index";
			const parts = path.split('/');
			if (parts[parts.length - 1] === defaultIndexName) {
				parts.pop();
				path = parts.join('/');
				addTrailingSlash = true;
			}
		}

		const slugParts = path.split('/').map(part => toKebabCase(part));
		const slug = slugParts.join('/');

		// Format base path
		if (basePath) {
			if (!basePath.startsWith("/")) basePath = "/" + basePath;
			if (!basePath.endsWith("/")) basePath += "/";
		}

		// Determine if we should add trailing slash
		// CRITICAL: Never add trailing slash before an anchor (e.g., /about#heading not /about/#heading)
		// This is especially important for anchor links from copy heading URL functionality
		// Anchor links should NEVER have trailing slashes, regardless of settings
		const shouldAddTrailingSlash = (this.settings.addTrailingSlashToLinks || addTrailingSlash) && !anchor;

		return `${basePath}${slug}${shouldAddTrailingSlash ? '/' : ''}${anchor}`;
	}

	/**
	 * Generates a standard Obsidian link to a heading, respecting user's link format preference
	 */
	generateObsidianLink(app: App, file: TFile, heading: HeadingCache): string {
		const headingText = heading.heading;

		// Check if user prefers wikilinks by testing Obsidian's default behavior
		const testLink = app.fileManager.generateMarkdownLink(file, '', '');
		if (testLink.startsWith('[[')) {
			// User prefers wikilinks - use just the filename (basename) without path
			const fileName = file.basename;
			return `[[${fileName}#${headingText}|${headingText}]]`;
		} else {
			// User prefers markdown links - use Obsidian's method with heading text as-is (URL-encoded)
			// Get the base link from Obsidian (respects user's path settings)
			const baseLink = app.fileManager.generateMarkdownLink(file, '', '');
			// Extract the path part and add our anchor with proper display text
			if (baseLink.startsWith('[[')) {
				// This shouldn't happen since we're in the markdown branch, but just in case
				const fileName = file.basename;
				return `[[${fileName}#${headingText}|${headingText}]]`;
			} else {
				// Extract the path from the generated link and reconstruct with proper display text
				const match = baseLink.match(/\[([^\]]+)\]\(([^)]+)\)/);
				if (match) {
					const [, , path] = match;
					// For Obsidian, use the heading text as-is (URL-encoded), not kebab-case
					return `[${headingText}](${path}#${encodeURIComponent(headingText)})`;
				} else {
					// Fallback to manual construction
					const encodedFilename = encodeURIComponent(file.name);
					// For Obsidian, use the heading text as-is (URL-encoded)
					return `[${headingText}](${encodedFilename}#${encodeURIComponent(headingText)})`;
				}
			}
		}
	}

	/**
	 * Generates a standard Obsidian wikilink to a heading
	 */
	generateObsidianWikilink(file: TFile, heading: HeadingCache): string {
		const headingText = heading.heading;
		// Use just the filename (basename), not the full path
		const fileName = file.basename;
		return `[[${fileName}#${headingText}|${headingText}]]`;
	}

	/**
	 * Generates an Astro-compatible markdown link to a heading
	 */
	generateAstroLink(file: TFile, heading: HeadingCache): string {
		const headingText = heading.heading;
		const anchor = toKebabCase(headingText);
		// Use the same logic as the existing link converter
		const internalLink = `${file.path}#${anchor}`;
		const astroUrl = this.getAstroUrlFromInternalLink(internalLink);
		return `[${headingText}](${astroUrl})`;
	}

	/**
	 * Generates an Astro-compatible wikilink to a heading
	 */
	generateAstroWikilink(file: TFile, heading: HeadingCache): string {
		const headingText = heading.heading;
		const anchor = toKebabCase(headingText);
		// Use the same logic as the existing link converter
		const internalLink = `${file.path}#${anchor}`;
		const astroUrl = this.getAstroUrlFromInternalLink(internalLink);
		// Create a wikilink with the Astro URL as the target
		return `[[${headingText}|${astroUrl}]]`;
	}

	/**
	 * Extracts the URL from a markdown link or wikilink
	 */
	extractUrl(link: string): string {
		// Handle markdown links: [text](url)
		const markdownMatch = link.match(/\[([^\]]+)\]\(([^)]+)\)/);
		if (markdownMatch) {
			return markdownMatch[2];
		}

		// Handle wikilinks: [[path#heading|text]] or [[path#heading]]
		const wikilinkMatch = link.match(/\[\[([^\]]+)\]\]/);
		if (wikilinkMatch) {
			const content = wikilinkMatch[1];
			// Extract the path part (before | if present)
			const pathPart = content.split('|')[0];
			return pathPart;
		}

		// If it doesn't match either format, return as-is (might already be a URL)
		return link;
	}

	/**
	 * Generates the appropriate link format based on settings
	 */
	generateLink(app: App, file: TFile, heading: HeadingCache): string {
		if (this.settings.copyHeadingLinkFormat === "astro") {
			// Astro format always uses markdown links (wikilinks with Astro URLs don't make sense)
			return this.generateAstroLink(file, heading);
		} else {
			// Use Obsidian's built-in method which respects user settings
			return this.generateObsidianLink(app, file, heading);
		}
	}

	/**
	 * Finds the heading at a specific line in a file
	 */
	findHeadingAtLine(app: App, file: TFile, line: number): HeadingCache | null {
		const cache = app.metadataCache.getFileCache(file);
		if (!cache || !cache.headings) {
			return null;
		}

		// Find the heading that contains this line
		for (let i = cache.headings.length - 1; i >= 0; i--) {
			const heading = cache.headings[i];
			if (heading.position.start.line <= line) {
				return heading;
			}
		}

		return null;
	}
}
