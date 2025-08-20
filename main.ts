import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder } from 'obsidian';

interface AstroCompanionSettings {
	draftStyle: 'frontmatter' | 'filename';
	defaultTemplate: string;
	linkBasePath: string;
	postsFolder: string;
	enableAutoRename: boolean;
}

const DEFAULT_SETTINGS: AstroCompanionSettings = {
	draftStyle: 'frontmatter',
	defaultTemplate: '---\ntitle: "{{title}}"\ndate: "{{date}}"\ndescription: ""\ntags: []\ndraft: true\n---\n\n',
	linkBasePath: '/blog/',
	postsFolder: 'posts',
	enableAutoRename: true
}

export default class AstroComposerPlugin extends Plugin {
	settings: AstroCompanionSettings;

	async onload() {
		await this.loadSettings();

		// Register file creation event
		this.registerEvent(
			this.app.vault.on('create', (file) => {
				if (file instanceof TFile && file.extension === 'md') {
					// Show modal for all new markdown files if auto-rename is enabled
					// Or only for files in posts folder if specified
					if (this.settings.enableAutoRename || 
						(this.settings.postsFolder && file.path.startsWith(this.settings.postsFolder))) {
						// Small delay to ensure file is fully created
						setTimeout(() => {
							new PostTitleModal(this.app, file, this).open();
						}, 100);
					}
				}
			})
		);

		// Add commands
		this.addCommand({
			id: 'standardize-frontmatter',
			name: 'Standardize Frontmatter',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.standardizeFrontmatter(view.file);
			}
		});

