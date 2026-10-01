/**
 * Renderer chrome: left rail, NTP composer, omnibox, side panel, webviews.
 */

import type {
	ApprovalRequest,
	BrowserTabState,
	HostToShell,
	PageAttachment,
	PermissionMode,
	TranscriptEntry,
} from "../browser/protocol";

interface OmbApi {
	ping(nonce: string): Promise<{ ok: boolean; nonce: string; ts: number }>;
	prompt(payload: {
		text: string;
		source: "ntp" | "side-panel" | "agent-tab";
		attachment?: PageAttachment | null;
		permissionMode?: PermissionMode;
	}): Promise<unknown>;
	respondApproval(id: string, value: string | boolean | null): Promise<unknown>;
	setPermissionMode(mode: PermissionMode): Promise<unknown>;
	setWorkingDirectory(dir: string): Promise<unknown>;
	abort(): Promise<unknown>;
	createTab(payload?: { url?: string; kind?: "human" | "agent" | "ntp" }): Promise<{
		id: string;
		url: string;
		kind: string;
	}>;
	activateTab(id: string): Promise<unknown>;
	closeTab(id: string): Promise<unknown>;
	navigate(id: string, url: string): Promise<unknown>;
	updateTabMeta(id: string, meta: { title?: string; url?: string }): Promise<unknown>;
	listTabs(): Promise<BrowserTabState[]>;
	onHost(handler: (message: HostToShell) => void): () => void;
	onTabs(handler: (tabs: BrowserTabState[]) => void): () => void;
}

declare global {
	interface Window {
		omb: OmbApi;
	}
}

const omb = window.omb;

const els = {
	humanTabs: document.querySelector("#human-tabs") as HTMLUListElement,
	agentTabs: document.querySelector("#agent-tabs") as HTMLUListElement,
	agentCount: document.querySelector("#agent-count") as HTMLSpanElement,
	ntp: document.querySelector("#ntp") as HTMLElement,
	webviewHost: document.querySelector("#webview-host") as HTMLElement,
	omnibox: document.querySelector("#omnibox") as HTMLInputElement,
	omniboxForm: document.querySelector("#omnibox-form") as HTMLFormElement,
	ntpForm: document.querySelector("#ntp-form") as HTMLFormElement,
	ntpInput: document.querySelector("#ntp-input") as HTMLTextAreaElement,
	ntpMode: document.querySelector("#ntp-mode") as HTMLSelectElement,
	permissionMode: document.querySelector("#permission-mode") as HTMLSelectElement,
	sidePanel: document.querySelector("#side-panel") as HTMLElement,
	sideForm: document.querySelector("#side-form") as HTMLFormElement,
	sideInput: document.querySelector("#side-input") as HTMLTextAreaElement,
	transcript: document.querySelector("#transcript") as HTMLElement,
	approval: document.querySelector("#approval") as HTMLElement,
	statusLine: document.querySelector("#status-line") as HTMLElement,
	pageAttach: document.querySelector("#page-attach") as HTMLElement,
	pageAttachTitle: document.querySelector("#page-attach-title") as HTMLElement,
	cwdInput: document.querySelector("#cwd-input") as HTMLInputElement,
	modelLabel: document.querySelector("#model-label") as HTMLElement,
	recentTasks: document.querySelector("#recent-tasks") as HTMLElement,
};

let tabs: BrowserTabState[] = [];
let activeId: string | null = null;
let attachment: PageAttachment | null = null;
interface TabWebview extends HTMLElement {
	src: string;
	canGoBack(): boolean;
	canGoForward(): boolean;
	goBack(): void;
	goForward(): void;
	reload(): void;
}

const bubbles = new Map<string, HTMLElement>();
const webviews = new Map<string, TabWebview>();

function permissionMode(): PermissionMode {
	return els.permissionMode.value as PermissionMode;
}

