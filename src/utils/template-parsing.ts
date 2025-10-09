import { App, TFile, Notice } from "obsidian";
import { AstroComposerSettings, PostType, ParsedFrontmatter, TemplateValues, KNOWN_ARRAY_KEYS, CustomContentType } from "../types";

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
				propertiesEnd = content.length; // Treat entire content as properties if no second ---
			} else {
				propertiesEnd += 4; // Move past the second ---
			}
			propertiesText = content.slice(4, propertiesEnd - 4).trim();
			
			try {
				let currentKey: string | null = null;
				const arrayKeys = new Set<string>(); // Track which keys are arrays
				
				propertiesText.split("\n").forEach((line) => {
					const trimmedLine = line.trim();
					
					// Match property lines - more flexible regex to handle various property names
					const match = trimmedLine.match(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$/);
					if (match) {
						const [, key, value] = match;
						currentKey = key;
						const isKnownArrayKey = KNOWN_ARRAY_KEYS.includes(key as typeof KNOWN_ARRAY_KEYS[number]);
						const isEmptyArray = !value || value.trim() === "" || value.trim() === "[]";
						const isArrayProperty = isKnownArrayKey || isEmptyArray;
						
						if (isArrayProperty) {
							existingProperties[key] = [];
							arrayKeys.add(key); // Mark this key as an array
						} else {
							existingProperties[key] = [value ? value.trim() : ""];
						}
					} else if (currentKey && trimmedLine.startsWith("- ")) {
						// Check if current key is an array property
						const isArrayProperty = arrayKeys.has(currentKey);
						
						if (isArrayProperty) {
							const item = trimmedLine.replace(/^-\s*/, "");
							if (item) existingProperties[currentKey].push(item);
						}
					} else if (trimmedLine && !trimmedLine.startsWith("- ") && !trimmedLine.startsWith("#")) {
						// Handle unrecognized properties that don't match the standard format
						// This is a fallback to preserve properties that might have special formatting
						const keyMatch = trimmedLine.match(/^([^:]+):\s*(.*)$/);
						if (keyMatch) {
							const [, key, value] = keyMatch;
							if (!existingProperties[key]) {
								existingProperties[key] = [value ? value.trim() : ""];
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
				const match = line.match(/^(\w+):\s*(.*)$/);
				if (match) {
					const [, key, value] = match;
					templateProps.push(key);
					
					// Check if this is an array property (known array keys or YAML list format)
					const isKnownArrayKey = KNOWN_ARRAY_KEYS.includes(key as typeof KNOWN_ARRAY_KEYS[number]);
					// Check if it's a YAML list format (no value after colon, empty brackets, or empty value means it's an array)
					const isEmptyArray = !value || value.trim() === "" || value.trim() === "[]";
					const isArrayProperty = isKnownArrayKey || isEmptyArray;
					
					if (isArrayProperty) {
						// Handle array properties
						if (value && value.startsWith("[")) {
							// Handle bracket format: ["item1", "item2"]
							const items = value
								.replace(/[[\]]/g, "")
								.split(",")
								.map(t => t.trim())
								.filter(t => t);
							templateValues[key] = items;
						} else {
							// Handle YAML list format: empty or with - items
							templateValues[key] = [];
							// Look ahead for item list
							for (let j = i + 1; j < templateLines.length; j++) {
								const nextLine = templateLines[j].trim();
								if (nextLine.startsWith("- ")) {
									const item = nextLine.replace(/^-\s*/, "").trim();
									if (item) (templateValues[key] as string[]).push(item);
								} else if (nextLine === "---" || (nextLine && !nextLine.startsWith("- ") && nextLine.includes(":"))) {
									// Stop at next property or end of properties section
									break;
								}
							}
						}
					} else {
						// This is a string property, not an array
						const stringValue = (value || "").replace(/\{\{title\}\}/g, title).replace(/\{\{date\}\}/g, window.moment(new Date()).format(this.settings.dateFormat));
						// Store as a single string value, not in an array
						templateValues[key] = stringValue;
					}
				}
			}
		}

		return { templateProps, templateValues };
	}

	buildFrontmatterContent(finalProps: Record<string, string[]>, arrayKeys?: Set<string>): string {
		let newContent = "---\n";
		for (const key in finalProps) {
			// Check if this is an array property
			const isArrayProperty = KNOWN_ARRAY_KEYS.includes(key as typeof KNOWN_ARRAY_KEYS[number]) || 
				(arrayKeys && arrayKeys.has(key));
			
			if (isArrayProperty) {
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

	async updateTitleInFrontmatter(file: TFile, newTitle: string, type: PostType | string): Promise<void> {
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
		let titleKeyPosition = -1; // Track the original position of the title key

		const arrayKeys = new Set<string>(); // Track which keys are arrays
		
		propertiesText.split("\n").forEach((line, index) => {
			const trimmedLine = line.trim();
			
			// Match property lines - more flexible regex to handle various property names
			const match = trimmedLine.match(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$/);
			if (match) {
				const [, key, value] = match;
				propOrder.push(key);
				currentKey = key;
				
				// Track the original position of the title key
				if (key === titleKey) {
					titleKeyPosition = index;
				}
				
				const isKnownArrayKey = KNOWN_ARRAY_KEYS.includes(key as typeof KNOWN_ARRAY_KEYS[number]);
				const isEmptyArray = !value || value.trim() === "" || value.trim() === "[]";
				const isArrayProperty = isKnownArrayKey || isEmptyArray;
				
				if (isArrayProperty) {
					existing[key] = [];
					arrayKeys.add(key); // Mark this key as an array
				} else {
					existing[key] = value ? value.trim() : "";
				}
			} else if (currentKey && arrayKeys.has(currentKey) && trimmedLine.startsWith("- ")) {
				// Handle array items
				const item = trimmedLine.replace(/^-\s*/, "");
				if (item) (existing[currentKey] as string[]).push(item);
			} else if (trimmedLine && !trimmedLine.startsWith("- ") && !trimmedLine.startsWith("#")) {
				// Handle unrecognized properties that don't match the standard format
				// This is a fallback to preserve properties that might have special formatting
				const keyMatch = trimmedLine.match(/^([^:]+):\s*(.*)$/);
				if (keyMatch) {
					const [, key, value] = keyMatch;
					if (!propOrder.includes(key)) {
						propOrder.push(key);
						existing[key] = value ? value.trim() : "";
					}
				}
			}
		});

		// Properly escape YAML string values
		// YAML strings with quotes need to be wrapped in single quotes or escaped properly
		let titleVal: string;
		if (newTitle.includes('"') || newTitle.includes("'") || newTitle.includes('\n') || newTitle.includes('\\')) {
			// For strings with quotes, newlines, or backslashes, use single quotes and escape single quotes
			titleVal = `'${newTitle.replace(/'/g, "''")}'`;
		} else if (newTitle.includes(" ") || newTitle.includes(":") || newTitle.includes("#") || newTitle.includes("@")) {
			// For strings with spaces or special YAML characters, wrap in double quotes and escape double quotes
			titleVal = `"${newTitle.replace(/"/g, '\\"')}"`;
		} else {
			// For simple strings, no quotes needed
			titleVal = newTitle;
		}
		existing[titleKey] = titleVal;

		// If title key was found in original properties, preserve its position
		// Otherwise, add it at the end
		if (titleKeyPosition === -1) {
			// Title key not found in original properties, add it at the end
			propOrder.push(titleKey);
		}
		// If titleKeyPosition >= 0, the title key is already in propOrder at the correct position

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

	private getTitleKey(type: PostType | string): string {
		let template: string;
		
		if (this.isCustomContentType(type)) {
			const customType = this.getCustomContentType(type);
			if (!customType) return "title";
			template = customType.template;
		} else {
			template = type === "post" ? this.settings.defaultTemplate : this.settings.pageTemplate;
		}
		
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

	private isCustomContentType(type: PostType | string): boolean {
		return type !== "post" && type !== "page";
	}

	private getCustomContentType(typeId: string): CustomContentType | null {
		return this.settings.customContentTypes.find(ct => ct.id === typeId) || null;
	}
}
