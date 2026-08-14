import { App, MarkdownView, TFile } from "obsidian";
import { AstroComposerPluginInterface } from "../types";

/**
 * Shows the parent folder name in Obsidian's inline title for folder-based
 * content, instead of the index file's basename.
 *
 * For a post stored as `posts/my-post/index.md`, Obsidian's inline title reads
 * "index", which is accurate but useless. The folder name is the thing that
 * actually identifies the post, and it is the thing a rename needs to change.
 *
 * The element is made read-only rather than left editable. Obsidian's native
 * inline title renames the *file*, so an edit left unintercepted would turn
 * `my-post/index.md` into `my-post/My Post.md`, which silently breaks the
 * folder convention. Clicking instead routes to the existing rename flow,
 * which already renames the parent folder and updates links.
 */

const MANAGED_CLASS = "astro-composer-folder-inline-title";

export class InlineTitleService {
	private observer?: MutationObserver;
	private refreshTimer: number | null = null;

	constructor(
		private app: App,
		private plugin: AstroComposerPluginInterface,
	) {}

	private get doc(): Document {
		return this.app.workspace.containerEl.ownerDocument;
	}

	register(): void {
		this.plugin.registerEvent(
			this.app.workspace.on("file-open", () => this.scheduleRefresh()),
		);
		this.plugin.registerEvent(
			this.app.workspace.on("active-leaf-change", () => this.scheduleRefresh()),
		);
		this.plugin.registerEvent(
			this.app.workspace.on("layout-change", () => this.scheduleRefresh()),
		);

		// Obsidian rebuilds the inline title node on rename and on some redraws,
		// which drops our text. The events above miss those, so watch for the
		// node being replaced underneath us.
		//
		// This observes the whole workspace subtree, which CodeMirror mutates on
		// every keystroke, so the callback filters for an actual inline-title
		// node before scheduling any work. Without that check this would wake up
		// continuously while typing.
		this.observer = new MutationObserver((mutations) => {
			if (!this.plugin.settings.showFolderNameAsInlineTitle) return;

			for (const mutation of mutations) {
				for (const node of Array.from(mutation.addedNodes)) {
					// Obsidian's instanceOf, not instanceof: pop-out windows have
					// their own HTMLElement constructor and would fail a bare check.
					if (!node.instanceOf(HTMLElement)) continue;
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

		this.registerClickHandler();
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

		// Returned raw, so a draft folder reads "_my-post" and the title always
		// matches what is actually on disk.
		return parent.name;
	}

	private scheduleRefresh(): void {
		if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
		this.refreshTimer = window.setTimeout(() => {
			this.refreshTimer = null;
			this.refresh();
		}, 20);
	}

	refresh(): void {
		const views = this.app.workspace.getLeavesOfType("markdown");
		for (const leaf of views) {
			const view = leaf.view;
			if (view instanceof MarkdownView) this.applyToView(view);
		}
	}

	private applyToView(view: MarkdownView): void {
		const titleEl = view.containerEl.querySelector<HTMLElement>(".inline-title");
		if (!titleEl) return;

		const file = view.file;
		const folderName =
			this.plugin.settings.showFolderNameAsInlineTitle && file
				? this.getFolderTitle(file)
				: null;

		if (!folderName) {
			this.restore(titleEl, file);
			return;
		}

		// Bail when already correct. Writing unconditionally would retrigger the
		// observer and loop.
		if (titleEl.hasClass(MANAGED_CLASS) && titleEl.textContent === folderName) {
			return;
		}

		titleEl.textContent = folderName;
		titleEl.setAttribute("contenteditable", "false");
		titleEl.addClass(MANAGED_CLASS);
	}

	private restore(titleEl: HTMLElement, file: TFile | null): void {
		if (!titleEl.hasClass(MANAGED_CLASS)) return;

		titleEl.removeClass(MANAGED_CLASS);
		titleEl.setAttribute("contenteditable", "true");
		if (file) titleEl.textContent = file.basename;
	}

	private registerClickHandler(): void {
		// Capture phase, so this runs before Obsidian's own inline-title handling.
		this.plugin.registerDomEvent(
			this.doc,
			"click",
			(evt: MouseEvent) => {
				if (!this.plugin.settings.showFolderNameAsInlineTitle) return;

				const target = evt.target as HTMLElement | null;
				if (!target?.closest(`.${MANAGED_CLASS}`)) return;

				const activeFile = this.app.workspace.getActiveFile();
				if (!activeFile) return;
				if (!this.getFolderTitle(activeFile)) return;

				evt.preventDefault();
				evt.stopPropagation();
				this.plugin.renameContentByPath(activeFile.path);
			},
			true,
		);
	}

	destroy(): void {
		if (this.refreshTimer !== null) {
			window.clearTimeout(this.refreshTimer);
			this.refreshTimer = null;
		}
		this.observer?.disconnect();
		this.observer = undefined;

		// Hand every title we touched back to Obsidian.
		const managed = this.doc.querySelectorAll<HTMLElement>(`.${MANAGED_CLASS}`);
		managed.forEach((el) => {
			el.removeClass(MANAGED_CLASS);
			el.setAttribute("contenteditable", "true");
		});
		this.refreshOnDestroy();
	}

	/**
	 * After clearing our markers, put each visible title back to the real
	 * basename so the editor is not left showing a folder name it cannot rename.
	 */
	private refreshOnDestroy(): void {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView) || !view.file) continue;
			const titleEl = view.containerEl.querySelector<HTMLElement>(".inline-title");
			if (titleEl) titleEl.textContent = view.file.basename;
		}
	}
}
