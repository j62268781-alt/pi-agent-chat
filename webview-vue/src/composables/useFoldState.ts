// The open state of a `<details>` that the component also drives itself.

import { ref } from "vue";

/**
 * Chromium raises `toggle` for a programmatic `open` change just as it does for a
 * click, so a handler that reads every `toggle` as user intent latches on the
 * component's own auto-open — and from then on `set` is ignored, which is how a
 * thinking row used to stay unfolded after the answer had started.
 *
 * `onToggle` therefore only records a decision when the new state is *not* the
 * one we asked for: that difference is what a real click leaves behind.
 */
export function useFoldState(initial: boolean) {
  const open = ref(initial);
  const pinnedByUser = ref(false);

  function onToggle(event: Event): void {
    const details = event.target as HTMLDetailsElement;
    if (details.open === open.value) return;
    pinnedByUser.value = true;
    open.value = details.open;
  }

  /** Drive the fold from state. A decision the user made by hand wins. */
  function set(next: boolean): void {
    if (pinnedByUser.value) return;
    open.value = next;
  }

  /** Record a touch that does not come through `toggle` (e.g. ctrl+click). */
  function pin(): void {
    pinnedByUser.value = true;
  }

  return { open, onToggle, set, pin };
}
