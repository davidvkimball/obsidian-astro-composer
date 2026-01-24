---
name: project
description: Project-specific architecture, maintenance tasks, and unique conventions for Astro Composer.
---

# Astro Composer Project Skill

Turn your notes into posts and pages for your Astro blog with automated content management features. This plugin simplifies the workflow of publishing Obsidian notes to an Astro project by managing slugs, dates, and frontmatter requirements.

## Core Architecture

- **Astro Integration**: Designed to bridge the gap between Obsidian's markdown and Astro's content collection requirements.
- **Metadata Automation**: Manages slugs and publishing dates automatically.
- **UI Components**: Provides a set of tools/modals for configuring post metadata.

## Project-Specific Conventions

- **Astro Patterns**: Follows standard Astro frontmatter conventions.
- **Slug Management**: Centralizes slug generation logic to avoid collisions.
- **Style Consistency**: Uses `styles.css` (9KB) for specialized modal and view styling.

## Key Files

- `src/main.ts`: Main plugin logic and command registration.
- `manifest.json`: Plugin registration and id (`astro-composer`).
- `styles.css`: Custom UI styling for composer tools.
- `esbuild.config.mjs`: Build script for production bundling.

## Maintenance Tasks

- **Astro Compatibility**: Track changes in Astro's content collection specification.
- **Validation**: Ensure slug generation is safe for all OS file systems.
