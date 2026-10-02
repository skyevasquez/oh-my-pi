/**
 * Shared control-plane messages between the Bun host and Electron shell.
 * Transport: WebSocket JSON frames (one object per message).
 */

export type PermissionMode = "read" | "guard" | "full";

export type TabKind = "human" | "agent" | "ntp";

export interface BrowserTabState {
	id: string;
	kind: TabKind;
	title: string;
	url: string;
	favicon?: string;
	active: boolean;
}

export interface PageAttachment {
	title: string;
	url: string;
	hostname: string;
}

export interface TranscriptEntry {
	id: string;
	role: "user" | "assistant" | "system" | "tool";
	text: string;
	timestamp: number;
	toolName?: string;
}

export interface ApprovalRequest {
	id: string;
	kind: "select" | "confirm" | "input";
	title: string;
	message?: string;
	options?: string[];
	placeholder?: string;
}

export interface HostHello {
	type: "host.hello";
	controlPort: number;
	cdpUrl: string | null;
	workingDirectory: string;
	permissionMode: PermissionMode;
	modelLabel: string | null;
}

export interface HostPong {
	type: "host.pong";
	nonce: string;
	ts: number;
}

export interface HostTranscript {
	type: "host.transcript";
	entry: TranscriptEntry;
}

export interface HostTranscriptDelta {
	type: "host.transcript_delta";
	id: string;
	delta: string;
}

export interface HostStatus {
	type: "host.status";
	text: string | null;
	streaming: boolean;
}

export interface HostApproval {
	type: "host.approval";
	request: ApprovalRequest;
}

export interface HostSessionInfo {
	type: "host.session_info";
	workingDirectory: string;
	permissionMode: PermissionMode;
	modelLabel: string | null;
	cdpUrl: string | null;
}

export interface HostNotify {
	type: "host.notify";
	message: string;
	level: "info" | "warning" | "error";
}

export type HostToShell =
	| HostHello
	| HostPong
	| HostTranscript
	| HostTranscriptDelta
	| HostStatus
	| HostApproval
	| HostSessionInfo
	| HostNotify;

export interface ShellHello {
	type: "shell.hello";
	version: string;
}

export interface ShellPing {
	type: "shell.ping";
	nonce: string;
}

export interface ShellCdpReady {
	type: "shell.cdp_ready";
	cdpUrl: string;
	port: number;
}

export interface ShellPrompt {
	type: "shell.prompt";
	text: string;
	source: "ntp" | "side-panel" | "agent-tab";
	attachment?: PageAttachment | null;
	permissionMode?: PermissionMode;
}

export interface ShellApprovalResponse {
	type: "shell.approval_response";
	id: string;
	/** Selected label, confirm boolean as "Approve"/"Deny", or input text; null = cancelled */
	value: string | boolean | null;
}

export interface ShellSetWorkingDirectory {
	type: "shell.set_working_directory";
	path: string;
}

export interface ShellSetPermissionMode {
	type: "shell.set_permission_mode";
	mode: PermissionMode;
}

export interface ShellTabsChanged {
	type: "shell.tabs_changed";
	tabs: BrowserTabState[];
}

export interface ShellAbort {
	type: "shell.abort";
}

export type ShellToHost =
	| ShellHello
	| ShellPing
	| ShellCdpReady
	| ShellPrompt
	| ShellApprovalResponse
	| ShellSetWorkingDirectory
	| ShellSetPermissionMode
	| ShellTabsChanged
	| ShellAbort;

export type ControlMessage = HostToShell | ShellToHost;

export function isControlMessage(value: unknown): value is ControlMessage {
	return (
		typeof value === "object" &&
		value !== null &&
		"type" in value &&
		typeof (value as { type: unknown }).type === "string"
	);
}