function normalizeUrl(input: string): string {
	const trimmed = input.trim();
	if (!trimmed) return "about:blank";
	if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("omb://")) return trimmed;
	if (trimmed.includes(" ") || !trimmed.includes(".")) {
		return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
	}
	return `https://${trimmed}`;
}

function ensureWebview(tab: BrowserTabState): TabWebview | null {
	if (tab.kind === "ntp" || tab.url.startsWith("omb://")) return null;
	let view = webviews.get(tab.id);
	if (view) return view;
	view = document.createElement("webview") as TabWebview;
	view.setAttribute("partition", "persist:omb-tabs");
	view.setAttribute("allowpopups", "true");
	view.src = tab.url;
	view.addEventListener("page-title-updated", (event: Event) => {
		const title = (event as unknown as { title: string }).title;
		void omb.updateTabMeta(tab.id, { title });
	});
	view.addEventListener("did-navigate", (event: Event) => {
		const url = (event as unknown as { url: string }).url;
		void omb.updateTabMeta(tab.id, { url });
		els.omnibox.value = url;
	});
	view.addEventListener("did-navigate-in-page", (event: Event) => {
		const url = (event as unknown as { url: string }).url;
		void omb.updateTabMeta(tab.id, { url });
		els.omnibox.value = url;
	});
	els.webviewHost.appendChild(view);
	webviews.set(tab.id, view);
	return view;
}

function renderTabs(): void {
	const human = tabs.filter(t => t.kind !== "agent");
	const agents = tabs.filter(t => t.kind === "agent");
	els.agentCount.textContent = String(agents.length);

	const paint = (list: HTMLUListElement, items: BrowserTabState[]) => {
		list.replaceChildren();
		for (const tab of items) {
			const li = document.createElement("li");
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = tab.active ? "active" : "";
			btn.innerHTML = `<span class="tab-title"></span><span class="tab-url"></span>`;
			(btn.querySelector(".tab-title") as HTMLElement).textContent = tab.title || "Tab";
			(btn.querySelector(".tab-url") as HTMLElement).textContent = tab.url;
			btn.addEventListener("click", () => void omb.activateTab(tab.id));
			btn.addEventListener("auxclick", event => {
				if (event.button === 1) void omb.closeTab(tab.id);
			});
			li.appendChild(btn);
			list.appendChild(li);
		}
	};

	paint(els.humanTabs, human);
	paint(els.agentTabs, agents);

	const active = tabs.find(t => t.active) ?? null;
	activeId = active?.id ?? null;

	const showNtp = !active || active.kind === "ntp" || active.url.startsWith("omb://");
	els.ntp.hidden = !showNtp;
	els.webviewHost.hidden = showNtp;

	for (const [id, view] of webviews) {
		view.classList.toggle("visible", id === activeId && !showNtp);
	}

	if (active && !showNtp) {
		ensureWebview(active)?.classList.add("visible");
		els.omnibox.value = active.url;
	} else {
		els.omnibox.value = "";
	}
}

function appendTranscript(entry: TranscriptEntry): void {
	const el = document.createElement("div");
	el.className = `bubble ${entry.role}`;
	el.dataset.id = entry.id;
	el.textContent = entry.text;
	els.transcript.appendChild(el);
	bubbles.set(entry.id, el);
	els.transcript.scrollTop = els.transcript.scrollHeight;

	if (entry.role === "user") {
		const card = document.createElement("div");
		card.className = "recent-card";
		card.textContent = entry.text.slice(0, 140);
		els.recentTasks.prepend(card);
	}
}

function deltaTranscript(id: string, delta: string): void {
	const el = bubbles.get(id);
	if (!el) {
		appendTranscript({ id, role: "assistant", text: delta, timestamp: Date.now() });
		return;
	}
	el.textContent = (el.textContent ?? "") + delta;
	els.transcript.scrollTop = els.transcript.scrollHeight;
}

