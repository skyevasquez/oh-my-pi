import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { HostToShell, PageAttachment, PermissionMode, TabKind } from "../browser/protocol";

const api = {
	ping(nonce: string) {
		return ipcRenderer.invoke("omb:ping", nonce) as Promise<{ ok: boolean; nonce: string; ts: number }>;
	},
	prompt(payload: {
		text: string;
		source: "ntp" | "side-panel" | "agent-tab";
		attachment?: PageAttachment | null;
		permissionMode?: PermissionMode;
	}) {
		return ipcRenderer.invoke("omb:prompt", payload);
	},
	respondApproval(id: string, value: string | boolean | null) {
		return ipcRenderer.invoke("omb:approval_response", { id, value });
	},
	setPermissionMode(mode: PermissionMode) {
		return ipcRenderer.invoke("omb:set_permission_mode", mode);
	},
	setWorkingDirectory(dir: string) {
		return ipcRenderer.invoke("omb:set_working_directory", dir);
	},
	abort() {
		return ipcRenderer.invoke("omb:abort");
	},
	createTab(payload?: { url?: string; kind?: TabKind }) {
		return ipcRenderer.invoke("omb:create_tab", payload ?? {});
	},
	activateTab(id: string) {
		return ipcRenderer.invoke("omb:activate_tab", id);
	},
	closeTab(id: string) {
		return ipcRenderer.invoke("omb:close_tab", id);
	},
	navigate(id: string, url: string) {
		return ipcRenderer.invoke("omb:navigate", { id, url });
	},
	updateTabMeta(id: string, meta: { title?: string; url?: string }) {
		return ipcRenderer.invoke("omb:update_tab_meta", { id, ...meta });
	},
	listTabs() {
		return ipcRenderer.invoke("omb:list_tabs");
	},
	onHost(handler: (message: HostToShell) => void) {
		const listener = (_event: IpcRendererEvent, message: HostToShell) => handler(message);
		ipcRenderer.on("omb:host", listener);
		return () => ipcRenderer.removeListener("omb:host", listener);
	},
	onTabs(handler: (tabs: unknown) => void) {
		const listener = (_event: IpcRendererEvent, tabs: unknown) => handler(tabs);
		ipcRenderer.on("omb:tabs", listener);
		return () => ipcRenderer.removeListener("omb:tabs", listener);
	},
};

contextBridge.exposeInMainWorld("omb", api);

export type OmbPreloadApi = typeof api;
