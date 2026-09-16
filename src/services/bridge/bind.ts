import { chmod, mkdir, unlink } from "node:fs/promises";
import type { Server } from "node:http";
import { connect } from "node:net";
import { dirname } from "node:path";
import type { BridgeEndpoint } from "./endpoint.ts";

export interface BindResult {
  port?: number;
  socketPath?: string;
  fallbackFrom?: number;
}

export async function bindServer(
  server: Server,
  endpoint: BridgeEndpoint,
  platform: NodeJS.Platform = process.platform,
): Promise<BindResult> {
  if (endpoint.kind === "socket") return bindSocket(server, endpoint, platform);
  if (endpoint.port === 0) return { port: await listen(server, 0) };
  try {
    return { port: await listen(server, endpoint.port) };
  } catch (error) {
    if (isAddressInUse(error)) {
      return { port: await listen(server, 0), fallbackFrom: endpoint.port };
    }
    throw error;
  }
}

async function bindSocket(
  server: Server,
  endpoint: Extract<BridgeEndpoint, { kind: "socket" }>,
  platform: NodeJS.Platform,
): Promise<BindResult> {
  const isWindows = platform === "win32";
  if (!isWindows) await mkdir(dirname(endpoint.path), { recursive: true });
  try {
    await listen(server, endpoint.path);
  } catch (error) {
    // A fixed path in use is a live server — never unlink it.
    // A unique path (contains {windowId}) in use can only be a stale file.
    if (isWindows || !isAddressInUse(error) || !endpoint.unique) throw error;
    await unlink(endpoint.path).catch(() => {});
    await listen(server, endpoint.path);
  }
  if (!isWindows) await chmod(endpoint.path, 0o600);
  return { socketPath: endpoint.path };
}

/**
 * Removes a Unix socket file that no live server is listening on. On POSIX,
 * closing a server leaves the socket file on disk, so a fixed path would fail
 * EADDRINUSE on the next bind. Probe-connect first: if the probe connects,
 * another server owns the path — leave it. Only unlink on ECONNREFUSED
 * (nothing listening). Never throws.
 */
export async function unlinkStaleSocket(
  socketPath: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  if (platform === "win32") return; // named pipes vanish when the server closes

  const nothingListening = await new Promise<boolean>((resolve) => {
    const socket = connect(socketPath);
    const finish = (refused: boolean) => {
      socket.destroy();
      resolve(refused);
    };
    socket.once("connect", () => finish(false));
    socket.once("error", (error) =>
      finish((error as NodeJS.ErrnoException).code === "ECONNREFUSED"),
    );
  });

  // Awaited: the removal used to be fire-and-forget, which let a caller resume
  // while the path was still on disk.
  if (nothingListening) await unlink(socketPath).catch(() => {});
}

function listen(server: Server, target: number | string): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    const onListen = () => {
      server.off("error", reject);
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    };
    // TCP binds loopback only (matches the previous server.listen(0, "127.0.0.1") behavior).
    if (typeof target === "number") {
      server.listen(target, "127.0.0.1", onListen);
    } else {
      server.listen(target, onListen);
    }
  });
}

function isAddressInUse(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "EADDRINUSE"
  );
}
