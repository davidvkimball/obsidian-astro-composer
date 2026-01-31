/**
 * Waits for an element to appear in the DOM using MutationObserver.
 * @param selector CSS selector to wait for
 * @param timeout Timeout in milliseconds (default: 5000)
 * @returns Promise that resolves with the element or rejects on timeout
 */
export function waitForElement(selector: string, timeout = 5000): Promise<Element> {
	return new Promise((resolve, reject) => {
		const element = document.querySelector(selector);
		if (element) {
			return resolve(element);
		}

		const observer = new MutationObserver((mutations) => {
			const targetElement = document.querySelector(selector);
			if (targetElement) {
				resolve(targetElement);
				observer.disconnect();
				clearTimeout(timer);
			}
		});

		observer.observe(document.body, {
			childList: true,
			subtree: true,
		});

		const timer = setTimeout(() => {
			observer.disconnect();
			reject(new Error(`Timeout waiting for element matching selector: ${selector}`));
		}, timeout);
	});
}
