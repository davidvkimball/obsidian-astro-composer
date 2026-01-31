import {
	Plugin,
	TFile,
	Notice,
	setIcon,
	Platform,
	EventRef,
} from "obsidian";

import { AstroComposerSettings, DEFAULT_SETTINGS } from "./settings";
import { AstroComposerPluginInterface, ContentType } from "./types";
import { registerCommands, registerContentTypeCommands, renameContentByPath as renameContentByPathFunction, openTerminalInProjectRoot, openConfigFile } from "./commands";
import { AstroComposerSettingTab } from "./ui/settings-tab";
import { FileOperations } from "./utils/file-operations";
import { TemplateParser } from "./utils/template-parsing";
import { HeadingLinkGenerator } from "./utils/heading-link-generator";
import { MigrationService } from "./services/MigrationService";
import { CreateEventService } from "./services/CreateEventService";
import { waitForElement } from "./utils/dom";

export default class AstroComposerPlugin extends Plugin implements AstroComposerPluginInterface {
	settings!: AstroComposerSettings;
	private createEventRef?: EventRef;
	private fileOps!: FileOperations;
	private templateParser!: TemplateParser;
	private headingLinkGenerator!: HeadingLinkGenerator;
	public pluginCreatedFiles: Map<string, number> = new Map();
	private processedFiles: Map<string, number> = new Map();
	private terminalRibbonIcon: HTMLElement | null = null;
	private configRibbonIcon: HTMLElement | null = null;
	private ribbonContextMenuObserver?: MutationObserver;
	private helpButtonObserver?: MutationObserver;
	private helpButtonElement?: HTMLElement;
	private customHelpButton?: HTMLElement;
	public settingsTab?: AstroComposerSettingTab;

	private migrationService!: MigrationService;
	private createEventService!: CreateEventService;

	/**
	 * Migrate old posts/pages settings to unified content types
	 */
	private async migrateSettingsIfNeeded(): Promise<void> {
		if (!this.migrationService) {
			this.migrationService = new MigrationService(this.app, this);
		}
		await this.migrationService.migrateSettingsIfNeeded();
	}

	async onload() {
		await this.loadSettings();

		// Initialize services and utilities
		this.migrationService = new MigrationService(this.app, this);
		this.createEventService = new CreateEventService(this.app, this);
		this.fileOps = new FileOperations(this.app, this.settings, this);
		this.templateParser = new TemplateParser(this.app, this.settings);
		this.headingLinkGenerator = new HeadingLinkGenerator(this.settings);

		// Register MDX file visibility if enabled
		if (this.settings.showMdxFilesInExplorer) {
			this.registerExtensions(["mdx"], "markdown");
		}

		// Wait for the vault to be fully loaded before registering the create event
		this.app.workspace.onLayoutReady(() => {
			this.registerCreateEvent();
			// Initialize help button replacement (desktop only)
			if (!Platform.isMobile) {
				void this.updateHelpButton();
			}

			// Run migration after plugin is fully loaded (non-blocking)
			void this.migrateSettingsIfNeeded();
		});

		// Register commands
		registerCommands(this, this.settings);

		// Register content type commands
		registerContentTypeCommands(this, this.settings);

		// Add settings tab and store reference for refresh after migration
		this.settingsTab = new AstroComposerSettingTab(this.app, this);
		this.addSettingTab(this.settingsTab);

		// Register context menu for copy heading links
		this.registerContextMenu();

		// Register ribbon icons if enabled
		this.registerRibbonIcons();

		// Setup ribbon context menu handling
		this.setupRibbonContextMenuHandling();
	}

	public registerCreateEvent() {
		if (this.createEventRef) {
			this.app.vault.offref(this.createEventRef);
			this.createEventRef = undefined;
		}

		const createEventRef = this.app.vault.on("create", (file) => {
			if (file instanceof TFile) {
				this.createEventService.handleCreate(file);
				this.cleanupPluginCreatedFiles();
			}
		});
		this.registerEvent(createEventRef);
		this.createEventRef = createEventRef;
	}

	private cleanupPluginCreatedFiles() {
		const now = Date.now();
		const ttl = 5 * 60 * 1000; // 5 minutes
		for (const [path, timestamp] of this.pluginCreatedFiles.entries()) {
			if (now - timestamp > ttl) {
				this.pluginCreatedFiles.delete(path);
			}
		}
	}

	async loadSettings() {
		const loadedData = (await this.loadData()) as unknown;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData as Partial<AstroComposerSettings> | null | undefined);

		// Ensure contentTypes is always an array (never undefined or null)
		if (!this.settings.contentTypes || !Array.isArray(this.settings.contentTypes)) {
			this.settings.contentTypes = [];
		}

