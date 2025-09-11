import { Plugin, Editor, MarkdownView, TFile, Notice } from "obsidian";
import { AstroComposerSettings } from "../types";
import { FileOperations } from "../utils/file-operations";
import { TemplateParser } from "../utils/template-parsing";
import { LinkConverter } from "../utils/link-conversion";
import { TitleModal } from "../ui/title-modal";

export function registerCommands(plugin: Plugin, settings: AstroComposerSettings): void {
	const fileOps = new FileOperations(plugin.app, settings);
	const templateParser = new TemplateParser(plugin.app, settings);
	const linkConverter = new LinkConverter(settings);

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

	// Rename Note command
	plugin.addCommand({
		id: "rename-note",
		name: "Rename Current Note",
		icon: "pencil",
		editorCallback: (editor: Editor, ctx: MarkdownView | any) => {
			if (ctx.file instanceof TFile) {
				const type = fileOps.determineType(ctx.file);
				const titleKey = fileOps.getTitleKey(type);
				const cache = plugin.app.metadataCache.getFileCache(ctx.file);
				if (!cache?.frontmatter || !(titleKey in cache.frontmatter)) {
					new Notice("Cannot rename: No title found in properties");
					return;
				}
				new TitleModal(plugin.app, ctx.file, plugin, type, true).open();
			}
		},
	});
}

async function standardizeProperties(app: any, settings: AstroComposerSettings, file: TFile): Promise<void> {
	const templateParser = new TemplateParser(app, settings);
	
	// Determine if it's a page or post
	const filePath = file.path;
	const pagesFolder = settings.pagesFolder || "";
	const isPage = settings.enablePages && pagesFolder && (filePath.startsWith(pagesFolder + "/") || filePath === pagesFolder);
	const templateString = isPage ? settings.pageTemplate : settings.defaultTemplate;

	// Wait briefly to allow editor state to stabilize
	await new Promise(resolve => setTimeout(resolve, 100));

	// Re-read content to ensure latest state after editor changes
	const content = await app.vault.read(file);
	const title = file.basename.replace(/^_/, "");
	
	const parsed = await templateParser.parseFrontmatter(content);
	const { templateProps, templateValues } = templateParser.parseTemplate(templateString, title);

	// Merge template properties with existing ones, preserving all existing
	const finalProps: Record<string, string[]> = { ...parsed.properties };
	for (const key of templateProps) {
		if (!(key in parsed.properties)) {
			finalProps[key] = templateValues[key] || (['tags', 'aliases', 'cssclasses'].includes(key) ? [] : [""]);
		} else if (['tags', 'aliases', 'cssclasses'].includes(key) && templateValues[key]?.length > 0) {
			// Merge items, ensuring no duplicates
			const allItems = [...(parsed.properties[key] || []), ...templateValues[key].filter(item => !(parsed.properties[key] || []).includes(item))];
			finalProps[key] = allItems;
		}
	}

	const newContent = templateParser.buildFrontmatterContent(finalProps) + parsed.bodyContent;

	await app.vault.modify(file, newContent);
	new Notice("Properties standardized using template.");
}
