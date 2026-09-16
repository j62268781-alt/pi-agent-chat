// Helpers for reading pi's message envelopes, which are loosely typed on the
// wire: `content` is either a string or an array of content blocks.

export interface ImageBlock {
  type: "image";
  data: string;
  mimeType: string;
}

/** Concatenate the text of a `content` field (string or block array). */
export function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  let text = "";
  for (const block of content) {
    if (typeof block === "string") text += block;
    else if (
      block &&
      typeof block === "object" &&
      typeof (block as { text?: unknown }).text === "string"
    ) {
      text += (block as { text: string }).text;
    }
  }
  return text;
}

/** Pull image blocks out of a `content` field. */
export function extractImages(content: unknown): ImageBlock[] {
  if (!Array.isArray(content)) return [];
  const images: ImageBlock[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const candidate = block as Partial<ImageBlock> & { type?: unknown };
    if (candidate.type === "image" && candidate.data && candidate.mimeType) {
      images.push({ type: "image", data: candidate.data, mimeType: candidate.mimeType });
    }
  }
  return images;
}

/** True when a user-role envelope is really a tool result echoed back. */
export function isToolResultMessage(message: Record<string, unknown>): boolean {
  return message.role === "toolResult" || typeof message.toolCallId === "string";
}
