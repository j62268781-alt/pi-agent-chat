// Owns the lifecycle of the local HTTP bridge that serves the `pi` process's
// LLM tools. Keeping this out of `extension.ts` leaves the entry point as pure
// wiring and makes the retry/debounce rules testable in isolation.

import * as vscode from "vscode";
import { t } from "../../utils/i18n.ts";
import { resolveEndpoint } from "./endpoint.ts";
import { isAbsolutePath } from "./params.ts";
import { createBridge } from "./server.ts";
import type { BridgeConfig } from "./types.ts";

export const BRIDGE_SETTING_KEY = "pi-agent-chat.bridgeSocket";

/**
 * The settings UI commits on every keystroke, so a configuration change only
 * restarts the bridge once the value has settled.
 */
const RESTART_SETTLE_MS = 1000;

let activeConfig: BridgeConfig | undefined;
let disposeActive: (() => Promise<void>) | undefined;
let restartTimer: NodeJS.Timeout | undefined;

/** Latest resolved bridge endpoint, or `undefined` before the first bind. */
export function currentBridgeConfig(): BridgeConfig | undefined {
  return activeConfig;
}

export interface BridgeStartResult {
  config: BridgeConfig;
  /** Set when the requested endpoint was unusable and a fallback was bound. */
  fellBackReason?: string;
}

/**
 * Bind the bridge, falling back to a random TCP port when the configured
 * endpoint cannot be used. Never throws: the chat panel works without a bridge,
 * it only loses the editor-integration tools.
 */
export async function startBridge(
  context: vscode.ExtensionContext,
  instanceId: string,
): Promise<BridgeStartResult> {
  await stopBridge();

  const endpoint = resolveEndpoint(
    vscode.workspace.getConfiguration("pi-agent-chat").get<string>("bridgeSocket", ""),
    instanceId,
  );

  let bridge: Awaited<ReturnType<typeof createBridge>>;
  let fellBackReason: string | undefined;
  try {
    bridge = await createBridge(context, endpoint);
    if (endpoint.kind === "tcp" && endpoint.invalid) {
      fellBackReason = t("the configured value is invalid");
    } else if (bridge.fallbackFrom !== undefined) {
      fellBackReason = t("port {0} is in use", bridge.fallbackFrom);
    } else if (endpoint.kind === "socket" && !bridge.socketPath) {
      fellBackReason = t("socket {0} is in use", endpoint.path);
    }
  } catch (error) {
    bridge = await createBridge(context, { kind: "tcp", port: 0 });
    fellBackReason = t(
      "binding {0} failed ({1})",
      endpoint.kind === "socket" ? endpoint.path : String(endpoint.port),
      error instanceof Error ? error.message : String(error),
    );
  }

  disposeActive = () => bridge.dispose();
  activeConfig = { url: bridge.url, socketPath: bridge.socketPath, token: bridge.token };
  return { config: activeConfig, fellBackReason };
}

export async function stopBridge(): Promise<void> {
  const dispose = disposeActive;
  disposeActive = undefined;
  activeConfig = undefined;
  await dispose?.();
}

export function cancelPendingRestart(): void {
  clearTimeout(restartTimer);
  restartTimer = undefined;
}

/** Debounced restart used by the configuration listener. */
export function scheduleBridgeRestart(instanceId: string, restart: () => Promise<void>): void {
  cancelPendingRestart();
  restartTimer = setTimeout(() => {
    restartTimer = undefined;
    void restart();
  }, RESTART_SETTLE_MS);
}

/**
 * Validate a raw `bridgeSocket` setting value. Returns a user-facing warning
 * message when the value cannot be used at all, otherwise `undefined`.
 */
export function describeInvalidBridgeSetting(
  value: string,
  instanceId: string,
): string | undefined {
  const endpoint = resolveEndpoint(value, instanceId);
  if (endpoint.kind === "tcp" && endpoint.invalid) {
    return t(
      'Invalid pi-agent-chat.bridgeSocket value "{0}" — expected a number 1-65535 or an absolute socket path. Bridge not restarted.',
      value,
    );
  }
  if (endpoint.kind === "socket" && !isAbsolutePath(endpoint.path)) {
    return t(
      'Invalid pi-agent-chat.bridgeSocket path "{0}" — expected an absolute path (or \\.\\pipe\\ on Windows). Bridge not restarted.',
      endpoint.path,
    );
  }
  return undefined;
}
