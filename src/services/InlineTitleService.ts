import { App, MarkdownView, TFile } from "obsidian";
import { AstroComposerPluginInterface } from "../types";

/**
 * Shows the parent folder name in Obsidian's inline title for folder-based
 * content, and lets you edit it in place to rename the folder.
 *
 * For a post stored as `posts/my-post/index.md`, Obsidian's inline title reads
 * "index", which is accurate and useless. The folder name is the slug, it is
 * what appears in the URL, and it is what a rename needs to change.
 *
 * Rather than reusing Obsidian's inline title element, this hides it and
 * renders an editable twin. Obsidian's own element renames the *file* on
 * commit, which would turn `my-post/index.md` into `my-post/my-new-post.md`
 * and break the folder convention. Owning the element outright means that
 * handler never runs, with no need to intercept or suppress it.
 *
 * Editing here changes the slug only. Frontmatter `title:` is left alone,
 * because the headline and the URL are separate things and only one of them
 * is on screen.
 */

const NATIVE_HIDDEN_CLASS = "astro-composer-native-title-hidden";
const SLUG_TITLE_CLASS = "astro-composer-slug-title";

export class InlineTitleService {
	private observer?: MutationObserver;
	private refreshTimer: number | null = null;
	/** Set while an Escape is being processed, so the ensuing blur does not commit. */
	private cancelling = false;

	constructor(
		private app: App,
		private plugin: AstroComposerPluginInterface,
	) {}

	private get doc(): Document {
		return this.app.workspace.containerEl.ownerDocument;
	}

	register(): void {
		// Applied synchronously rather than debounced. Obsidian paints the real
		// basename first, so any delay here shows a visible flash of "index"
		// before the folder name replaces it. Detection is a config lookup with
		// no async work, so it can run in the same tick as the event.
		this.plugin.registerEvent(this.app.workspace.on("file-open", () => this.refresh()));
		this.plugin.registerEvent(this.app.workspace.on("active-leaf-change", () => this.refresh()));
		this.plugin.registerEvent(this.app.workspace.on("layout-change", () => this.refresh()));

		// Obsidian rebuilds the inline title on rename and on some redraws, which
		// discards our twin. The events above miss those.
		//
		// This observes the whole workspace subtree, which CodeMirror mutates on
		// every keystroke, so the callback filters for an actual inline-title
		// node before scheduling work. Without that check it would wake up
		// continuously while typing.
		this.observer = new MutationObserver((mutations) => {
			if (!this.plugin.settings.showFolderNameAsInlineTitle) return;

			for (const mutation of mutations) {
				for (const node of Array.from(mutation.addedNodes)) {
					// Obsidian's instanceOf, not instanceof: pop-out windows have
					// their own HTMLElement constructor and would fail a bare check.
					if (!node.instanceOf(HTMLElement)) continue;
					if (node.hasClass(SLUG_TITLE_CLASS)) continue;
					if (
						node.classList.contains("inline-title") ||
						node.querySelector(".inline-title")
					) {
						this.scheduleRefresh();
						return;
					}
				}
			}
		});
		this.observer.observe(this.app.workspace.containerEl, {
			childList: true,
			subtree: true,
		});

		this.refresh();
	}

	/**
	 * Returns the folder name to display, or null when this file is not a
	 * folder-based index file belonging to a content type we manage.
	 */
	private getFolderTitle(file: TFile): string | null {
		const contentType = this.plugin.fileOps.getContentTypeByPath(file.path);
		if (!contentType || contentType.creationMode !== "folder") return null;

		const indexFileName = contentType.indexFileName || "index";
		if (file.basename !== indexFileName) return null;

		const parent = file.parent;
		if (!parent) return null;
		// An index file sitting in the vault root has no meaningful folder to show.
		if (parent.path === "" || parent.path === "/") return null;

		// Returned raw, so a draft folder reads "_my-post" and what is on screen
		// is exactly what is on disk.
		return parent.name;
	}

	private scheduleRefresh(): void {
		if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
		this.refreshTimer = window.setTimeout(() => {
			this.refreshTimer = null;
			this.refresh();
		}, 0);
	}

