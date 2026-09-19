/**
 * The last few stderr lines of a `pi --mode rpc` subprocess.
 *
 * pi reports a broken extension as a stderr `Error:` and then exits 1 without
 * ever answering a command, so the only diagnosis of a session that never
 * starts lives there. The rpcTrace output channel is off by default, which
 * means the message must be held in memory to be shown at all — this is that
 * buffer, deliberately independent of the trace setting.
 */
export interface StderrTail {
  push(line: string): void;
  text(): string;
  readonly count: number;
}

export function createStderrTail(maxLines = 40): StderrTail {
  const lines: string[] = [];
  return {
    push(line: string): void {
      if (!line.trim()) return;
      lines.push(line);
      if (lines.length > maxLines) lines.shift();
    },
    text(): string {
      return lines.join("\n");
    },
    get count(): number {
      return lines.length;
    },
  };
}
