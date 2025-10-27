import { Plugin, Editor, MarkdownView, TFile, Notice, App } from "obsidian";
import { AstroComposerSettings, AstroComposerPluginInterface } from "../types";
import { FileOperations } from "../utils/file-operations";
import { TemplateParser } from "../utils/template-parsing";
import { LinkConverter } from "../utils/link-conversion";
import { TitleModal } from "../ui/title-modal";

export function registerCommands(plugin: Plugin, settings: AstroComposerSettings): void {
	const fileOps = new FileOperations(plugin.app, settings, plugin);
	const linkConverter = new LinkConverter(settings);


	// Helper function to check if a file matches any configured content type
	function hasMatchingContentType(file: TFile, settings: AstroComposerSettings): boolean {
		const filePath = file.path;
		const postsFolder = settings.postsFolder || "";
		const pagesFolder = settings.enablePages ? (settings.pagesFolder || "") : "";
		
		// Check if it's a post (only if automation is enabled)
		if (settings.automatePostCreation) {
			if (postsFolder) {
				// If postsFolder is specified, check if file is in that folder
				if (filePath.startsWith(postsFolder + "/") || filePath === postsFolder) {
					return true;
				}
			} else {
				// If postsFolder is blank, only treat files in vault root as posts
				// This includes both direct files and folder-based posts in vault root
				if (!filePath.includes("/") || (filePath.includes("/") && !filePath.startsWith("/") && filePath.split("/").length === 2)) {
					return true;
				}
			}
		}
		
		// Check if it's a page (automation is automatic when pages are enabled)
		if (settings.enablePages) {
			if (pagesFolder && (filePath.startsWith(pagesFolder + "/") || filePath === pagesFolder)) {
				return true;
			} else if (!pagesFolder && !filePath.includes("/")) {
				// If pagesFolder is blank, only treat files in vault root as pages
				return true;
			}
		}
		
		// Check if it's a custom content type
		const type = fileOps.determineType(file);
		if (fileOps.isCustomContentType(type)) {
			const customType = fileOps.getCustomContentType(type);
			if (customType && customType.enabled) {
				return true;
			}
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
				standardizeProperties(plugin.app, settings, ctx.file, plugin);
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
					new Notice("Cannot rename: This file is not part of a configured content type folder.");
					return;
				}
				
				// Determine content type from folder structure
				const type = fileOps.determineType(ctx.file);
				const cache = plugin.app.metadataCache.getFileCache(ctx.file);
				
				// Get the appropriate title key for this content type
				const titleKey = fileOps.getTitleKey(type);
				
				// Check if the file has the required title property
				if (!cache?.frontmatter || !(titleKey in cache.frontmatter)) {
					new Notice(`Cannot rename: No ${titleKey} found in properties`);
					return;
				}
				
				new TitleModal(plugin.app, ctx.file, plugin as unknown as AstroComposerPluginInterface, type, true).open();
			}
		},
	});
}

async function standardizeProperties(app: App, settings: AstroComposerSettings, file: TFile, plugin?: any): Promise<void> {
	const templateParser = new TemplateParser(app, settings);
	const fileOps = new FileOperations(app, settings, plugin);
	
	// Determine content type using the existing logic
	const type = fileOps.determineType(file);
	
	// Check if this file has a valid content type (not just "note")
	if (type === "note") {
		new Notice("No properties template specified for this content. This file doesn't match any configured content type folders.");
		return;
	}
	
	let templateString: string;
	
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
