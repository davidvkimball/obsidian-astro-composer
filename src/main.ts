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
import { FrontmatterService } from "./services/FrontmatterService";
import { waitForElement } from "./utils/dom";

export default class AstroComposerPlugin extends Plugin implements AstroComposerPluginInterface {
	settings!: AstroComposerSettings;
	private createEventRef?: EventRef;
	public fileOps!: FileOperations;
	public templateParser!: TemplateParser;
	public headingLinkGenerator!: HeadingLinkGenerator;
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
	public frontmatterService!: FrontmatterService;

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
		try {
			await this.loadSettings();

			// Initialize services (order matters: fileOps first as it's a dependency)
			this.fileOps = new FileOperations(this.app, this.settings, this);
			this.migrationService = new MigrationService(this.app, this);
			this.createEventService = new CreateEventService(this.app, this);
			this.frontmatterService = new FrontmatterService(this.app, this);
			this.templateParser = new TemplateParser(this.app, this.settings, this);
			this.headingLinkGenerator = new HeadingLinkGenerator(this.settings, this);

			// Register MDX file visibility if enabled (safely handle if already registered)
			if (this.settings.showMdxFilesInExplorer) {
				try {
					this.registerExtensions(["mdx"], "markdown");
				} catch (error) {
					console.warn("[Astro Composer] MDX extension already registered:", error);
				}
			}

			// Handle layout-ready initialization (desktop only)
			this.app.workspace.onLayoutReady(() => {
				this.registerCreateEvent();
				// Initialize help button replacement (desktop only)
				if (!Platform.isMobile) {
					this.startHelpButtonMonitor();
				}

				this.registerTitlePropertyClickListener();

				// Run migration after plugin is fully loaded (non-blocking)
				void this.migrateSettingsIfNeeded();
			});

			// Register commands
			registerCommands(this, this.settings);
			registerContentTypeCommands(this, this.settings);

			// Add settings tab
			this.settingsTab = new AstroComposerSettingTab(this.app, this);
			this.addSettingTab(this.settingsTab);

			// Register UI elements
			this.registerContextMenu();
			this.registerRibbonIcons();
			this.setupRibbonContextMenuHandling();
		} catch (error) {
			console.error("[Astro Composer] Critical error during onload:", error);
			new Notice("Astro Composer failed to load. Check console (Ctrl+Shift+I) for details.");
			throw error;
		}
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

