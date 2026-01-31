import { App, PluginSettingTab, Setting, Platform, setIcon } from "obsidian";
import { Plugin } from "obsidian";
import { ContentType, AstroComposerPluginInterface, AstroComposerSettings } from "../types";
import { CommandPickerModal } from "./components/CommandPickerModal";
import { IconPickerModal } from "./components/IconPickerModal";
import { ConfirmModal } from "./components/ConfirmModal";
import { createSettingsGroup } from "../utils/settings-compat";
import { registerContentTypeCommands } from "../commands";

export class AstroComposerSettingTab extends PluginSettingTab {
	plugin: AstroComposerPluginInterface;
	public icon = 'lucide-pencil-line';
	autoRenameContainer: HTMLElement | null = null;
	postsFolderContainer: HTMLElement | null = null;
	onlyAutomateContainer: HTMLElement | null = null;
	creationModeContainer: HTMLElement | null = null;
	indexFileContainer: HTMLElement | null = null;
	excludedDirsContainer: HTMLElement | null = null;
	underscorePrefixContainer: HTMLElement | null = null;
	autoInsertContainer: HTMLElement | null = null;
	pagesFieldsContainer: HTMLElement | null = null;
	pagesIndexFileContainer: HTMLElement | null = null;
	pagesOnlyAutomateContainer: HTMLElement | null = null;
	terminalCommandContainer: HTMLElement | null = null;
	configCommandContainer: HTMLElement | null = null;
	customContentTypesContainer: HTMLElement | null = null;
	terminalRibbonToggle: Setting | null = null;
	configRibbonToggle: Setting | null = null;
	private terminalRibbonToggleComponent: { setDisabled: (disabled: boolean) => void } | null = null;
	private configRibbonToggleComponent: { setDisabled: (disabled: boolean) => void } | null = null;

	constructor(app: App, plugin: Plugin) {
		super(app, plugin);
		this.plugin = plugin as unknown as AstroComposerPluginInterface;
	}

	/**
	 * Refresh just the content types section
	 * More efficient than refreshing the entire settings tab
	 */
	public refreshContentTypes(): void {
		if (this.customContentTypesContainer) {
			this.renderCustomContentTypes();
		}
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// Use current plugin settings (already loaded and up-to-date)
		// Always read fresh settings to ensure we show migrated content types immediately
		const settings = this.plugin.settings;

		// Render the settings tab with current settings
		// This will show all content types including newly migrated ones
		this.renderSettingsTab(containerEl, settings);
	}

