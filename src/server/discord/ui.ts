import type { Embed } from './api';

/** Discord message components (buttons, select menus, modal fields) and interaction responses. */

export const STYLE = { primary: 1, secondary: 2, success: 3, danger: 4, link: 5 } as const;
export const EPHEMERAL = 64;

export interface Button {
  type: 2;
  style: number;
  label: string;
  custom_id?: string;
  url?: string;
  emoji?: { name: string };
  disabled?: boolean;
}
export interface SelectOption {
  label: string;
  value: string;
  description?: string;
  emoji?: { name: string };
}
export interface Select {
  type: 3;
  custom_id: string;
  placeholder?: string;
  options: SelectOption[];
}
export interface TextInput {
  type: 4;
  custom_id: string;
  label: string;
  style: 1 | 2;
  min_length?: number;
  max_length?: number;
  required?: boolean;
  placeholder?: string;
}
export interface Row {
  type: 1;
  components: (Button | Select | TextInput)[];
}

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export const button = (label: string, customId: string, style: number = STYLE.secondary, emoji?: string, disabled?: boolean): Button => ({
  type: 2,
  style,
  label: cut(label, 80),
  custom_id: customId,
  ...(emoji ? { emoji: { name: emoji } } : {}),
  ...(disabled ? { disabled } : {}),
});
export const linkButton = (label: string, url: string, emoji?: string): Button => ({ type: 2, style: STYLE.link, label: cut(label, 80), url, ...(emoji ? { emoji: { name: emoji } } : {}) });
export const select = (customId: string, options: SelectOption[], placeholder?: string): Select => ({
  type: 3,
  custom_id: customId,
  placeholder,
  options: options.slice(0, 25).map((o) => ({ ...o, label: cut(o.label, 100), ...(o.description ? { description: cut(o.description, 100) } : {}) })),
});
export const textInput = (customId: string, label: string, opts: { long?: boolean; min?: number; max?: number; placeholder?: string; required?: boolean } = {}): TextInput => ({
  type: 4,
  custom_id: customId,
  label,
  style: opts.long ? 2 : 1,
  ...(opts.min ? { min_length: opts.min } : {}),
  ...(opts.max ? { max_length: opts.max } : {}),
  ...(opts.placeholder ? { placeholder: opts.placeholder } : {}),
  required: opts.required ?? true,
});
/** Up to 5 buttons per row. */
export const rows = (...components: (Button | Select | TextInput)[]): Row[] => {
  const out: Row[] = [];
  for (const c of components) {
    const last = out.at(-1);
    if (c.type === 2 && last && last.components.length < 5 && last.components.every((x) => x.type === 2)) last.components.push(c);
    else out.push({ type: 1, components: [c] });
  }
  return out;
};

export interface MessageData {
  content?: string;
  embeds?: Embed[];
  components?: Row[];
  flags?: number;
  allowed_mentions?: { parse: string[]; users?: string[]; roles?: string[] };
}

/** Interaction response: a new message (4), the clicked message updated (7) or a modal (9). */
export type Response = { type: 1 } | { type: 4 | 7; data: MessageData } | { type: 5 | 6; data?: { flags?: number } } | { type: 9; data: { custom_id: string; title: string; components: Row[] } };

const noPings = { parse: [] as string[] };
export const reply = (data: MessageData, ephemeral = false): Response => ({ type: 4, data: { allowed_mentions: noPings, ...data, ...(ephemeral ? { flags: EPHEMERAL } : {}) } });
export const say = (content: string, ephemeral = true): Response => reply({ content }, ephemeral);
export const update = (data: MessageData): Response => ({ type: 7, data: { allowed_mentions: noPings, components: [], ...data } });
export const modal = (customId: string, title: string, inputs: TextInput[]): Response => ({ type: 9, data: { custom_id: customId, title: cut(title, 45), components: inputs.map((c) => ({ type: 1, components: [c] })) } });
/** "Thinking…" now, the real answer comes later (editOriginal). */
export const deferred = (ephemeral = true): Response => ({ type: 5, data: ephemeral ? { flags: EPHEMERAL } : {} });

/** A text progress bar, e.g. ▰▰▰▰▱▱▱▱▱▱ 40 %. */
export function bar(share: number, size = 10) {
  const s = Math.max(0, Math.min(1, share));
  const full = Math.round(s * size);
  return `${'▰'.repeat(full)}${'▱'.repeat(size - full)} ${Math.round(s * 100)} %`;
}