function showApproval(request: ApprovalRequest): void {
	els.approval.hidden = false;
	els.sidePanel.hidden = false;
	els.approval.replaceChildren();
	const title = document.createElement("h3");
	title.textContent = request.title;
	els.approval.appendChild(title);
	if (request.message) {
		const p = document.createElement("p");
		p.textContent = request.message;
		els.approval.appendChild(p);
	}
	const actions = document.createElement("div");
	actions.className = "approval-actions";
	const options = request.kind === "confirm" ? (request.options ?? ["Approve", "Deny"]) : (request.options ?? ["OK"]);
	if (request.kind === "input") {
		const input = document.createElement("input");
		input.placeholder = request.placeholder ?? "";
		input.style.cssText = "width:100%;margin-bottom:8px";
		els.approval.appendChild(input);
		const submit = document.createElement("button");
		submit.type = "button";
		submit.textContent = "Submit";
		submit.addEventListener("click", () => {
			void omb.respondApproval(request.id, input.value);
			els.approval.hidden = true;
		});
		actions.appendChild(submit);
	} else {
		for (const option of options) {
			const btn = document.createElement("button");
			btn.type = "button";
			btn.textContent = option;
			btn.addEventListener("click", () => {
				void omb.respondApproval(request.id, option);
				els.approval.hidden = true;
			});
			actions.appendChild(btn);
		}
	}
	const cancel = document.createElement("button");
	cancel.type = "button";
	cancel.textContent = "Cancel";
	cancel.addEventListener("click", () => {
		void omb.respondApproval(request.id, null);
		els.approval.hidden = true;
	});
	actions.appendChild(cancel);
	els.approval.appendChild(actions);
}

function handleHost(message: HostToShell): void {
	switch (message.type) {
		case "host.pong":
			els.statusLine.textContent = `IPC ok · ${new Date(message.ts).toLocaleTimeString()}`;
			return;
		case "host.hello":
		case "host.session_info":
			els.cwdInput.value = message.workingDirectory;
			els.permissionMode.value = message.permissionMode;
			els.modelLabel.textContent = message.modelLabel
				? `Model: ${message.modelLabel}`
				: "Model: none (run omp /login)";
			return;
		case "host.transcript":
			appendTranscript(message.entry);
			els.sidePanel.hidden = false;
			return;
		case "host.transcript_delta":
			deltaTranscript(message.id, message.delta);
			return;
		case "host.status":
			els.statusLine.textContent = message.text ?? "";
			return;
		case "host.approval":
			showApproval(message.request);
			return;
		case "host.notify":
			els.statusLine.textContent = message.message;
			return;
	}
}

async function openUrl(url: string, kind: "human" | "agent" = "human"): Promise<void> {
	const created = await omb.createTab({ url: normalizeUrl(url), kind });
	ensureWebview({
		id: created.id,
		kind: created.kind as BrowserTabState["kind"],
		title: kind === "agent" ? "Agent" : "Tab",
		url: created.url,
		active: true,
	});
}

async function runPrompt(text: string, source: "ntp" | "side-panel" | "agent-tab"): Promise<void> {
	const trimmed = text.trim();
	if (!trimmed) return;
	els.sidePanel.hidden = false;
	await omb.setPermissionMode(permissionMode());
	await omb.prompt({
		text: trimmed,
		source,
		attachment,
		permissionMode: permissionMode(),
	});
}

