/**
 * Discord's limits for one message (characters): content 2000; an embed's title 256,
 * description 4096, up to 25 fields of name 256 / value 1024, footer 2048, and 6000 for
 * all embeds together. Messages are built in Bulgarian and translated afterwards, so a
 * translation can grow past them (413 „Message size exceeds maximum allowed“); `fitMessage`
 * makes the final message fit just before it is sent, whatever its language.
 */
export const DISCORD_LIMITS = { content: 2000, title: 256, description: 4096, fields: 25, fieldName: 256, fieldValue: 1024, footer: 2048, total: 6000 } as const;

const cut = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).replace(/\s+\S*$/, '')}…`);

interface Embed {
  title?: string;
  description?: string;
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
  author?: { name: string };
  [k: string]: unknown;
}

const size = (e: Embed) => (e.title?.length ?? 0) + (e.description?.length ?? 0) + (e.footer?.text.length ?? 0) + (e.author?.name.length ?? 0) + (e.fields ?? []).reduce((n, f) => n + f.name.length + f.value.length, 0);

export function fitMessage<T extends Record<string, unknown>>(payload: T): T {
  const out: Record<string, unknown> = { ...payload };
  if (typeof out.content === 'string') out.content = cut(out.content, DISCORD_LIMITS.content);
  if (!Array.isArray(out.embeds)) return out as T;
  const embeds: Embed[] = (out.embeds as Embed[]).map((e) => ({
    ...e,
    ...(e.title !== undefined ? { title: cut(e.title, DISCORD_LIMITS.title) } : {}),
    ...(e.description !== undefined ? { description: cut(e.description, DISCORD_LIMITS.description) } : {}),
    ...(e.footer ? { footer: { ...e.footer, text: cut(e.footer.text, DISCORD_LIMITS.footer) } } : {}),
    ...(e.fields ? { fields: e.fields.slice(0, DISCORD_LIMITS.fields).map((f) => ({ ...f, name: cut(f.name, DISCORD_LIMITS.fieldName), value: cut(f.value, DISCORD_LIMITS.fieldValue) })) } : {}),
  }));
  const total = () => embeds.reduce((n, e) => n + size(e), 0);
  // Over the total: drop fields from the end of the last embed that has any, then shorten descriptions.
  for (let i = embeds.length - 1; i >= 0 && total() > DISCORD_LIMITS.total; i--) {
    while (embeds[i]!.fields?.length && total() > DISCORD_LIMITS.total) embeds[i]!.fields = embeds[i]!.fields!.slice(0, -1);
  }
  for (let i = embeds.length - 1; i >= 0 && total() > DISCORD_LIMITS.total; i--) {
    const e = embeds[i]!;
    if (e.description) e.description = cut(e.description, Math.max(1, e.description.length - (total() - DISCORD_LIMITS.total) - 1));
  }
  out.embeds = embeds;
  return out as T;
}
