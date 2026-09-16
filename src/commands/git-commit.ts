// SCM-title commands that ask the pi agent to draft a commit message from the
// staged diff.

import * as vscode from "vscode";

export function registerGitCommitCommands(): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("pi-agent-chat.generateGitCommitMessage", async (scm) => {
      const { generateCommitMsg } = await import("../services/git/commit-message.ts");
      generateCommitMsg(scm);
    }),

    vscode.commands.registerCommand("pi-agent-chat.abortGitCommitMessage", async () => {
      const { abortCommitGeneration } = await import("../services/git/commit-message.ts");
      abortCommitGeneration();
    }),
  ];
}
