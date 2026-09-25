// The `vscode` module at unit-test time.
//
// Host modules import the API as a value (`vscode.workspace…`), and there is no
// such module outside an extension host: only `@types/vscode` is installed. The
// vitest config aliases `vscode` here so a unit test can load a host module that
// only *reads* configuration. Everything the loaded path does not call is
// deliberately absent — an unexpected call should fail loudly, not be faked.
// Two exceptions, both read back by a test that asserts on them: an output
// channel that records what it was given, and configuration values a test pins.

/** Configuration values a test wants to pin; anything else falls back. */
const configured = new Map<string, unknown>();

export function setConfigValue(key: string, value: unknown): void {
  configured.set(key, value);
}

/** What the extension wrote to its output channels, in order. */
export const outputLines: Array<{ channel: string; line: string }> = [];

export const window = {
  createOutputChannel: (channel: string) => ({
    appendLine: (line: string): void => {
      outputLines.push({ channel, line });
    },
    dispose: (): void => {},
    show: (): void => {},
  }),
};

const configuration = {
  get: <T>(key: string, fallback?: T): T | undefined =>
    configured.has(key) ? (configured.get(key) as T) : fallback,
  update: async (): Promise<void> => {},
  has: (key: string): boolean => configured.has(key),
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
