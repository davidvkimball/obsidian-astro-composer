import { TFile, PluginSettingTab } from "obsidian";

export interface AstroComposerSettings {
	defaultTemplate: string; // Kept temporarily for migration
	autoInsertProperties: boolean;
	dateFormat: string;
	enableCopyHeadingLink: boolean;
	copyHeadingLinkFormat: "obsidian" | "astro";
	addTrailingSlashToLinks: boolean;
	enableOpenTerminalCommand: boolean;
	terminalProjectRootPath: string;
	terminalApplicationName: string;
	enableTerminalDebugLogging: boolean;
	enableTerminalRibbonIcon: boolean;
	enableOpenConfigFileCommand: boolean;
	configFilePath: string;
	enableConfigRibbonIcon: boolean;
	contentTypes: ContentType[];
	helpButtonReplacement: HelpButtonReplacementSettings;
	migrationCompleted: boolean;
	showMdxFilesInExplorer: boolean;
	processBackgroundFileChanges: boolean;
	// Legacy fields (kept for migration, ignored after migration)
	enableUnderscorePrefix?: boolean;
	postsFolder?: string;
	postsLinkBasePath?: string;
	automatePostCreation?: boolean;
	creationMode?: "file" | "folder";
	indexFileName?: string;
	excludedDirectories?: string;
	onlyAutomateInPostsFolder?: boolean;
	enablePages?: boolean;
	pagesFolder?: string;
	pagesLinkBasePath?: string;
	pagesCreationMode?: "file" | "folder";
	pagesIndexFileName?: string;
	pageTemplate?: string;
	onlyAutomateInPagesFolder?: boolean;
	customContentTypes?: ContentType[]; // Legacy name
}

export interface HelpButtonReplacementSettings {
	enabled: boolean;
	commandId: string;
	iconId: string;
}

export interface ParsedFrontmatter {
	properties: Record<string, string[]>;
	propertiesText: string;
	propertiesEnd: number;
	bodyContent: string;
}

export interface TemplateValues {
	[key: string]: string[] | string;
}

// ContentType is now just a string ID - no distinction between built-in and custom types
export type ContentTypeId = string;

export interface ContentType {
	id: string;
	name: string;
	folder: string;
	linkBasePath: string;
	template: string;
	enabled: boolean;
	creationMode: "file" | "folder";
	indexFileName: string;
	ignoreSubfolders: boolean;
	enableUnderscorePrefix: boolean;
	useMdxExtension: boolean;
	collapsed?: boolean;
}

export interface FileCreationOptions {
	file: TFile;
	title: string;
	type: ContentTypeId; // Content type ID (string)
}

export interface RenameOptions {
	file: TFile;
	title: string;
	type: ContentTypeId; // Content type ID (string)
}

export const KNOWN_ARRAY_KEYS = ['tags', 'aliases', 'cssclasses'] as const;

export const CONSTANTS = {
	DEBOUNCE_MS: 500,
	STAT_MTIME_THRESHOLD: 1000,
	EDITOR_STABILIZE_DELAY: 100,
	FILE_EXPLORER_REVEAL_DELAY: 200,
} as const;

export interface AstroComposerPluginInterface {
	settings: AstroComposerSettings;
	saveSettings(): Promise<void>;
	loadSettings(): Promise<void>;
	registerCreateEvent(): void;
	pluginCreatedFiles: Map<string, number>;
	settingsTab?: PluginSettingTab;
	registerRibbonIcons?(): void;
	updateHelpButton?(): Promise<void>;
}