	private registerTitlePropertyClickListener() {
		this.registerDomEvent(document, "click", (evt: MouseEvent) => {
			if (!this.settings.renameOnTitleClick) return;

			const target = evt.target as HTMLElement;
			const propertyEl = target.closest(".metadata-property");
			if (!propertyEl) return;

			const propertyKey = propertyEl.getAttribute("data-property-key");
			if (!propertyKey) return;

			const activeFile = this.app.workspace.getActiveFile();
			if (!activeFile) return;

			const typeId = this.fileOps.determineType(activeFile);
			const titleKey = this.fileOps.getTitleKey(typeId);

			if (propertyKey === titleKey) {
				evt.preventDefault();
				evt.stopPropagation();
				this.renameContentByPath(activeFile.path);
			}
		}, true); // use capture phase
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
		if (!this.settings) {
			this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData as Partial<AstroComposerSettings> | null | undefined);
		} else {
			Object.assign(this.settings, loadedData as Partial<AstroComposerSettings> | null | undefined);
		}

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
				'linkBasePath', 'enableAutoRename', 'enableAutoInsertFrontmatter', 'draftStyle'
			];

			const settingsRecord = this.settings as unknown as Record<string, unknown>;
			let fieldsRemoved = false;
			for (const field of legacyFields) {
				if (settingsRecord[field] !== undefined) {
					delete settingsRecord[field];
					fieldsRemoved = true;
				}
			}
			// Only save if we actually cleaned up fields to avoid redundant writes
			if (fieldsRemoved) {
				await this.saveSettings();
			}
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
			this.configRibbonIcon = this.addRibbonIcon('rocket', 'Edit astro config', async () => {
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

	/**
	 * Starts a robust monitor that keeps the help button in sync with settings.
	 */
	private startHelpButtonMonitor() {
		if (this.helpButtonObserver) this.helpButtonObserver.disconnect();

		// Immediate first sync
		this.syncHelpButton();

		let timer: number | null = null;
		let mutationCount = 0;

		this.helpButtonObserver = new MutationObserver(() => {
			mutationCount++;
			if (timer) window.clearTimeout(timer);

			// For the first few mutations (during startup), be super aggressive
			// After that, use a small debounce to stay performant
			const delay = mutationCount < 20 ? 0 : 100;

			if (delay === 0) {
				this.syncHelpButton();
			} else {
				timer = window.setTimeout(() => this.syncHelpButton(), delay);
			}
		});

		// Observe body with subtree and attributes (in case icons/classes change)
		this.helpButtonObserver.observe(document.body, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ['class', 'src', 'aria-label']
		});
	}

	/**
	 * Synchronizes the help button state based on settings.
	 */
	private syncHelpButton() {
		const enabled = this.settings.helpButtonReplacement?.enabled;

		// 1. Manage the CSS class for hiding the original button
		if (enabled) document.body.addClass('astro-composer-hide-help-button');
		else document.body.removeClass('astro-composer-hide-help-button');

		// 2. Clear custom button if disabled
		if (!enabled) {
			if (this.customHelpButton) {
				this.customHelpButton.remove();
				this.customHelpButton = undefined;
			}
			return;
		}

		// 3. Look for the original help button
		const selectors = [
			'.workspace-drawer-vault-actions .clickable-icon svg.help',
			'.workspace-sidedock-vault-profile .clickable-icon svg.help',
			'.workspace-drawer .clickable-icon svg.help',
			'.clickable-icon svg.help'
		];

		let helpButtonSvg: SVGElement | null = null;
		for (const selector of selectors) {
			helpButtonSvg = document.querySelector(selector);
			if (helpButtonSvg) break;
		}

		if (!helpButtonSvg) return;
		const originalHelpButton = helpButtonSvg.parentElement as HTMLElement;
		if (!originalHelpButton) return;

		// 4. Check if we already have a valid custom button in the right place
		const existingReplacement = originalHelpButton.parentElement?.querySelector('[data-astro-composer-help-replacement="true"]');
		if (existingReplacement) {
			this.customHelpButton = existingReplacement as HTMLElement;
			return;
		}

		// 5. Create and inject the replacement
		const customButton = originalHelpButton.cloneNode(true) as HTMLElement;
		customButton.addClass("astro-composer-help-replacement");
		customButton.removeAttribute('aria-label');
		customButton.setAttribute('data-astro-composer-help-replacement', 'true');
		customButton.onclick = null;

		const iconContainer = customButton.querySelector('svg')?.parentElement || customButton;
		try {
			if (iconContainer instanceof HTMLElement) {
				setIcon(iconContainer, this.settings.helpButtonReplacement!.iconId);
			}
		} catch (error) {
			console.warn('[Astro Composer] Error setting replacement icon:', error);
		}

		customButton.addEventListener('click', (evt: MouseEvent) => {
			evt.preventDefault();
			evt.stopPropagation();

			const commandId = this.settings.helpButtonReplacement?.commandId;
			if (commandId) {
				const appWithCommands = this.app as unknown as { commands?: { executeCommandById?: (id: string) => Promise<void> } };
				if (appWithCommands.commands?.executeCommandById) {
					void appWithCommands.commands.executeCommandById(commandId);
				}
			}
		}, true);

		originalHelpButton.parentElement?.insertBefore(customButton, originalHelpButton);
		this.customHelpButton = customButton;
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
				let iconName = svg.getAttribute('data-lucide') || svg.getAttribute('xmlns:lucide') ||
					svg.getAttribute('data-icon') ||
					(svg.classList.contains('lucide-terminal-square') ? 'terminal-square' : null) ||
					(svg.classList.contains('lucide-rocket') ? 'rocket' : null) ||
					(svg.classList.contains('lucide-wrench') ? 'wrench' : null);

				if (iconName) iconName = iconName.replace(/^lucide-/, '');

				if (terminalShouldBeHidden && iconName === 'terminal-square') {
					if (item.textContent?.toLowerCase().includes('terminal')) item.remove();
				}
				if (configShouldBeHidden && (iconName === 'rocket' || iconName === 'wrench')) {
					if (item.textContent?.toLowerCase().includes('config')) item.remove();
				}
			}
		}
	}
}