	private renderSettingsTab(containerEl: HTMLElement, settings: AstroComposerSettings): void {

		// Global settings (first group - no heading)
		const generalGroup = createSettingsGroup(containerEl, undefined, 'astro-composer');
		generalGroup.addSetting((setting) => {
			setting
				.setName("Date format")
				// Date format codes (MMMM, yyyy, etc.) are technical notation, not UI text
				.setDesc("Format for the date in properties (e.g., yyyy-mm-dd, MMMM D, yyyy, yyyy-mm-dd HH:mm)")
				.addText((text) =>
					text
						// "YYYY-MM-DD" is a date format placeholder, not UI text
						.setPlaceholder("YYYY-MM-DD")
						.setValue(settings.dateFormat)
						.onChange(async (value: string) => {
							settings.dateFormat = value || "YYYY-MM-DD";
							await this.plugin.saveSettings();
						})
				);
		});

		generalGroup.addSetting((setting) => {
			setting
				.setName("Enable copy heading links")
				.setDesc("Add right-click context menu option to copy heading links in various formats.")
				.addToggle((toggle) =>
					toggle
						.setValue(settings.enableCopyHeadingLink)
						.onChange(async (value: boolean) => {
							settings.enableCopyHeadingLink = value;
							await this.plugin.saveSettings();
							this.updateCopyHeadingFields();
						})
				);
		});

		generalGroup.addSetting((setting) => {
			setting
				.setName("Default heading link format")
				// "Astro" is a proper noun (framework name) and should be capitalized
				.setDesc("Choose the default format for copied heading links. Obsidian format respects your Obsidian settings for wikilink vs markdown preference. Astro link uses your link base path from above and converts the heading into kebab-case format as an anchor link")
				.addDropdown((dropdown) =>
					dropdown
						.addOption("obsidian", "Obsidian link")
						.addOption("astro", "Astro link")
						.setValue(settings.copyHeadingLinkFormat)
						.onChange(async (value: string) => {
							settings.copyHeadingLinkFormat = value as "obsidian" | "astro";
							await this.plugin.saveSettings();
						})
				);
			// Add conditional visibility classes - keep setting in group
			setting.settingEl.classList.toggle("astro-composer-setting-container-visible", settings.enableCopyHeadingLink);
			setting.settingEl.classList.toggle("astro-composer-setting-container-hidden", !settings.enableCopyHeadingLink);
		});

		generalGroup.addSetting((setting) => {
			setting
				.setName("Add trailing slash to links")
				.setDesc("Add trailing slashes to all converted internal links (e.g., /about/ instead of /about).")
				.addToggle((toggle) =>
					toggle
						.setValue(settings.addTrailingSlashToLinks)
						.onChange(async (value: boolean) => {
							settings.addTrailingSlashToLinks = value;
							await this.plugin.saveSettings();
						})
				);
		});

		generalGroup.addSetting((setting) => {
			setting
				.setName("Process background file changes")
				// Technical terms like "Obsidian", "git" are proper nouns in this context
				.setDesc("Automatically process new files when they're changed in the background (by Git or other plugins). Disable to prevent modal spam when files are already processed on other devices during a sync.")
				.addToggle((toggle) =>
					toggle
						.setValue(settings.processBackgroundFileChanges)
						.onChange(async (value: boolean) => {
							settings.processBackgroundFileChanges = value;
							await this.plugin.saveSettings();
						})
				);
		});

		generalGroup.addSetting((setting) => {
			setting
				// "MDX" is a proper noun (file format) and should be capitalized
				.setName("Show MDX files in file explorer")
				.setDesc("Make .mdx files visible in Obsidian's file explorer. Requires reload to take effect.")
				.addToggle((toggle) =>
					toggle
						.setValue(settings.showMdxFilesInExplorer)
						.onChange(async (value: boolean) => {
							settings.showMdxFilesInExplorer = value;
							await this.plugin.saveSettings();
						})
				);
		});

		// Auto-insert properties (global setting)
		generalGroup.addSetting((setting) => {
			setting
				.setName("Auto-insert properties")
				.setDesc("Automatically insert the properties template when creating new files for any content type.")
				.addToggle((toggle) =>
					toggle
						.setValue(settings.autoInsertProperties)
						.onChange(async (value: boolean) => {
							settings.autoInsertProperties = value;
							await this.plugin.saveSettings();
						})
				);
		});

		// Content types
		const contentTypesGroup = createSettingsGroup(containerEl, "Content types", 'astro-composer');

		// Add container as a setting - hide the setting's default UI, add our container inside
		contentTypesGroup.addSetting((setting) => {
			// Hide the setting's default UI elements using CSS classes
			setting.settingEl.addClass("astro-composer-setting-hidden-elements");
			setting.settingEl.addClass("astro-composer-setting-container-full-width");
			// Add our container inside the setting element - ensure it's visible
			this.customContentTypesContainer = setting.settingEl.createDiv({
				cls: "custom-content-types-container astro-composer-custom-types-container-visible"
			});
		});
		// Render content types after container is created
		if (this.customContentTypesContainer) {
			this.renderCustomContentTypes();
		}

		// Developer commands (desktop only - not available on mobile)
		if (!Platform.isMobile) {
			const developerGroup = createSettingsGroup(containerEl, "Developer commands", 'astro-composer');

			// Terminal command settings
			developerGroup.addSetting((setting) => {
				setting
					.setName("Enable open terminal command")
					.setDesc("Enable command to open terminal in project root directory.")
					.addToggle((toggle) =>
						toggle
							.setValue(settings.enableOpenTerminalCommand)
							.onChange(async (value: boolean) => {
								settings.enableOpenTerminalCommand = value;
								await this.plugin.saveSettings();
								this.updateTerminalCommandFields();
								// registerRibbonIcons checks both command and icon settings
								// If command is enabled AND icon is enabled, it will show; otherwise it will hide
								if (this.plugin.registerRibbonIcons) {
									this.plugin.registerRibbonIcons();
								}
							})
					);
			});

			// Create container for terminal command fields - keep for backward compatibility with update methods
			this.terminalCommandContainer = containerEl.createDiv({ cls: "terminal-command-fields" });
			this.terminalCommandContainer.classList.toggle("astro-composer-setting-container-visible", settings.enableOpenTerminalCommand);
			this.terminalCommandContainer.classList.toggle("astro-composer-setting-container-hidden", !settings.enableOpenTerminalCommand);

			developerGroup.addSetting((setting) => {
				const descFragment = document.createDocumentFragment();
				// Text is already in sentence case; "Obsidian" is a proper noun
				descFragment.createEl("div", { text: "Path relative to the Obsidian vault root folder. Use ../.. for two levels up. Leave blank to use the vault folder" });
				descFragment.createEl("div", { text: "This is where the terminal will open. Absolute paths work also." });
				setting
					.setName("Project root directory path")
					.setDesc(descFragment)
					.addText((text) =>
						text
							.setPlaceholder("../..")
							.setValue(settings.terminalProjectRootPath)
							.onChange(async (value: string) => {
								settings.terminalProjectRootPath = value;
								await this.plugin.saveSettings();
							})
					);
				// Add class for conditional visibility - keep setting in group
				setting.settingEl.classList.toggle("astro-composer-setting-container-visible", settings.enableOpenTerminalCommand);
				setting.settingEl.classList.toggle("astro-composer-setting-container-hidden", !settings.enableOpenTerminalCommand);
			});

			developerGroup.addSetting((setting) => {
				const descFragment = document.createDocumentFragment();
				// Text is already in sentence case; proper nouns or product names like "macOS", "Windows", "Linux"
				descFragment.createEl("div", { text: "Leave blank to use platform defaults. On macOS, the default is Terminal. On Windows, it's Windows Terminal (Win 11) or cmd.exe (Win 10). On Linux, it's gnome-terminal, konsole, or xterm" });
				// Text is already in sentence case; proper nouns like "Terminal", "iTerm", "PowerShell"
				descFragment.createEl("div", { text: "Examples include Terminal, iTerm, PowerShell, and Alacritty" });
				setting
					.setName("Terminal application name")
					.setDesc(descFragment)
					.addText((text) =>
						text
							.setPlaceholder("Terminal")
							.setValue(settings.terminalApplicationName)
							.onChange(async (value: string) => {
								settings.terminalApplicationName = value;
								await this.plugin.saveSettings();
							})
					);
				// Add class for conditional visibility - keep setting in group
				setting.settingEl.classList.toggle("astro-composer-setting-container-visible", settings.enableOpenTerminalCommand);
				setting.settingEl.classList.toggle("astro-composer-setting-container-hidden", !settings.enableOpenTerminalCommand);
			});

			developerGroup.addSetting((setting) => {
				setting
					.setName("Enable debug logging")
					.setDesc("Log terminal launch commands and platform decisions to the developer console for troubleshooting.")
					.addToggle((toggle) =>
						toggle
							.setValue(settings.enableTerminalDebugLogging)
							.onChange(async (value: boolean) => {
								settings.enableTerminalDebugLogging = value;
								await this.plugin.saveSettings();
							})
					);
				// Add class for conditional visibility - keep setting in group
				setting.settingEl.classList.toggle("astro-composer-setting-container-visible", settings.enableOpenTerminalCommand);
				setting.settingEl.classList.toggle("astro-composer-setting-container-hidden", !settings.enableOpenTerminalCommand);
			});

			developerGroup.addSetting((setting) => {
				setting
					.setName("Show open terminal ribbon icon")
					.setDesc("Add a ribbon icon to launch the terminal command.")
					.addToggle((toggle) => {
						this.terminalRibbonToggleComponent = toggle;
						toggle
							.setValue(settings.enableTerminalRibbonIcon)
							.setDisabled(!settings.enableOpenTerminalCommand)
							.onChange(async (value: boolean) => {
								// Update settings directly on plugin instance
								this.plugin.settings.enableTerminalRibbonIcon = value;
								settings.enableTerminalRibbonIcon = value;
								await this.plugin.saveSettings();
								// Small delay to ensure settings are saved, then re-register
								setTimeout(() => {
									if (this.plugin.registerRibbonIcons) {
										this.plugin.registerRibbonIcons();
									}
								}, 50);
							});
					});
				// Add class for conditional visibility - keep setting in group
				setting.settingEl.classList.toggle("astro-composer-setting-container-visible", settings.enableOpenTerminalCommand);
				setting.settingEl.classList.toggle("astro-composer-setting-container-hidden", !settings.enableOpenTerminalCommand);
				// Store reference for updating disabled state
				this.terminalRibbonToggle = setting;
			});

			// Config file command settings
			developerGroup.addSetting((setting) => {
				setting
					.setName("Enable edit config file command")
					.setDesc("Enable command to open astro config file in default editor.")
					.addToggle((toggle) =>
						toggle
							.setValue(settings.enableOpenConfigFileCommand)
							.onChange(async (value: boolean) => {
								settings.enableOpenConfigFileCommand = value;
								await this.plugin.saveSettings();
								this.updateConfigCommandFields();
								// registerRibbonIcons checks both command and icon settings
								// If command is enabled AND icon is enabled, it will show; otherwise it will hide
								if (this.plugin.registerRibbonIcons) {
									this.plugin.registerRibbonIcons();
								}
							})
					);
			});

			// Create container for config command fields - keep for backward compatibility with update methods
			this.configCommandContainer = containerEl.createDiv({ cls: "config-command-fields" });
			this.configCommandContainer.classList.toggle("astro-composer-setting-container-visible", settings.enableOpenConfigFileCommand);
			this.configCommandContainer.classList.toggle("astro-composer-setting-container-hidden", !settings.enableOpenConfigFileCommand);

			developerGroup.addSetting((setting) => {
				const descFragment = document.createDocumentFragment();
				descFragment.createEl("div", { text: "Path to the config file relative to the vault root. Use ../config.ts or ../../astro.config.mjs." });
				descFragment.createEl("div", { text: "Absolute paths work also." });
				setting
					.setName("Config file path")
					.setDesc(descFragment)
					.addText((text) =>
						text
							.setPlaceholder("../config.ts")
							.setValue(settings.configFilePath)
							.onChange(async (value: string) => {
								settings.configFilePath = value;
								await this.plugin.saveSettings();
							})
					);
				// Add class for conditional visibility - keep setting in group
				setting.settingEl.classList.toggle("astro-composer-setting-container-visible", settings.enableOpenConfigFileCommand);
				setting.settingEl.classList.toggle("astro-composer-setting-container-hidden", !settings.enableOpenConfigFileCommand);
			});

			developerGroup.addSetting((setting) => {
				setting
					.setName("Show open config ribbon icon")
					.setDesc("Add a ribbon icon to launch the config file command.")
					.addToggle((toggle) => {
						this.configRibbonToggleComponent = toggle;
						toggle
							.setValue(settings.enableConfigRibbonIcon)
							.setDisabled(!settings.enableOpenConfigFileCommand)
							.onChange(async (value: boolean) => {
								// Update settings directly on plugin instance
								this.plugin.settings.enableConfigRibbonIcon = value;
								settings.enableConfigRibbonIcon = value;
								await this.plugin.saveSettings();
								// Small delay to ensure settings are saved, then re-register
								setTimeout(() => {
									if (this.plugin.registerRibbonIcons) {
										this.plugin.registerRibbonIcons();
									}
								}, 50);
							});
					});
				// Add class for conditional visibility - keep setting in group
				setting.settingEl.classList.toggle("astro-composer-setting-container-visible", settings.enableOpenConfigFileCommand);
				setting.settingEl.classList.toggle("astro-composer-setting-container-hidden", !settings.enableOpenConfigFileCommand);
				// Store reference for updating disabled state
				this.configRibbonToggle = setting;
			});

			// Help button replacement toggle (part of developer commands group)
			developerGroup.addSetting((setting) => {
				setting
					.setName('Swap out help button for custom action')
					.setDesc('Replace the help button in the vault profile area with a custom action.')
					.addToggle(toggle => toggle
						.setValue(settings.helpButtonReplacement?.enabled ?? false)
						.onChange(async (value) => {
							if (!settings.helpButtonReplacement) {
								settings.helpButtonReplacement = {
									enabled: false,
									commandId: 'edit-astro-config',
									iconId: 'wrench',
								};
							}
							settings.helpButtonReplacement.enabled = value;
							await this.plugin.saveSettings();
							// Trigger help button replacement update (it will reload settings)
							if (this.plugin.updateHelpButton) {
								await this.plugin.updateHelpButton();
							}
							// Re-render to show/hide options
							this.display();
						}));
			});

			// Show command and icon pickers only if enabled (part of developer commands group)
			if (settings.helpButtonReplacement?.enabled) {
				// Command picker
				const commandName = this.getCommandName(settings.helpButtonReplacement.commandId);
				developerGroup.addSetting((setting) => {
					setting
						.setName('Command')
						.setDesc('Select the command to execute when the button is clicked.')
						.addButton(button => button
							.setButtonText(commandName || 'Select command')
							.onClick(() => {
								const modal = new CommandPickerModal(this.app, (commandId) => {
									void (async () => {
										if (!settings.helpButtonReplacement) {
											settings.helpButtonReplacement = {
												enabled: true,
												commandId: 'edit-astro-config',
												iconId: 'wrench',
											};
										}
										settings.helpButtonReplacement.commandId = commandId;
										await this.plugin.saveSettings();
										// Trigger help button replacement update immediately (it will reload settings)
										if (this.plugin.updateHelpButton) {
											await this.plugin.updateHelpButton();
										}
										// Re-render to show updated command name
										this.display();
									})();
								});
								modal.open();
							}));
				});

				// Icon picker
				const iconName = this.getIconName(settings.helpButtonReplacement.iconId);
				developerGroup.addSetting((setting) => {
					setting
						.setName('Icon')
						.setDesc('Select the icon to display on the button.')
						.addButton(button => button
							.setButtonText(iconName || 'Select icon...')
							.onClick(() => {
								const modal = new IconPickerModal(this.app, (iconId) => {
									void (async () => {
										if (!settings.helpButtonReplacement) {
											settings.helpButtonReplacement = {
												enabled: true,
												commandId: 'edit-astro-config',
												iconId: 'wrench',
											};
										}
										settings.helpButtonReplacement.iconId = iconId;
										await this.plugin.saveSettings();
										// Trigger help button replacement update immediately (it will reload settings)
										if (this.plugin.updateHelpButton) {
											await this.plugin.updateHelpButton();
										}
										// Re-render to show updated icon name
										this.display();
									})();
								});
								modal.open();
							}));
				});
			}
		}

		this.updateCopyHeadingFields();
		// Only update terminal/config fields if not on mobile
		if (!Platform.isMobile) {
			this.updateTerminalCommandFields();
			this.updateConfigCommandFields();
		}
	}


