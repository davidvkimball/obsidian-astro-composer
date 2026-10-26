/**
 * Makes a title safe to use as a file name while keeping it as typed:
 * "My Note: Part 2?" becomes "My Note Part 2". Removes the characters that
 * file systems reject or that break Obsidian links (\ / : * ? " < > | # ^ [ ]),
 * plus control and bidi characters, and avoids Windows reserved names.
 * @param str The title
 * @returns A file name without extension, or "" if nothing usable is left
 */
export function toSafeFileName(str: string): string {
    const cleaned = str
        .normalize("NFC")
        .replace(/[‎‏‪-‮⁦-⁩]/g, "")
        .split("")
        .filter(char => char.charCodeAt(0) >= 32)
        .join("")
        .replace(/[\\/:*?"<>|#^[\]]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        // A leading dot hides the file; trailing dots and spaces are dropped by Windows.
        .replace(/^\.+/, "")
        .replace(/[.\s]+$/g, "");

    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(cleaned)) {
        return `${cleaned} file`;
    }
    return cleaned;
}

/**
 * Converts a string to kebab-case.
 * @param str The string to convert
 * @returns Kebab-case string
 */
export function toKebabCase(str: string): string {
    const normalized = str
        .normalize("NFKC")
        .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
        .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2$3")
        .toLowerCase()
        // Strip bidi control chars that can visually reorder filename text.
        .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
        // Replace filesystem-invalid filename chars with spaces so separators stay stable.
        .replace(/[<>:"/\\|?*]/g, " ")
        .split("")
        .filter(char => char.charCodeAt(0) >= 32)
        .join("")
        // Keep letters/numbers from all scripts plus spaces and dashes.
        .replace(/[^\p{L}\p{N}\p{M}\s-]/gu, "")
        .trim()
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");

    if (!normalized) {
        return "";
    }

    // Avoid Windows reserved file basenames across all platforms.
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(normalized)) {
        return `${normalized}-file`;
    }

    return normalized.replace(/[.\s]+$/g, "");
}
