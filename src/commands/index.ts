import { Plugin, Editor, MarkdownView, TFile, Notice, App, MarkdownFileInfo } from "obsidian";
import { AstroComposerSettings, AstroComposerPluginInterface } from "../types";
import { FileOperations } from "../utils/file-operations";
import { TemplateParser } from "../utils/template-parsing";
import { LinkConverter } from "../utils/link-conversion";
import { TitleModal } from "../ui/title-modal";

export function registerCommands(plugin: Plugin, settings: AstroComposerSettings): void {
	const fileOps = new FileOperations(plugin.app, settings, plugin as unknown as AstroComposerPluginInterface & { pluginCreatedFiles?: Set<string> });
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
		name: "Standardize properties",
		icon: "file-check",
		editorCallback: (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
			const file = ctx instanceof MarkdownView ? ctx.file : ctx.file;
			if (file instanceof TFile) {
				void standardizeProperties(plugin.app, settings, file, plugin as unknown as AstroComposerPluginInterface);
			}
		},
	});

	// Convert Wikilinks command
	plugin.addCommand({
		id: "convert-wikilinks-astro",
		name: "Convert internal links for Astro",
		icon: "link-2",
		editorCallback: (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
			const file = ctx instanceof MarkdownView ? ctx.file : ctx.file;
			if (file instanceof TFile) {
				linkConverter.convertWikilinksForAstro(editor, file);
			}
		},
	});

	// Rename Content command
	plugin.addCommand({
		id: "rename-content",
		name: "Rename current content",
		icon: "pencil",
		editorCallback: (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
			const file = ctx instanceof MarkdownView ? ctx.file : ctx.file;
			if (file instanceof TFile) {
				// Check if this file matches any configured content type
				if (!hasMatchingContentType(file, settings)) {
					new Notice("Cannot rename: this file is not part of a configured content type folder.");
					return;
				}
				
				// Determine content type from folder structure
				const type = fileOps.determineType(file);
				const cache = plugin.app.metadataCache.getFileCache(file);
				
				// Get the appropriate title key for this content type
				const titleKey = fileOps.getTitleKey(type);
				
				// Check if the file has the required title property
				if (!cache?.frontmatter || !(titleKey in cache.frontmatter)) {
					new Notice(`Cannot rename: No ${titleKey} found in properties`);
					return;
				}
				
				new TitleModal(plugin.app, file, plugin as unknown as AstroComposerPluginInterface, type, true).open();
			}
		},
	});

	// Open Terminal command (always registered, checks settings at runtime)
	plugin.addCommand({
		id: "open-project-terminal",
		name: "Open project terminal",
		icon: "terminal-square",
		callback: async () => {
			const currentSettings = (plugin as unknown as AstroComposerPluginInterface).settings;
			if (!currentSettings.enableOpenTerminalCommand) {
				new Notice("Open terminal command is disabled. Enable it in settings to use this command.");
				return;
			}
			await openTerminalInProjectRoot(plugin.app, currentSettings);
		},
	});

	// Edit Config File command (always registered, checks settings at runtime)
	plugin.addCommand({
		id: "edit-astro-config",
		name: "Edit Astro config",
		icon: "wrench",
		callback: async () => {
			const currentSettings = (plugin as unknown as AstroComposerPluginInterface).settings;
			if (!currentSettings.enableOpenConfigFileCommand) {
				new Notice("Edit config file command is disabled. Enable it in settings to use this command.");
				return;
			}
			await openConfigFile(plugin.app, currentSettings);
		},
	});
}