		if (!this.settings.migrationCompleted) {
			const legacySettings = this.settings as unknown as { customContentTypes?: ContentType[] };
			const hasLegacyTypes = legacySettings.customContentTypes && Array.isArray(legacySettings.customContentTypes) && legacySettings.customContentTypes.length > 0;
			const hasNewTypes = this.settings.contentTypes && Array.isArray(this.settings.contentTypes) && this.settings.contentTypes.length > 0;

			if (hasLegacyTypes && !hasNewTypes) {
				this.settings.contentTypes = legacySettings.customContentTypes || [];
			}
		} else {
			const legacyFields = [
				'customContentTypes', 'enableUnderscorePrefix', 'postsFolder', 'postsLinkBasePath',
				'automatePostCreation', 'creationMode', 'indexFileName', 'excludedDirectories',
				'onlyAutomateInPostsFolder', 'enablePages', 'pagesFolder', 'pagesLinkBasePath',
				'pagesCreationMode', 'pagesIndexFileName', 'pageTemplate', 'onlyAutomateInPagesFolder',
			];

			const settingsRecord = this.settings as unknown as Record<string, unknown>;
			for (const field of legacyFields) {
				if (settingsRecord[field] !== undefined) {
					delete settingsRecord[field];
				}
			}
			await this.saveSettings();
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private registerContextMenu() {
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu, editor, view) => {
				if (!this.settings.enableCopyHeadingLink) {
					return;
				}

				const cursor = editor.getCursor();
				const file = view.file;

				if (!(file instanceof TFile)) {
					return;
				}

				const heading = this.headingLinkGenerator.findHeadingAtLine(this.app, file, cursor.line);

				if (heading) {
					const fullLink = this.headingLinkGenerator.generateLink(this.app, file, heading);
					const urlOnly = this.headingLinkGenerator.extractUrl(fullLink);

					menu.addItem((item) => {
						item
							.setTitle('Copy heading link')
							.setIcon('link-2')
							.onClick(async () => {
								await navigator.clipboard.writeText(urlOnly);
								new Notice('Heading link copied to clipboard');
							});
					});

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

	renameContentByPath(filePath: string): void {
		renameContentByPathFunction(this.app, filePath, this.settings, this);
	}

	public registerRibbonIcons() {
		if (Platform.isMobile) {
			if (this.terminalRibbonIcon) {
				try { if (this.terminalRibbonIcon.parentNode) this.terminalRibbonIcon.remove(); } catch { /* Ignore */ }
				this.terminalRibbonIcon = null;
			}
			if (this.configRibbonIcon) {
				try { if (this.configRibbonIcon.parentNode) this.configRibbonIcon.remove(); } catch { /* Ignore */ }
				this.configRibbonIcon = null;
			}
			try {
				const terminalIcons = document.querySelectorAll('.side-dock-ribbon-action[aria-label="Open project terminal"]');
				terminalIcons.forEach((icon: Element) => icon.remove());
				const configIcons = document.querySelectorAll('.side-dock-ribbon-action[aria-label="Edit astro config"]');
				configIcons.forEach((icon: Element) => icon.remove());
			} catch { /* Ignore */ }
			return;
		}

		const terminalShouldExist = this.settings.enableTerminalRibbonIcon && this.settings.enableOpenTerminalCommand;
		const configShouldExist = this.settings.enableConfigRibbonIcon && this.settings.enableOpenConfigFileCommand;

		if (this.terminalRibbonIcon) {
			try { if (this.terminalRibbonIcon.parentNode) this.terminalRibbonIcon.remove(); } catch { /* Ignore */ }
			this.terminalRibbonIcon = null;
		}

		if (this.configRibbonIcon) {
			try { if (this.configRibbonIcon.parentNode) this.configRibbonIcon.remove(); } catch { /* Ignore */ }
			this.configRibbonIcon = null;
		}

		try {
			document.querySelectorAll('.side-dock-ribbon-action[aria-label="Open project terminal"]').forEach(el => el.remove());
			document.querySelectorAll('.side-dock-ribbon-action[aria-label="Edit astro config"]').forEach(el => el.remove());
		} catch { /* Ignore */ }

		if (terminalShouldExist) {
			this.terminalRibbonIcon = this.addRibbonIcon('terminal-square', 'Open project terminal', () => {
				if (!this.settings.enableOpenTerminalCommand) {
					new Notice("Open terminal command is disabled.");
					return;
				}
				openTerminalInProjectRoot(this.app, this.settings);
			});
			if (this.terminalRibbonIcon) this.terminalRibbonIcon.setAttribute('data-astro-composer-terminal-ribbon', 'true');
		}

		if (configShouldExist) {
			this.configRibbonIcon = this.addRibbonIcon('wrench', 'Edit astro config', async () => {
				if (!this.settings.enableOpenConfigFileCommand) {
					new Notice("Edit config file command is disabled.");
					return;
				}
				await openConfigFile(this.app, this.settings);
			});
			if (this.configRibbonIcon) this.configRibbonIcon.setAttribute('data-astro-composer-config-ribbon', 'true');
		}

		this.updateRibbonContextMenuCSS();
		this.setupRibbonContextMenuObserver();
	}

	onunload() {
		if (this.terminalRibbonIcon) {
			this.terminalRibbonIcon.remove();
			this.terminalRibbonIcon = null;
		}
		if (this.configRibbonIcon) {
			this.configRibbonIcon.remove();
			this.configRibbonIcon = null;
		}
		if (this.ribbonContextMenuObserver) {
			this.ribbonContextMenuObserver.disconnect();
			this.ribbonContextMenuObserver = undefined;
		}
		document.body.removeClass('astro-composer-hide-terminal-icon');
		document.body.removeClass('astro-composer-hide-config-icon');
		if (this.helpButtonObserver) {
			this.helpButtonObserver.disconnect();
			this.helpButtonObserver = undefined;
		}
		if (this.customHelpButton) {
			this.customHelpButton.remove();
			this.customHelpButton = undefined;
		}
		this.helpButtonElement = undefined;
	}

	private setupRibbonContextMenuHandling() {
		this.updateRibbonContextMenuCSS();
		this.setupRibbonContextMenuObserver();
	}

	private updateRibbonContextMenuCSS() {
		const terminalShouldBeHidden = !this.settings.enableTerminalRibbonIcon || !this.settings.enableOpenTerminalCommand;
		const configShouldBeHidden = !this.settings.enableConfigRibbonIcon || !this.settings.enableOpenConfigFileCommand;

		if (terminalShouldBeHidden) document.body.addClass('astro-composer-hide-terminal-icon');
		else document.body.removeClass('astro-composer-hide-terminal-icon');

		if (configShouldBeHidden) document.body.addClass('astro-composer-hide-config-icon');
		else document.body.removeClass('astro-composer-hide-config-icon');
	}

	private setupRibbonContextMenuObserver() {
		if (this.ribbonContextMenuObserver) this.ribbonContextMenuObserver.disconnect();

		const terminalShouldBeHidden = !this.settings.enableTerminalRibbonIcon || !this.settings.enableOpenTerminalCommand;
		const configShouldBeHidden = !this.settings.enableConfigRibbonIcon || !this.settings.enableOpenConfigFileCommand;

		if (!terminalShouldBeHidden && !configShouldBeHidden) return;

		this.ribbonContextMenuObserver = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				if (mutation.addedNodes.length > 0) {
					for (const node of Array.from(mutation.addedNodes)) {
						if (node instanceof HTMLElement) {
							if (node.classList.contains('menu') || node.querySelector('.menu')) {
								this.removeRibbonIconsFromContextMenu(node);
							}
						}
					}
				}
			}
		});

		this.ribbonContextMenuObserver.observe(document.body, { childList: true, subtree: true });
	}

