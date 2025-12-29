import { App, TFile, Notice } from "obsidian";
import { AstroComposerSettings, ParsedFrontmatter, TemplateValues, KNOWN_ARRAY_KEYS, ContentTypeId } from "../types";

export class TemplateParser {
	constructor(private app: App, private settings: AstroComposerSettings) {}

	/**
	 * Convert a string to kebab-case for slug generation
	 */
	private toKebabCase(str: string): string {
		return str
			.toLowerCase()
			.replace(/[^a-z0-9\s-]/g, "")
			.trim()
			.replace(/\s+/g, "-")
			.replace(/-+/g, "-")
			.replace(/^-|-$/g, "");
	}

	parseFrontmatter(content: string): ParsedFrontmatter {
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
						const trimmedValue = value ? value.trim() : "";
						
						// Check for bracket-syntax arrays: [item] or ["item1", "item2"] or [item1, item2]
						const bracketArrayMatch = trimmedValue.match(/^\[(.*)\]$/);
						if (bracketArrayMatch) {
							// This is a bracket-format array
							const arrayContent = bracketArrayMatch[1].trim();
							existingProperties[key] = [];
							arrayKeys.add(key); // Mark this key as an array
							
							if (arrayContent) {
								// Parse array items - handle both quoted and unquoted values
								// Split by comma, but respect quotes
								const items: string[] = [];
								let currentItem = "";
								let inQuotes = false;
								let quoteChar = '';
								
								for (let i = 0; i < arrayContent.length; i++) {
									const char = arrayContent[i];
									
									if (!inQuotes && (char === '"' || char === "'")) {
										inQuotes = true;
										quoteChar = char;
									} else if (inQuotes && char === quoteChar) {
										// Check if it's escaped
										if (i > 0 && arrayContent[i - 1] === '\\') {
											currentItem += char;
										} else {
											inQuotes = false;
											quoteChar = '';
										}
									} else if (!inQuotes && char === ',') {
										// End of current item
										const trimmedItem = currentItem.trim();
										if (trimmedItem) {
											// Remove surrounding quotes if present
											const unquoted = trimmedItem.replace(/^["']|["']$/g, '');
											items.push(unquoted);
										}
										currentItem = "";
									} else {
										currentItem += char;
									}
								}
								
								// Add the last item
								if (currentItem.trim()) {
									const trimmedItem = currentItem.trim();
									const unquoted = trimmedItem.replace(/^["']|["']$/g, '');
									items.push(unquoted);
								}
								
								existingProperties[key] = items;
							}
						} else {
							// Not a bracket array, check for other array formats
							const isKnownArrayKey = KNOWN_ARRAY_KEYS.includes(key as typeof KNOWN_ARRAY_KEYS[number]);
							const isEmptyArray = !trimmedValue || trimmedValue === "";
							const isArrayProperty = isKnownArrayKey || isEmptyArray;
							
							if (isArrayProperty) {
								existingProperties[key] = [];
								arrayKeys.add(key); // Mark this key as an array
							} else {
								existingProperties[key] = [trimmedValue];
							}
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
			} catch {
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
									if (item) {
										const arrayValue = templateValues[key];
										if (Array.isArray(arrayValue)) {
											arrayValue.push(item);
										}
									}
								} else if (nextLine === "---" || (nextLine && !nextLine.startsWith("- ") && nextLine.includes(":"))) {
									// Stop at next property or end of properties section
									break;
								}
							}
						}
					} else {
						// This is a string property, not an array
						const slug = this.toKebabCase(title);
						const stringValue = (value || "")
							.replace(/\{\{title\}\}/g, title)
							.replace(/\{\{date\}\}/g, window.moment(new Date()).format(this.settings.dateFormat))
							.replace(/\{\{slug\}\}/g, slug);
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

	async updateTitleInFrontmatter(file: TFile, newTitle: string, type: ContentTypeId): Promise<void> {
		// Check if template has {{title}} - if not, don't update frontmatter at all
		const titleKey = this.getTitleKey(type);
		const hasTitleInTemplate = this.templateHasTitle(type);
		
		// If template doesn't have {{title}}, don't modify frontmatter
		if (!hasTitleInTemplate) {
			return;
		}
		
		const content = await this.app.vault.read(file);
		let propertiesEnd = 0;
		let propertiesText = "";
		let hasFrontmatter = false;

		if (content.startsWith("---")) {
			hasFrontmatter = true;
			propertiesEnd = content.indexOf("\n---", 3);
			if (propertiesEnd === -1) {
				propertiesEnd = content.length;
			} else {
				propertiesEnd += 4;
			}
			propertiesText = content.slice(4, propertiesEnd - 4).trim();
		}

		const propOrder: string[] = [];
		const existing: Record<string, string | string[]> = {};
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
		
		// Also update slug if it exists in frontmatter
		if ("slug" in existing) {
			const newSlug = this.toKebabCase(newTitle);
			existing["slug"] = newSlug;
		}

		// If title key was found in original properties, preserve its position
		// Otherwise, add it at the end
		if (titleKeyPosition === -1) {
			// Title key not found in original properties, add it at the end
			propOrder.push(titleKey);
		}
		// If titleKeyPosition >= 0, the title key is already in propOrder at the correct position

		// Only create/update frontmatter if it already exists
		// Don't create frontmatter from scratch if file had none
		if (!hasFrontmatter) {
			// File had no frontmatter - don't create it, just return
			// The rename already happened, we just don't update frontmatter
			return;
		}

		// Build new content with frontmatter
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
		newContent += "---\n";

		// Get body content (frontmatter already existed, so we know propertiesEnd is set)
		const bodyContent = content.slice(propertiesEnd);
		newContent += bodyContent;

		await this.app.vault.modify(file, newContent);
	}

	private getTitleKey(type: ContentTypeId): string {
		if (type === "note") return "title";
		
		const contentTypes = this.settings.contentTypes || [];
		const contentType = contentTypes.find(ct => ct.id === type);
		if (!contentType) return "title";
		
		const template = contentType.template;
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
	
	// Check if the template for this content type has {{title}}
	private templateHasTitle(type: ContentTypeId): boolean {
		if (type === "note") return true; // Notes always have title
		
		const contentTypes = this.settings.contentTypes || [];
		const contentType = contentTypes.find(ct => ct.id === type);
		if (!contentType) return true; // Default to true for safety
		
		const template = contentType.template;
		return template.includes("{{title}}");
	}
}
