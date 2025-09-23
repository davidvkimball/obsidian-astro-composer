import { Plugin, Editor, MarkdownView, TFile, Notice, App } from "obsidian";
import { AstroComposerSettings } from "../types";
import { FileOperations } from "../utils/file-operations";
import { TemplateParser } from "../utils/template-parsing";
import { LinkConverter } from "../utils/link-conversion";
import { TitleModal } from "../ui/title-modal";

export function registerCommands(plugin: Plugin, settings: AstroComposerSettings): void {
	const fileOps = new FileOperations(plugin.app, settings);
	const linkConverter = new LinkConverter(settings);

	// Helper function to check if a file matches any configured content type
	function hasMatchingContentType(file: TFile, settings: AstroComposerSettings): boolean {
		const filePath = file.path;
		const postsFolder = settings.postsFolder || "";
		const pagesFolder = settings.enablePages ? (settings.pagesFolder || "") : "";
		
		// Check if it's a post
		if (settings.automatePostCreation && postsFolder && 
			(filePath.startsWith(postsFolder + "/") || filePath === postsFolder)) {
			return true;
		}
		
		// Check if it's a page
		if (settings.enablePages && pagesFolder && 
			(filePath.startsWith(pagesFolder + "/") || filePath === pagesFolder)) {
			return true;
		}
		
		// Check if it's a custom content type
		const type = fileOps.determineType(file);
		if (fileOps.isCustomContentType(type)) {
			const customType = fileOps.getCustomContentType(type);
			if (customType && customType.enabled) {
				return true;
			}
		}
		
		// Smart fallback: check if file has frontmatter with title
		const cache = plugin.app.metadataCache.getFileCache(file);
		if (cache?.frontmatter && cache.frontmatter.title) {
			return true; // Allow rename if it has a title in frontmatter
		}
		
		return false;
	}

	// Standardize Properties command
	plugin.addCommand({
		id: "standardize-properties",
		name: "Standardize Properties",
		icon: "file-check",
		editorCallback: (editor: Editor, ctx: MarkdownView | any) => {
			if (ctx.file instanceof TFile) {
				standardizeProperties(plugin.app, settings, ctx.file);
			}
		},
	});

	// Convert Wikilinks command
	plugin.addCommand({
		id: "convert-wikilinks-astro",
		name: "Convert internal links for Astro",
		icon: "link-2",
		editorCallback: (editor: Editor, ctx: MarkdownView | any) => {
			if (ctx.file instanceof TFile) {
				linkConverter.convertWikilinksForAstro(editor, ctx.file);
			}
		},
	});

	// Rename Content command
	plugin.addCommand({
		id: "rename-content",
		name: "Rename Current Content",
		icon: "pencil",
		editorCallback: (editor: Editor, ctx: MarkdownView | any) => {
			if (ctx.file instanceof TFile) {
				// Check if this file matches any configured content type
				if (!hasMatchingContentType(ctx.file, settings)) {
					new Notice("Cannot rename: This file doesn't have a title in its frontmatter or match any configured content type folders.");
					return;
				}
				
				// Smart type detection with fallback
				let type = fileOps.determineType(ctx.file);
				const cache = plugin.app.metadataCache.getFileCache(ctx.file);
				
				// If type couldn't be determined from folder structure, try to detect from frontmatter
				if (!fileOps.isCustomContentType(type) && type !== "post" && type !== "page") {
					// Check if it has a title in frontmatter - if so, treat as generic "note"
					if (cache?.frontmatter && cache.frontmatter.title) {
						type = "note";
					}
				}
				
				// For generic notes, use "title" as the key
				const titleKey = type === "note" ? "title" : fileOps.getTitleKey(type);
				
				if (!cache?.frontmatter || !(titleKey in cache.frontmatter)) {
					new Notice("Cannot rename: No title found in properties");
					return;
				}
				new TitleModal(plugin.app, ctx.file, plugin as any, type, true).open();
			}
		},
	});
}

async function standardizeProperties(app: App, settings: AstroComposerSettings, file: TFile): Promise<void> {
	const templateParser = new TemplateParser(app, settings);
	const fileOps = new FileOperations(app, settings);
	
	// Determine content type
	const type = fileOps.determineType(file);
	let templateString: string;
	
	// Check if this file matches any content type criteria
	const filePath = file.path;
	const postsFolder = settings.postsFolder || "";
	const pagesFolder = settings.enablePages ? (settings.pagesFolder || "") : "";
	
	let hasMatchingContentType = false;
	
	// Check if it's a post
	if (settings.automatePostCreation && postsFolder && 
		(filePath.startsWith(postsFolder + "/") || filePath === postsFolder)) {
		hasMatchingContentType = true;
	}
	
	// Check if it's a page
	if (!hasMatchingContentType && settings.enablePages && pagesFolder && 
		(filePath.startsWith(pagesFolder + "/") || filePath === pagesFolder)) {
		hasMatchingContentType = true;
	}
	
	// Check if it's a custom content type
	if (!hasMatchingContentType && fileOps.isCustomContentType(type)) {
		const customType = fileOps.getCustomContentType(type);
		if (customType && customType.enabled) {
			hasMatchingContentType = true;
		}
	}
	
	// If no content type matches, show notification and return
	if (!hasMatchingContentType) {
		new Notice("No properties template specified for this content. This file doesn't match any configured content type folders.");
		return;
	}
	
	// Determine template based on content type
	if (fileOps.isCustomContentType(type)) {
		const customType = fileOps.getCustomContentType(type);
		templateString = customType ? customType.template : settings.defaultTemplate;
	} else {
		const isPage = type === "page";
		templateString = isPage ? settings.pageTemplate : settings.defaultTemplate;
	}

	// Wait briefly to allow editor state to stabilize
	await new Promise(resolve => setTimeout(resolve, 100));

	// Re-read content to ensure latest state after editor changes
	const content = await app.vault.read(file);
	const title = file.basename.replace(/^_/, "");
	
	const parsed = await templateParser.parseFrontmatter(content);
	const { templateProps, templateValues } = templateParser.parseTemplate(templateString, title);

	// Merge template properties with existing ones, preserving all existing
	const finalProps: Record<string, string[]> = { ...parsed.properties };
	const arrayKeys = new Set<string>(); // Track which keys are arrays
	
	for (const key of templateProps) {
		if (!(key in parsed.properties)) {
			// Property doesn't exist, add it from template
			const templateValue = templateValues[key];
			if (Array.isArray(templateValue)) {
				finalProps[key] = templateValue;
				arrayKeys.add(key); // Mark as array
			} else {
				finalProps[key] = [templateValue || ""];
			}
		} else {
			// Property exists, check if it's an array type
			const templateValue = templateValues[key];
			const isArrayValue = Array.isArray(templateValue);
			
			if (isArrayValue) {
				// This is an array property - preserve existing values and merge with template
				const existingItems = parsed.properties[key] || [];
				const newItems = templateValue.filter(item => !existingItems.includes(item));
				finalProps[key] = [...existingItems, ...newItems];
				arrayKeys.add(key); // Mark as array
			}
			// For non-array values, keep existing value (don't overwrite)
		}
	}

	// Also add any existing array keys that weren't in the template
	for (const key in parsed.properties) {
		if (parsed.properties[key].length > 1) {
			arrayKeys.add(key);
		}
	}

	const newContent = templateParser.buildFrontmatterContent(finalProps, arrayKeys) + parsed.bodyContent;

	await app.vault.modify(file, newContent);
	new Notice("Properties standardized using template.");
}
