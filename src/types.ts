import { TFile } from "obsidian";

export interface AstroComposerSettings {
	enableUnderscorePrefix: boolean;
	defaultTemplate: string;
	postsFolder: string;
	postsLinkBasePath: string;
	automatePostCreation: boolean;
	autoInsertProperties: boolean;
	creationMode: "file" | "folder";
	indexFileName: string;
	dateFormat: string;
	excludedDirectories: string;
	onlyAutomateInPostsFolder: boolean;
	enablePages: boolean;
	pagesFolder: string;
	pagesLinkBasePath: string;
	pagesCreationMode: "file" | "folder";
	pagesIndexFileName: string;
	pageTemplate: string;
	enableCopyHeadingLink: boolean;
	copyHeadingLinkFormat: "obsidian" | "astro";
	addTrailingSlashToLinks: boolean;
	enableOpenTerminalCommand: boolean;
	terminalProjectRootPath: string;
	enableTerminalRibbonIcon: boolean;
	enableOpenConfigFileCommand: boolean;
	configFilePath: string;
	enableConfigRibbonIcon: boolean;
	customContentTypes: CustomContentType[];
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

export type PostType = "post" | "page";

// ContentType represents either a built-in PostType or a custom content type ID (string)
// Using a helper type to prevent TypeScript from simplifying PostType | string to just string
export type ContentType = PostType | (string & {});

export interface CustomContentType {
	id: string;
	name: string;
	folder: string;
	linkBasePath: string;
	template: string;
	enabled: boolean;
	creationMode: "file" | "folder";
	indexFileName: string;
}

export interface FileCreationOptions {
	file: TFile;
	title: string;
	type: ContentType; // PostType for posts/pages, string for custom content types
}

export interface RenameOptions {
	file: TFile;
	title: string;
	type: ContentType; // PostType for posts/pages, string for custom content types
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
	registerCreateEvent(): void;
}