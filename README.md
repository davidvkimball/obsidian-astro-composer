# Astro Composer for Obsidian

This plugin streamlines blogging in Obsidian for AstroJS static sites by automating post creation, frontmatter setup, and wikilink conversion.

![astro-composer-plugi-demo](https://github.com/user-attachments/assets/794e965b-a122-433f-a081-dcc643b6af8d)

## Features

- **New Post Dialog**: Prompts for a title when creating a new Markdown file, auto-generating a kebab-case filename ("My Blog Post" → `my-blog-post.md`) and frontmatter with `title`, `date`, `draft`, etc.
- **Frontmatter Standardization**: Updates a note’s frontmatter to match a customizable template.
- **Draft Flexibility**: Mark drafts via frontmatter (`draft: true`) or filename prefix (e.g., `_my-post.md`), configurable in settings.
- **Wikilink Conversion**: Converts Obsidian wikilinks (`[[My Post]]`) to Astro-friendly Markdown links (`[My Post](/blog/my-post/)`), with support for folder-based posts.
- **Configurable Workflow**: Set posts folder (e.g., `posts/`), link base path (e.g., `/blog/`), and choose file-based or folder-based post creation (e.g., `my-post/index.md`).

## Installation

1. Clone or download this plugin into your Obsidian vault’s `.obsidian/plugins/` directory.
2. Ensure `manifest.json` and `main.js` are in the `astro-composer` folder.
3. In Obsidian, go to **Settings > Community Plugins** and enable "Astro Composer."
4. Click the settings icon to configure options.

## Usage

1. **Customize Settings**: In **Settings > Astro Composer**, adjust draft style, posts folder, link base path, and frontmatter template.
2. **Create a Post**: Create a new `.md` file. A modal prompts for the title, then names the file and adds frontmatter.
3. **Convert Wikilinks**: Use `Astro Composer: Convert Wikilinks for Astro` to prepare links for Astro’s routing.


## Contributing

Submit issues or pull requests on the Git repository. Contributions to improve features or fix bugs are welcome!
