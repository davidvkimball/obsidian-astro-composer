import { Editor, TFile, Notice } from "obsidian";
import { AstroComposerSettings, PostType } from "../types";

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

	async convertWikilinksForAstro(editor: Editor, file: TFile | null): Promise<void> {
		if (!(file instanceof TFile)) {
			new Notice("No active file.");
			return;
		}

		const content = editor.getValue();
		let newContent = content;

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

				const url = this.getAstroUrlFromInternalLink(linkText);

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

				const url = this.getAstroUrlFromInternalLink(link);

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

			const url = this.getAstroUrlFromInternalLink(fileName);

			return `[Embedded: ${fileName}](${url})`;
		});

		editor.setValue(newContent);
		new Notice("All internal links converted for Astro.");
	}
}