		this.addCommand({
			id: 'convert-wikilinks-astro',
			name: 'Convert Wikilinks for Astro',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.convertWikilinksForAstro(editor, view.file);
			}
		});

		this.addCommand({
			id: 'publish-note',
			name: 'Publish Note',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.publishNote(editor, view.file);
			}
		});

		this.addCommand({
			id: 'setup-astro-folders',
			name: 'Setup Astro-friendly folder structure',
			callback: () => {
				this.setupAstroFolders();
			}
		});

		// Add settings tab
		this.addSettingTab(new AstroCompanionSettingTab(this.app, this));
	}

	

	toKebabCase(str: string): string {
		return str
			.toLowerCase()
			.replace(/[^a-z0-9\s-]/g, '') // Remove invalid characters
			.trim()
			.replace(/\s+/g, '-') // Replace spaces with hyphens
			.replace(/-+/g, '-') // Remove multiple consecutive hyphens
			.replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
	}

	async renameFileWithTitle(file: TFile, title: string) {
		const kebabTitle = this.toKebabCase(title);
		const isDraft = this.settings.draftStyle === 'filename';
		const prefix = isDraft ? '_' : '';
		const newName = `${prefix}${kebabTitle}.md`;

		const folder = file.parent;
		const newPath = folder ? `${folder.path}/${newName}` : newName;

		// Check if file with new name already exists
		const existingFile = this.app.vault.getAbstractFileByPath(newPath);
		if (existingFile && existingFile !== file) {
			new Notice(`File with name "${newName}" already exists`);
			return null;
		}

		try {
			await this.app.vault.rename(file, newPath);
			return this.app.vault.getAbstractFileByPath(newPath) as TFile;
		} catch (error) {
			new Notice(`Failed to rename file: ${error.message}`);
			return null;
		}
	}

	async addFrontmatterToFile(file: TFile, title: string, slug?: string) {
		const content = await this.app.vault.read(file);
		const date = new Date().toISOString();

		let template = this.settings.defaultTemplate;
		
		// Replace template variables
		template = template.replace(/\{\{title\}\}/g, title);
		template = template.replace(/\{\{date\}\}/g, date);

		// For new files created through the modal, just add the template
		// (they shouldn't have frontmatter yet since we're doing this after user input)
		const newContent = template + content;
		await this.app.vault.modify(file, newContent);
		new Notice(`Added frontmatter with title: ${title}`);
	}

	async standardizeFrontmatter(file: TFile | null) {
		if (!file) {
			new Notice('No active file');
			return;
		}

		const content = await this.app.vault.read(file);
		const title = file.basename.replace(/^_/, ''); // Remove draft prefix if present

		// Parse existing frontmatter or create new
		let frontmatterEnd = 0;
		let existingFrontmatter: any = {};

		if (content.startsWith('---')) {
			const secondDelimiter = content.indexOf('\n---', 3);
			if (secondDelimiter !== -1) {
				frontmatterEnd = secondDelimiter + 4;
				const frontmatterText = content.slice(4, secondDelimiter);
				try {
					// Simple YAML parsing for basic fields
					frontmatterText.split('\n').forEach(line => {
						const match = line.match(/^(\w+):\s*(.+)$/);
						if (match) {
							const [, key, value] = match;
							existingFrontmatter[key] = value.replace(/^["'\[\]]|["'\[\]]$/g, '');
						}
					});
				} catch (error) {
					new Notice('Failed to parse existing frontmatter');
				}
			}
		}

		// Use template from settings and replace variables
		let template = this.settings.defaultTemplate;
		template = template.replace(/\{\{title\}\}/g, existingFrontmatter.title || title);
		template = template.replace(/\{\{date\}\}/g, existingFrontmatter.date || new Date().toISOString());

		// Handle draft status based on settings
		const draftValue = this.settings.draftStyle === 'frontmatter' ? 'true' : 'false';
		template = template.replace(/draft:\s*true/g, `draft: ${existingFrontmatter.draft || draftValue}`);

		const bodyContent = content.slice(frontmatterEnd);
		const newContent = template + (template.endsWith('\n') ? '' : '\n') + bodyContent;

		await this.app.vault.modify(file, newContent);
		new Notice('Frontmatter standardized using template');
	}

	async convertWikilinksForAstro(editor: Editor, file: TFile | null) {
		if (!file) {
			new Notice('No active file');
			return;
		}

		const content = editor.getValue();
		let newContent = content;

		// Convert wikilinks [[Title]] or [[Title|Display Text]]
		newContent = newContent.replace(/\[\[([^\]|]+)(\|([^\]]+))?\]\]/g, (match, linkText, _, displayText) => {
			const display = displayText || linkText;
			const slug = this.toKebabCase(linkText);
			return `[${display}](${this.settings.linkBasePath}${slug})`;
		});

		// Convert image wikilinks ![[image.png]] to Astro-compatible format
		newContent = newContent.replace(/!\[\[([^\]]+)\]\]/g, (match, imageName) => {
			const cleanName = imageName.replace(/\.[^/.]+$/, ""); // Remove extension
			const slug = this.toKebabCase(cleanName);
			return `![${cleanName}](${this.settings.linkBasePath}images/${imageName})`;
		});

		// Convert embedded files {{embed.md}} to include format
		newContent = newContent.replace(/\{\{([^}]+)\}\}/g, (match, fileName) => {
			const slug = this.toKebabCase(fileName.replace('.md', ''));
			return `[Embedded: ${fileName}](${this.settings.linkBasePath}${slug})`;
		});

		editor.setValue(newContent);
		new Notice('Wikilinks converted for Astro');
	}

	async publishNote(editor: Editor, file: TFile | null) {
		if (!file) {
			new Notice('No active file');
			return;
		}

		// First convert wikilinks
		await this.convertWikilinksForAstro(editor, file);

		// Then handle draft status
		if (this.settings.draftStyle === 'filename' && file.name.startsWith('_')) {
			// Remove underscore prefix
			const newName = file.name.substring(1);
			const newPath = file.parent ? `${file.parent.path}/${newName}` : newName;
			await this.app.vault.rename(file, newPath);
			file = this.app.vault.getAbstractFileByPath(newPath) as TFile;
		}

		// Update frontmatter
		const content = await this.app.vault.read(file);
		let newContent = content;

		// Remove draft: true and add published date
		newContent = newContent.replace(/draft:\s*true/g, 'draft: false');
		newContent = newContent.replace(/published:\s*[^\n]*/g, ''); // Remove existing published date

		// Add published date after date field
		const publishedDate = new Date().toISOString();
		newContent = newContent.replace(/(date:\s*[^\n]*\n)/, `$1published: "${publishedDate}"\n`);

		await this.app.vault.modify(file, newContent);
		new Notice('Note published successfully!');
	}

	async setupAstroFolders() {
		const folders = [
			this.settings.postsFolder,
			`${this.settings.postsFolder}/images`,
			'.obsidian-ignore', // Folder for Obsidian files that Astro should ignore
			`${this.settings.postsFolder}/drafts`
		];

		for (const folderPath of folders) {
			const folder = this.app.vault.getAbstractFileByPath(folderPath);
			if (!folder) {
				await this.app.vault.createFolder(folderPath);
			}
		}

		// Create .gitignore for Astro to ignore Obsidian files
		const gitignoreContent = `# Obsidian files
.obsidian/
*.canvas
*.excalidraw
.DS_Store
.obsidian-ignore/
`;

		const gitignorePath = '.gitignore';
		const existingGitignore = this.app.vault.getAbstractFileByPath(gitignorePath);

		if (!existingGitignore) {
			await this.app.vault.create(gitignorePath, gitignoreContent);
		} else {
			const existing = await this.app.vault.read(existingGitignore as TFile);
			if (!existing.includes('.obsidian/')) {
				await this.app.vault.modify(existingGitignore as TFile, existing + '\n' + gitignoreContent);
			}
		}

		new Notice('Astro-friendly folder structure created!');
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class PostTitleModal extends Modal {
	file: TFile;
	plugin: AstroComposerPlugin;
	titleInput: HTMLInputElement;

	constructor(app: App, file: TFile, plugin: AstroComposerPlugin) {
		super(app);
		this.file = file;
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'New Blog Post' });
		contentEl.createEl('p', { text: 'Enter a title for your blog post:' });

		this.titleInput = contentEl.createEl('input', {
			type: 'text',
			placeholder: 'My Awesome Blog Post'
		});
		this.titleInput.style.width = '100%';
		this.titleInput.style.marginBottom = '16px';
		this.titleInput.focus();

		const buttonContainer = contentEl.createDiv();
		buttonContainer.style.display = 'flex';
		buttonContainer.style.gap = '8px';
		buttonContainer.style.justifyContent = 'flex-end';

		const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
		cancelButton.onclick = () => this.close();

		const createButton = buttonContainer.createEl('button', { text: 'Create' });
		createButton.classList.add('mod-cta');
		createButton.onclick = () => this.createPost();

		// Handle Enter key
		this.titleInput.addEventListener('keypress', (e) => {
			if (e.key === 'Enter') {
				this.createPost();
			}
		});
	}

	async createPost() {
		const title = this.titleInput.value.trim();
		if (!title) {
			new Notice('Please enter a title');
			return;
		}

		const renamedFile = await this.plugin.renameFileWithTitle(this.file, title);
		if (renamedFile) {
			await this.plugin.addFrontmatterToFile(renamedFile, title);
			new Notice(`Created blog post: ${renamedFile.name}`);
		}

		this.close();
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class AstroCompanionSettingTab extends PluginSettingTab {
	plugin: AstroComposerPlugin;

	constructor(app: App, plugin: AstroComposerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Draft Style')
			.setDesc('How to mark posts as drafts')
			.addDropdown(dropdown => dropdown
				.addOption('frontmatter', 'Frontmatter (draft: true)')
				.addOption('filename', 'Filename prefix (_post-name.md)')
				.setValue(this.plugin.settings.draftStyle)
				.onChange(async (value: 'frontmatter' | 'filename') => {
					this.plugin.settings.draftStyle = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Posts Folder')
			.setDesc('Folder name for blog posts')
			.addText(text => text
				.setPlaceholder('posts')
				.setValue(this.plugin.settings.postsFolder)
				.onChange(async (value) => {
					this.plugin.settings.postsFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Link Base Path')
			.setDesc('Base path for converted links')
			.addText(text => text
				.setPlaceholder('/blog/')
				.setValue(this.plugin.settings.linkBasePath)
				.onChange(async (value) => {
					this.plugin.settings.linkBasePath = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Auto-rename Files')
			.setDesc('Automatically show title dialog for new .md files')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableAutoRename)
				.onChange(async (value) => {
					this.plugin.settings.enableAutoRename = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Default Frontmatter Template')
			.setDesc('Template for new post frontmatter (use {{title}}, {{date}})')
			.addTextArea(text => {
				text.setPlaceholder('---\ntitle: "{{title}}"\ndate: "{{date}}"\ndescription: ""\ntags: []\ndraft: true\n---\n')
					.setValue(this.plugin.settings.defaultTemplate)
					.onChange(async (value) => {
						this.plugin.settings.defaultTemplate = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.style.height = '200px';
				text.inputEl.style.width = '100%';
			});
	}
}