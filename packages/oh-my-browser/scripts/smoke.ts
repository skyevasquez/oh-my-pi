#!/usr/bin/env bun
/**
 * Headless smoke: load createAgentSession + control server + prompt templates
 * without spawning Electron (CI / no-display safe).
 */
import { logger } from "@oh-my-pi/pi-utils";
import { connectedOpenOptions, HOST_BROWSER_CONTROL_PATH } from "../src/browser/connected";
import { cdpHttpUrl } from "../src/browser/cdp-port";
import { startHost } from "../src/host/index";
import browserSystem from "../src/prompts/browser-system.md" with { type: "text" };
import desktopAppend from "../src/prompts/desktop-append.md" with { type: "text" };

if (!browserSystem.includes("oh-my-browser") || !desktopAppend.includes("desktop rules")) {
	logger.error("oh-my-browser smoke: prompt templates failed to load");
	process.exit(1);
}

const host = await startHost({
	cwd: process.env.OMB_CWD ?? process.cwd(),
	smoke: true,
});

const cdpUrl = cdpHttpUrl(host.cdpPort);
const openOpts = connectedOpenOptions(cdpUrl);

// IPC ping against the control server
const ws = new WebSocket(host.controlUrl);
const { promise: pingPromise, resolve: resolvePing, reject: rejectPing } = Promise.withResolvers<void>();
const timer = setTimeout(() => rejectPing(new Error("control ping timeout")), 5_000);

ws.addEventListener("open", () => {
	ws.send(JSON.stringify({ type: "shell.ping", nonce: "smoke" }));
});
ws.addEventListener("message", event => {
	try {
		const msg = JSON.parse(String(event.data)) as { type?: string; nonce?: string };
		if (msg.type === "host.pong" && msg.nonce === "smoke") {
			clearTimeout(timer);
			resolvePing();
		}
	} catch (err) {
		rejectPing(err);
	}
});
ws.addEventListener("error", () => rejectPing(new Error("control websocket error")));

await pingPromise;
ws.close();

logger.info("oh-my-browser smoke passed", {
	controlUrl: host.controlUrl,
	cdpUrl,
	openOpts,
	hostBrowserPath: HOST_BROWSER_CONTROL_PATH,
	model: host.bridge.modelLabel,
	permissionMode: host.bridge.permissionMode,
	cwd: host.bridge.workingDirectory,
});

await host.stop();
process.exit(0);