	updateCopyHeadingFields() {
		const settings = this.plugin.settings;
		const isVisible = settings.enableCopyHeadingLink;

		// Update the "Default heading link format" setting element visibility
		const containerEl = this.containerEl;
		const allSettings = containerEl.querySelectorAll('.setting-item');
		allSettings.forEach((settingEl) => {
			const nameEl = settingEl.querySelector('.setting-item-name');
			if (nameEl && nameEl.textContent?.trim() === "Default heading link format") {
				settingEl.classList.toggle("astro-composer-setting-container-visible", isVisible);
				settingEl.classList.toggle("astro-composer-setting-container-hidden", !isVisible);
			}
		});
	}

	updateTerminalCommandFields() {
		const settings = this.plugin.settings;
		const isVisible = settings.enableOpenTerminalCommand;

		// Update container for backward compatibility
		if (this.terminalCommandContainer) {
			this.terminalCommandContainer.classList.toggle("astro-composer-setting-container-visible", isVisible);
			this.terminalCommandContainer.classList.toggle("astro-composer-setting-container-hidden", !isVisible);
		}

		// Update individual setting elements that are in the group
		// Find settings by their name text content
		const containerEl = this.containerEl;
		const allSettings = containerEl.querySelectorAll('.setting-item');
		allSettings.forEach((settingEl) => {
			const nameEl = settingEl.querySelector('.setting-item-name');
			if (nameEl) {
				const name = nameEl.textContent?.trim();
				if (name === "Project root directory path" || name === "Show open terminal ribbon icon") {
					settingEl.classList.toggle("astro-composer-setting-container-visible", isVisible);
					settingEl.classList.toggle("astro-composer-setting-container-hidden", !isVisible);
				}
			}
		});

		// Update ribbon toggle disabled state using the toggle component
		if (this.terminalRibbonToggleComponent) {
			this.terminalRibbonToggleComponent.setDisabled(!this.plugin.settings.enableOpenTerminalCommand);
		}
	}

