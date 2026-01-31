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
	// Normalize for case-insensitive matching
	const normalizedFilePath = filePath.toLowerCase();
	const normalizedPattern = folderPattern.toLowerCase().replace(/^\/|\/$/g, "");

	// Handle empty folder pattern (root folder) - matches files in vault root only
	if (!normalizedPattern || normalizedPattern.trim() === "") {
		return !normalizedFilePath.includes("/") || (normalizedFilePath.split("/").length === 1);
	}

	// If pattern doesn't contain wildcards, use simple prefix matching
	if (!normalizedPattern.includes("*")) {
		return normalizedFilePath === normalizedPattern || normalizedFilePath.startsWith(normalizedPattern + "/");
	}

	// Convert wildcard pattern to regex
	// Escape special regex characters except *
	const escapedPattern = normalizedPattern
		.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
		.replace(/\*/g, "[^/]+"); // Wildcard matches any path segment (non-slash characters)

	// Create regex that matches the pattern and anything after it
	const regexPattern = `^${escapedPattern}(?:/|$)`;
	const regex = new RegExp(regexPattern);
	return regex.test(normalizedFilePath);
}

/**
 * Gets the depth of a folder pattern (number of segments)
 * Used for prioritizing more specific patterns
 * Blank/root folder has depth 0 (least specific)
 * @param folderPattern The folder pattern
 * @returns The number of path segments in the pattern (0 for root/blank)
 */
export function getPatternDepth(folderPattern: string): number {
	if (!folderPattern || folderPattern.trim() === "") return 0;
	return folderPattern.split("/").length;
}

/**
 * Sorts content types by pattern specificity (more specific patterns first)
 * This ensures that more specific patterns are checked before less specific ones
 * Blank/root folder patterns (depth 0) are sorted last (least specific)
 */
export function sortByPatternSpecificity<T extends { folder: string }>(types: T[]): T[] {
	return [...types].sort((a, b) => {
		const depthA = getPatternDepth(a.folder);
		const depthB = getPatternDepth(b.folder);
		// More specific (deeper) patterns first
		// Blank patterns (depth 0) will be sorted last
		return depthB - depthA;
	});
}

