import { App, Modal } from "obsidian";

export interface MigrationConflictResult {
	action: "skip" | "migrate";
}

export class MigrationModal extends Modal {
	result: MigrationConflictResult | null = null;
	resolvePromise: ((result: MigrationConflictResult) => void) | null = null;

	constructor(app: App, conflicts: string[]) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("astro-composer-migration-modal");

		contentEl.createEl("h2", { text: "Migration Conflict Detected" });

		contentEl.createEl("p", {
			text: "You have existing content types with names that conflict with Posts or Pages. How would you like to proceed?",
		});

		const conflictList = contentEl.createEl("ul");
		conflictList.createEl("li", { text: "Skip migration: Keep your existing Posts/Pages settings (they will be ignored)" });
		conflictList.createEl("li", { text: "Migrate with renamed types: Create 'Posts (migrated)' and 'Pages (migrated)' content types" });

		const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });

		const skipButton = buttonContainer.createEl("button", {
			text: "Skip Migration",
			cls: "mod-cta",
		});
		skipButton.onclick = () => {
			this.result = { action: "skip" };
			this.close();
		};

		const migrateButton = buttonContainer.createEl("button", {
			text: "Migrate with Renamed Types",
			cls: "mod-cta",
		});
		migrateButton.onclick = () => {
			this.result = { action: "migrate" };
			this.close();
		};
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
		if (this.resolvePromise && this.result) {
			this.resolvePromise(this.result);
		}
	}

	async waitForResult(): Promise<MigrationConflictResult> {
		return new Promise((resolve) => {
			this.resolvePromise = resolve;
			this.open();
		});
	}
}

