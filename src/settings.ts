import { AstroComposerSettings, CONSTANTS } from "./types";

export type { AstroComposerSettings } from "./types";
export { CONSTANTS } from "./types";

export const DEFAULT_SETTINGS: AstroComposerSettings = {
	enableUnderscorePrefix: false,
	defaultTemplate:
		'---\ntitle: "{{title}}"\ndate: {{date}}\ntags: []\n---\n',
	linkBasePath: "/blog/",
	postsFolder: "posts",
	automatePostCreation: true,
	autoInsertProperties: true,
	creationMode: "file",
	indexFileName: "index",
	dateFormat: "YYYY-MM-DD",
	excludedDirectories: "",
	onlyAutomateInPostsFolder: false,
	enablePages: false,
	pagesFolder: "pages",
	pageTemplate:
		'---\ntitle: "{{title}}"\ndescription: ""\n---\n',
	enableCopyHeadingLink: true,
	copyHeadingLinkFormat: "obsidian",
};
