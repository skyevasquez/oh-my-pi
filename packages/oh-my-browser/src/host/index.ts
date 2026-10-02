import * as path from "node:path";
import { $ } from "bun";
import { logger } from "@oh-my-pi/pi-utils";
import { cdpHttpUrl, findFreePort as findCdpPort } from "../browser/cdp-port";
import type { HostToShell, PermissionMode, ShellToHost } from "../browser/protocol";
import { startControlServer } from "./control-server";
import { DEFAULT_PERMISSION_MODE } from "./policy";
import { createSessionBridge, type SessionBridge } from "./session-bridge";

export interface HostOptions {
	cwd?: string;
	permissionMode?: PermissionMode;
	/** When true, skip spawning Electron (smoke / headless). */
	smoke?: boolean;
	/** Keep process alive after smoke session init. */
	holdOpen?: boolean;
}

/**
 * Bun host entry: control server + createAgentSession + optional Electron shell.
 */
export async function startHost(options: HostOptions = {}): Promise<{
	bridge: SessionBridge;
	controlUrl: string;
	cdpPort: number;
	stop: () => Promise<void>;
}> {
	const cwd = options.cwd ?? process.cwd();
	const permissionMode = options.permissionMode ?? DEFAULT_PERMISSION_MODE;
	const packageRoot = path.resolve(import.meta.dir, "../..");

	const cdpPort = await findCdpPort();
	let bridge: SessionBridge | null = null;

	const control = await startControlServer({
		onConnect(client) {
			if (!bridge) return;
			client.send({
				type: "host.hello",
				controlPort: control.port,
				cdpUrl: bridge.cdpUrl,
				workingDirectory: bridge.workingDirectory,
				permissionMode: bridge.permissionMode,
				modelLabel: bridge.modelLabel,
			});
		},
		async onMessage(message: ShellToHost, client) {
			if (!bridge) return;
			switch (message.type) {
				case "shell.hello":
					client.send({
						type: "host.hello",
						controlPort: control.port,
						cdpUrl: bridge.cdpUrl,
						workingDirectory: bridge.workingDirectory,
						permissionMode: bridge.permissionMode,
						modelLabel: bridge.modelLabel,
					});
					return;
				case "shell.ping":
					client.send({ type: "host.pong", nonce: message.nonce, ts: Date.now() });
					return;
				case "shell.cdp_ready":
					await bridge.setCdpUrl(message.cdpUrl);
					return;
				case "shell.prompt":
					if (message.permissionMode) await bridge.setPermissionMode(message.permissionMode);
					await bridge.prompt(message.text, {
						attachment: message.attachment,
						source: message.source,
					});
					return;
				case "shell.approval_response":
					bridge.ui.resolveApproval(message.id, message.value);
					return;
				case "shell.set_working_directory":
					await bridge.setWorkingDirectory(message.path);
					return;
				case "shell.set_permission_mode":
					await bridge.setPermissionMode(message.mode);
					return;
				case "shell.tabs_changed":
					logger.debug("oh-my-browser tabs changed", { count: message.tabs.length });
					return;
				case "shell.abort":
					bridge.abort();
					return;
			}
		},
	});

	const send = (message: HostToShell) => control.broadcast(message);

	bridge = await createSessionBridge({
		cwd,
		send,
		permissionMode,
	});

	// Pre-set expected CDP URL so settings are ready before the shell connects.
	await bridge.setCdpUrl(cdpHttpUrl(cdpPort));

	let electronProc: ReturnType<typeof Bun.spawn> | null = null;

	if (!options.smoke) {
		await $`bun ${path.join(packageRoot, "scripts/build-electron.ts")}`.quiet();
		const electronEntry = path.join(packageRoot, "dist/electron/main.js");
		let electronCli: string;
		try {
			electronCli = Bun.resolveSync("electron/cli.js", packageRoot);
		} catch {
			electronCli = path.join(packageRoot, "../../node_modules/electron/cli.js");
		}
		const env = {
			...process.env,
			OMB_CONTROL_URL: control.url,
			OMB_CDP_PORT: String(cdpPort),
			OMB_PACKAGE_ROOT: packageRoot,
			ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
		};
		electronProc = Bun.spawn(["bun", electronCli, electronEntry], {
			cwd: packageRoot,
			env,
			stdout: "inherit",
			stderr: "inherit",
			stdin: "ignore",
		});
		logger.info("oh-my-browser spawned Electron", { pid: electronProc.pid, cdpPort, electronCli });
	} else {
		logger.info("oh-my-browser smoke mode: session loaded without Electron", {
			controlUrl: control.url,
			cdpUrl: cdpHttpUrl(cdpPort),
			cwd,
			permissionMode,
			model: bridge.modelLabel,
		});
	}

	const stop = async () => {
		try {
			await bridge?.dispose();
		} catch (err) {
			logger.warn("oh-my-browser session dispose failed", { err });
		}
		control.stop();
		if (electronProc) {
			electronProc.kill();
			await electronProc.exited.catch(() => undefined);
		}
	};

	return { bridge, controlUrl: control.url, cdpPort, stop };
}
