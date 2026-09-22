// The `vscode` module at unit-test time.
//
// Host modules import the API as a value (`vscode.workspace…`), and there is no
// such module outside an extension host: only `@types/vscode` is installed. The
// vitest config aliases `vscode` here so a unit test can load a host module that
// only *reads* configuration. Everything the loaded path does not call is
// deliberately absent — an unexpected call should fail loudly, not be faked.

const configuration = {
  get: <T>(_key: string, fallback?: T): T | undefined => fallback,
  update: async (): Promise<void> => {},
  has: (): boolean => false,
  inspect: (): undefined => undefined,
};

export const workspace = {
  workspaceFolders: undefined as Array<{ uri: { fsPath: string; scheme: string } }> | undefined,
  getConfiguration: () => configuration,
  onDidChangeConfiguration: () => ({ dispose: () => {} }),
};

export const env = { language: "en" };

export const Uri = {
  file: (p: string) => ({ fsPath: p, path: p, scheme: "file", toString: () => `file://${p}` }),
  parse: (s: string) => ({ fsPath: s, path: s, scheme: s.split(":")[0], toString: () => s }),
  joinPath: (base: { fsPath: string }, ...parts: string[]) =>
    Uri.file([base.fsPath, ...parts].join("/")),
};
