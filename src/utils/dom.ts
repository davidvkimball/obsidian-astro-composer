/**
 * Waits for an element to appear in the DOM using MutationObserver.
 * @param selector CSS selector to wait for
 * @param timeout Timeout in milliseconds (default: 5000)
 * @returns Promise that resolves with the element or rejects on timeout
 */
export function waitForElement(selector: string, timeout = 5000): Promise<Element> {
	return new Promise((resolve, reject) => {
		const element = activeDocument.querySelector(selector);
		if (element) {
			return resolve(element);
		}

		const observer = new MutationObserver((mutations) => {
			const targetElement = activeDocument.querySelector(selector);
			if (targetElement) {
				resolve(targetElement);
				observer.disconnect();
				window.clearTimeout(timer);
			}
		});

		observer.observe(activeDocument.body, {
			childList: true,
			subtree: true,
		});

		const timer = window.setTimeout(() => {
			observer.disconnect();
			reject(new Error(`Timeout waiting for element matching selector: ${selector}`));
		}, timeout);
	});
}
