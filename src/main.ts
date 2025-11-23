import {
	Plugin,
	TFile,
	Notice,
	setIcon,
} from "obsidian";

import { AstroComposerSettings, DEFAULT_SETTINGS, CONSTANTS } from "./settings";
import { AstroComposerPluginInterface } from "./types";
import { registerCommands, renameContentByPath as renameContentByPathFunction, openTerminalInProjectRoot, openConfigFile } from "./commands";
import { AstroComposerSettingTab } from "./ui/settings-tab";
import { TitleModal } from "./ui/title-modal";
import { FileOperations } from "./utils/file-operations";
import { TemplateParser } from "./utils/template-parsing";
import { HeadingLinkGenerator } from "./utils/heading-link-generator";

export default class AstroComposerPlugin extends Plugin implements AstroComposerPluginInterface {
	settings!: AstroComposerSettings;
	private createEvent!: (file: TFile) => void;
	private fileOps!: FileOperations;
	private templateParser!: TemplateParser;
	private headingLinkGenerator!: HeadingLinkGenerator;
	private pluginCreatedFiles: Set<string> = new Set();
	private terminalRibbonIcon: HTMLElement | null = null;
	private configRibbonIcon: HTMLElement | null = null;
	private ribbonContextMenuStyleEl?: HTMLStyleElement;
	private ribbonContextMenuObserver?: MutationObserver;
	private helpButtonObserver?: MutationObserver;
	private helpButtonElement?: HTMLElement;
	private customHelpButton?: HTMLElement;
	private helpButtonStyleEl?: HTMLStyleElement;

	async onload() {
		await this.loadSettings();

		// Initialize utilities
		this.fileOps = new FileOperations(this.app, this.settings, this as unknown as AstroComposerPluginInterface & { pluginCreatedFiles?: Set<string> });
		this.templateParser = new TemplateParser(this.app, this.settings);
		this.headingLinkGenerator = new HeadingLinkGenerator(this.settings);

		// Wait for the vault to be fully loaded before registering the create event
		this.app.workspace.onLayoutReady(() => {
			this.registerCreateEvent();
			// Initialize help button replacement
			this.updateHelpButton();
		});

		// Register commands
		registerCommands(this, this.settings);

		// Add settings tab
		this.addSettingTab(new AstroComposerSettingTab(this.app, this));

		// Register context menu for copy heading links
		this.registerContextMenu();

		// Register ribbon icons if enabled
		this.registerRibbonIcons();
		
		// Setup ribbon context menu handling
		this.setupRibbonContextMenuHandling();
	}


