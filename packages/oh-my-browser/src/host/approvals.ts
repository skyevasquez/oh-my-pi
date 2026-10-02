import { theme } from "@oh-my-pi/pi-tui/theme";
import type {
	ExtensionUIContext,
	ExtensionUIDialogOptions,
	ExtensionUISelectItem,
	ExtensionWidgetContent,
	ExtensionWidgetOptions,
	ExtensionUiComponentFactory,
	TerminalInputHandler,
} from "@oh-my-pi/pi-coding-agent";
import { logger } from "@oh-my-pi/pi-utils";
import type { ApprovalRequest, HostToShell } from "../browser/protocol";

function selectLabel(option: ExtensionUISelectItem): string {
	return typeof option === "string" ? option : option.label;
}

type Send = (message: HostToShell) => void;

/**
 * ExtensionUIContext that routes select/confirm/input to the Electron chrome
 * over the control WebSocket so Guard approvals appear in the side panel.
 */
export class BrowserHostUIContext implements ExtensionUIContext {
	#send: Send;
	#pending = new Map<
		string,
		{
			resolve: (value: string | boolean | null | undefined) => void;
		}
	>();
	#editorText = "";
	#seq = 0;

	constructor(send: Send) {
		this.#send = send;
	}

	resolveApproval(id: string, value: string | boolean | null): void {
		const pending = this.#pending.get(id);
		if (!pending) {
			logger.warn("oh-my-browser approval response for unknown id", { id });
			return;
		}
		this.#pending.delete(id);
		pending.resolve(value);
	}

	#request(request: ApprovalRequest): Promise<string | boolean | null | undefined> {
		const { promise, resolve } = Promise.withResolvers<string | boolean | null | undefined>();
		this.#pending.set(request.id, { resolve });
		this.#send({ type: "host.approval", request });
		return promise;
	}

	#nextId(): string {
		this.#seq += 1;
		return `approval-${this.#seq}-${Date.now()}`;
	}

	async select(
		title: string,
		options: ExtensionUISelectItem[],
		_dialogOptions?: ExtensionUIDialogOptions,
	): Promise<string | undefined> {
		const labels = options.map(selectLabel);
		const value = await this.#request({
			id: this.#nextId(),
			kind: "select",
			title,
			options: labels,
		});
		if (typeof value !== "string") return undefined;
		return value;
	}

	async confirm(title: string, message: string, _dialogOptions?: ExtensionUIDialogOptions): Promise<boolean> {
		const value = await this.#request({
			id: this.#nextId(),
			kind: "confirm",
			title,
			message,
			options: ["Approve", "Deny"],
		});
		if (value === true) return true;
		if (value === "Approve") return true;
		return false;
	}

	async input(
		title: string,
		placeholder?: string,
		_dialogOptions?: ExtensionUIDialogOptions,
	): Promise<string | undefined> {
		const value = await this.#request({
			id: this.#nextId(),
			kind: "input",
			title,
			placeholder,
		});
		if (typeof value !== "string") return undefined;
		return value;
	}

	notify(message: string, type?: "info" | "warning" | "error"): void {
		this.#send({
			type: "host.notify",
			message,
			level: type ?? "info",
		});
	}

	onTerminalInput(_handler: TerminalInputHandler): () => void {
		return () => {};
	}

	setStatus(key: string, text: string | undefined): void {
		this.#send({
			type: "host.status",
			text: text ? `${key}: ${text}` : null,
			streaming: Boolean(text),
		});
	}

	setWorkingMessage(message?: string): void {
		this.#send({
			type: "host.status",
			text: message ?? null,
			streaming: Boolean(message),
		});
	}

	setWidget(_key: string, _content: ExtensionWidgetContent, _options?: ExtensionWidgetOptions): void {}
	setFooter(_factory: ExtensionUiComponentFactory | undefined): void {}
	setHeader(_factory: ExtensionUiComponentFactory | undefined): void {}
	setTitle(_title: string): void {}
	async custom<T>(): Promise<T> {
		return undefined as never;
	}
	setEditorText(text: string): void {
		this.#editorText = text;
	}
	pasteToEditor(text: string): void {
		this.#editorText += text;
	}
	getEditorText(): string {
		return this.#editorText;
	}
	async editor(title: string, prefill?: string): Promise<string | undefined> {
		return this.input(title, prefill);
	}
	addAutocompleteProvider(): void {}
	get theme() {
		return theme;
	}
	getAllThemes() {
		return Promise.resolve([]);
	}
	getTheme() {
		return Promise.resolve(undefined);
	}
	setTheme() {
		return Promise.resolve({ success: false as const, error: "Theme switching is not available in oh-my-browser" });
	}
	setEditorComponent(): void {}
	getToolsExpanded(): boolean {
		return false;
	}
	setToolsExpanded(): void {}
}