async function standardizeProperties(app: App, settings: AstroComposerSettings, file: TFile, plugin?: AstroComposerPluginInterface): Promise<void> {
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
	
	const parsed = templateParser.parseFrontmatter(content);
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

/**
 * Rename a file by path (for programmatic use, e.g., from other plugins)
 * This allows the rename modal to appear without opening the file first
 */
export async function renameContentByPath(
	app: App,
	filePath: string,
	settings: AstroComposerSettings,
	plugin: AstroComposerPluginInterface
): Promise<void> {
	const file = app.vault.getAbstractFileByPath(filePath);
	if (!(file instanceof TFile)) {
		new Notice(`File not found: ${filePath}`);
		return;
	}

	const fileOps = new FileOperations(app, settings, plugin as unknown as AstroComposerPluginInterface & { pluginCreatedFiles?: Set<string> });

	// Helper function to check if file matches content type (copy from registerCommands)
	function hasMatchingContentType(file: TFile, settings: AstroComposerSettings): boolean {
		const filePath = file.path;
		const postsFolder = settings.postsFolder || "";
		const pagesFolder = settings.enablePages ? (settings.pagesFolder || "") : "";

		if (settings.automatePostCreation) {
			if (postsFolder) {
				if (filePath.startsWith(postsFolder + "/") || filePath === postsFolder) {
					return true;
				}
			} else {
				if (!filePath.includes("/") || (filePath.includes("/") && !filePath.startsWith("/") && filePath.split("/").length === 2)) {
					return true;
				}
			}
		}

		if (settings.enablePages) {
			if (pagesFolder && (filePath.startsWith(pagesFolder + "/") || filePath === pagesFolder)) {
				return true;
			} else if (!pagesFolder && !filePath.includes("/")) {
				return true;
			}
		}

		const type = fileOps.determineType(file);
		if (fileOps.isCustomContentType(type)) {
			const customType = fileOps.getCustomContentType(type);
			if (customType && customType.enabled) {
				return true;
			}
		}

		return false;
	}

	if (!hasMatchingContentType(file, settings)) {
		new Notice("Cannot rename: this file is not part of a configured content type folder.");
		return;
	}

	const type = fileOps.determineType(file);
	const cache = app.metadataCache.getFileCache(file);
	const titleKey = fileOps.getTitleKey(type);

	if (!cache?.frontmatter || !(titleKey in cache.frontmatter)) {
		new Notice(`Cannot rename: No ${titleKey} found in properties`);
		return;
	}

	new TitleModal(app, file, plugin, type, true).open();
}

/**
 * Open terminal in project root directory
 * Exported for use by ribbon icons
 */
export async function openTerminalInProjectRoot(app: App, settings: AstroComposerSettings): Promise<void> {
	try {
		const { exec } = require('child_process');
		const path = require('path');
		const fs = require('fs');

		// Get the actual vault path string from the adapter
		const vaultPath = (app.vault.adapter as any).basePath || (app.vault.adapter as any).path;
		const vaultPathString = typeof vaultPath === 'string' ? vaultPath : vaultPath.toString();

		// Resolve project root path
		let projectPath: string;
		if (settings.terminalProjectRootPath && settings.terminalProjectRootPath.trim()) {
			// Use custom path relative to vault
			projectPath = path.resolve(vaultPathString, settings.terminalProjectRootPath);
		} else {
			// Default: vault folder itself
			projectPath = vaultPathString;
		}

		// Verify the path exists
		if (!fs.existsSync(projectPath)) {
			new Notice(`Project root directory not found at: ${projectPath}`);
			return;
		}

		const platform = process.platform;
		let command: string;

		if (platform === 'win32') {
			// Windows: Try Windows Terminal first, fallback to cmd
			exec('where wt', (error: any) => {
				if (!error) {
					// Windows Terminal is available
					exec(`wt -d "${projectPath}"`, (execError: any) => {
						if (execError) {
							// Fallback to cmd
							exec(`cmd /k cd /d "${projectPath}"`, (cmdError: any) => {
								if (cmdError) {
									new Notice(`Error opening terminal: ${cmdError.message}`);
								}
							});
						}
					});
				} else {
					// Fallback to cmd
					exec(`cmd /k cd /d "${projectPath}"`, (cmdError: any) => {
						if (cmdError) {
							new Notice(`Error opening terminal: ${cmdError.message}`);
						}
					});
				}
			});
			return; // Early return since we handle Windows asynchronously
		} else if (platform === 'darwin') {
			// macOS: Use osascript to open Terminal.app
			command = `osascript -e 'tell application "Terminal" to do script "cd \\"${projectPath}\\" && bash"'`;
		} else {
			// Linux: Try common terminals
			const terminals = [
				`gnome-terminal --working-directory="${projectPath}"`,
				`konsole --workdir "${projectPath}"`,
				`xterm -e "cd \\"${projectPath}\\" && bash"`
			];

			// Try each terminal until one works
			const tryTerminal = (index: number) => {
				if (index >= terminals.length) {
					new Notice('No supported terminal found. Please install gnome-terminal, konsole, or xterm.');
					return;
				}

				exec(`which ${terminals[index].split(' ')[0]}`, (error: any) => {
					if (!error) {
						exec(terminals[index], (execError: any) => {
							if (execError && index < terminals.length - 1) {
								tryTerminal(index + 1);
							} else if (execError) {
								new Notice(`Error opening terminal: ${execError.message}`);
							}
						});
					} else {
						tryTerminal(index + 1);
					}
				});
			};

			tryTerminal(0);
			return; // Early return since we handle Linux asynchronously
		}

		// Execute command for macOS
		if (command) {
			exec(command, (error: any) => {
				if (error) {
					new Notice(`Error opening terminal: ${error.message}`);
				}
			});
		}
	} catch (error) {
		new Notice(`Error opening terminal: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/**
 * Open config file in default editor
 * Exported for use by ribbon icons
 */
export async function openConfigFile(app: App, settings: AstroComposerSettings): Promise<void> {
	try {
		const fs = require('fs');
		const path = require('path');
		const { shell } = require('electron');

		// Get the actual vault path string from the adapter
		const vaultPath = (app.vault.adapter as any).basePath || (app.vault.adapter as any).path;
		const vaultPathString = typeof vaultPath === 'string' ? vaultPath : vaultPath.toString();

		// Resolve config file path
		if (!settings.configFilePath || !settings.configFilePath.trim()) {
			new Notice("Please specify a config file path in settings.");
			return;
		}

		// Use custom path relative to vault
		const configPath = path.resolve(vaultPathString, settings.configFilePath);

		// Check if file exists
		if (!fs.existsSync(configPath)) {
			new Notice(`Config file not found at: ${configPath}`);
			return;
		}

		// Use Electron's shell to open the file with the default editor
		await shell.openPath(configPath);
	} catch (error) {
		new Notice(`Error opening config file: ${error instanceof Error ? error.message : String(error)}`);
	}
}