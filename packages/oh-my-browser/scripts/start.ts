#!/usr/bin/env bun
import { startHost } from "../src/host/index";

const host = await startHost({
	cwd: process.env.OMB_CWD ?? process.cwd(),
});

const shutdown = async () => {
	await host.stop();
	process.exit(0);
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

// Keep alive while Electron runs.
await new Promise<void>(() => {});
