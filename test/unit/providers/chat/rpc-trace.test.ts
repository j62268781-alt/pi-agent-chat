// The session-title call's report, which is the only place its failures can be
// read from: it is silent by design (the session keeps its date), and an
// extension host's `console.*` does not reach the exthost log (measured), so a
// line in the "Pi Chat RPC" channel is what makes "起名没生效" answerable.

import { beforeEach, describe, expect, it } from "vitest";
import { disposeRpcTrace, rpcTrace, titleTrace } from "../../../../src/providers/chat/rpc-trace.ts";
import { outputLines, setConfigValue } from "../../stubs/vscode.ts";

describe("the trace channel", () => {
  beforeEach(() => {
    outputLines.length = 0;
    disposeRpcTrace();
    setConfigValue("rpcTrace", false);
  });

  it("stays silent while the switch is off", () => {
    titleTrace('named in 2600ms: "登录会话丢失"');
    rpcTrace("chat", "out", '{"type":"get_state"}');

    expect(outputLines).toEqual([]);
  });

  it("reports what the naming call did when it is on", () => {
    setConfigValue("rpcTrace", true);

    titleTrace('named in 2600ms: "登录会话丢失"');
    titleTrace("no title: Request timed out.");

    expect(outputLines).toEqual([
      { channel: "Pi Chat RPC", line: '[title] named in 2600ms: "登录会话丢失"' },
      { channel: "Pi Chat RPC", line: "[title] no title: Request timed out." },
    ]);
  });
});
