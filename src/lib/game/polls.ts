import { z } from 'zod';

/** Polls in the company chat (v1.3): one open at a time, members vote once (and may change their vote). */
export const POLL = {
  questionMax: 140,
  optionMax: 60,
  minOptions: 2,
  maxOptions: 5,
  hours: [6, 24, 48, 72] as const,
} as const;

export const pollInputSchema = z.object({
  question: z.string().trim().min(3, 'Въпросът е твърде кратък.').max(POLL.questionMax),
  options: z
    .array(z.string().trim().max(POLL.optionMax))
    .transform((xs) => xs.filter(Boolean))
    .pipe(z.array(z.string()).min(POLL.minOptions, 'Нужни са поне два отговора.').max(POLL.maxOptions, `Най-много ${POLL.maxOptions} отговора.`)),
  hours: z.number().int().refine((h) => (POLL.hours as readonly number[]).includes(h), 'Невалидна продължителност.'),
});
export type PollInput = z.infer<typeof pollInputSchema>;
