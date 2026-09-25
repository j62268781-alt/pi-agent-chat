import * as vscode from "vscode";

const CHANNEL_NAME = "Pi Chat RPC";
let channel: vscode.OutputChannel | undefined;

function isEnabled(): boolean {
  return vscode.workspace.getConfiguration("pi-agent-chat").get<boolean>("rpcTrace") ?? false;
}

function getChannel(): vscode.OutputChannel {
  if (!channel) channel = vscode.window.createOutputChannel(CHANNEL_NAME);
  return channel;
}

export function rpcTrace(tag: string, direction: "out" | "in", line: string): void {
  if (!isEnabled()) return;
  const arrow = direction === "out" ? "->" : "<-";
  getChannel().appendLine(`[${tag}] ${arrow} ${line}`);
}

export function rpcTraceErr(tag: string, line: string): void {
  if (!isEnabled()) return;
  getChannel().appendLine(`[${tag}] [err] ${line}`);
}

/**
 * The session-title call's own report.
 *
 * It is the panel's other model call, and unlike the chat it fails *silently* by
 * design (the session keeps its date), so without a line here "起名没生效" is
 * unanswerable: `console.*` from an extension host does not reach the exthost log
 * (measured), which is the only other place this could have gone.
 */
export function titleTrace(line: string): void {
  if (!isEnabled()) return;
  getChannel().appendLine(`[title] ${line}`);
}

export function disposeRpcTrace(): void {
  channel?.dispose();
  channel = undefined;
}