	updateConfigCommandFields() {
		const settings = this.plugin.settings;
		const isVisible = settings.enableOpenConfigFileCommand;

		// Update container for backward compatibility
		if (this.configCommandContainer) {
			this.configCommandContainer.classList.toggle("astro-composer-setting-container-visible", isVisible);
			this.configCommandContainer.classList.toggle("astro-composer-setting-container-hidden", !isVisible);
		}

		// Update individual setting elements that are in the group
		// Find settings by their name text content
		const containerEl = this.containerEl;
		const allSettings = containerEl.querySelectorAll('.setting-item');
		allSettings.forEach((settingEl) => {
			const nameEl = settingEl.querySelector('.setting-item-name');
			if (nameEl) {
				const name = nameEl.textContent?.trim();
				if (name === "Config file path" || name === "Show open config ribbon icon") {
					settingEl.classList.toggle("astro-composer-setting-container-visible", isVisible);
					settingEl.classList.toggle("astro-composer-setting-container-hidden", !isVisible);
				}
			}
		});

		// Update ribbon toggle disabled state using the toggle component
		if (this.configRibbonToggleComponent) {
			this.configRibbonToggleComponent.setDisabled(!this.plugin.settings.enableOpenConfigFileCommand);
		}
	}

	checkForFolderConflicts() {
		const settings = this.plugin.settings;
		const blankFolders: string[] = [];
		const folderConflicts: { [folder: string]: string[] } = {};

		// Check content types
		const contentTypes = settings.contentTypes || [];
		for (const contentType of contentTypes) {
			if (contentType.enabled) {
				if (!contentType.folder || contentType.folder.trim() === "") {
					blankFolders.push(contentType.name || "Content");
				} else {
					if (!folderConflicts[contentType.folder]) {
						folderConflicts[contentType.folder] = [];
					}
					folderConflicts[contentType.folder].push(contentType.name || "Content");
				}
			}
		}

		// Check for conflicts
		// Warning box removed - conflicts are still detected at runtime
	}