	private updateHelpButtonCSS() {
		if (this.settings.helpButtonReplacement?.enabled) document.body.addClass('astro-composer-hide-help-button');
		else document.body.removeClass('astro-composer-hide-help-button');
	}

	public async updateHelpButton() {
		if (Platform.isMobile) {
			this.restoreHelpButton();
			return;
		}

		if (this.helpButtonObserver) this.helpButtonObserver.disconnect();

		await this.loadSettings();
		this.updateHelpButtonCSS();

		if (!this.settings.helpButtonReplacement?.enabled) {
			this.restoreHelpButton();
			this.setupHelpButtonObserver();
			return;
		}

		try {
			const helpButton = await waitForElement('.workspace-drawer-vault-actions .clickable-icon svg.help', 10000)
				.then(svg => svg.parentElement as HTMLElement);

			if (!helpButton) {
				this.setupHelpButtonObserver();
				return;
			}

			this.helpButtonElement = helpButton;

			if (this.customHelpButton && this.customHelpButton.parentElement && document.body.contains(this.customHelpButton) &&
				this.customHelpButton.hasAttribute('data-astro-composer-help-replacement')) {
				this.customHelpButton.remove();
			}
			this.customHelpButton = undefined;

			const customButton = helpButton.cloneNode(true) as HTMLElement;
			customButton.addClass("astro-composer-help-replacement");
			customButton.removeAttribute('aria-label');
			customButton.setAttribute('data-astro-composer-help-replacement', 'true');
			customButton.classList.add('astro-composer-help-replacement');
			customButton.onclick = null;

			const iconContainer = customButton.querySelector('svg')?.parentElement || customButton;
			try {
				if (iconContainer instanceof HTMLElement) {
					setIcon(iconContainer, this.settings.helpButtonReplacement.iconId);
				}
			} catch (error) {
				console.warn('[Astro Composer] Error setting icon:', error);
			}

			customButton.addEventListener('click', (evt: MouseEvent) => {
				evt.preventDefault();
				evt.stopPropagation();

				const commandId = this.settings.helpButtonReplacement?.commandId;
				if (commandId) {
					void (async () => {
						try {
							const appWithCommands = this.app as unknown as { commands?: { executeCommandById?: (id: string) => Promise<void> } };
							if (appWithCommands.commands?.executeCommandById) {
								await appWithCommands.commands.executeCommandById(commandId);
							}
						} catch (error) {
							console.warn('[Astro Composer] Error executing command:', error);
							new Notice(`Failed to execute command: ${commandId}`);
						}
					})();
				}
			}, true);

			helpButton.parentElement?.insertBefore(customButton, helpButton);
			this.customHelpButton = customButton;

			setTimeout(() => {
				if (this.settings.helpButtonReplacement?.enabled) this.setupHelpButtonObserver();
			}, 1000);
		} catch (error) {
			console.warn('[Astro Composer] Error updating help button:', error);
			this.setupHelpButtonObserver();
		}
	}