	refresh(): void {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (view instanceof MarkdownView) this.applyToView(view);
		}
	}

	private applyToView(view: MarkdownView): void {
		const nativeEl = view.containerEl.querySelector<HTMLElement>(
			`.inline-title:not(.${SLUG_TITLE_CLASS})`,
		);
		if (!nativeEl) return;

		const file = view.file;
		const folderName =
			this.plugin.settings.showFolderNameAsInlineTitle && file
				? this.getFolderTitle(file)
				: null;

		if (!folderName || !file) {
			this.restore(view);
			return;
		}

		nativeEl.addClass(NATIVE_HIDDEN_CLASS);

		const existing = view.containerEl.querySelector<HTMLElement>(`.${SLUG_TITLE_CLASS}`);
		if (existing) {
			// Never overwrite while the user is mid-edit, or their caret jumps to
			// the start on every unrelated workspace redraw.
			if (this.doc.activeElement === existing) return;
			if (existing.textContent !== folderName) existing.textContent = folderName;
			return;
		}

		this.createSlugTitle(nativeEl, folderName, view);
	}

	private createSlugTitle(nativeEl: HTMLElement, folderName: string, view: MarkdownView): void {
		const el = this.doc.createElement("div");
		// Carries .inline-title so it inherits Obsidian's own title styling and
		// stays correct across themes.
		el.className = `inline-title ${SLUG_TITLE_CLASS}`;
		el.setAttribute("contenteditable", "true");
		el.setAttribute("spellcheck", "false");
		el.setAttribute("autocapitalize", "off");
		el.textContent = folderName;

		el.addEventListener("keydown", (evt: KeyboardEvent) => {
			if (evt.key === "Enter") {
				evt.preventDefault();
				el.blur();
				return;
			}
			if (evt.key === "Escape") {
				evt.preventDefault();
				this.cancelling = true;
				const current = view.file?.parent?.name ?? folderName;
				el.textContent = current;
				el.blur();
			}
		});

		el.addEventListener("blur", () => {
			if (this.cancelling) {
				this.cancelling = false;
				return;
			}
			void this.commit(el, view);
		});

		nativeEl.insertAdjacentElement("afterend", el);
	}

	private async commit(el: HTMLElement, view: MarkdownView): Promise<void> {
		const file = view.file;
		if (!file) return;

		const current = file.parent?.name ?? "";
		const typed = (el.textContent ?? "").trim();

		// An emptied title is a slip, not a request to rename to "untitled".
		if (!typed) {
			el.textContent = current;
			return;
		}
		if (typed === current) {
			el.textContent = current;
			return;
		}

		const renamed = await this.plugin.fileOps.renameFolderSlug(file, typed);
		if (!renamed) {
			el.textContent = current;
			return;
		}
		// The sanitized result can differ from what was typed, and the rename may
		// have de-duplicated the name, so show what actually landed on disk.
		el.textContent = renamed.parent?.name ?? typed;
	}

	private restore(view: MarkdownView): void {
		view.containerEl
			.querySelectorAll<HTMLElement>(`.${SLUG_TITLE_CLASS}`)
			.forEach((el) => el.remove());
		view.containerEl
			.querySelectorAll<HTMLElement>(`.${NATIVE_HIDDEN_CLASS}`)
			.forEach((el) => el.removeClass(NATIVE_HIDDEN_CLASS));
	}

	destroy(): void {
		if (this.refreshTimer !== null) {
			window.clearTimeout(this.refreshTimer);
			this.refreshTimer = null;
		}
		this.observer?.disconnect();
		this.observer = undefined;

		// Hand every title we touched back to Obsidian.
		this.doc.querySelectorAll<HTMLElement>(`.${SLUG_TITLE_CLASS}`).forEach((el) => el.remove());
		this.doc
			.querySelectorAll<HTMLElement>(`.${NATIVE_HIDDEN_CLASS}`)
			.forEach((el) => el.removeClass(NATIVE_HIDDEN_CLASS));
	}
}