	private addCustomContentType() {
		const settings = this.plugin.settings;
		const contentTypes = settings.contentTypes || [];
		const newType: ContentType = {
			id: `content-${Date.now()}`,
			name: `Content ${contentTypes.length + 1}`,
			folder: "",
			linkBasePath: "",
			template: '---\ntitle: "{{title}}"\ndate: {{date}}\n---\n',
			enabled: true,
			creationMode: "file",
			indexFileName: "",
			ignoreSubfolders: false,
			enableUnderscorePrefix: false,
			useMdxExtension: false,
		};
		contentTypes.push(newType);
		settings.contentTypes = contentTypes;
		void this.plugin.saveSettings();
		this.renderCustomContentTypes();
		this.plugin.registerCreateEvent();
		// Re-register content type commands to include the new type
		registerContentTypeCommands(this.plugin as unknown as Plugin, settings);
	}

	private renderCustomContentTypes() {
		if (!this.customContentTypesContainer) return;

		this.customContentTypesContainer.empty();

		// Always read fresh settings from plugin to ensure we have latest data
		// This is critical after migration
		const settings = this.plugin.settings;
		const contentTypes = settings.contentTypes || [];
		contentTypes.forEach((customType: ContentType, index: number) => {
			if (!this.customContentTypesContainer) return;
			const typeContainer = this.customContentTypesContainer.createDiv({
				cls: "custom-content-type-item",
				attr: { "data-type-id": customType.id }
			});

			// Header with controls
			const header = typeContainer.createDiv({ cls: "custom-content-type-header" });
			header.classList.add("astro-composer-custom-type-header");

			// Left side - collapse/expand button
			const collapseButton = header.createEl("button", {
				cls: "astro-composer-collapse-button",
				attr: { "aria-label": "Collapse/expand" }
			});
			const isCollapsed = customType.collapsed ?? false;
			// Always use chevron-down, rotate it when collapsed to point right
			setIcon(collapseButton, "chevron-down");
			if (isCollapsed) {
				collapseButton.classList.add("is-collapsed");
			}
			collapseButton.addEventListener("click", () => {
				void this.toggleContentTypeCollapse(customType.id);
				// Update class after toggle (icon stays the same, just rotates)
				const updatedType = this.plugin.settings.contentTypes.find((ct: ContentType) => ct.id === customType.id);
				if (updatedType) {
					if (updatedType.collapsed) {
						collapseButton.classList.add("is-collapsed");
					} else {
						collapseButton.classList.remove("is-collapsed");
					}
				}
			});

			// Middle left - content type name
			const headerName = header.createDiv({ cls: "astro-composer-header-name" });
			headerName.createEl("div", { text: customType.name || `Content ${index + 1}`, cls: "setting-item-name" });

			// Middle right - up/down buttons (side-by-side)
			const reorderContainer = header.createDiv({ cls: "astro-composer-reorder-buttons" });
			const upButton = reorderContainer.createEl("button", {
				cls: "astro-composer-reorder-button",
				attr: { "aria-label": "Move up" }
			});
			setIcon(upButton, "chevron-up");
			upButton.disabled = index === 0;
			upButton.addEventListener("click", () => {
				void this.moveContentTypeUp(customType.id);
			});

			const downButton = reorderContainer.createEl("button", {
				cls: "astro-composer-reorder-button",
				attr: { "aria-label": "Move down" }
			});
			setIcon(downButton, "chevron-down");
			downButton.disabled = index === contentTypes.length - 1;
			downButton.addEventListener("click", () => {
				void this.moveContentTypeDown(customType.id);
			});

			// Right side - toggle
			const toggleContainer = header.createDiv({ cls: "checkbox-container" });
			if (customType.enabled) {
				toggleContainer.classList.add("is-enabled");
			}

			const toggle = toggleContainer.createEl("input", { type: "checkbox", cls: "checkbox-input" });
			toggle.checked = customType.enabled;

			// Add click event to the container as well
			toggleContainer.addEventListener("click", (e) => {
				void (async () => {
					e.preventDefault();
					const newValue = !customType.enabled;
					customType.enabled = newValue;
					toggle.checked = newValue;

					await this.plugin.saveSettings();
					this.plugin.registerCreateEvent();

					// Update the container class for visual feedback
					if (newValue) {
						toggleContainer.classList.add("is-enabled");
					} else {
						toggleContainer.classList.remove("is-enabled");
					}

					// Update visibility
					this.updateCustomContentTypeVisibility(customType.id, newValue);

					// Re-register content type commands to reflect enabled/disabled state
					registerContentTypeCommands(this.plugin as unknown as Plugin, this.plugin.settings);

					// Conflict checking removed from settings UI
				})();
			});

			// Also add change event as backup
			toggle.addEventListener("change", (e) => {
				void (async () => {
					const value = (e.target as HTMLInputElement).checked;
					customType.enabled = value;
					await this.plugin.saveSettings();
					this.plugin.registerCreateEvent();

					// Update the container class for visual feedback
					if (value) {
						toggleContainer.classList.add("is-enabled");
					} else {
						toggleContainer.classList.remove("is-enabled");
					}

					// Update visibility
					this.updateCustomContentTypeVisibility(customType.id, value);

					// Re-register content type commands to reflect enabled/disabled state
					registerContentTypeCommands(this.plugin as unknown as Plugin, this.plugin.settings);
				})();
			});

			// Settings container that can be collapsed
			const settingsContainer = typeContainer.createDiv({
				cls: "custom-content-type-settings",
				attr: { "data-type-id": customType.id }
			});

			// Set initial visibility state based on enabled and collapsed state
			const initiallyCollapsed = customType.collapsed ?? false;
			const initiallyVisible = customType.enabled && !initiallyCollapsed;
			if (initiallyVisible) {
				settingsContainer.classList.add("astro-composer-setting-container-visible");
			} else {
				settingsContainer.classList.add("astro-composer-setting-container-hidden");
			}

			// Content type name
			const nameContainer = settingsContainer.createDiv();
			new Setting(nameContainer)
				.setName("Content type name")
				.setDesc("Display name for this content type (e.g., 'projects', 'notes', 'tutorials')")
				.addText((text) => {
					text
						.setPlaceholder("Enter content type name")
						.setValue(customType.name)
						.onChange(async (value: string) => {
							customType.name = value;
							await this.plugin.saveSettings();
							// Re-register content type commands to update command name
							registerContentTypeCommands(this.plugin as unknown as Plugin, this.plugin.settings);
						});
				});

			// Folder location
			const folderContainer = settingsContainer.createDiv();
			const folderSetting = new Setting(folderContainer)
				.setName("Folder location")
				.setDesc("Folder path where this content type will be created. Leave blank to use the vault folder. Supports wildcards like directory/* or directory/*/* to match specific folder depths.")
				.addText((text) => {
					text
						.setPlaceholder("Enter folder path (e.g., 'docs', 'docs/*', 'docs/*/*') or leave blank for vault root")
						.setValue(customType.folder)
						.onChange(async (value: string) => {
							customType.folder = value;
							await this.plugin.saveSettings();
							this.plugin.registerCreateEvent();
							this.updateCustomContentTypeIgnoreSubfoldersField(customType.id);
							// Update conflict warnings for all content types (folder change may affect others)
							const allContentTypes = this.plugin.settings.contentTypes || [];
							for (const ct of allContentTypes) {
								this.updateFolderConflictWarning(ct.id, null);
							}
						});
				});

			// Add conflict warning element
			folderContainer.createDiv({ cls: "astro-composer-conflict-warning hidden", attr: { "data-type-id": customType.id } });
			this.updateFolderConflictWarning(customType.id, folderSetting);

			// Ignore subfolders (only show when folder is set)
			const ignoreSubfoldersContainer = settingsContainer.createDiv({ cls: "custom-ignore-subfolders-field" });
			ignoreSubfoldersContainer.setAttribute("data-type-id", customType.id);
			ignoreSubfoldersContainer.classList.toggle("astro-composer-setting-container-visible", !!customType.folder);
			ignoreSubfoldersContainer.classList.toggle("astro-composer-setting-container-hidden", !customType.folder);
			new Setting(ignoreSubfoldersContainer)
				.setName("Ignore subfolders")
				.setDesc("When enabled, automation will only trigger for new .md files within this content type's folder and one level down (for folder-based content). Files in deeper subfolders will be ignored.")
				.addToggle((toggle) =>
					toggle
						.setValue(customType.ignoreSubfolders || false)
						.onChange(async (value: boolean) => {
							customType.ignoreSubfolders = value;
							await this.plugin.saveSettings();
						})
				);

			// Underscore prefix
			const underscorePrefixContainer = settingsContainer.createDiv();
			new Setting(underscorePrefixContainer)
				.setName("Use underscore prefix for drafts")
				.setDesc("Add an underscore prefix (_content-title) to new notes by default when enabled. This hides them from astro, which can be helpful for drafts")
				.addToggle((toggle) =>
					toggle
						.setValue(customType.enableUnderscorePrefix || false)
						.onChange(async (value: boolean) => {
							customType.enableUnderscorePrefix = value;
							await this.plugin.saveSettings();
						})
				);

			// Link base path
			const linkContainer = settingsContainer.createDiv();
			new Setting(linkContainer)
				.setName("Link base path")
				.setDesc("Base path for converted links (e.g., '/projects/', '/notes/tutorials/', leave blank for root /).")
				.addText((text) => {
					text
						.setPlaceholder("Enter link base path")
						.setValue(customType.linkBasePath || "")
						.onChange(async (value: string) => {
							customType.linkBasePath = value;
							await this.plugin.saveSettings();
						});
				});

			// Creation mode
			const creationModeContainer = settingsContainer.createDiv();
			new Setting(creationModeContainer)
				.setName("Creation mode")
				.setDesc("How to create new entries: file-based or folder-based with an index file.")
				.addDropdown((dropdown) =>
					dropdown
						.addOption("file", "File-based (content-title.md)")
						.addOption("folder", "Folder-based (content-title/index.md)")
						.setValue(customType.creationMode)
						.onChange(async (value: string) => {
							customType.creationMode = value as "file" | "folder";
							await this.plugin.saveSettings();
							this.updateCustomContentTypeIndexFileField(customType.id);
						})
				);

			// Use MDX extension
			const useMdxContainer = settingsContainer.createDiv();
			new Setting(useMdxContainer)
				// "MDX" is a proper noun (file format) and should be capitalized
				.setName("Use MDX instead of MD")
				.setDesc("Create files with .mdx extension instead of .md extension.")
				.addToggle((toggle) =>
					toggle
						.setValue(customType.useMdxExtension || false)
						.onChange(async (value: boolean) => {
							customType.useMdxExtension = value;
							await this.plugin.saveSettings();
						})
				);

			// Index file name (only show for folder-based)
			const indexFileContainer = settingsContainer.createDiv({ cls: "custom-index-file-field" });
			indexFileContainer.classList.toggle("astro-composer-setting-container-visible", customType.creationMode === "folder");
			indexFileContainer.classList.toggle("astro-composer-setting-container-hidden", customType.creationMode !== "folder");
			new Setting(indexFileContainer)
				.setName("Index file name")
				.setDesc("Name for index files in folder-based content (without .md extension). Defaults to 'index' if left blank.")
				.addText((text) =>
					text
						.setPlaceholder("Index")
						.setValue(customType.indexFileName)
						.onChange(async (value: string) => {
							customType.indexFileName = value;
							await this.plugin.saveSettings();
						})
				);

			// Template
			const templateContainer = settingsContainer.createDiv();
			new Setting(templateContainer)
				.setName("Properties template")
				.addTextArea((text) => {
					text
						.setPlaceholder('---\ntitle: "{{title}}"\ndate: {{date}}\n---\n')
						.setValue(customType.template)
						.onChange(async (value: string) => {
							customType.template = value;
							await this.plugin.saveSettings();
						});
					text.inputEl.classList.add("astro-composer-template-textarea");
					return text;
				})
				.then((setting) => {
					setting.descEl.empty();
					const descDiv = setting.descEl.createEl("div");
					descDiv.createEl("div", { text: "Template for new files of this content type." });
					descDiv.createEl("div", { text: "Variables include {{title}}, {{date}}, and {{slug}}." });
					descDiv.createEl("div", { text: "Do not wrap {{date}} in quotes as it represents a datetime value, not a string." });
				});

			// Remove button at the bottom (no divider)
			const removeContainer = settingsContainer.createDiv();
			const removeSetting = new Setting(removeContainer)
				.setName("")
				.addButton((button) => {
					button
						.setButtonText("Remove")
						.setWarning()
						.onClick(async () => {
							const contentType = this.plugin.settings.contentTypes.find(ct => ct.id === customType.id);
							const typeName = contentType?.name || "content type";
							const modal = new ConfirmModal(
								this.app,
								`Are you sure you want to remove "${typeName}"? This action cannot be undone.`,
								"Remove",
								"Cancel"
							);
							const confirmed = await modal.waitForResult();
							if (confirmed) {
								await this.removeCustomContentType(customType.id);
							}
						});
				});

			// Hide the divider line for the remove button
			removeSetting.settingEl.classList.add("astro-composer-remove-setting");

			// Set initial visibility (checks both enabled and collapsed state)
			this.updateCustomContentTypeVisibility(customType.id, customType.enabled);
		});

		// Update conflict warnings for all types after rendering (folder changes may affect others)
		contentTypes.forEach((customType: ContentType) => {
			this.updateFolderConflictWarning(customType.id, null);
		});

		// Add floating button for creating new custom content types (no settings background)
		const addButtonContainer = this.customContentTypesContainer.createDiv({ cls: "astro-composer-add-button-container" });
		const addButton = addButtonContainer.createEl("button", {
			cls: "mod-cta",
			text: "Add content type"
		});
		addButton.addEventListener("click", () => {
			this.addCustomContentType();
		});
	}

