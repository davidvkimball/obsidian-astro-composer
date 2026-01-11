import { Plugin, Editor, MarkdownView, TFile, Notice, App, MarkdownFileInfo, Platform, TFolder } from "obsidian";
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
					void standardizeProperties(plugin.app, currentSettings, file, pluginInterface, editor);
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
				void standardizeProperties(plugin.app, settings, file, plugin as unknown as AstroComposerPluginInterface, editor);
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
			callback: () => {
				const currentSettings = (plugin as unknown as AstroComposerPluginInterface).settings;
				if (!currentSettings.enableOpenTerminalCommand) {
					new Notice("Open terminal command is disabled. Enable it in settings to use this command.");
					return;
				}
				openTerminalInProjectRoot(plugin.app, currentSettings);
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

async function standardizeProperties(app: App, settings: AstroComposerSettings, file: TFile, plugin?: AstroComposerPluginInterface, editor?: Editor): Promise<void> {
	// Get fresh settings from plugin if available
	const currentSettings = plugin?.settings || settings;
	const templateParser = new TemplateParser(app, currentSettings);
	const fileOps = new FileOperations(app, currentSettings, plugin);
	
	// Preserve cursor position if editor is provided
	let cursorPosition: { line: number; ch: number } | null = null;
	let originalContent = "";
	if (editor) {
		const cursor = editor.getCursor();
		cursorPosition = { line: cursor.line, ch: cursor.ch };
		originalContent = editor.getValue();
	}
	
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
	
	// Generate slug from title for slug property auto-population
	const slug = fileOps.toKebabCase(title);
	
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
			} else {
				// For non-array values, check if it's slug and needs auto-population
				if (key === "slug") {
					const existingSlug = parsed.properties[key][0] || "";
					// Only auto-populate if slug is empty or missing
					if (!existingSlug || existingSlug.trim() === "") {
						finalProps[key] = [slug];
					}
					// If slug has a value, preserve it (don't overwrite)
				}
				// For other non-array values, keep existing value (don't overwrite)
			}
		}
	}
	
	// Also check if slug property exists in frontmatter but is empty (even if not in template)
	// Only auto-populate if template has {{slug}} placeholder
	if ("slug" in parsed.properties && templateString.includes("{{slug}}")) {
		const existingSlug = parsed.properties["slug"][0] || "";
		if (!existingSlug || existingSlug.trim() === "") {
			// Slug exists but is empty, and template has {{slug}} - auto-populate it
			finalProps["slug"] = [slug];
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
	
	// Restore cursor position if editor was provided and file is still open
	if (editor && cursorPosition) {
		// Wait for Obsidian to reload the file in the editor
		await new Promise(resolve => setTimeout(resolve, 50));
		
		// Try to get the active editor for this file
		const activeView = app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView && activeView.file === file && activeView.editor) {
			const activeEditor = activeView.editor;
			const newLineCount = newContent.split('\n').length;
			const originalLineCount = originalContent.split('\n').length;
			
			// Calculate new cursor position
			let newLine = cursorPosition.line;
			let newCh = cursorPosition.ch;
			
			// Adjust for content changes
			if (newLineCount !== originalLineCount) {
				// If lines were added/removed, adjust line number
				if (newLine >= newLineCount) {
					newLine = Math.max(0, newLineCount - 1);
				}
			}
			
			// Adjust column position if line length changed
			const newLineLength = newContent.split('\n')[newLine]?.length || 0;
			if (newCh > newLineLength) {
				newCh = Math.max(0, newLineLength);
			}
			
			// Restore cursor position
			activeEditor.setCursor({ line: newLine, ch: newCh });
		}
	}
	
	new Notice("Properties standardized using template.");
}

/**
 * Rename a file by path (for programmatic use, e.g., from other plugins)
 * This allows the rename modal to appear without opening the file first
 */
