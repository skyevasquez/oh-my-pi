import * as net from "node:net";
import { logger } from "@oh-my-pi/pi-utils";
import { isControlMessage, type HostToShell, type ShellToHost } from "../browser/protocol";

export interface ControlClient {
	send(message: HostToShell): void;
}

export interface ControlServer {
	port: number;
	url: string;
	broadcast(message: HostToShell): void;
	stop(): void;
}

export interface ControlServerOptions {
	onMessage: (message: ShellToHost, client: ControlClient) => void | Promise<void>;
	onConnect?: (client: ControlClient) => void;
	onDisconnect?: (client: ControlClient) => void;
}

async function findFreePort(): Promise<number> {
	const { promise, resolve, reject } = Promise.withResolvers<number>();
	const server = net.createServer();
	server.unref();
	server.once("error", reject);
	server.listen(0, "127.0.0.1", () => {
		const addr = server.address();
		if (addr && typeof addr === "object") {
			const port = addr.port;
			server.close(err => (err ? reject(err) : resolve(port)));
		} else {
			server.close();
			reject(new Error("Failed to allocate control port"));
		}
	});
	return promise;
}

/**
 * Loopback WebSocket control plane between Bun host and Electron shell.
 */
export async function startControlServer(options: ControlServerOptions): Promise<ControlServer> {
	const port = await findFreePort();
	const clients = new Set<{ ws: WebSocket; client: ControlClient }>();

	const server = Bun.serve({
		hostname: "127.0.0.1",
		port,
		fetch(req, srv) {
			const upgraded = srv.upgrade(req);
			if (upgraded) return undefined;
			return new Response("oh-my-browser control", { status: 200 });
		},
		websocket: {
			open(ws) {
				const client: ControlClient = {
					send(message) {
						try {
							ws.send(JSON.stringify(message));
						} catch (err) {
							logger.warn("oh-my-browser control send failed", { err });
						}
					},
				};
				const entry = { ws: ws as unknown as WebSocket, client };
				(ws as unknown as { data: typeof entry }).data = entry;
				clients.add(entry);
				options.onConnect?.(client);
				logger.debug("oh-my-browser shell connected", { clients: clients.size });
			},
			async message(ws, raw) {
				const entry = (ws as unknown as { data: { client: ControlClient } }).data;
				let parsed: unknown;
				try {
					parsed = typeof raw === "string" ? JSON.parse(raw) : JSON.parse(Buffer.from(raw).toString("utf8"));
				} catch (err) {
					logger.warn("oh-my-browser invalid control JSON", { err });
					return;
				}
				if (!isControlMessage(parsed) || !String(parsed.type).startsWith("shell.")) {
					logger.warn("oh-my-browser ignored non-shell control message", {
						type: (parsed as { type?: string })?.type,
					});
					return;
				}
				try {
					await options.onMessage(parsed as ShellToHost, entry.client);
				} catch (err) {
					logger.error("oh-my-browser control handler failed", { err, type: parsed.type });
				}
			},
			close(ws) {
				const entry = (ws as unknown as { data?: { client: ControlClient } }).data;
				if (!entry) return;
				for (const c of clients) {
					if (c.client === entry.client) clients.delete(c);
				}
				options.onDisconnect?.(entry.client);
			},
		},
	});

	const boundPort = server.port;
	if (typeof boundPort !== "number") {
		server.stop(true);
		throw new Error("oh-my-browser control server failed to bind a port");
	}
	const url = `ws://127.0.0.1:${boundPort}`;
	logger.info("oh-my-browser control server listening", { url });

	return {
		port: boundPort,
		url,
		broadcast(message) {
			const payload = JSON.stringify(message);
			for (const { ws } of clients) {
				try {
					(ws as unknown as { send: (data: string) => void }).send(payload);
				} catch (err) {
					logger.warn("oh-my-browser broadcast failed", { err });
				}
			}
		},
		stop() {
			server.stop(true);
			clients.clear();
		},
	};
}

export { findFreePort };