	private updateCustomContentTypeVisibility(typeId: string, enabled: boolean) {
		const settingsContainer = this.customContentTypesContainer?.querySelector(`[data-type-id="${typeId}"].custom-content-type-settings`) as HTMLElement;
		if (settingsContainer) {
			const contentTypes = this.plugin.settings.contentTypes || [];
			const contentType = contentTypes.find((ct: ContentType) => ct.id === typeId);
			const isCollapsed = contentType?.collapsed ?? false;
			const shouldBeVisible = enabled && !isCollapsed;

			settingsContainer.classList.toggle("astro-composer-setting-container-visible", shouldBeVisible);
			settingsContainer.classList.toggle("astro-composer-setting-container-hidden", !shouldBeVisible);
		}
	}

	private updateCustomContentTypeIndexFileField(typeId: string) {
		const contentTypes = this.plugin.settings.contentTypes || [];
		const customType = contentTypes.find(type => type.id === typeId);
		if (!customType) return;

		const indexFileContainer = this.customContentTypesContainer?.querySelector(`[data-type-id="${typeId}"] .custom-index-file-field`) as HTMLElement;
		if (indexFileContainer) {
			indexFileContainer.classList.toggle("astro-composer-setting-container-visible", customType.creationMode === "folder");
			indexFileContainer.classList.toggle("astro-composer-setting-container-hidden", customType.creationMode !== "folder");
		}
	}

