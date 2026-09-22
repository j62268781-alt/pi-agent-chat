// The "a run just settled" chime.
//
// VS Code's own audio cues are unreachable from here: `accessibility.signals.*`
// has no notification entry, and every cue the workbench actually plays comes
// off its own chat/terminal/task internals (audited 2026-09-22). What a webview
// *does* get is the right to play media — VS Code's default CSP allows
// `media-src 'self' data:` — so the panel carries its own 225ms two-note chime
// (`src/assets/completion.wav`, synthesized, no licensing) and rings it itself.
//
// Electron's autoplay policy defaults to `no-user-gesture-required` and VS Code
// does not override it, so this normally starts on its own. The catch below is
// the fallback for a host that is stricter: the first pointer or key event
// anywhere in the panel rings the pending chime and unlocks the element for
// good.

import chimeUrl from "@/assets/completion.wav";

let element: HTMLAudioElement | null = null;
let unlocked = false;
let waitingForGesture = false;

function chime(): HTMLAudioElement {
  element ??= new Audio(chimeUrl);
  return element;
}

function onFirstGesture(): void {
  document.removeEventListener("pointerdown", onFirstGesture);
  document.removeEventListener("keydown", onFirstGesture);
  unlocked = true;
  if (!waitingForGesture) return;
  waitingForGesture = false;
  void chime()
    .play()
    .catch(() => {});
}

/** Ring it; called when a turn settles and the user did not stop that turn. */
export function playCompletionChime(): void {
  const audio = chime();
  audio.currentTime = 0;
  void audio.play().catch(() => {
    if (unlocked || waitingForGesture) return;
    waitingForGesture = true;
    document.addEventListener("pointerdown", onFirstGesture);
    document.addEventListener("keydown", onFirstGesture);
  });
}
