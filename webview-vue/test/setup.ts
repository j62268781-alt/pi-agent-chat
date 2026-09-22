// jsdom globals the real webview has and the test DOM does not.
//
// `ResizeObserver` is the one that bites: a component that measures itself
// (the queue's height, the transcript's growth) constructs one on mount, and
// without it every test that mounts such a component dies with a
// `ReferenceError`. The stub never calls back — jsdom does no layout, so there
// is nothing to observe and nothing to report.

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

// The popups scroll a keyboard highlight into view; jsdom has no layout and no
// such method at all, so a popup that opens would throw inside `nextTick`.
if (typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = () => {};
}