	private updateCustomContentTypeIgnoreSubfoldersField(typeId: string) {
		const contentTypes = this.plugin.settings.contentTypes || [];
		const customType = contentTypes.find(type => type.id === typeId);
		if (!customType) return;

		const ignoreSubfoldersContainer = this.customContentTypesContainer?.querySelector(`[data-type-id="${typeId}"].custom-ignore-subfolders-field`) as HTMLElement;
		if (ignoreSubfoldersContainer) {
			ignoreSubfoldersContainer.classList.toggle("astro-composer-setting-container-visible", !!customType.folder && customType.folder.trim() !== "");
			ignoreSubfoldersContainer.classList.toggle("astro-composer-setting-container-hidden", !customType.folder || customType.folder.trim() === "");
		}
	}

	private updateFolderConflictWarning(typeId: string, setting: Setting | null) {
		const contentTypes = this.plugin.settings.contentTypes || [];
		const currentType = contentTypes.find(type => type.id === typeId);
		if (!currentType) return;

		const conflictWarningEl = this.customContentTypesContainer?.querySelector(`[data-type-id="${typeId}"].astro-composer-conflict-warning`) as HTMLElement;
		if (!conflictWarningEl) return;

		// Find conflicts - other content types with the same folder pattern
		const currentFolder = (currentType.folder || "").trim();
		const conflictingTypes: string[] = [];

		for (const otherType of contentTypes) {
			if (otherType.id === typeId || !otherType.enabled) continue;

			const otherFolder = (otherType.folder || "").trim();

			// Check if folders conflict
			// Both blank = conflict (both match vault root)
			if (currentFolder === "" && otherFolder === "") {
				conflictingTypes.push(otherType.name || "Unnamed");
			}
			// Same folder = conflict
			else if (currentFolder === otherFolder && currentFolder !== "") {
				conflictingTypes.push(otherType.name || "Unnamed");
			}
		}

		if (conflictingTypes.length > 0) {
			conflictWarningEl.removeClass("hidden");
			conflictWarningEl.textContent = `Conflict: ${conflictingTypes.join(", ")} also use${conflictingTypes.length === 1 ? "s" : ""} this folder. More specific patterns will take priority.`;
		} else {
			conflictWarningEl.addClass("hidden");
		}
	}


