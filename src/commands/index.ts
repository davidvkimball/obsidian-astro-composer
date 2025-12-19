import { Plugin, Editor, MarkdownView, TFile, Notice, App, MarkdownFileInfo, Platform } from "obsidian";
import { AstroComposerSettings, AstroComposerPluginInterface } from "../types";
import { FileOperations } from "../utils/file-operations";
import { TemplateParser } from "../utils/template-parsing";
import { LinkConverter } from "../utils/link-conversion";
import { TitleModal } from "../ui/title-modal";

export function registerCommands(plugin: Plugin, settings: AstroComposerSettings): void {
	// Terminal and config commands are desktop-only - NEVER register on mobile
	// Check Platform.isMobile - if true, these commands must NEVER be registered
	const isMobile = Platform.isMobile;
	
	// If on mobile, absolutely do not register terminal/config commands
	// They use Node.js/Electron APIs that don't exist on mobile
	if (isMobile) {
		// On mobile, only register the safe commands that work on mobile
		const pluginInterface = plugin as unknown as AstroComposerPluginInterface;
		const fileOps = new FileOperations(plugin.app, settings, pluginInterface as AstroComposerPluginInterface & { pluginCreatedFiles?: Set<string> });
		const linkConverter = new LinkConverter(settings, pluginInterface);
		
		// Register only mobile-safe commands
		plugin.addCommand({
			id: "standardize-properties",
			name: "Standardize properties",
			icon: "file-check",
			editorCallback: (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
				const file = ctx instanceof MarkdownView ? ctx.file : ctx.file;
				if (file instanceof TFile) {
					// Get fresh settings from plugin
					const currentSettings = pluginInterface.settings || settings;
					void standardizeProperties(plugin.app, currentSettings, file, pluginInterface);
				}
			},
		});

		plugin.addCommand({
			id: "convert-wikilinks-astro",
			name: "Convert internal links for astro",
			icon: "link-2",
			editorCallback: (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
				const file = ctx instanceof MarkdownView ? ctx.file : ctx.file;
				if (file instanceof TFile) {
					linkConverter.convertWikilinksForAstro(editor, file);
				}
			},
		});

		// Helper function for rename command (mobile version)
		// Uses the same logic as FileOperations.determineType() to ensure consistency
		function hasMatchingContentType(file: TFile, settings: AstroComposerSettings): boolean {
			const type = fileOps.determineType(file);
			// If determineType returns "note", it means no content type matched
			if (type === "note") {
				return false;
			}
			// Check if the matched content type is enabled
			const contentType = fileOps.getContentType(type);
			return contentType !== null && contentType.enabled;
		}

		plugin.addCommand({
			id: "rename-content",
			name: "Rename current content",
			icon: "pencil",
			editorCallback: (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
				const file = ctx instanceof MarkdownView ? ctx.file : ctx.file;
				if (file instanceof TFile) {
					if (!hasMatchingContentType(file, settings)) {
						new Notice("Cannot rename: this file is not part of a configured content type folder.");
						return;
					}
					
					const type = fileOps.determineType(file);
					const cache = plugin.app.metadataCache.getFileCache(file);
					const titleKey = fileOps.getTitleKey(type);
					
					if (!cache?.frontmatter || !(titleKey in cache.frontmatter)) {
						new Notice(`Cannot rename: No ${titleKey} found in properties`);
						return;
					}
					
					new TitleModal(plugin.app, file, plugin as unknown as AstroComposerPluginInterface, type, true).open();
				}
			},
		});

		// DO NOT register terminal or config commands on mobile - return early
		return;
	}
	
	// Desktop: register all commands including terminal and config
	const pluginInterface = plugin as unknown as AstroComposerPluginInterface;


	// Helper function to check if a file matches any configured content type
	// Uses the same logic as FileOperations.determineType() to ensure consistency
	// Gets fresh settings from plugin to ensure we check against current content types
	function hasMatchingContentType(file: TFile, settings: AstroComposerSettings): boolean {
		// Get fresh settings from plugin if available
		const currentSettings = (plugin as unknown as AstroComposerPluginInterface)?.settings || settings;
		// Create a temporary FileOperations with fresh settings
		const tempFileOps = new FileOperations(plugin.app, currentSettings, plugin as unknown as AstroComposerPluginInterface & { pluginCreatedFiles?: Set<string> });
		const type = tempFileOps.determineType(file);
		// If determineType returns "note", it means no content type matched
		if (type === "note") {
			return false;
		}
		// Check if the matched content type is enabled
		const contentType = tempFileOps.getContentType(type);
		return contentType !== null && contentType.enabled;
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
		name: "Convert internal links for astro",
		icon: "link-2",
		editorCallback: (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
			const file = ctx instanceof MarkdownView ? ctx.file : ctx.file;
			if (file instanceof TFile) {
				// Get fresh settings from plugin and create LinkConverter with it
				const currentSettings = pluginInterface.settings || settings;
				const currentLinkConverter = new LinkConverter(currentSettings, pluginInterface);
				currentLinkConverter.convertWikilinksForAstro(editor, file);
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
					// Get fresh settings from plugin
					const currentSettings = pluginInterface.settings || settings;
					// Create FileOperations with fresh settings
					const currentFileOps = new FileOperations(plugin.app, currentSettings, pluginInterface as AstroComposerPluginInterface & { pluginCreatedFiles?: Set<string> });
					
					// Check if this file matches any configured content type
					if (!hasMatchingContentType(file, currentSettings)) {
						new Notice("Cannot rename: this file is not part of a configured content type folder.");
						return;
					}
					
					// Determine content type from folder structure
					const type = currentFileOps.determineType(file);
					
					// Always open the modal - it will handle files without frontmatter or title key
					// If there's no title in frontmatter, the modal will use the filename as fallback
					// and the rename will proceed with kebab-case version of what user types
					new TitleModal(plugin.app, file, pluginInterface, type, true).open();
				}
			},
		});

	// Open Terminal command (desktop only - not available on mobile)
	if (!isMobile) {
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
	}

	// Edit Config File command (desktop only - not available on mobile)
	if (!isMobile) {
		plugin.addCommand({
			id: "edit-astro-config",
			name: "Edit astro config",
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
}

async function standardizeProperties(app: App, settings: AstroComposerSettings, file: TFile, plugin?: AstroComposerPluginInterface): Promise<void> {
	// Get fresh settings from plugin if available
	const currentSettings = plugin?.settings || settings;
	const templateParser = new TemplateParser(app, currentSettings);
	const fileOps = new FileOperations(app, currentSettings, plugin);
	
	// Determine content type using the existing logic
	const type = fileOps.determineType(file);
	
	// Check if this file has a valid content type (not just "note")
	if (type === "note") {
		new Notice("No properties template specified for this content. This file doesn't match any configured content type folders.");
		return;
	}
	
	let templateString: string;
	
	// Determine template based on content type
	if (type === "note") {
		new Notice("No properties template specified for this content. This file doesn't match any configured content type folders.");
		return;
	}
	
	const contentType = fileOps.getContentType(type);
	if (!contentType) {
		new Notice("Content type not found.");
		return;
	}
	
	templateString = contentType.template;

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

	// Helper function to check if file matches content type
	// Uses the same logic as FileOperations.determineType() to ensure consistency
	function hasMatchingContentType(file: TFile, settings: AstroComposerSettings): boolean {
		const type = fileOps.determineType(file);
		// If determineType returns "note", it means no content type matched
		if (type === "note") {
			return false;
		}
		// Check if the matched content type is enabled
		const contentType = fileOps.getContentType(type);
		return contentType !== null && contentType.enabled;
	}

	if (!hasMatchingContentType(file, settings)) {
		new Notice("Cannot rename: this file is not part of a configured content type folder.");
		return;
	}

	const type = fileOps.determineType(file);
	
	// Always open the modal - it will handle files without frontmatter or title key
	// If there's no title in frontmatter, the modal will use the filename as fallback
	// and the rename will proceed with kebab-case version of what user types
	new TitleModal(app, file, plugin, type, true).open();
}

/**
 * Open terminal in project root directory
 * Exported for use by ribbon icons
 */
export async function openTerminalInProjectRoot(app: App, settings: AstroComposerSettings): Promise<void> {
	try {
		// eslint-disable-next-line import/no-nodejs-modules, @typescript-eslint/no-require-imports, no-undef
		const { exec } = require('child_process') as { exec: (command: string, callback: (error: { message?: string } | null) => void) => void };
		// eslint-disable-next-line import/no-nodejs-modules, @typescript-eslint/no-require-imports, no-undef
		const path = require('path') as { resolve: (...args: string[]) => string };
		// eslint-disable-next-line import/no-nodejs-modules, @typescript-eslint/no-require-imports, no-undef
		const fs = require('fs') as { existsSync: (path: string) => boolean };

		// Get the actual vault path string from the adapter
		const adapter = app.vault.adapter as unknown as { basePath?: string; path?: string };
		const vaultPath = adapter.basePath || adapter.path;
		const vaultPathString = typeof vaultPath === 'string' ? vaultPath : String(vaultPath);

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

		// eslint-disable-next-line no-undef
		const platform = process.platform;
		let command: string;

		if (platform === 'win32') {
			// Windows: Try Windows Terminal first, fallback to cmd
			exec('where wt', (error: { message?: string } | null) => {
				if (!error) {
					// Windows Terminal is available
					exec(`wt -d "${projectPath}"`, (execError: { message?: string } | null) => {
						if (execError) {
							// Fallback to cmd
							exec(`cmd /k cd /d "${projectPath}"`, (cmdError: { message?: string } | null) => {
								if (cmdError) {
									new Notice(`Error opening terminal: ${cmdError.message || 'Unknown error'}`);
								}
							});
						}
					});
				} else {
					// Fallback to cmd
					exec(`cmd /k cd /d "${projectPath}"`, (cmdError: { message?: string } | null) => {
						if (cmdError) {
							new Notice(`Error opening terminal: ${cmdError.message || 'Unknown error'}`);
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

				exec(`which ${terminals[index].split(' ')[0]}`, (error: { message?: string } | null) => {
					if (!error) {
						exec(terminals[index], (execError: { message?: string } | null) => {
							if (execError && index < terminals.length - 1) {
								tryTerminal(index + 1);
							} else if (execError) {
								new Notice(`Error opening terminal: ${execError.message || 'Unknown error'}`);
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
			exec(command, (error: { message?: string } | null) => {
				if (error) {
					new Notice(`Error opening terminal: ${error.message || 'Unknown error'}`);
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
		// eslint-disable-next-line import/no-nodejs-modules, @typescript-eslint/no-require-imports, no-undef
		const fs = require('fs') as { existsSync: (path: string) => boolean };
		// eslint-disable-next-line import/no-nodejs-modules, @typescript-eslint/no-require-imports, no-undef
		const path = require('path') as { resolve: (...args: string[]) => string };
		// eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef
		const { shell } = require('electron') as { shell: { openPath: (path: string) => Promise<string> } };

		// Get the actual vault path string from the adapter
		const adapter = app.vault.adapter as unknown as { basePath?: string; path?: string };
		const vaultPath = adapter.basePath || adapter.path;
		const vaultPathString = typeof vaultPath === 'string' ? vaultPath : String(vaultPath);

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