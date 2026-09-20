// The folder a chat runs in, and the one case where a window has none.
//
// VS Code drops the launch folder when it hands an Extension Development Host
// its window: `WindowsMainService.openExtensionDevelopmentHostWindow` filters
// out any folder that another window already holds as a *folder* and then opens
// with `forceEmpty`, so pressing F5 while the repo is also open as a folder
// anywhere lands the host on the welcome page. With no
// `workspaceFolders[0]` the chat has no cwd: pi cannot resolve per-project
// sessions and the panel renders empty. Opening the repo through its
// `.code-workspace` file instead is what keeps the folder out of that filter —
// that, not the platform, is why the workaround works on one machine and not
// another.

let devHostRoot: string | undefined;

/**
 * Set once at activation. `isProduction` pins the fallback to dev/test hosts:
 * in an install, a folderless window means the user simply has no project open,
 * and running pi inside the extension's own directory would be nonsense.
 */
export function configureDevHostRoot(extensionRoot: string, isProduction: boolean): void {
  devHostRoot = isProduction ? undefined : extensionRoot;
}

/** The workspace folder if the window has one, else the dev-host fallback. */
export function resolveChatCwd(folder: string | undefined): string | undefined {
  return folder ?? devHostRoot;
}
