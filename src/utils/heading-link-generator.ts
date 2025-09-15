import { TFile, HeadingCache } from "obsidian";
import { AstroComposerSettings } from "../types";

export class HeadingLinkGenerator {
	constructor(private settings: AstroComposerSettings) {}

	/**
	 * Converts text to kebab-case slug for URLs
	 */
	private toKebabCase(str: string): string {
		return str
			.toLowerCase()
			.replace(/[^a-z0-9\s-]/g, "")
			.trim()
			.replace(/\s+/g, "-")
			.replace(/-+/g, "-")
			.replace(/^-|-$/g, "");
	}

	/**
	 * Gets the Astro-compatible URL from an internal link (copied from LinkConverter)
	 */
	private getAstroUrlFromInternalLink(link: string): string {
		const hashIndex = link.indexOf('#');
		let path = hashIndex >= 0 ? link.slice(0, hashIndex) : link;
		let anchor = hashIndex >= 0 ? link.slice(hashIndex) : '';

		path = path.replace(/\.md$/, "");

		// Strip root folder if present
		if (path.startsWith(this.settings.postsFolder + '/')) {
			path = path.slice(this.settings.postsFolder.length + 1);
		} else if (this.settings.enablePages && path.startsWith(this.settings.pagesFolder + '/')) {
			path = path.slice(this.settings.pagesFolder.length + 1);
		}

		let addTrailingSlash = false;
		if (this.settings.creationMode === "folder") {
			const parts = path.split('/');
			if (parts[parts.length - 1] === this.settings.indexFileName) {
				parts.pop();
				path = parts.join('/');
				addTrailingSlash = true;
			}
		}

		const slugParts = path.split('/').map(part => this.toKebabCase(part));
		const slug = slugParts.join('/');

		let basePath = this.settings.linkBasePath;
		if (!basePath.startsWith("/")) basePath = "/" + basePath;
		if (!basePath.endsWith("/")) basePath += "/";

		return `${basePath}${slug}${addTrailingSlash ? '/' : ''}${anchor}`;
	}

	/**
	 * Generates a standard Obsidian link to a heading, respecting user's link format preference
	 */
	generateObsidianLink(app: any, file: TFile, heading: HeadingCache): string {
		const headingText = heading.heading;
		
		// Check if user prefers wikilinks by testing Obsidian's default behavior
		const testLink = app.fileManager.generateMarkdownLink(file, '', '');
		if (testLink.startsWith('[[')) {
			// User prefers wikilinks
			const filePath = file.path.replace(/\.md$/, "");
			return `[[${filePath}#${headingText}|${headingText}]]`;
		} else {
			// User prefers markdown links - use Obsidian's method but fix the display text
			const anchor = this.toKebabCase(headingText);
			// Get the base link from Obsidian (respects user's path settings)
			const baseLink = app.fileManager.generateMarkdownLink(file, '', '');
			// Extract the path part and add our anchor with proper display text
			if (baseLink.startsWith('[[')) {
				// This shouldn't happen since we're in the markdown branch, but just in case
				const filePath = file.path.replace(/\.md$/, "");
				return `[[${filePath}#${headingText}|${headingText}]]`;
			} else {
				// Extract the path from the generated link and reconstruct with proper display text
				const match = baseLink.match(/\[([^\]]+)\]\(([^)]+)\)/);
				if (match) {
					const [, , path] = match;
					return `[${headingText}](${path}#${encodeURIComponent(anchor)})`;
				} else {
					// Fallback to manual construction
					const encodedFilename = encodeURIComponent(file.name);
					return `[${headingText}](${encodedFilename}#${encodeURIComponent(anchor)})`;
				}
			}
		}
	}

	/**
	 * Generates a standard Obsidian wikilink to a heading
	 */
	generateObsidianWikilink(file: TFile, heading: HeadingCache): string {
		const headingText = heading.heading;
		const filePath = file.path.replace(/\.md$/, "");
		return `[[${filePath}#${headingText}|${headingText}]]`;
	}

	/**
	 * Generates an Astro-compatible markdown link to a heading
	 */
	generateAstroLink(file: TFile, heading: HeadingCache): string {
		const headingText = heading.heading;
		const anchor = this.toKebabCase(headingText);
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
		const anchor = this.toKebabCase(headingText);
		// Use the same logic as the existing link converter
		const internalLink = `${file.path}#${anchor}`;
		const astroUrl = this.getAstroUrlFromInternalLink(internalLink);
		// Create a wikilink with the Astro URL as the target
		return `[[${headingText}|${astroUrl}]]`;
	}

	/**
	 * Generates the appropriate link format based on settings
	 */
	generateLink(app: any, file: TFile, heading: HeadingCache): string {
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
	findHeadingAtLine(app: any, file: TFile, line: number): HeadingCache | null {
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
