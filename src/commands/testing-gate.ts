// The e2e harness needs to stimulate the webview side of the chat — sending a
// prompt, aborting a run, answering a permission dialog. Test code runs in the
// extension host and VS Code exposes no API for injecting a message into a
// webview, so the stimulus has to live here, behind a gate.
//
// This module deliberately does not import `vscode`: the gate is the one piece
// worth unit-testing, and importing the vscode module would make that
// impossible under vitest.

/** `vscode.ExtensionMode.Production`. Numeric and stable in the public API. */
export const EXTENSION_MODE_PRODUCTION = 1;

export function shouldRegisterTestingCommands(mode: number): boolean {
  return mode !== EXTENSION_MODE_PRODUCTION;
}
