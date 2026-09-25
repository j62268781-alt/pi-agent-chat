// The shape-forcing half of session naming: the model is asked for a title and
// nothing else, and this is where "nothing else" is enforced. No model call here
// — `generateSessionTitle` needs a live provider, and everything it does with
// the reply passes through `sanitizeTitle`.

import { describe, expect, it } from "vitest";
import { sanitizeTitle } from "../../../../src/services/chat/session-title.ts";

describe("sanitizeTitle", () => {
  it("keeps a plain title as it is", () => {
    expect(sanitizeTitle("登录会话丢失排查")).toBe("登录会话丢失排查");
  });

  it("drops the wrapping a model adds on its own", () => {
    expect(sanitizeTitle('"登录会话丢失排查"')).toBe("登录会话丢失排查");
    expect(sanitizeTitle("**虚拟滚动实现**")).toBe("虚拟滚动实现");
    expect(sanitizeTitle("# 间距调整")).toBe("间距调整");
    expect(sanitizeTitle("「间距调整」")).toBe("间距调整");
  });

  it("takes the first line of a reply that kept talking", () => {
    expect(sanitizeTitle("标题：\n\n这是一个更长的解释")).toBe("标题");
  });

  it("strips a trailing full stop", () => {
    expect(sanitizeTitle("Request timed out.")).toBe("Request timed out");
    expect(sanitizeTitle("间距调整。")).toBe("间距调整");
  });

  it("has nothing for an empty or punctuation-only reply", () => {
    expect(sanitizeTitle("")).toBeUndefined();
    expect(sanitizeTitle("   \n  ")).toBeUndefined();
    expect(sanitizeTitle("。。。")).toBeUndefined();
  });

  it("cuts a runaway reply down to a title", () => {
    expect(sanitizeTitle("一".repeat(60))).toBe("一".repeat(40));
  });
});