export function renameContentByPath(
	app: App,
	filePath: string,
	settings: AstroComposerSettings,
	plugin: AstroComposerPluginInterface
): void {
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
 * Register commands for each enabled content type
 * Each command creates a new file in the content type's folder and opens the TitleModal
 */
export function registerContentTypeCommands(plugin: Plugin, settings: AstroComposerSettings): void {
	const pluginInterface = plugin as unknown as AstroComposerPluginInterface;
	const contentTypes = settings.contentTypes || [];
	
	// Register a command for each enabled content type
	for (const contentType of contentTypes) {
		if (!contentType.enabled) {
			continue; // Skip disabled content types
		}
		
		const commandId = `create-content-type-${contentType.id}`;
		const commandName = `Create new content type: ${contentType.name}`;
		
		plugin.addCommand({
			id: commandId,
			name: commandName,
			callback: async () => {
				// Determine target folder from content type (or vault root if blank)
				let targetFolder = contentType.folder || "";
				
				// Create folder if it doesn't exist and is specified
				if (targetFolder && targetFolder.trim() !== "") {
					const folder = plugin.app.vault.getAbstractFileByPath(targetFolder);
					if (!(folder instanceof TFolder)) {
						try {
							await plugin.app.vault.createFolder(targetFolder);
						} catch (error) {
							const errorMessage = error instanceof Error ? error.message : String(error);
							new Notice(`Failed to create folder: ${errorMessage}`);
							return;
						}
					}
				}
				
				// Create a temporary file in the target folder
				const tempFileName = "Untitled.md";
				const filePath = targetFolder ? `${targetFolder}/${tempFileName}` : tempFileName;
				
				// Check if file already exists (unlikely but possible)
				const existingFile = plugin.app.vault.getAbstractFileByPath(filePath);
				if (existingFile instanceof TFile) {
					// If file exists, use it directly
					new TitleModal(plugin.app, existingFile, pluginInterface, contentType.id, false, true).open();
					return;
				}
				
				// Mark that this file will be created by the plugin
				// This prevents the create event from triggering another modal
				if (pluginInterface && 'pluginCreatedFiles' in pluginInterface) {
					const pluginWithFiles = pluginInterface as { pluginCreatedFiles?: Set<string> };
					if (!pluginWithFiles.pluginCreatedFiles) {
						pluginWithFiles.pluginCreatedFiles = new Set<string>();
					}
					pluginWithFiles.pluginCreatedFiles.add(filePath);
				}
				
				try {
					// Create the temporary file
					const tempFile = await plugin.app.vault.create(filePath, "");
					
					// Open the TitleModal with the file, content type ID, and isNewNote flag
					new TitleModal(plugin.app, tempFile, pluginInterface, contentType.id, false, true).open();
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : String(error);
					new Notice(`Failed to create file: ${errorMessage}`);
					
					// Clean up the tracking if file creation failed
					if (pluginInterface && 'pluginCreatedFiles' in pluginInterface) {
						const pluginWithFiles = pluginInterface as { pluginCreatedFiles?: Set<string> };
						pluginWithFiles.pluginCreatedFiles?.delete(filePath);
					}
				}
			},
		});
	}
}

/**
 * Debug logger for terminal commands
 */
const terminalLogger = {
	enabled: false,
	setEnabled(value: boolean) {
		this.enabled = value;
	},
	log(...args: unknown[]) {
		if (this.enabled) {
			console.debug("[astro-composer:terminal]", ...args);
		}
	}
};

/**
 * Get default terminal application name based on platform
 */
function getDefaultTerminalApp(): string {
	if (!Platform.isDesktopApp) {
		return "";
	}
	if (Platform.isMacOS) {
		return "Terminal";
	}
	if (Platform.isWin) {
		return "cmd.exe";
	}
	if (Platform.isLinux) {
		return "gnome-terminal";
	}
	return "";
}

/**
 * Sanitize terminal application name (trim whitespace)
 */
function sanitizeTerminalApp(value: string): string {
	return value.trim();
}

/**
 * Escape double quotes in a string
 */
function escapeDoubleQuotes(value: string): string {
	return value.replace(/"/g, '\\"');
}

/**
 * Open terminal in project root directory
 * Exported for use by ribbon icons
 */
export function openTerminalInProjectRoot(app: App, settings: AstroComposerSettings): void {
	// Update logger state
	terminalLogger.setEnabled(settings.enableTerminalDebugLogging);

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

		// Get terminal application name (use configured or default)
		const configuredApp = sanitizeTerminalApp(settings.terminalApplicationName || "");
		const terminalApp = configuredApp || getDefaultTerminalApp();

		// Warn if terminal app name is empty (but still try to use defaults)
		if (!configuredApp && !terminalApp) {
			new Notice("Terminal application name is empty. Please configure it in settings.");
			return;
		}

		// eslint-disable-next-line no-undef
		const platform = process.platform;
		terminalLogger.log("Opening terminal", { platform, terminalApp, projectPath });

		if (platform === 'win32') {
			// Windows: Use start command with configurable terminal
			const escapedPath = projectPath.replace(/"/g, '"');
			const lowerApp = terminalApp.toLowerCase();

			if (lowerApp === "wt.exe" || lowerApp === "wt" || lowerApp === "windows terminal") {
				// Windows Terminal
				exec('where wt', (error: { message?: string } | null) => {
					if (!error) {
						const command = `start "" wt.exe -d "${escapedPath}"`;
						terminalLogger.log("Windows launch (wt)", { command, projectPath });
						exec(command, (execError: { message?: string } | null) => {
							if (execError) {
								terminalLogger.log("Windows Terminal failed, falling back to cmd", { error: execError.message });
								// Fallback to cmd
								const fallbackCommand = `start "" cmd.exe /K "cd /d "${escapedPath}""`;
								exec(fallbackCommand, (cmdError: { message?: string } | null) => {
									if (cmdError) {
										new Notice(`Error opening terminal: ${cmdError.message || 'Unknown error'}`);
									}
								});
							}
						});
					} else {
						// Windows Terminal not found, fallback to cmd
						terminalLogger.log("Windows Terminal not found, using cmd", {});
						const fallbackCommand = `start "" cmd.exe /K "cd /d "${escapedPath}""`;
						exec(fallbackCommand, (cmdError: { message?: string } | null) => {
							if (cmdError) {
								new Notice(`Error opening terminal: ${cmdError.message || 'Unknown error'}`);
							}
						});
					}
				});
			} else if (lowerApp === "powershell" || lowerApp === "powershell.exe") {
				// PowerShell
				const escapedPathForPS = projectPath.replace(/'/g, "''");
				const command = `start "" powershell -NoExit -Command "Set-Location '${escapedPathForPS}';"`;
				terminalLogger.log("Windows launch (powershell)", { command, projectPath });
				exec(command, (error: { message?: string } | null) => {
					if (error) {
						new Notice(`Error opening terminal: ${error.message || 'Unknown error'}`);
					}
				});
			} else if (lowerApp === "cmd.exe" || lowerApp === "cmd") {
				// Command Prompt
				const command = `start "" cmd.exe /K "cd /d "${escapedPath}""`;
				terminalLogger.log("Windows launch (cmd)", { command, projectPath });
				exec(command, (error: { message?: string } | null) => {
					if (error) {
						new Notice(`Error opening terminal: ${error.message || 'Unknown error'}`);
					}
				});
			} else {
				// Generic terminal - try to launch it directly
				const command = `start "" "${terminalApp}"`;
				terminalLogger.log("Windows launch (generic)", { command, terminalApp, projectPath });
				exec(command, (error: { message?: string } | null) => {
					if (error) {
						// Fallback to cmd if generic launch fails
						terminalLogger.log("Generic terminal failed, falling back to cmd", { error: error.message });
						const fallbackCommand = `start "" cmd.exe /K "cd /d "${escapedPath}""`;
						exec(fallbackCommand, (cmdError: { message?: string } | null) => {
							if (cmdError) {
								new Notice(`Error opening terminal: ${cmdError.message || 'Unknown error'}`);
							}
						});
					}
				});
			}
		} else if (platform === 'darwin') {
			// macOS: Use open -a (simpler than osascript)
			const escapedApp = escapeDoubleQuotes(terminalApp);
			const escapedPath = escapeDoubleQuotes(projectPath);
			const command = `open -na "${escapedApp}" "${escapedPath}"`;
			terminalLogger.log("macOS launch", { command, terminalApp, projectPath });
			exec(command, (error: { message?: string } | null) => {
				if (error) {
					new Notice(`Error opening terminal: ${error.message || 'Unknown error'}`);
				}
			});
		} else {
			// Linux: Try configurable terminal with fallback chain
			const terminals = terminalApp ? [terminalApp] : ["gnome-terminal", "konsole", "xterm"];
			const projectPathEscaped = projectPath.replace(/"/g, '\\"');

			// Try each terminal until one works
			const tryTerminal = (index: number) => {
				if (index >= terminals.length) {
					new Notice('No supported terminal found. Please install a terminal application or configure one in settings.');
					return;
				}

				const currentTerminal = terminals[index];
				const terminalName = currentTerminal.split(' ')[0];

				// Check if terminal exists
				exec(`which ${terminalName}`, (error: { message?: string } | null) => {
					if (!error) {
						// Terminal found, try to launch it
						let command: string;
						if (currentTerminal.includes("gnome-terminal")) {
							command = `gnome-terminal --working-directory="${projectPathEscaped}"`;
						} else if (currentTerminal.includes("konsole")) {
							command = `konsole --workdir "${projectPathEscaped}"`;
						} else {
							// Generic terminal
							command = `${currentTerminal} -e "cd \\"${projectPathEscaped}\\" && bash"`;
						}
						terminalLogger.log("Linux launch", { command, terminal: currentTerminal, projectPath });
						exec(command, (execError: { message?: string } | null) => {
							if (execError && index < terminals.length - 1) {
								terminalLogger.log("Terminal launch failed, trying next", { terminal: currentTerminal, error: execError.message });
								tryTerminal(index + 1);
							} else if (execError) {
								new Notice(`Error opening terminal: ${execError.message || 'Unknown error'}`);
							}
						});
					} else {
						// Terminal not found, try next
						terminalLogger.log("Terminal not found, trying next", { terminal: currentTerminal });
						tryTerminal(index + 1);
					}
				});
			};

			tryTerminal(0);
		}
	} catch (error) {
		terminalLogger.log("Unexpected error", { error });
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