	private setupHelpButtonObserver() {
		if (this.helpButtonObserver) this.helpButtonObserver.disconnect();
		if (!this.settings.helpButtonReplacement?.enabled) return;

		let updateTimeout: number | null = null;
		this.helpButtonObserver = new MutationObserver(() => {
			if (updateTimeout) clearTimeout(updateTimeout);
			updateTimeout = window.setTimeout(() => {
				const vaultActions = document.querySelector('.workspace-drawer-vault-actions');
				if (!vaultActions) return;

				const customButtonExists = this.customHelpButton && this.customHelpButton.parentElement && document.body.contains(this.customHelpButton) &&
					this.customHelpButton.hasAttribute('data-astro-composer-help-replacement');

				if (!customButtonExists) {
					if (this.customHelpButton && (!document.body.contains(this.customHelpButton) || !this.customHelpButton.hasAttribute('data-astro-composer-help-replacement'))) {
						this.customHelpButton = undefined;
					}
					void this.updateHelpButton();
				}
			}, 100);
		});

		const vaultActions = document.querySelector('.workspace-drawer-vault-actions');
		if (vaultActions) this.helpButtonObserver.observe(vaultActions, { childList: true, subtree: true });

		const vaultProfile = document.querySelector('.workspace-sidedock-vault-profile');
		if (vaultProfile) this.helpButtonObserver.observe(vaultProfile, { childList: true, subtree: true });

		if (!vaultActions && !vaultProfile) {
			const workspace = document.querySelector('.workspace-split');
			if (workspace) this.helpButtonObserver.observe(workspace, { childList: true, subtree: true });
			else this.helpButtonObserver.observe(document.body, { childList: true, subtree: true });
		}
	}

	private restoreHelpButton() {
		document.body.removeClass('astro-composer-hide-help-button');
		if (this.customHelpButton) {
			this.customHelpButton.remove();
			this.customHelpButton = undefined;
		}
		this.helpButtonElement = undefined;
	}

	private removeRibbonIconsFromContextMenu(menuElement: HTMLElement) {
		const terminalShouldBeHidden = !this.settings.enableTerminalRibbonIcon || !this.settings.enableOpenTerminalCommand;
		const configShouldBeHidden = !this.settings.enableConfigRibbonIcon || !this.settings.enableOpenConfigFileCommand;

		const menuItems = menuElement.querySelectorAll('.menu-item');
		for (const item of Array.from(menuItems)) {
			const svg = item.querySelector('svg');
			if (svg) {
				const iconName = svg.getAttribute('data-lucide') || svg.getAttribute('xmlns:lucide') ||
					(svg.classList.contains('lucide-terminal-square') ? 'terminal-square' : null) ||
					(svg.classList.contains('lucide-wrench') ? 'wrench' : null);

				if (terminalShouldBeHidden && iconName === 'terminal-square') {
					if (item.textContent?.toLowerCase().includes('terminal')) item.remove();
				}
				if (configShouldBeHidden && iconName === 'wrench') {
					if (item.textContent?.toLowerCase().includes('config')) item.remove();
				}
			}
		}
	}
}
