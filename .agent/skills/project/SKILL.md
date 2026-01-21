---
name: project
description: Project-specific architecture, maintenance tasks, and unique conventions for Astro Composer. Load when performing project-wide maintenance or working with the core architecture.
---

# Project Context

This skill provides the unique context and architectural details for the **Astro Composer** repository.

## Purpose

To provide guidance on project-specific structures and tasks that differ from general Obsidian development patterns.

## When to Use

Load this skill when:
- Understanding the repository's unique architecture.
- Performing recurring maintenance tasks.
- Following project-specific coding conventions.

## Project Overview

Astro Composer is an Obsidian plugin that turns notes into posts and pages for Astro blogs with automated content management features. It provides a bridge between Obsidian notes and Astro blog content, enabling seamless content creation and management workflows.

## Maintenance Tasks

- **Sync References**: Run the setup scripts (`scripts/setup-ref-links.*`) to update symlinks to the 6 core Obsidian projects.
- **Update Skills**: Use `node scripts/update-agents.mjs "Description"` after syncing or updating reference materials.
- **Test Platforms**: Ensure features are tested on both desktop and mobile.

## Project-Specific Conventions

- **Modular Source**: Core logic is distributed across `src/ui`, `src/utils`, and `src/commands`.
- **Settings Compatibility**: Uses `SettingGroup` with backward compatibility for API versions < 1.11.0.
- **Wildcard Patterns**: Supports wildcard folder matching (e.g., `docs/*`) for content types.
