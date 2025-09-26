import { AstroComposerSettings } from "./types";

export type { AstroComposerSettings } from "./types";
export { CONSTANTS } from "./types";

export const DEFAULT_SETTINGS: AstroComposerSettings = {
	enableUnderscorePrefix: false,
	defaultTemplate:
		'---\ntitle: "{{title}}"\ndate: {{date}}\ntags: []\n---\n',
	postsFolder: "posts",
	postsLinkBasePath: "blog/",
	automatePostCreation: true,
	autoInsertProperties: true,
	creationMode: "file",
	indexFileName: "",
	dateFormat: "YYYY-MM-DD",
	excludedDirectories: "",
	onlyAutomateInPostsFolder: false,
	enablePages: false,
	pagesFolder: "pages",
	pagesLinkBasePath: "",
	pagesCreationMode: "file",
	pagesIndexFileName: "",
	pageTemplate:
		'---\ntitle: "{{title}}"\ndescription: ""\n---\n',
	enableCopyHeadingLink: true,
	copyHeadingLinkFormat: "obsidian",
	addTrailingSlashToLinks: false,
	customContentTypes: [],
};