function wireUi(): void {
	document.querySelector("#btn-new-tab")?.addEventListener("click", () => {
		void omb.createTab({ kind: "ntp", url: "omb://newtab" });
	});
	document.querySelector("#btn-new-agent")?.addEventListener("click", () => {
		void openUrl("https://example.com", "agent");
	});
	document.querySelector("#btn-new-chat")?.addEventListener("click", () => {
		void omb.createTab({ kind: "ntp", url: "omb://newtab" });
		els.sidePanel.hidden = false;
		els.ntpInput.focus();
	});
	document.querySelector("#btn-side-panel")?.addEventListener("click", () => {
		els.sidePanel.hidden = !els.sidePanel.hidden;
	});
	document.querySelector("#btn-close-side")?.addEventListener("click", () => {
		els.sidePanel.hidden = true;
	});
	document.querySelector("#btn-search")?.addEventListener("click", () => {
		els.omnibox.focus();
		els.omnibox.select();
	});

	document.querySelectorAll("#bookmark-list button").forEach(btn => {
		btn.addEventListener("click", () => {
			const url = (btn as HTMLElement).dataset.url;
			if (url) void openUrl(url);
		});
	});

	els.omniboxForm.addEventListener("submit", event => {
		event.preventDefault();
		const url = normalizeUrl(els.omnibox.value);
		if (activeId) {
			void omb.navigate(activeId, url).then(() => {
				const view =
					webviews.get(activeId!) ??
					ensureWebview({
						id: activeId!,
						kind: "human",
						title: "Tab",
						url,
						active: true,
					});
				if (view) view.src = url;
				els.ntp.hidden = true;
				els.webviewHost.hidden = false;
			});
		} else {
			void openUrl(url);
		}
	});

	els.ntpForm.addEventListener("submit", event => {
		event.preventDefault();
		if (els.ntpMode.value === "search") {
			void openUrl(`https://www.google.com/search?q=${encodeURIComponent(els.ntpInput.value)}`);
			return;
		}
		void runPrompt(els.ntpInput.value, "ntp");
		els.ntpInput.value = "";
	});

	els.sideForm.addEventListener("submit", event => {
		event.preventDefault();
		void runPrompt(els.sideInput.value, "side-panel");
		els.sideInput.value = "";
	});

	document.querySelector("#btn-attach-page")?.addEventListener("click", () => {
		const active = tabs.find(t => t.active);
		if (!active || active.url.startsWith("omb://")) return;
		let hostname = active.url;
		try {
			hostname = new URL(active.url).hostname;
		} catch {
			// keep raw
		}
		attachment = { title: active.title || hostname, url: active.url, hostname };
		els.pageAttach.hidden = false;
		els.pageAttachTitle.textContent = `${attachment.title} · ${attachment.hostname}`;
	});

	document.querySelector("#btn-detach")?.addEventListener("click", () => {
		attachment = null;
		els.pageAttach.hidden = true;
	});

	els.permissionMode.addEventListener("change", () => {
		void omb.setPermissionMode(permissionMode());
	});

	els.cwdInput.addEventListener("change", () => {
		const value = els.cwdInput.value.trim();
		if (value) void omb.setWorkingDirectory(value);
	});

	document.querySelector("#btn-back")?.addEventListener("click", () => {
		const view = activeId ? webviews.get(activeId) : undefined;
		if (view?.canGoBack()) view.goBack();
	});
	document.querySelector("#btn-forward")?.addEventListener("click", () => {
		const view = activeId ? webviews.get(activeId) : undefined;
		if (view?.canGoForward()) view.goForward();
	});
	document.querySelector("#btn-reload")?.addEventListener("click", () => {
		const view = activeId ? webviews.get(activeId) : undefined;
		view?.reload();
	});

	window.addEventListener("keydown", event => {
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
			event.preventDefault();
			els.sidePanel.hidden = !els.sidePanel.hidden;
		}
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "e") {
			event.preventDefault();
			els.sidePanel.hidden = false;
			els.sideInput.focus();
		}
	});
}

async function boot(): Promise<void> {
	wireUi();
	omb.onHost(handleHost);
	omb.onTabs(next => {
		tabs = next;
		renderTabs();
	});
	tabs = await omb.listTabs();
	renderTabs();
	const ping = await omb.ping(`ui-${Date.now()}`);
	els.statusLine.textContent = ping.ok ? "Connected to Bun host" : "IPC failed";
}

void boot();
