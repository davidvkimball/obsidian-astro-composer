import { TFile } from "obsidian";

export interface AstroComposerSettings {
	enableUnderscorePrefix: boolean;
	defaultTemplate: string;
	linkBasePath: string;
	postsFolder: string;
	automatePostCreation: boolean;
	autoInsertProperties: boolean;
	creationMode: "file" | "folder";
	indexFileName: string;
	dateFormat: string;
	excludedDirectories: string;
	onlyAutomateInPostsFolder: boolean;
	enablePages: boolean;
	pagesFolder: string;
	pageTemplate: string;
	enableCopyHeadingLink: boolean;
	copyHeadingLinkFormat: "obsidian" | "astro";
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

export interface CustomContentType {
	id: string;
	name: string;
	folder: string;
	template: string;
	enabled: boolean;
}

export interface FileCreationOptions {
	file: TFile;
	title: string;
	type: PostType | string; // string for custom content types
}

export interface RenameOptions {
	file: TFile;
	title: string;
	type: PostType | string; // string for custom content types
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