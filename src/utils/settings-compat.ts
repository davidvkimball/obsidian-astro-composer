/**
 * Compatibility utilities for settings
 * Provides backward compatibility for SettingGroup (requires API 1.11.0+)
 */

import { Setting, requireApiVersion } from 'obsidian';
import * as ObsidianModule from 'obsidian';

/**
 * Interface that works with both SettingGroup and fallback container
 */
export interface SettingsContainer {
	addSetting(cb: (setting: Setting) => void): void;
}

/**
 * Creates a settings container that uses SettingGroup if available (API 1.11.0+),
 * otherwise falls back to creating a heading and using the container directly.
 * 
 * Uses requireApiVersion('1.11.0') to check if SettingGroup is available.
 * This is the official Obsidian API method for version checking.
 * 
 * @param containerEl - The container element for settings
 * @param heading - The heading text for the settings group (optional)
 * @param manifestId - The plugin's manifest ID for CSS scoping (required for fallback mode)
 * @returns A container that can be used to add settings
 */
export function createSettingsGroup(
	containerEl: HTMLElement,
	heading?: string,
	manifestId?: string
): SettingsContainer {
	// Check if SettingGroup is available (API 1.11.0+)
	// requireApiVersion is the official Obsidian API method for version checking
	if (requireApiVersion('1.11.0')) {
		// Use SettingGroup - it's guaranteed to exist if requireApiVersion returns true
		// Access SettingGroup via type assertion since it may not be in type definitions
		// for older TypeScript versions, but exists at runtime in Obsidian 1.11.0+
		// Using unknown instead of any to satisfy eslint while maintaining type safety
		const SettingGroupClass = (ObsidianModule as unknown as { SettingGroup?: new (containerEl: HTMLElement) => {
			setHeading(heading: string): {
				addSetting(cb: (setting: Setting) => void): void;
			};
			addSetting(cb: (setting: Setting) => void): void;
		} }).SettingGroup;
		
		if (SettingGroupClass) {
			const group = heading 
				? new SettingGroupClass(containerEl).setHeading(heading)
				: new SettingGroupClass(containerEl);
			return {
				addSetting(cb: (setting: Setting) => void) {
					group.addSetting(cb);
				}
			};
		}
	}
	
	// Fallback path (either API < 1.11.0 or SettingGroup not found)
	// Add scoping class to containerEl to scope CSS to only this plugin's settings
	if (manifestId) {
		containerEl.addClass(`${manifestId}-settings-compat`);
	}
	
	{
		// Fallback: Create a heading manually for older API versions
		// Note: While best practice prefers Setting.setHeading(), the fallback path
		// is for versions that may not support it, so manual heading is appropriate here
		if (heading) {
			const headingEl = containerEl.createDiv('setting-group-heading');
			headingEl.createEl('h3', { text: heading });
		}
		
		return {
			addSetting(cb: (setting: Setting) => void) {
				const setting = new Setting(containerEl);
				cb(setting);
			}
		};
	}
}
