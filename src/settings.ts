import { AstroComposerSettings } from "./types";

export type { AstroComposerSettings } from "./types";
export { CONSTANTS } from "./types";

export const DEFAULT_SETTINGS: AstroComposerSettings = {
	defaultTemplate:
		'---\ntitle: "{{title}}"\ndate: {{date}}\ntags: []\n---\n',
	autoInsertProperties: true,
	dateFormat: "YYYY-MM-DD",
	enableCopyHeadingLink: true,
	copyHeadingLinkFormat: "obsidian",
	addTrailingSlashToLinks: false,
	enableOpenTerminalCommand: false,
	terminalProjectRootPath: "",
	terminalApplicationName: "",
	enableTerminalDebugLogging: false,
	enableTerminalRibbonIcon: false,
	enableOpenConfigFileCommand: false,
	configFilePath: "",
	enableConfigRibbonIcon: false,
	contentTypes: [],
	migrationCompleted: false,
	helpButtonReplacement: {
		enabled: false,
		commandId: 'edit-astro-config',
		iconId: 'wrench',
	},
	showMdxFilesInExplorer: false,
};
