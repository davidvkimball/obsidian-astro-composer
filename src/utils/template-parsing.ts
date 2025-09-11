import { App, TFile, Notice } from "obsidian";
import { AstroComposerSettings, PostType, ParsedFrontmatter, TemplateValues, KNOWN_ARRAY_KEYS } from "../types";

export class TemplateParser {
	constructor(private app: App, private settings: AstroComposerSettings) {}

	async parseFrontmatter(content: string): Promise<ParsedFrontmatter> {
		let propertiesEnd = 0;
		let propertiesText = "";
		const existingProperties: Record<string, string[]> = {};

		// Parse existing properties with fallback for missing second ---
		if (content.startsWith("---")) {
			propertiesEnd = content.indexOf("\n---", 3);
			if (propertiesEnd === -1) {
				propertiesEnd = content.length; // Treat entire content as frontmatter if no second ---
			} else {
				propertiesEnd += 4; // Move past the second ---
			}
			propertiesText = content.slice(4, propertiesEnd - 4).trim();
			
			try {
				let currentKey: string | null = null;
				propertiesText.split("\n").forEach((line) => {
					const match = line.match(/^(\w+):\s*(.+)?$/);
					if (match) {
						const [, key, value] = match;
						currentKey = key;
						if (KNOWN_ARRAY_KEYS.includes(key as any)) {
							existingProperties[key] = [];
						} else {
							existingProperties[key] = [value ? value.trim() : ""];
						}
					} else if (currentKey && KNOWN_ARRAY_KEYS.includes(currentKey as any) && line.trim().startsWith("- ")) {
						const item = line.trim().replace(/^-\s*/, "");
						if (item) existingProperties[currentKey].push(item);
					} else if (line.trim() && !line.trim().startsWith("- ")) {
						// Handle unrecognized properties
						const keyMatch = line.match(/^(\w+):/);
						if (keyMatch) {
							const key = keyMatch[1];
							const value = line.slice(line.indexOf(":") + 1).trim();
							if (!existingProperties[key]) {
								existingProperties[key] = [value || ""];
							}
						}
					}
				});
				// Preserve array keys if they exist without values
				KNOWN_ARRAY_KEYS.forEach(key => {
					if (propertiesText.includes(key + ':') && !existingProperties[key]) {
						existingProperties[key] = [];
					}
				});
			} catch (error) {
				// Fallback to template if parsing fails
				new Notice("Falling back to template due to parsing error.");
			}
		}

		const bodyContent = content.slice(propertiesEnd);
		return {
			properties: existingProperties,
			propertiesText,
			propertiesEnd,
			bodyContent
		};
	}

	parseTemplate(templateString: string, title: string): { templateProps: string[]; templateValues: TemplateValues } {
		const templateLines = templateString.split("\n");
		const templateProps: string[] = [];
		const templateValues: TemplateValues = {};
		let inProperties = false;

		for (let i = 0; i < templateLines.length; i++) {
			const line = templateLines[i].trim();
			if (line === "---") {
				inProperties = !inProperties;
				if (!inProperties) {
					break; // Stop at second --- to exclude post-property content
				}
				continue;
			}
			if (inProperties) {
				const match = line.match(/^(\w+):\s*(.+)?$/);
				if (match) {
					const [, key, value] = match;
					templateProps.push(key);
					if (KNOWN_ARRAY_KEYS.includes(key as any)) {
						// Handle template array keys
						if (value && value.startsWith("[")) {
							const items = value
								.replace(/[\[\]]/g, "")
								.split(",")
								.map(t => t.trim())
								.filter(t => t);
							templateValues[key] = items;
						} else {
							templateValues[key] = [];
							// Look ahead for item list
							for (let j = i + 1; j < templateLines.length; j++) {
								const nextLine = templateLines[j].trim();
								if (nextLine.startsWith("- ")) {
									const item = nextLine.replace(/^-\s*/, "").trim();
									if (item) templateValues[key].push(item);
								} else if (nextLine === "---") {
									break;
								}
							}
						}
					} else {
						templateValues[key] = [ (value || "").replace(/\{\{title\}\}/g, title).replace(/\{\{date\}\}/g, window.moment(new Date()).format(this.settings.dateFormat)) ];
					}
				}
			}
		}

		return { templateProps, templateValues };
	}

	buildFrontmatterContent(finalProps: Record<string, string[]>): string {
		let newContent = "---\n";
		for (const key in finalProps) {
			if (KNOWN_ARRAY_KEYS.includes(key as any)) {
				newContent += `${key}:\n`;
				if (finalProps[key].length > 0) {
					finalProps[key].forEach(item => {
						newContent += `  - ${item}\n`;
					});
				}
			} else {
				newContent += `${key}: ${finalProps[key][0] || ""}\n`;
			}
		}
		newContent += "---";
		return newContent;
	}

	async updateTitleInFrontmatter(file: TFile, newTitle: string, type: PostType): Promise<void> {
		const titleKey = this.getTitleKey(type);
		const content = await this.app.vault.read(file);
		let propertiesEnd = 0;
		let propertiesText = "";

		if (content.startsWith("---")) {
			propertiesEnd = content.indexOf("\n---", 3);
			if (propertiesEnd === -1) {
				propertiesEnd = content.length;
			} else {
				propertiesEnd += 4;
			}
			propertiesText = content.slice(4, propertiesEnd - 4).trim();
		}

		const propOrder: string[] = [];
		const existing: Record<string, any> = {};
		let currentKey: string | null = null;

		propertiesText.split("\n").forEach((line) => {
			const match = line.match(/^(\w+):\s*(.+)?$/);
			if (match) {
				const [, key, value] = match;
				propOrder.push(key);
				currentKey = key;
				if (KNOWN_ARRAY_KEYS.includes(key as any)) {
					existing[key] = [];
				} else {
					existing[key] = value ? value.trim() : "";
				}
			} else if (currentKey && KNOWN_ARRAY_KEYS.includes(currentKey as any) && line.trim().startsWith("- ")) {
				const item = line.trim().replace(/^-\s*/, "");
				if (item) (existing[currentKey] as string[]).push(item);
			}
		});

		const escapedTitle = newTitle.replace(/"/g, '\\"');
		const titleVal = newTitle.includes(" ") || newTitle.includes('"') ? `"${escapedTitle}"` : newTitle;
		existing[titleKey] = titleVal;

		if (!propOrder.includes(titleKey)) {
			propOrder.push(titleKey);
		}

		let newContent = "---\n";
		for (const key of propOrder) {
			const val = existing[key];
			if (Array.isArray(val)) {
				newContent += `${key}:\n`;
				if (val.length > 0) {
					val.forEach((item: string) => {
						newContent += `  - ${item}\n`;
					});
				}
			} else {
				newContent += `${key}: ${val || ""}\n`;
			}
		}
		newContent += "---";

		const bodyContent = content.slice(propertiesEnd);
		newContent += bodyContent;

		await this.app.vault.modify(file, newContent);
	}

	private getTitleKey(type: PostType): string {
		const template = type === "post" ? this.settings.defaultTemplate : this.settings.pageTemplate;
		const lines = template.split("\n");
		let inProperties = false;
		for (const line of lines) {
			const trimmed = line.trim();
			if (trimmed === "---") {
				inProperties = !inProperties;
				continue;
			}
			if (inProperties) {
				const match = trimmed.match(/^(\w+):\s*(.+)$/);
				if (match) {
					const key = match[1];
					const value = match[2];
					if (value.includes("{{title}}")) {
						return key;
					}
				}
			}
		}
		return "title";
	}
}
