#!/usr/bin/env bun
import { startHost } from "../src/host/index";

const host = await startHost({
	cwd: process.env.OMB_CWD ?? process.cwd(),
});

process.on("SIGINT", () => void host.stop().then(() => process.exit(0)));
await new Promise<void>(() => {});
