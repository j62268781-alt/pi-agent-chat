import { describe, expect, it } from "vitest";
import { createStderrTail } from "./stderr-tail.ts";

describe("createStderrTail", () => {
  it("starts empty", () => {
    const tail = createStderrTail();
    expect(tail.text()).toBe("");
    expect(tail.count).toBe(0);
  });

  it("keeps push order", () => {
    const tail = createStderrTail();
    tail.push("first");
    tail.push("second");
    expect(tail.text()).toBe("first\nsecond");
  });

  it("drops the oldest line past the cap, so a chatty pi cannot grow it", () => {
    const tail = createStderrTail(3);
    for (const line of ["a", "b", "c", "d", "e"]) tail.push(line);
    expect(tail.count).toBe(3);
    expect(tail.text()).toBe("c\nd\ne");
  });

  it("ignores blank and whitespace-only lines", () => {
    const tail = createStderrTail();
    tail.push("");
    tail.push("   ");
    tail.push("Error: Failed to load extension");
    expect(tail.count).toBe(1);
    expect(tail.text()).toBe("Error: Failed to load extension");
  });

  it("keeps a real pi extension-load failure verbatim", () => {
    const tail = createStderrTail();
    tail.push(
      "Error: Failed to load extension \"C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\pi-lens\\dist\\index.js\": Failed to load extension: Cannot find module '@earendil-works/pi-tui'",
    );
    tail.push("Require stack:");
    tail.push("- C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\pi-lens\\dist\\index.js");
    expect(tail.text().split("\n")).toHaveLength(3);
    expect(tail.text()).toContain("Cannot find module '@earendil-works/pi-tui'");
  });
});