	public registerCreateEvent() {

		// Register create event for automation
		const hasCustomContentTypes = this.settings.customContentTypes.some(ct => ct.enabled);
		const shouldUseCreateEvent = this.settings.automatePostCreation || this.settings.enablePages || hasCustomContentTypes;
		
		if (shouldUseCreateEvent) {
			// Debounce to prevent multiple modals from rapid file creations
			let lastProcessedTime = 0;

			this.createEvent = (file: TFile) => {
				void (async () => {
				const now = Date.now();
				if (now - lastProcessedTime < CONSTANTS.DEBOUNCE_MS) {
					return; // Skip if within debounce period
				}
				lastProcessedTime = now;

				if (file instanceof TFile && file.extension === "md") {
					const filePath = file.path;

					// Skip if this file was created by the plugin itself
					if (this.pluginCreatedFiles.has(filePath)) {
						this.pluginCreatedFiles.delete(filePath); // Clean up
						return;
					}

					// Check folder restrictions FIRST - only proceed if file is in a relevant folder
					const postsFolder = this.settings.postsFolder || "";
					const pagesFolder = this.settings.enablePages ? (this.settings.pagesFolder || "") : "";
					let isPage = false;
					let customTypeId: string | null = null;
					let shouldProcess = false;

					// Check exclusions FIRST - before any content type matching
					// Only check exclusions when Posts folder is specified (when exclusions make sense)
					let isExcluded = false;
					if (postsFolder && this.settings.excludedDirectories) {
						const excludedDirs = this.settings.excludedDirectories.split("|").map(dir => dir.trim()).filter(dir => dir);
						for (const excludedDir of excludedDirs) {
							// Check if the file is in the excluded directory (exact path match only)
							if (filePath === excludedDir || filePath.startsWith(excludedDir + "/")) {
								isExcluded = true;
								break;
							}
						}
					}

					// If file is excluded, skip entirely
					if (isExcluded) {
						return;
					}

					// Check for folder conflicts only if the file is in a conflicting location
					const fileDir = file.parent?.path || "";
					const isInVaultRoot = fileDir === "" || fileDir === "/";
					
					// Find which content types would process this file
					const applicableContentTypes: string[] = [];
					
					// Check if file would be processed as post
					if (this.settings.automatePostCreation) {
						if (!postsFolder && isInVaultRoot) {
							applicableContentTypes.push("Posts");
						} else if (postsFolder && (filePath.startsWith(postsFolder + "/") || filePath === postsFolder)) {
							applicableContentTypes.push("Posts");
						}
					}
					
					// Check if file would be processed as page
					if (this.settings.enablePages) {
						if (!pagesFolder && isInVaultRoot) {
							applicableContentTypes.push("Pages");
						} else if (pagesFolder && (filePath.startsWith(pagesFolder + "/") || filePath === pagesFolder)) {
							applicableContentTypes.push("Pages");
						}
					}
					
					// Check if file would be processed as custom content type
					for (const customType of this.settings.customContentTypes) {
						if (customType.enabled) {
							if (!customType.folder && isInVaultRoot) {
								applicableContentTypes.push(customType.name || "Custom Content");
							} else if (customType.folder && (filePath.startsWith(customType.folder + "/") || filePath === customType.folder)) {
								applicableContentTypes.push(customType.name || "Custom Content");
							}
						}
					}
					
					// Only show conflict if multiple content types would process this specific file
					if (applicableContentTypes.length > 1) {
						new Notice(`⚠️ Folder conflict detected! Multiple content types (${applicableContentTypes.join(", ")}) would process this file. Please specify different folders in settings.`);
						return;
					}

					// Check custom content types first
					for (const customType of this.settings.customContentTypes) {
						if (customType.enabled) {
							if (customType.folder && 
								(filePath.startsWith(customType.folder + "/") || filePath === customType.folder)) {
								customTypeId = customType.id;
								shouldProcess = true;
								break;
							} else if (!customType.folder) {
								// Custom content type folder is blank - treat all files as this type
								customTypeId = customType.id;
								shouldProcess = true;
								break;
							}
						}
					}

					if (!customTypeId) {
						// Check if it's a page (automation is automatic when pages are enabled)
						if (this.settings.enablePages) {
							if (pagesFolder && (filePath.startsWith(pagesFolder + "/") || filePath === pagesFolder)) {
								isPage = true;
								shouldProcess = true;
							} else if (!pagesFolder && isInVaultRoot) {
								// Pages folder is blank - only treat files in vault root as pages
								isPage = true;
								shouldProcess = true;
							}
						}
					}

					// Check posts folder - but only if not already matched as page or custom content type
					if (!shouldProcess && this.settings.automatePostCreation) {
						// Only process as post if meets posts folder criteria
						if (postsFolder) {
							// Posts folder is specified
							if (this.settings.onlyAutomateInPostsFolder) {
								// Only automate in posts folder and one level down
								const pathDepth = filePath.split("/").length;
								const postsDepth = postsFolder.split("/").length;
								
								if (filePath.startsWith(postsFolder + "/") || filePath === postsFolder) {
									// Allow files in posts folder and exactly one level down
									if (pathDepth <= postsDepth + 1) {
										shouldProcess = true;
									}
								}
							} else {
								// Normal automation - check if file is in posts folder
								if (filePath.startsWith(postsFolder + "/") || filePath === postsFolder) {
									shouldProcess = true;
								}
							}
						} else {
							// Posts folder is blank - treat all files as posts (like pages)
							shouldProcess = true;
						}
					}


					// If not in any relevant folder, skip entirely
					if (!shouldProcess) {
						return;
					}

					// Check if file is newly created by user (recent creation time)
					const stat = await this.app.vault.adapter.stat(file.path);
					const isNewNote = stat?.mtime && (now - stat.mtime < CONSTANTS.STAT_MTIME_THRESHOLD);

					// Skip if not a user-initiated new note
					if (!isNewNote) {
						return;
					}

					// Check if file already has properties that look like they were created by another plugin
					const cache = this.app.metadataCache.getFileCache(file);
					if (cache?.frontmatter) {
						// If it already has properties, it might have been created by another plugin
						// Only proceed if it's very basic properties (like just a title)
						const frontmatterKeys = Object.keys(cache.frontmatter);
						if (frontmatterKeys.length > 1 || !frontmatterKeys.includes('title')) {
							// This looks like it was created by another plugin with a full template
							return;
						}
					}

					// Show the appropriate modal
					if (customTypeId) {
						new TitleModal(this.app, file, this, customTypeId).open();
					} else if (isPage) {
						new TitleModal(this.app, file, this, "page").open();
					} else {
						// This is a post
						new TitleModal(this.app, file, this, "post").open();
					}
				}
				})();
			};
			// Use vault.create event to detect new file creation
			this.registerEvent(this.app.vault.on("create", (file) => {
				if (file instanceof TFile) {
					this.createEvent(file);
				}
			}));
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private registerContextMenu() {
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu, editor, view) => {
				// Only show menu if the feature is enabled
				if (!this.settings.enableCopyHeadingLink) {
					return;
				}

				const cursor = editor.getCursor();
				const file = view.file;
				
				if (!(file instanceof TFile)) {
					return;
				}

				// Find the heading at the current cursor position
				const heading = this.headingLinkGenerator.findHeadingAtLine(this.app, file, cursor.line);
				
				if (heading) {
					const fullLink = this.headingLinkGenerator.generateLink(this.app, file, heading);
					const urlOnly = this.headingLinkGenerator.extractUrl(fullLink);
					
					// Option 1: Copy URL only (for CTRL+K workflow)
					menu.addItem((item) => {
						item
							.setTitle('Copy heading link')
							.setIcon('link-2')
							.onClick(async () => {
								await navigator.clipboard.writeText(urlOnly);
								new Notice('Heading link copied to clipboard');
							});
					});
					
					// Option 2: Copy full link with text (for standalone pasting)
					menu.addItem((item) => {
						item
							.setTitle('Copy heading link with text')
							.setIcon('heading')
							.onClick(async () => {
								await navigator.clipboard.writeText(fullLink);
								new Notice('Heading link with text copied to clipboard');
							});
					});
				}
			})
		);
	}

	/**
	 * Rename a file by path (for programmatic use, e.g., from other plugins)
	 * This allows the rename modal to appear without opening the file first
	 */
	async renameContentByPath(filePath: string): Promise<void> {
		await renameContentByPathFunction(this.app, filePath, this.settings, this);
	}

	public registerRibbonIcons() {
		// Calculate what should exist FIRST (before DOM search)
		const terminalRibbonEnabled = this.settings.enableTerminalRibbonIcon === true;
		const terminalCommandEnabled = this.settings.enableOpenTerminalCommand === true;
		const terminalShouldExist = terminalRibbonEnabled && terminalCommandEnabled;

		const configRibbonEnabled = this.settings.enableConfigRibbonIcon === true;
		const configCommandEnabled = this.settings.enableOpenConfigFileCommand === true;
		const configShouldExist = configRibbonEnabled && configCommandEnabled;

		// ALWAYS remove all icons first, regardless of state - this ensures clean slate
		// Remove from our references first
		if (this.terminalRibbonIcon) {
			try {
				if (this.terminalRibbonIcon.parentNode) {
					this.terminalRibbonIcon.remove();
				}
			} catch (e) {
				// Silently handle errors
			}
			this.terminalRibbonIcon = null;
		}
		
		if (this.configRibbonIcon) {
			try {
				if (this.configRibbonIcon.parentNode) {
					this.configRibbonIcon.remove();
				}
			} catch (e) {
				// Silently handle errors
			}
			this.configRibbonIcon = null;
		}
		
		// Search DOM and remove ALL instances of our icons (by aria-label)
		// This catches any icons that might exist but aren't tracked
		try {
			// ALWAYS remove ALL terminal icons, regardless of settings
			const terminalIcons = document.querySelectorAll('.side-dock-ribbon-action[aria-label="Open project terminal"]');
			terminalIcons.forEach((icon: Element) => icon.remove());
			
			// ALWAYS remove ALL config icons, regardless of settings
			const configIcons = document.querySelectorAll('.side-dock-ribbon-action[aria-label="Edit Astro config"]');
			configIcons.forEach((icon: Element) => icon.remove());
		} catch (e) {
			// Silently handle errors
		}

		// Now add only the icons that should exist
		if (terminalShouldExist) {
			// Only add if icon doesn't exist in DOM
			const existingTerminal = document.querySelector('.side-dock-ribbon-action[aria-label="Open project terminal"]');
			if (!existingTerminal) {
				this.terminalRibbonIcon = this.addRibbonIcon('terminal-square', 'Open project terminal', async () => {
					if (!this.settings.enableOpenTerminalCommand) {
						new Notice("Open terminal command is disabled. Enable it in settings to use this command.");
						return;
					}
					await openTerminalInProjectRoot(this.app, this.settings);
				});
				// Add data attribute to identify our icon
				if (this.terminalRibbonIcon) {
					this.terminalRibbonIcon.setAttribute('data-astro-composer-terminal-ribbon', 'true');
				}
			} else {
				this.terminalRibbonIcon = existingTerminal as HTMLElement;
			}
			
			// Immediately check and remove config icon if it was re-added
			if (!configShouldExist) {
				const configIcons = document.querySelectorAll('.side-dock-ribbon-action[aria-label="Edit Astro config"]');
				if (configIcons.length > 0) {
					configIcons.forEach((icon: Element) => icon.remove());
					this.configRibbonIcon = null;
				}
			}
		} else {
			this.terminalRibbonIcon = null;
		}

		if (configShouldExist) {
			// Only add if icon doesn't exist in DOM
			const existingConfig = document.querySelector('.side-dock-ribbon-action[aria-label="Edit Astro config"]');
			if (!existingConfig) {
				this.configRibbonIcon = this.addRibbonIcon('wrench', 'Edit Astro config', async () => {
					if (!this.settings.enableOpenConfigFileCommand) {
						new Notice("Edit config file command is disabled. Enable it in settings to use this command.");
						return;
					}
					await openConfigFile(this.app, this.settings);
				});
				// Add data attribute to identify our icon
				if (this.configRibbonIcon) {
					this.configRibbonIcon.setAttribute('data-astro-composer-config-ribbon', 'true');
				}
			} else {
				this.configRibbonIcon = existingConfig as HTMLElement;
			}
			
			// Immediately check and remove terminal icon if it was re-added
			if (!terminalShouldExist) {
				const terminalIcons = document.querySelectorAll('.side-dock-ribbon-action[aria-label="Open project terminal"]');
				if (terminalIcons.length > 0) {
					terminalIcons.forEach((icon: Element) => icon.remove());
					this.terminalRibbonIcon = null;
				}
			}
		} else {
			this.configRibbonIcon = null;
		}
		
		// Update context menu handling after icons are registered
		this.updateRibbonContextMenuCSS();
		this.setupRibbonContextMenuObserver();
		
		// Final cleanup pass - ensure no unwanted icons exist in DOM
		setTimeout(() => {
			if (!terminalShouldExist) {
				const terminalIcons = document.querySelectorAll('.side-dock-ribbon-action[aria-label="Open project terminal"]');
				terminalIcons.forEach((icon: Element) => icon.remove());
				this.terminalRibbonIcon = null;
			}
			if (!configShouldExist) {
				const configIcons = document.querySelectorAll('.side-dock-ribbon-action[aria-label="Edit Astro config"]');
				configIcons.forEach((icon: Element) => icon.remove());
				this.configRibbonIcon = null;
			}
		}, 100);
	}

	onunload() {
		// Clean up ribbon icons
		if (this.terminalRibbonIcon) {
			this.terminalRibbonIcon.remove();
			this.terminalRibbonIcon = null;
		}
		if (this.configRibbonIcon) {
			this.configRibbonIcon.remove();
			this.configRibbonIcon = null;
		}
		
		// Cleanup ribbon context menu handling
		if (this.ribbonContextMenuObserver) {
			this.ribbonContextMenuObserver.disconnect();
			this.ribbonContextMenuObserver = undefined;
		}
		
		if (this.ribbonContextMenuStyleEl) {
			this.ribbonContextMenuStyleEl.remove();
			this.ribbonContextMenuStyleEl = undefined;
		}

		// Cleanup help button replacement
		if (this.helpButtonObserver) {
			this.helpButtonObserver.disconnect();
			this.helpButtonObserver = undefined;
		}

		if (this.helpButtonStyleEl) {
			this.helpButtonStyleEl.remove();
			this.helpButtonStyleEl = undefined;
		}

		if (this.customHelpButton) {
			this.customHelpButton.remove();
			this.customHelpButton = undefined;
		}

		this.helpButtonElement = undefined;
	}

	// Ribbon context menu handling - based on Astro Modular Settings approach
	private setupRibbonContextMenuHandling() {
		this.updateRibbonContextMenuCSS();
		this.setupRibbonContextMenuObserver();
	}

	private updateRibbonContextMenuCSS() {
		// Remove existing style if any
		if (this.ribbonContextMenuStyleEl) {
			this.ribbonContextMenuStyleEl.remove();
		}

		// Check if either icon should be hidden
		const terminalShouldBeHidden = !this.settings.enableTerminalRibbonIcon || !this.settings.enableOpenTerminalCommand;
		const configShouldBeHidden = !this.settings.enableConfigRibbonIcon || !this.settings.enableOpenConfigFileCommand;

		// Only add CSS if icons should be hidden
		if (terminalShouldBeHidden || configShouldBeHidden) {
			// Create style element to hide our ribbon icons from context menu
			this.ribbonContextMenuStyleEl = document.createElement('style');
			this.ribbonContextMenuStyleEl.id = 'astro-composer-hide-ribbon-context-menu';
			let cssRules = '';
			
			if (terminalShouldBeHidden) {
				cssRules += `
					/* Hide terminal icon from context menu when disabled */
					.menu-item:has(svg[data-lucide="terminal-square"]),
					.menu-item:has(.lucide-terminal-square),
					.menu-item .menu-item-icon:has(svg[data-lucide="terminal-square"]),
					.menu-item .menu-item-icon:has(.lucide-terminal-square) {
						display: none !important;
					}
				`;
			}
			
			if (configShouldBeHidden) {
				cssRules += `
					/* Hide config icon from context menu when disabled */
					.menu-item:has(svg[data-lucide="wrench"]),
					.menu-item:has(.lucide-wrench),
					.menu-item .menu-item-icon:has(svg[data-lucide="wrench"]),
					.menu-item .menu-item-icon:has(.lucide-wrench) {
						display: none !important;
					}
				`;
			}
			
			this.ribbonContextMenuStyleEl.textContent = cssRules;
			document.head.appendChild(this.ribbonContextMenuStyleEl);
		}
	}

	private setupRibbonContextMenuObserver() {
		// Disconnect existing observer if any
		if (this.ribbonContextMenuObserver) {
			this.ribbonContextMenuObserver.disconnect();
		}

		// Check if we need to hide any icons
		const terminalShouldBeHidden = !this.settings.enableTerminalRibbonIcon || !this.settings.enableOpenTerminalCommand;
		const configShouldBeHidden = !this.settings.enableConfigRibbonIcon || !this.settings.enableOpenConfigFileCommand;

		// Only set up observer if any icon should be hidden
		if (!terminalShouldBeHidden && !configShouldBeHidden) {
			return;
		}

		// Watch for context menu creation and remove our items
		this.ribbonContextMenuObserver = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				if (mutation.addedNodes.length > 0) {
					// Check if a menu was added
					for (const node of Array.from(mutation.addedNodes)) {
						if (node instanceof HTMLElement) {
							// Check if it's a menu
							if (node.classList.contains('menu') || node.querySelector('.menu')) {
								this.removeRibbonIconsFromContextMenu(node);
							}
						}
					}
				}
			}
		});

		// Observe the document body for menu additions
		this.ribbonContextMenuObserver.observe(document.body, {
			childList: true,
			subtree: true,
		});
	}

	private updateHelpButtonCSS() {
		// Remove existing style if any
		if (this.helpButtonStyleEl) {
			this.helpButtonStyleEl.remove();
		}

		// Only add CSS if replacement is enabled
		if (this.settings.helpButtonReplacement?.enabled) {
			// Create style element to hide help button globally
			// Use unique ID to avoid conflicts with other plugins
			this.helpButtonStyleEl = document.createElement('style');
			this.helpButtonStyleEl.id = 'astro-composer-hide-help-button';
			this.helpButtonStyleEl.textContent = `
				.workspace-drawer-vault-actions .clickable-icon:has(svg.help) {
					display: none !important;
				}
			`;
			document.head.appendChild(this.helpButtonStyleEl);
		}
	}

	public async updateHelpButton() {
		// Temporarily disconnect observer to prevent infinite loops
		if (this.helpButtonObserver) {
			this.helpButtonObserver.disconnect();
		}

		// Ensure we have the latest settings
		await this.loadSettings();

		// Update CSS first (this will hide the help button globally)
		this.updateHelpButtonCSS();

		try {
			// Check if replacement is enabled
			if (!this.settings.helpButtonReplacement?.enabled) {
				this.restoreHelpButton();
				return;
			}

			// Find the help button
			const vaultActions = document.querySelector('.workspace-drawer-vault-actions');
			if (!vaultActions) {
				return;
			}

			// Find the help button - it's the first clickable-icon that contains an SVG with class "help"
			const clickableIcons = Array.from(vaultActions.querySelectorAll('.clickable-icon'));
			let helpButton: HTMLElement | null = null;
			
			for (const icon of clickableIcons) {
				const svg = icon.querySelector('svg.help');
				if (svg) {
					helpButton = icon as HTMLElement;
					break;
				}
			}
			
			if (!helpButton) {
				return;
			}

			// Store reference to the button
			this.helpButtonElement = helpButton;

			// Remove existing custom button if it exists (always recreate to update icon/command)
			// Check if it's actually in the DOM and has our identifier before trying to remove it
			if (this.customHelpButton && 
				this.customHelpButton.parentElement && 
				document.body.contains(this.customHelpButton) &&
				this.customHelpButton.hasAttribute('data-astro-composer-help-replacement')) {
				this.customHelpButton.remove();
			}
			this.customHelpButton = undefined;

			// Create a new custom button
			const customButton = helpButton.cloneNode(true) as HTMLElement;
			customButton.style.display = '';
			customButton.removeAttribute('aria-label'); // Remove any existing aria-label
			
			// Add unique identifier to avoid conflicts with other plugins
			customButton.setAttribute('data-astro-composer-help-replacement', 'true');
			customButton.classList.add('astro-composer-help-replacement');
			
			// Clear any existing click handlers
			customButton.onclick = null;
			
			// Replace the icon using Obsidian's setIcon function
			const iconContainer = customButton.querySelector('svg')?.parentElement || customButton;
			try {
				setIcon(iconContainer as HTMLElement, this.settings.helpButtonReplacement.iconId);
			} catch (error) {
				console.warn('[Astro Composer] Error setting icon:', error);
			}

			// Add our custom click handler
			customButton.addEventListener('click', async (evt: MouseEvent) => {
				evt.preventDefault();
				evt.stopPropagation();
				
				const commandId = this.settings.helpButtonReplacement?.commandId;
				if (commandId) {
					try {
						await (this.app as any).commands.executeCommandById(commandId);
					} catch (error) {
						console.warn('[Astro Composer] Error executing command:', error);
						new Notice(`Failed to execute command: ${commandId}`);
					}
				}
			}, true); // Use capture phase to ensure we handle it first

			// Insert the custom button right after the original (hidden) button
			helpButton.parentElement?.insertBefore(customButton, helpButton.nextSibling);
			
			// Store reference to custom button
			this.customHelpButton = customButton;
		} finally {
			// Reconnect observer after a delay
			setTimeout(() => {
				if (this.settings.helpButtonReplacement?.enabled) {
					this.setupHelpButtonObserver();
				}
			}, 1000);
		}
	}

	private setupHelpButtonObserver() {
		// Disconnect existing observer if any
		if (this.helpButtonObserver) {
			this.helpButtonObserver.disconnect();
		}

		// Only set up observer if replacement is enabled
		if (!this.settings.helpButtonReplacement?.enabled) {
			return;
		}

		// Watch for changes to the vault profile area only (more targeted)
		let updateTimeout: number | null = null;
		this.helpButtonObserver = new MutationObserver(() => {
			// Debounce updates to prevent infinite loops
			if (updateTimeout) {
				clearTimeout(updateTimeout);
			}
			updateTimeout = window.setTimeout(() => {
				// Check if help button was recreated (CSS will hide it, but we need to inject our custom button)
				const vaultActions = document.querySelector('.workspace-drawer-vault-actions');
				if (!vaultActions) return;
				
			// Check if we have a custom button AND it's still in the DOM
			// The reference might exist but the button could have been removed
			// Also verify it has our unique identifier to avoid conflicts with other plugins
			const customButtonExists = this.customHelpButton && 
				this.customHelpButton.parentElement && 
				document.body.contains(this.customHelpButton) &&
				this.customHelpButton.hasAttribute('data-astro-composer-help-replacement');
			
			if (!customButtonExists) {
				// Clear stale reference if button was removed or doesn't have our identifier
				if (this.customHelpButton && (!document.body.contains(this.customHelpButton) || 
					!this.customHelpButton.hasAttribute('data-astro-composer-help-replacement'))) {
					this.customHelpButton = undefined;
				}
				this.updateHelpButton();
			}
			}, 100); // Shorter debounce for better responsiveness
		});

		// Observe the vault actions area more specifically
		const vaultActions = document.querySelector('.workspace-drawer-vault-actions');
		if (vaultActions) {
			this.helpButtonObserver.observe(vaultActions, {
				childList: true,
				subtree: true, // Watch subtree to catch when buttons are recreated
			});
		}
		
		// Also observe the parent vault profile area
		const vaultProfile = document.querySelector('.workspace-sidedock-vault-profile');
		if (vaultProfile) {
			this.helpButtonObserver.observe(vaultProfile, {
				childList: true,
				subtree: false,
			});
		}
	}

	private restoreHelpButton() {
		// Remove CSS that hides help button
		if (this.helpButtonStyleEl) {
			this.helpButtonStyleEl.remove();
			this.helpButtonStyleEl = undefined;
		}

		// Remove the custom button
		if (this.customHelpButton) {
			this.customHelpButton.remove();
			this.customHelpButton = undefined;
		}

		// Clear stored references
		this.helpButtonElement = undefined;
	}

	private removeRibbonIconsFromContextMenu(menuElement: HTMLElement) {
		const terminalShouldBeHidden = !this.settings.enableTerminalRibbonIcon || !this.settings.enableOpenTerminalCommand;
		const configShouldBeHidden = !this.settings.enableConfigRibbonIcon || !this.settings.enableOpenConfigFileCommand;

		// Find all menu items
		const menuItems = menuElement.querySelectorAll('.menu-item');
		for (const item of Array.from(menuItems)) {
			// Check if this menu item contains our icons
			const svg = item.querySelector('svg');
			if (svg) {
				const iconName = svg.getAttribute('data-lucide') || 
					svg.getAttribute('xmlns:lucide') ||
					(svg.classList.contains('lucide-terminal-square') ? 'terminal-square' : null) ||
					(svg.classList.contains('lucide-wrench') ? 'wrench' : null);
				
				// Remove terminal icon if it should be hidden
				if (terminalShouldBeHidden && iconName === 'terminal-square') {
					const itemText = item.textContent?.toLowerCase() || '';
					if (itemText.includes('terminal') || itemText.includes('project terminal')) {
						item.remove();
					}
				}
				
				// Remove config icon if it should be hidden
				if (configShouldBeHidden && iconName === 'wrench') {
					const itemText = item.textContent?.toLowerCase() || '';
					if (itemText.includes('config') || itemText.includes('astro config')) {
						item.remove();
					}
				}
			}
		}
	}
}
