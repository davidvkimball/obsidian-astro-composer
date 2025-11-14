# Astro Composer for Obsidian

Turn your Obsidian notes into posts and pages for your Astro blog with automated content management features.

![astro-composer-plugin-demo](https://github.com/user-attachments/assets/794e965b-a122-433f-a081-dcc643b6af8d)

## Video Guide

📺 [Astro Composer Plugin for Obsidian Video Guide](https://www.youtube.com/watch?v=VVs9RytpTfc)

## Features

- **New Post Dialog**: When enabled, prompts for a title when creating a new Markdown file via Obsidian's "New note" action, auto-generating a kebab-case filename (e.g., "My Blog Post" → `my-blog-post.md`) and optionally inserting properties with `title`, `date`, etc.
- **Property Standardization**: Updates a note's properties to match a customizable template using the "Standardize Properties" command. Preserves existing property values, adds missing properties from the template in the specified order, and appends unrecognized properties at the end.
- **Draft Management**: Optionally adds an underscore prefix (e.g., `_my-post.md`) to hide drafts from Astro, configurable via settings.
- **Internal Link Conversion**: Converts Obsidian wikilinks and markdown internal links (`[[My Post]] or [My Post](my-post)`) to Astro-friendly Markdown links (`[My Post](/blog/my-post/)`), supporting both file-based and folder-based post structures.
- **Configurable Workflow**: Customize posts folder, link base path, creation mode (file-based or folder-based with `index.md`), date format, and excluded directories. Enable or disable automation for new notes and properties insertion independently.
- **Robust Automation**: Only triggers the title dialog for user-initiated new notes (e.g., via "New note" command), avoiding unwanted prompts during vault loading or file imports (e.g., via git pull).
- **Rename Post Command**: easily rename your notes by updating the title property with the desired post name, and get a kebab-case file or folder update afterward.

## Installation

1. Clone or download this plugin into your Obsidian vault’s `.obsidian/plugins/` directory.
2. Ensure `manifest.json`, `main.js`, and `styles.css` are in the `astro-composer` folder.
3. In Obsidian, go to **Settings > Community Plugins**, enable "Community Plugins" if not already enabled, and then enable "Astro Composer."
4. Click the settings icon next to "Astro Composer" to configure options.

## Usage

1. **Customize Settings**: In **Settings > Astro Composer**, configure:
   - **Automate post creation**: Toggle to enable the title dialog for new `.md` files created via Obsidian's "New note" action (ensure your default new note location matches your post location in Obsidian settings).
   - **Auto-insert properties**: Enable to automatically apply the properties template when creating new files (requires "Automate post creation" to be enabled).
   - **Posts folder**: Set the folder for blog posts (leave blank to use the vault root). Specify the default location for new notes in Obsidian's **Settings > Files and links**.
   - **Ignore subfolders**: Restrict automation to the specified posts folder and its subfolders.
   - **Excluded directories**: List directories to exclude from automation (e.g., `pages|posts/example`), separated by `|`, when not restricted to the posts folder.
   - **Use underscore prefix for drafts**: Add a prefix (e.g., `_my-post.md`) to hide drafts from Astro.
   - **Creation mode**: Choose file-based (`my-post.md`) or folder-based (`my-post/index.md`) structure.
   - **Index file name**: Name the main file in folder-based mode (e.g., `index`).
   - **Date format**: Set the properties date format (e.g., `YYYY-MM-DD` or `MMMM D, YYYY`).
   - **Properties template**: Define the template for new posts and standardization (e.g., `---\ntitle: "{{title}}"\ndate: {{date}}\ndescription: ""\ntags: []\n---`).
2. **Create More Content Types**: With "Enable pages" enabled and by creating custom content types, you can do the same automation behavior for any other content type, like pages, documentation, projects, etc.
3. **Standardize Properties**: Use the `Astro Composer: Standardize Properties` command to update a note's properties to the relevant content type, preserving existing values, adding missing properties, and maintaining the template's order with unrecognized properties at the end.
4. **Convert Internal Links**: Use the `Astro Composer: Convert internal links for Astro` command to transform Obsidian wikilinks and internal Markdown links into Astro-compatible Markdown links.
5. **Rename Content**: Using the `Astro Composer: Rename Current Note` command, set the title of your content and have the file or parent folder get automatically renamed with the kebab-case version.

## Roadmap
- MDX Support

## Contributing

Submit issues or pull requests on the [GitHub repository](https://github.com/davidvkimball/obsidian-astro-composer). Contributions to enhance features, improve documentation, or fix bugs are welcome!
