import type { Notes } from "@lib/types/meeting.ts";
import { AppError } from "@server/utils/errors.ts";
import { z } from "zod";

export const NotesSchema = z.object({
  summary: z.string().max(20000).refine((value) => Boolean(value.trim())),
  keyPoints: z.array(z.string().max(4000)).max(50),
  actions: z.array(z.object({
    id: z.string().max(200).default(() => crypto.randomUUID()),
    text: z.string().max(4000),
    owner: z.string().max(200),
    done: z.boolean().default(false),
  })).max(50),
});

export function validateNotes(value: unknown): Notes {
  const result = NotesSchema.safeParse(value);
  if (!result.success) {
    throw new AppError(
      422,
      "Notes have an invalid format. Please retry or check your edits.",
    );
  }
  return result.data;
}
