/**
 * Allocate a free loopback TCP port for Electron's remote-debugging-port.
 */
import * as net from "node:net";

export async function findFreePort(): Promise<number> {
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
			reject(new Error("Failed to allocate port"));
		}
	});
	return promise;
}

export function cdpHttpUrl(port: number): string {
	return `http://127.0.0.1:${port}`;
}