	private async moveContentTypeUp(typeId: string) {
		const settings = this.plugin.settings;
		const contentTypes = settings.contentTypes || [];
		const currentIndex = contentTypes.findIndex((ct: ContentType) => ct.id === typeId);

		if (currentIndex <= 0) return; // Already at the top

		// Swap with previous item
		[contentTypes[currentIndex], contentTypes[currentIndex - 1]] = [contentTypes[currentIndex - 1], contentTypes[currentIndex]];
		settings.contentTypes = contentTypes;
		await this.plugin.saveSettings();
		this.renderCustomContentTypes();
	}

	private async moveContentTypeDown(typeId: string) {
		const settings = this.plugin.settings;
		const contentTypes = settings.contentTypes || [];
		const currentIndex = contentTypes.findIndex((ct: ContentType) => ct.id === typeId);

		if (currentIndex < 0 || currentIndex >= contentTypes.length - 1) return; // Already at the bottom

		// Swap with next item
		[contentTypes[currentIndex], contentTypes[currentIndex + 1]] = [contentTypes[currentIndex + 1], contentTypes[currentIndex]];
		settings.contentTypes = contentTypes;
		await this.plugin.saveSettings();
		this.renderCustomContentTypes();
	}

	private async toggleContentTypeCollapse(typeId: string) {
		const settings = this.plugin.settings;
		const contentTypes = settings.contentTypes || [];
		const contentType = contentTypes.find((ct: ContentType) => ct.id === typeId);

		if (!contentType) return;

		contentType.collapsed = !contentType.collapsed;
		await this.plugin.saveSettings();
		this.updateCustomContentTypeVisibility(typeId, contentType.enabled);
	}

	private async removeCustomContentType(typeId: string) {
		const settings = this.plugin.settings;
		const contentTypes = settings.contentTypes || [];
		settings.contentTypes = contentTypes.filter((ct: ContentType) => ct.id !== typeId);
		// CRITICAL: Await the save to ensure deletion is persisted before any reloads happen
		await this.plugin.saveSettings();
		this.renderCustomContentTypes();
		this.plugin.registerCreateEvent();
		// Re-register content type commands to remove the deleted type
		registerContentTypeCommands(this.plugin as unknown as Plugin, settings);
	}

	private getCommandName(commandId: string): string {
		if (!commandId) return '';
		try {
			const commandRegistry = (this.app as unknown as { commands?: { listCommands?: () => Array<{ id: string; name: string }>; commands?: Record<string, { id: string; name: string }> } }).commands;

			// Method 1: Try listCommands()
			if (commandRegistry && typeof commandRegistry.listCommands === 'function') {
				try {
					const allCommands = commandRegistry.listCommands();
					const command = allCommands.find((cmd: { id: string; name?: string }) => cmd.id === commandId);
					if (command?.name) {
						return command.name;
					}
				} catch (e) {
					console.warn('[Astro Composer] Error getting command name via listCommands():', e);
				}
			}

			// Method 2: Try accessing the internal commands registry directly
			try {
				const registry = commandRegistry?.commands;
				if (registry && typeof registry === 'object') {
					const command = (registry as Record<string, { name?: string }>)[commandId];
					if (command?.name) {
						return command.name;
					}
				}
			} catch (e) {
				console.warn('[Astro Composer] Error getting command name via registry:', e);
			}
		} catch (e) {
			console.warn('[Astro Composer] Error getting command name:', e);
		}
		// Return empty string if command not found, so it shows "Select command..." placeholder
		return '';
	}

	private getIconName(iconId: string): string {
		if (!iconId) return '';
		// Convert icon ID to a readable name, removing lucide- prefix if present
		return iconId
			.replace(/^lucide-/, '') // Remove lucide- prefix
			.split('-')
			.map(word => word.charAt(0).toUpperCase() + word.slice(1))
			.join(' ');
	}
}
