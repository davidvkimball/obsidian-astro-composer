/**
 * Utility functions for matching file paths against folder patterns with wildcard support.
 * 
 * Wildcard patterns:
 * - `docs` matches `docs/` and anything under it
 * - `docs/{asterisk}` matches `docs/anything/` and anything under it (one level deep)
 * - `docs/{asterisk}/{asterisk}` matches `docs/anything/anything/` and anything under it (two levels deep)
 * - etc.
 * 
 * Note: {asterisk} represents the wildcard character *
 */

/**
 * Checks if a file path matches a folder pattern (supports wildcards)
 * @param filePath The file path to check (e.g., "docs/example-a/getting-started.md")
 * @param folderPattern The folder pattern - use asterisk for wildcards (e.g., "docs", "docs/asterisk", "docs/asterisk/asterisk")
 * @returns true if the file path matches the pattern
 */
export function matchesFolderPattern(filePath: string, folderPattern: string): boolean {
	// Handle empty folder pattern
	if (!folderPattern) {
		return false;
	}

	// If pattern doesn't contain wildcards, use simple prefix matching
	if (!folderPattern.includes("*")) {
		return filePath === folderPattern || filePath.startsWith(folderPattern + "/");
	}

	// Convert wildcard pattern to regex
	// Escape special regex characters except *
	const escapedPattern = folderPattern
		.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
		.replace(/\*/g, "[^/]+"); // Wildcard matches any path segment (non-slash characters)

	// Create regex that matches the pattern and anything after it
	const regexPattern = `^${escapedPattern}(?:/|$)`;
	const regex = new RegExp(regexPattern);
	return regex.test(filePath);
}

/**
 * Gets the depth of a folder pattern (number of segments)
 * Used for prioritizing more specific patterns
 * @param folderPattern The folder pattern
 * @returns The number of path segments in the pattern
 */
export function getPatternDepth(folderPattern: string): number {
	if (!folderPattern) return 0;
	return folderPattern.split("/").length;
}

/**
 * Sorts custom content types by pattern specificity (more specific patterns first)
 * This ensures that more specific patterns are checked before less specific ones
 */
export function sortByPatternSpecificity<T extends { folder: string }>(types: T[]): T[] {
	return [...types].sort((a, b) => {
		const depthA = getPatternDepth(a.folder);
		const depthB = getPatternDepth(b.folder);
		// More specific (deeper) patterns first
		return depthB - depthA;
	});
}

