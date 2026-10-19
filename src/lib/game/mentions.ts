/**
 * Chat mentions: "@username" in a message. Usernames are 3–20 letters, digits,
 * dot, dash or underscore (see the sign-up rules). Shared by server (who to
 * notify) and client (highlighting, autocomplete).
 */
export const MENTION_RE = /(^|[^\p{L}\p{N}_.@-])@([\p{L}\p{N}_.-]{3,20})/gu;

/** At most this many players are notified per message. */
export const MENTION_MAX = 5;

/** Distinct usernames mentioned in a message (in order, lower-cased for matching). */
export function extractMentions(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(MENTION_RE)) {
    // A trailing dot or dash ends the sentence, not the name.
    const name = m[2]!.replace(/[.-]+$/, '').toLowerCase();
    if (name.length >= 3 && !out.includes(name)) out.push(name);
  }
  return out.slice(0, MENTION_MAX);
}

/** Splits a message into text and mention parts for rendering. */
export function splitMentions(body: string): { text: string; mention?: string }[] {
  const parts: { text: string; mention?: string }[] = [];
  let last = 0;
  for (const m of body.matchAll(MENTION_RE)) {
    const name = m[2]!.replace(/[.-]+$/, '');
    const start = m.index! + m[1]!.length;
    if (start > last) parts.push({ text: body.slice(last, start) });
    parts.push({ text: `@${name}`, mention: name });
    last = start + 1 + name.length;
  }
  if (last < body.length) parts.push({ text: body.slice(last) });
  return parts;
}

/** The "@partial" being typed at the end of the text before the caret, if any. */
export function typingMention(textBeforeCaret: string): string | null {
  const m = /(^|\s)@([\p{L}\p{N}_.-]{0,20})$/u.exec(textBeforeCaret);
  return m ? m[2]! : null;
}

/** A small set of emoji for the chat picker (plain Unicode, no images). */
export const CHAT_EMOJI = ['😀', '😂', '😉', '😍', '😎', '🤔', '😅', '😢', '😡', '👍', '👎', '👏', '🙏', '💪', '🤝', '👋', '🔥', '🎉', '❤️', '💯', '✅', '❌', '⚠️', '⏰', '🚚', '🚛', '🛣️', '⛽', '🛠️', '📦', '💰', '🏆', '⭐', '🌙', '☀️', '❄️', '🎄', '🎃', '🍀', '☕'];
