/**
 * Bundle Electron main + preload + UI for the Node/Electron runtime.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";

const root = path.resolve(import.meta.dir, "..");
const outDir = path.join(root, "dist/electron");

await fs.mkdir(outDir, { recursive: true });
await fs.mkdir(path.join(root, "dist/ui"), { recursive: true });

const mainResult = await Bun.build({
	entrypoints: [path.join(root, "src/main/electron-main.ts")],
	outdir: outDir,
	target: "node",
	format: "esm",
	naming: "main.js",
	external: ["electron"],
});

if (!mainResult.success) {
	logger.error("oh-my-browser electron main build failed", { logs: mainResult.logs });
	process.exit(1);
}

const preloadResult = await Bun.build({
	entrypoints: [path.join(root, "src/preload/preload.ts")],
	outdir: outDir,
	target: "node",
	format: "cjs",
	naming: "preload.cjs",
	external: ["electron"],
});

if (!preloadResult.success) {
	logger.error("oh-my-browser preload build failed", { logs: preloadResult.logs });
	process.exit(1);
}

const uiResult = await Bun.build({
	entrypoints: [path.join(root, "src/ui/app.ts")],
	outdir: path.join(root, "src/ui"),
	target: "browser",
	format: "esm",
	naming: "app.js",
});

if (!uiResult.success) {
	logger.error("oh-my-browser ui build failed", { logs: uiResult.logs });
	process.exit(1);
}

logger.info("oh-my-browser electron bundles ready", { outDir });
