import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

/**
 * Name a chat session after the message that created it.
 *
 * Runs in-process — the same recipe as the commit-message generator: no
 * subprocess, no MCP bootstrap, no tools, an in-memory session. pi resolves the
 * model itself (its `defaultProvider`/`defaultModel`), so the panel never has to
 * pick one; if the call fails for any reason the session simply keeps its
 * timestamp title, which is why every failure here is swallowed.
 */

const SYSTEM_PROMPT =
  "You name chat sessions. Given the user's first message, reply with a title for it and nothing else: no quotes, no explanation, no trailing punctuation. At most 40 characters, written in the same language as the message.";

/** The message is only there to be summarized; a pasted file must not run the prompt away. */
const MAX_INPUT_CHARS = 2000;
/** A title is one short line. Anything longer is the model talking past the answer. */
const MAX_TITLE_CHARS = 40;
/** Background work with nobody watching it: a model that never answers must not leak a session. */
const TIMEOUT_MS = 20_000;

/** Quoting and emphasis a model adds around an answer nobody asked it to wrap. */
const WRAPPERS = /^["'`“”「」『』()（）*]+|["'`“”「」『』()（）*]+$/g;
const PUNCTUATION = /[。．.!！?？:：,，;；]+$/;

/**
 * The one line the reply is worth. Models like to hand back a quoted, bolded or
 * punctuated title even when told not to, so the shape is forced here rather
 * than trusted.
 */
export function sanitizeTitle(raw: string): string | undefined {
  const firstLine = raw
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return undefined;
  let title = firstLine.replace(/^[#>\s]+/, "");
  // Wrappers stack — 「间距调整」。 arrives wrapped *and* punctuated — so peel
  // until the string stops changing.
  for (let pass = 0; pass < 3; pass++) {
    title = title.replace(WRAPPERS, "").replace(PUNCTUATION, "").trim();
  }
  if (!title) return undefined;
  return title.length > MAX_TITLE_CHARS ? title.slice(0, MAX_TITLE_CHARS).trim() : title;
}

export async function generateSessionTitle(
  firstMessage: string,
  cwd: string,
): Promise<string | undefined> {
  const message = firstMessage.trim().slice(0, MAX_INPUT_CHARS);
  if (!message) return undefined;

  let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
  let unsubscribe: (() => void) | undefined;
  let timer: NodeJS.Timeout | undefined;
  try {
    const agentDir = getAgentDir();
    // Everything the project would otherwise inject (AGENTS.md, skills, the
    // coding system prompt) is noise for a title, and prompt tokens.
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPromptOverride: () => SYSTEM_PROMPT,
      appendSystemPromptOverride: () => [],
    });
    await loader.reload();

    const created = await createAgentSession({
      cwd,
      agentDir,
      noTools: "all",
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(),
    });
    session = created.session;

    let text = "";
    unsubscribe = session.subscribe((event) => {
      if (event.type !== "message_update") return;
      const inner = event.assistantMessageEvent as { type: string; delta?: string };
      if (inner?.type === "text_delta" && typeof inner.delta === "string") text += inner.delta;
    });

    timer = setTimeout(() => {
      void session?.abort().catch(() => {});
    }, TIMEOUT_MS);

    await session.prompt(message);
    return sanitizeTitle(text);
  } catch {
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
    try {
      unsubscribe?.();
      session?.dispose();
    } catch {
      /* nothing left to release */
    }
  }
}
