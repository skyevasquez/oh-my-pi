/**
 * Electron main process: window chrome + multi-tab <webview> content + CDP publish.
 * Built to dist/electron/main.js (Node target) by scripts/build-electron.ts.
 */

import * as path from "node:path";
import { app, BrowserWindow, ipcMain, session } from "electron";
import type {
	BrowserTabState,
	HostToShell,
	PageAttachment,
	PermissionMode,
	ShellToHost,
	TabKind,
} from "../browser/protocol";

const packageRoot = process.env.OMB_PACKAGE_ROOT ?? path.resolve(__dirname, "../..");
const controlUrl = process.env.OMB_CONTROL_URL ?? "";
const cdpPort = Number(process.env.OMB_CDP_PORT ?? "0");

if (cdpPort > 0) {
	app.commandLine.appendSwitch("remote-debugging-port", String(cdpPort));
	app.commandLine.appendSwitch("remote-allow-origins", `http://127.0.0.1:${cdpPort}`);
}

interface TabRecord {
	id: string;
	kind: TabKind;
	title: string;
	url: string;
	active: boolean;
}

let mainWindow: BrowserWindow | null = null;
let controlWs: WebSocket | null = null;
const tabs = new Map<string, TabRecord>();
let activeTabId: string | null = null;
let tabSeq = 0;

function sendToHost(message: ShellToHost): void {
	if (!controlWs || controlWs.readyState !== WebSocket.OPEN) return;
	controlWs.send(JSON.stringify(message));
}

function sendToRenderer(channel: string, payload: unknown): void {
	mainWindow?.webContents.send(channel, payload);
}

function nextTabId(): string {
	tabSeq += 1;
	return `tab-${tabSeq}`;
}

function snapshotTabs(): BrowserTabState[] {
	return [...tabs.values()].map(t => ({
		...t,
		active: t.id === activeTabId,
	}));
}

function publishTabs(): void {
	const list = snapshotTabs();
	sendToRenderer("omb:tabs", list);
	sendToHost({ type: "shell.tabs_changed", tabs: list });
}

function connectControl(): void {
	if (!controlUrl) return;
	const ws = new WebSocket(controlUrl);
	controlWs = ws;
	ws.addEventListener("open", () => {
		sendToHost({ type: "shell.hello", version: "0.1.0" });
		if (cdpPort > 0) {
			sendToHost({
				type: "shell.cdp_ready",
				cdpUrl: `http://127.0.0.1:${cdpPort}`,
				port: cdpPort,
			});
		}
		sendToHost({ type: "shell.ping", nonce: `boot-${Date.now()}` });
	});
	ws.addEventListener("message", event => {
		try {
			const msg = JSON.parse(String(event.data)) as HostToShell;
			sendToRenderer("omb:host", msg);
		} catch {
			// ignore malformed
		}
	});
	ws.addEventListener("close", () => {
		controlWs = null;
		setTimeout(connectControl, 1000);
	});
	ws.addEventListener("error", () => {
		// reconnect via close
	});
}

function createWindow(): void {
	const preload = path.join(packageRoot, "dist/electron/preload.cjs");
	const uiHtml = path.join(packageRoot, "src/ui/index.html");

	mainWindow = new BrowserWindow({
		width: 1440,
		height: 960,
		minWidth: 960,
		minHeight: 640,
		title: "oh-my-browser",
		backgroundColor: "#e8eef5",
		webPreferences: {
			preload,
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
			webviewTag: true,
			partition: "persist:omb-chrome",
		},
	});

	mainWindow.loadFile(uiHtml);

	mainWindow.on("closed", () => {
		mainWindow = null;
	});

	// Seed NTP tab
	const ntpId = nextTabId();
	tabs.set(ntpId, {
		id: ntpId,
		kind: "ntp",
		title: "New Tab",
		url: "omb://newtab",
		active: true,
	});
	activeTabId = ntpId;
	publishTabs();
}

