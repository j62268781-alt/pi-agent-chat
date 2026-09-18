// Dev-only stimulus surface for the e2e harness. Registered only when the
// extension is not installed from a vsix (see shouldRegisterTestingCommands),
// so nothing here exists in a shipped build.
//
// Observation does not need this file: the harness reads the "Pi Chat RPC"
// output channel instead. Only *stimulus* — making the extension send something
// — needs a host-side entry point.

import * as vscode from "vscode";
import type { WebviewToExt } from "../protocol/messages.ts";

const COMMAND_ID = "pi-agent-chat.__webviewMessage";

export function registerTestingCommands(): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(COMMAND_ID, async (payload: unknown) => {
      if (typeof payload !== "string") {
        throw new Error(`${COMMAND_ID} expects a JSON string`);
      }
      const parsed: unknown = JSON.parse(payload);
      if (
        !parsed ||
        typeof parsed !== "object" ||
        typeof (parsed as { type?: unknown }).type !== "string"
      ) {
        throw new Error(`${COMMAND_ID} expects an object with a string \`type\``);
      }

      const { getSidebarSession } = await import("../providers/chat/chat-sidebar.ts");
      const session = getSidebarSession();
      if (!session) throw new Error("no sidebar chat session is running");
      await session.sendFromWebview(parsed as WebviewToExt);
    }),
  ];
}
