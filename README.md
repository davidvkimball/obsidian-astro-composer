# Astro Composer for Obsidian

This plugin streamlines blogging in Obsidian for Astro static sites with automated file renaming, optional frontmatter insertion, and internal link conversion.

![astro-composer-plugin-demo](https://github.com/user-attachments/assets/794e965b-a122-433f-a081-dcc643b6af8d)

## Features

- **New Post Dialog**: When enabled, prompts for a title when creating a new Markdown file, auto-generating a kebab-case filename (e.g., "My Blog Post" → `my-blog-post.md`) and optionally inserting frontmatter with `title`, `date`, etc.
- **Frontmatter Standardization**: Updates a note’s frontmatter to match a customizable template using the "Standardize Frontmatter" command, with optional automatic insertion.
- **Draft Management**: Optionally adds an underscore prefix (e.g., `_my-post.md`) to hide drafts from Astro, configurable via settings.
- **Wikilink Conversion**: Converts Obsidian wikilinks (`[[My Post]]`) to Astro-friendly Markdown links (`[My Post](/blog/my-post/)`), supporting both file-based and folder-based post structures.
- **Configurable Workflow**: Customize posts folder (e.g., `posts/`), link base path (e.g., `/blog/`), creation mode (file-based or folder-based with `index.md`), and date format. Enable or disable auto-renaming and auto-frontmatter insertion independently.

## Installation

1. Clone or download this plugin into your Obsidian vault’s `.obsidian/plugins/` directory.
2. Ensure `manifest.json` and `main.js` are in the `astro-composer` folder.
3. In Obsidian, go to **Settings > Community Plugins** and enable "Astro Composer."
4. Click the settings icon to configure options.

## Usage

1. **Customize Settings**: In **Settings > Astro Composer**, configure:
   - **Auto-rename files**: Toggle to enable the title dialog for new `.md` files.
   - **Auto-insert frontmatter**: Enable to automatically apply the frontmatter template during file creation or standardization.
   - **Posts folder**: Set the folder for blog posts (e.g., `posts/`).
   - **Use underscore prefix for drafts**: Add a prefix (e.g., `_my-post.md`) to hide drafts from Astro.
   - **Creation mode**: Choose file-based (`my-post.md`) or folder-based (`my-post/index.md`) structure.
   - **Index file name**: Name the main file in folder-based mode (e.g., `index`).
   - **Date format**: Set the frontmatter date format (e.g., `YYYY-MM-DD`).
   - **Frontmatter Template**: Define the template for new posts and standardization.
2. **Create a Post**: With "Auto-rename files" enabled, create a new `.md` file to trigger the title dialog, which renames the file and optionally adds frontmatter.
3. **Standardize Frontmatter**: Use the `Astro Composer: Standardize Frontmatter` command to apply the template to an existing note.
4. **Convert Wikilinks**: Use `Astro Composer: Convert Wikilinks for Astro` to transform links for Astro compatibility.

## Contributing

Submit issues or pull requests on the Git repository. Contributions to enhance features or fix bugs are welcome!