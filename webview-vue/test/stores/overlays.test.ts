import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { useOverlaysStore } from "@/stores/overlays.ts";

describe("overlays widget slots", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("keeps one entry per key, so two extensions cannot evict each other", () => {
    const overlays = useOverlaysStore();
    overlays.applyWidget("rewind-files", ['{"files":[]}']);
    overlays.applyWidget("pi-todo", ['{"items":[]}']);
    expect(Object.keys(overlays.widgets)).toEqual(["rewind-files", "pi-todo"]);
  });

  it("clearing one key leaves the other alone", () => {
    const overlays = useOverlaysStore();
    overlays.applyWidget("rewind-files", ["a"]);
    overlays.applyWidget("pi-todo", ["b"]);
    overlays.applyWidget("pi-todo", undefined);
    expect(overlays.widgets["pi-todo"]).toBeUndefined();
    expect(overlays.widgets["rewind-files"]).toEqual(["a"]);
  });

  it("treats empty lines as a clear and ignores a missing key", () => {
    const overlays = useOverlaysStore();
    overlays.applyWidget("pi-todo", ["x"]);
    overlays.applyWidget("pi-todo", []);
    overlays.applyWidget(undefined, ["y"]);
    expect(overlays.widgets).toEqual({});
  });
});
