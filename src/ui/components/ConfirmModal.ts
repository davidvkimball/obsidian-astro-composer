import { App, Modal } from "obsidian";

export class ConfirmModal extends Modal {
	result: boolean = false;
	resolvePromise: ((result: boolean) => void) | null = null;

	constructor(app: App, private message: string, private confirmText: string = "Confirm", private cancelText: string = "Cancel") {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("astro-composer-confirm-modal");

		contentEl.createEl("p", { text: this.message });

		const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });

		const cancelButton = buttonContainer.createEl("button", {
			text: this.cancelText,
		});
		cancelButton.onclick = () => {
			this.result = false;
			this.close();
		};

		const confirmButton = buttonContainer.createEl("button", {
			text: this.confirmText,
			cls: "mod-cta mod-warning",
		});
		confirmButton.onclick = () => {
			this.result = true;
			this.close();
		};
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
		if (this.resolvePromise) {
			this.resolvePromise(this.result);
		}
	}

	async waitForResult(): Promise<boolean> {
		return new Promise((resolve) => {
			this.resolvePromise = resolve;
			this.open();
		});
	}
}

