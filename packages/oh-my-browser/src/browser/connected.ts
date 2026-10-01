/**
 * Host browser backend: expose Electron Chromium over CDP and attach via
 * coding-agent's existing `connected` BrowserKind (no new registry fork).
 *
 * Agent path (Eval browser prelude):
 *   browser.open({ app: { cdp_url } }) / settings browser.cdpUrl
 *   → goto / observe / click / type on in-app WebContents pages
 *
 * See docs/tools/browser.md and packages/coding-agent/src/tools/browser/registry.ts.
 */

import { logger } from "@oh-my-pi/pi-utils";

/** Default loopback CDP discovery URL once Electron publishes its port. */
export function cdpHttpUrl(port: number): string {
	return `http://127.0.0.1:${port}`;
}

/**
 * Prove the goto → observe → click control path exists for in-app tabs.
 * Used by smoke docs and host wiring comments; runtime uses Eval `browser.*`.
 */
export const HOST_BROWSER_CONTROL_PATH = [
	"Electron enables --remote-debugging-port before app ready",
	"Shell reports shell.cdp_ready { cdpUrl, port } to Bun host",
	"Host overlays settings browser.cdpUrl → connected BrowserKind",
	"Eval browser.goto / browser.observe / browser.click attach via pickElectronTarget",
] as const;

export function logHostBrowserPath(cdpUrl: string): void {
	logger.info("oh-my-browser host CDP backend ready", {
		cdpUrl,
		kind: "connected",
		ops: ["goto", "observe", "click", "type", "fill"],
		path: HOST_BROWSER_CONTROL_PATH,
	});
}

/**
 * Build open options the agent (or host) can pass into Eval so the prelude
 * attaches to this app instead of launching headless Chromium.
 */
export function connectedOpenOptions(
	cdpUrl: string,
	target?: string,
): {
	app: { cdp_url: string; target?: string };
} {
	return {
		app: {
			cdp_url: cdpUrl,
			...(target ? { target } : {}),
		},
	};
}
