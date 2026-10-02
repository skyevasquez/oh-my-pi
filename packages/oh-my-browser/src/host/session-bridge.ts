import {
	AgentRegistry,
	createAgentSession,
	discoverAuthStorage,
	getAgentDir,
	ModelRegistry,
	SessionManager,
	Settings,
	type AgentSession,
	type CreateAgentSessionResult,
} from "@oh-my-pi/pi-coding-agent";
import { cfgBrowserCdpUrl } from "@oh-my-pi/pi-coding-agent/tools/browser/settings";
import { cfgToolsApprovalMode } from "@oh-my-pi/pi-coding-agent/tools/settings";
import { logger } from "@oh-my-pi/pi-utils";
import browserSystemTemplate from "../prompts/browser-system.md" with { type: "text" };
import desktopAppend from "../prompts/desktop-append.md" with { type: "text" };
import { logHostBrowserPath } from "../browser/connected";
import type { HostToShell, PageAttachment, PermissionMode, TranscriptEntry } from "../browser/protocol";
import { BrowserHostUIContext } from "./approvals";
import { approvalModeForPermission, DEFAULT_PERMISSION_MODE } from "./policy";

export interface SessionBridgeOptions {
	cwd: string;
	send: (message: HostToShell) => void;
	permissionMode?: PermissionMode;
}

export interface SessionBridge {
	session: AgentSession;
	ui: BrowserHostUIContext;
	permissionMode: PermissionMode;
	workingDirectory: string;
	cdpUrl: string | null;
	modelLabel: string | null;
	setCdpUrl(cdpUrl: string): Promise<void>;
	setPermissionMode(mode: PermissionMode): Promise<void>;
	setWorkingDirectory(cwd: string): Promise<void>;
	prompt(text: string, opts?: { attachment?: PageAttachment | null; source?: string }): Promise<void>;
	abort(): void;
	dispose(): Promise<void>;
}

let transcriptSeq = 0;

function nextTranscriptId(prefix: string): string {
	transcriptSeq += 1;
	return `${prefix}-${transcriptSeq}`;
}

function modelLabelFromSession(session: AgentSession): string | null {
	const model = session.model;
	if (!model) return null;
	const id = "id" in model && typeof model.id === "string" ? model.id : null;
	const provider = "provider" in model && typeof model.provider === "string" ? model.provider : null;
	if (id && provider) return `${provider}/${id}`;
	return id ?? provider;
}

/**
 * Embed createAgentSession sharing ~/.omp auth/models, stream events to the UI,
 * and keep browser.cdpUrl pointed at the Electron shell.
 */
export async function createSessionBridge(options: SessionBridgeOptions): Promise<SessionBridge> {
	const send = options.send;
	let workingDirectory = options.cwd;
	let permissionMode = options.permissionMode ?? DEFAULT_PERMISSION_MODE;
	let cdpUrl: string | null = null;
	let disposed = false;

	const baseSettings = await Settings.init({ cwd: workingDirectory });
	const settings = baseSettings.overlay({
		"tools.approvalMode": approvalModeForPermission(permissionMode),
	});

	const authStorage = await discoverAuthStorage(getAgentDir(), { settings, cwd: workingDirectory });
	const modelRegistry = new ModelRegistry(authStorage, undefined, { settings });
	await modelRegistry.refresh();

	const created: CreateAgentSessionResult = await createAgentSession({
		cwd: workingDirectory,
		authStorage,
		modelRegistry,
		settings,
		sessionManager: SessionManager.create(workingDirectory),
		agentRegistry: new AgentRegistry(),
		hasUI: true,
		interactivePrompts: true,
		systemPromptTemplate: browserSystemTemplate,
		appendSystemPrompt: desktopAppend,
	});

	const { session, setToolUIContext } = created;
	const ui = new BrowserHostUIContext(send);
	setToolUIContext(ui, true);

	let assistantStreamId: string | null = null;

	const unsubscribe = session.subscribe(event => {
		if (disposed) return;
		try {
			if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
				if (!assistantStreamId) {
					assistantStreamId = nextTranscriptId("assistant");
					const entry: TranscriptEntry = {
						id: assistantStreamId,
						role: "assistant",
						text: event.assistantMessageEvent.delta,
						timestamp: Date.now(),
					};
					send({ type: "host.transcript", entry });
				} else {
					send({
						type: "host.transcript_delta",
						id: assistantStreamId,
						delta: event.assistantMessageEvent.delta,
					});
				}
				send({ type: "host.status", text: "Streaming…", streaming: true });
				return;
			}

			if (event.type === "message_end" || event.type === "agent_end") {
				assistantStreamId = null;
				send({ type: "host.status", text: null, streaming: false });
			}

			if (event.type === "tool_execution_start") {
				const entry: TranscriptEntry = {
					id: nextTranscriptId("tool"),
					role: "tool",
					text: `Running ${event.toolName}…`,
					timestamp: Date.now(),
					toolName: event.toolName,
				};
				send({ type: "host.transcript", entry });
			}

			if (event.type === "tool_execution_end") {
				const entry: TranscriptEntry = {
					id: nextTranscriptId("tool"),
					role: "tool",
					text: event.isError ? `${event.toolName} failed` : `${event.toolName} done`,
					timestamp: Date.now(),
					toolName: event.toolName,
				};
				send({ type: "host.transcript", entry });
			}
		} catch (err) {
			logger.error("oh-my-browser session event fan-out failed", { err });
		}
	});

	const publishSessionInfo = () => {
		send({
			type: "host.session_info",
			workingDirectory,
			permissionMode,
			modelLabel: modelLabelFromSession(session),
			cdpUrl,
		});
	};

	publishSessionInfo();
	logger.info("oh-my-browser session ready", {
		cwd: workingDirectory,
		permissionMode,
		model: modelLabelFromSession(session),
	});

	const bridge: SessionBridge = {
		session,
		ui,
		get permissionMode() {
			return permissionMode;
		},
		get workingDirectory() {
			return workingDirectory;
		},
		get cdpUrl() {
			return cdpUrl;
		},
		get modelLabel() {
			return modelLabelFromSession(session);
		},

		async setCdpUrl(next: string) {
			cdpUrl = next;
			// Runtime override so Eval `connected` attaches to in-app tabs.
			cfgBrowserCdpUrl.override(settings, next);
			logHostBrowserPath(next);
			publishSessionInfo();
		},

		async setPermissionMode(mode: PermissionMode) {
			permissionMode = mode;
			cfgToolsApprovalMode.override(settings, approvalModeForPermission(mode));
			publishSessionInfo();
		},

		async setWorkingDirectory(cwd: string) {
			workingDirectory = cwd;
			try {
				await session.moveSession(cwd);
			} catch (err) {
				logger.warn("oh-my-browser moveSession failed; tracking cwd for UI only", { cwd, err });
			}
			publishSessionInfo();
		},

		async prompt(text, opts = {}) {
			const attachment = opts.attachment;
			let promptText = text.trim();
			if (attachment) {
				promptText = [`Page context: ${attachment.title} (${attachment.url})`, "", promptText].join("\n");
			}
			const entry: TranscriptEntry = {
				id: nextTranscriptId("user"),
				role: "user",
				text: promptText,
				timestamp: Date.now(),
			};
			send({ type: "host.transcript", entry });
			send({ type: "host.status", text: "Working…", streaming: true });
			assistantStreamId = null;
			await session.prompt(promptText);
		},

		abort() {
			void session.abort();
			send({ type: "host.status", text: "Aborted", streaming: false });
		},

		async dispose() {
			disposed = true;
			unsubscribe();
			await session.dispose();
		},
	};

	return bridge;
}