function wireIpc(): void {
	ipcMain.handle("omb:ping", async (_event, nonce: string) => {
		sendToHost({ type: "shell.ping", nonce });
		return { ok: true, nonce, ts: Date.now() };
	});

	ipcMain.handle(
		"omb:prompt",
		async (
			_event,
			payload: {
				text: string;
				source: "ntp" | "side-panel" | "agent-tab";
				attachment?: PageAttachment | null;
				permissionMode?: PermissionMode;
			},
		) => {
			sendToHost({
				type: "shell.prompt",
				text: payload.text,
				source: payload.source,
				attachment: payload.attachment ?? null,
				permissionMode: payload.permissionMode,
			});
			return { ok: true };
		},
	);

	ipcMain.handle(
		"omb:approval_response",
		async (
			_event,
			payload: {
				id: string;
				value: string | boolean | null;
			},
		) => {
			sendToHost({
				type: "shell.approval_response",
				id: payload.id,
				value: payload.value,
			});
			return { ok: true };
		},
	);

	ipcMain.handle("omb:set_permission_mode", async (_event, mode: PermissionMode) => {
		sendToHost({ type: "shell.set_permission_mode", mode });
		return { ok: true };
	});

	ipcMain.handle("omb:set_working_directory", async (_event, dir: string) => {
		sendToHost({ type: "shell.set_working_directory", path: dir });
		return { ok: true };
	});

	ipcMain.handle("omb:abort", async () => {
		sendToHost({ type: "shell.abort" });
		return { ok: true };
	});

	ipcMain.handle("omb:create_tab", async (_event, payload: { url?: string; kind?: TabKind }) => {
		const id = nextTabId();
		const kind = payload.kind ?? "human";
		const url = payload.url ?? (kind === "ntp" ? "omb://newtab" : "https://example.com");
		tabs.set(id, {
			id,
			kind,
			title: kind === "agent" ? "Agent" : kind === "ntp" ? "New Tab" : "Tab",
			url,
			active: true,
		});
		activeTabId = id;
		for (const t of tabs.values()) t.active = t.id === id;
		publishTabs();
		return { id, url, kind };
	});

	ipcMain.handle("omb:activate_tab", async (_event, id: string) => {
		if (!tabs.has(id)) return { ok: false };
		activeTabId = id;
		for (const t of tabs.values()) t.active = t.id === id;
		publishTabs();
		return { ok: true };
	});

	ipcMain.handle("omb:close_tab", async (_event, id: string) => {
		if (!tabs.has(id)) return { ok: false };
		tabs.delete(id);
		if (activeTabId === id) {
			const next = [...tabs.keys()].at(-1) ?? null;
			activeTabId = next;
			for (const t of tabs.values()) t.active = t.id === next;
		}
		if (tabs.size === 0) {
			const ntpId = nextTabId();
			tabs.set(ntpId, { id: ntpId, kind: "ntp", title: "New Tab", url: "omb://newtab", active: true });
			activeTabId = ntpId;
		}
		publishTabs();
		return { ok: true };
	});

	ipcMain.handle("omb:navigate", async (_event, payload: { id: string; url: string }) => {
		const tab = tabs.get(payload.id);
		if (!tab) return { ok: false };
		tab.url = payload.url;
		if (tab.kind === "ntp") tab.kind = "human";
		publishTabs();
		return { ok: true };
	});

	ipcMain.handle("omb:update_tab_meta", async (_event, payload: { id: string; title?: string; url?: string }) => {
		const tab = tabs.get(payload.id);
		if (!tab) return { ok: false };
		if (payload.title) tab.title = payload.title;
		if (payload.url) tab.url = payload.url;
		publishTabs();
		return { ok: true };
	});

	ipcMain.handle("omb:list_tabs", async () => snapshotTabs());

	ipcMain.on("omb:forward_to_host", (_event, message: ShellToHost) => {
		sendToHost(message);
	});
}

app.whenReady().then(() => {
	// Allow webviews to load remote content
	session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => {
		callback(true);
	});

	wireIpc();
	createWindow();
	connectControl();

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
