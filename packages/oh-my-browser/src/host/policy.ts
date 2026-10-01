import type { PermissionMode } from "../browser/protocol";

/**
 * Map product permission labels to omp `tools.approvalMode`.
 * @see docs/approval-mode.md
 */
export function approvalModeForPermission(mode: PermissionMode): "always-ask" | "write" | "yolo" {
	switch (mode) {
		case "read":
			return "always-ask";
		case "guard":
			return "write";
		case "full":
			return "yolo";
	}
}

export function permissionLabel(mode: PermissionMode): string {
	switch (mode) {
		case "read":
			return "Read";
		case "guard":
			return "Guard";
		case "full":
			return "Full";
	}
}

/** Default MVP mode: auto-approve read+write; prompt exec (bash/eval/browser). */
export const DEFAULT_PERMISSION_MODE: PermissionMode = "guard";
