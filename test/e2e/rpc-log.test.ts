import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  findRpcLogPath,
  inboundEvents,
  inboundResponses,
  inboundUiRequests,
  parseRpcTrace,
} from "./rpc-log.ts";

const created: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-rpclog-"));
  created.push(dir);
  return dir;
}

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

// Shapes copied verbatim from a real run (FINDINGS §11.1).
const SAMPLE = [
  '[sidebar] -> {"type":"get_state","id":"a1"}',
  '[sidebar] <- {"id":"a1","type":"response","command":"get_state","success":true,"data":{"messageCount":0}}',
  '[sidebar] <- {"type":"extension_ui_request","id":"u1","method":"setStatus","statusKey":"pi-lens-lsp"}',
  '[sidebar] <- {"type":"agent_start"}',
  '[sidebar] -> {"type":"prompt","id":"a2","message":"hi"}',
  '[sidebar] <- {"id":"a2","type":"response","command":"prompt","success":true}',
  "[sidebar] [err] some stderr noise",
].join("\n");

describe("parseRpcTrace", () => {
  it("splits tag, direction and raw payload", () => {
    const entries = parseRpcTrace(SAMPLE);
    expect(entries).toHaveLength(7);
    // Out lines are `JSON.stringify(command)` (src/services/rpc/client.ts:132),
    // so they carry a parsed `json` exactly like inbound lines do.
    expect(entries[0]).toEqual({
      tag: "sidebar",
      direction: "out",
      raw: '{"type":"get_state","id":"a1"}',
      json: { type: "get_state", id: "a1" },
    });
    expect(entries[2]?.direction).toBe("in");
    expect(entries[6]).toEqual({ tag: "sidebar", direction: "err", raw: "some stderr noise" });
  });

  it("parses JSON payloads and tolerates non-JSON", () => {
    const entries = parseRpcTrace(SAMPLE);
    expect(entries[1]?.json).toMatchObject({ type: "response", command: "get_state" });
    expect(entries[6]?.json).toBeUndefined();
  });

  it("ignores blank lines and trailing whitespace", () => {
    expect(parseRpcTrace("\n[sidebar] -> {}\n\n  \n")).toHaveLength(1);
  });

  it("accepts an untagged line without throwing", () => {
    // The channel can contain lines the extension did not format.
    expect(parseRpcTrace("just some text")).toEqual([
      { tag: "", direction: "err", raw: "just some text" },
    ]);
  });
});

describe("inbound selectors", () => {
  const entries = parseRpcTrace(SAMPLE);

  it("extracts successful responses with their command and data", () => {
    expect(inboundResponses(entries)).toEqual([
      { command: "get_state", success: true, data: { messageCount: 0 } },
      { command: "prompt", success: true, data: undefined },
    ]);
  });

  it("extracts agent events, excluding responses and ui requests", () => {
    expect(inboundEvents(entries)).toEqual(["agent_start"]);
  });

  it("extracts extension_ui_request methods", () => {
    expect(inboundUiRequests(entries)).toEqual([{ method: "setStatus" }]);
  });
});

describe("findRpcLogPath", () => {
  it("finds the channel log nested under logs/<ts>/window1/exthost/output_logging_<ts>", () => {
    const userData = tempDir();
    const dir = join(
      userData,
      "logs",
      "20260918T174115",
      "window1",
      "exthost",
      "output_logging_20260918T174117",
    );
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "1-Pi Chat RPC.log");
    writeFileSync(file, SAMPLE);

    expect(findRpcLogPath(userData)).toBe(file);
  });

  it("returns undefined when no log exists yet", () => {
    expect(findRpcLogPath(tempDir())).toBeUndefined();
  });
});
