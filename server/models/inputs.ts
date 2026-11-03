import { z } from "zod";
import { AppError } from "@server/utils/errors.ts";
import { NotesSchema } from "@server/models/notes.ts";

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export function parseInput<T>(
  schema: z.ZodType<T>,
  value: unknown,
  status = 400,
): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    // Messages are authored by us; never send raw payloads or Zod/vendor internals.
    throw new AppError(
      status,
      result.error.issues[0]?.message ?? "Invalid input.",
    );
  }
  return result.data;
}
export const textInput = (name: string, max = 200) => {
  const error = `${name} must contain 1–${max} characters.`;
  return z.string({ error }).max(max, { error }).trim().min(1, { error });
};
const consent = z.literal(true, {
  error: "Confirm participant consent before recording or uploading.",
});
const duration = z.number({ error: "Invalid recording duration." }).finite()
  .min(0).max(36000);
export const CreateMeetingSchema = z.object({
  title: textInput("Meeting title"),
  source: z.enum(["demo", "microphone", "upload"], {
    error: "Invalid meeting source.",
  }),
  consent,
  duration: duration.optional(),
  audioPath: z.string().min(1).optional(),
  audioMime: z.string().optional(),
}).refine((input) => input.source === "demo" || Boolean(input.audioPath), {
  error: "An audio recording is required.",
  path: ["audioPath"],
});
export const DemoMeetingSchema = z.object({
  title: textInput("Meeting title"),
  consent,
  source: z.literal("demo", {
    error: "Use a file upload for real recordings.",
  }),
});
export const UploadMeetingSchema = z.object({
  title: textInput("Meeting title"),
  source: z.enum(["upload", "microphone"], {
    error: "Invalid recording source.",
  }),
  consent: z.literal("true", {
    error: "Confirm participant consent before uploading.",
  }).transform(() => true as const),
  // Multipart values are strings. Reject File objects and non-finite conversions.
  duration: z.string().transform(Number).pipe(duration),
});
export const CreateMatterSchema = z.object({
  name: textInput("Matter name"),
  reference: textInput("Reference", 50),
  client: textInput("Client"),
});
export const PatchMeetingSchema = z.object({
  title: textInput("Meeting title").optional(),
  personalNotes: z.string().max(20000, {
    error: "Personal notes must be under 20,000 characters.",
  }).optional(),
  matterId: z.string().min(1).max(200).nullable().optional(),
  notes: NotesSchema.optional(),
});
export const SaveMeetingSchema = z.object({
  reviewed: z.literal(true, {
    error: "Review and confirm the notes before saving.",
  }),
});
export const DeleteMeetingSchema = z.object({
  confirmed: z.literal(true, {
    error: "Confirm before deleting this meeting.",
  }),
});
export const MeetingIdSchema = z.string().min(1).max(200);

const NonEmptyAudioSchema = z.instanceof(File, {
  error: "Choose a non-empty audio file.",
})
  .refine((file) => file.size > 0, { error: "Choose a non-empty audio file." });
const AudioSizeSchema = z.custom<File>(
  (file) => (file as File).size <= MAX_UPLOAD_BYTES,
  {
    error: "Recording is too large. Maximum upload is 50 MB.",
  },
);
const AudioFormatSchema = z.custom<File>((value) => {
  const file = value as File;
  return /\.(mp3|mp4|m4a|wav|webm|ogg|flac)$/i.test(file.name) &&
    /^(audio\/(mpeg|mp3|mp4|m4a|x-m4a|wav|wave|x-wav|webm|ogg|flac|x-flac)|video\/(webm|mp4)|application\/octet-stream)(;.*)?$/
      .test(file.type || "application/octet-stream");
}, { error: "Use MP3, M4A, MP4, WAV, WebM, OGG, or FLAC audio." });
export function validateAudioFile(value: unknown): File {
  const file = parseInput(NonEmptyAudioSchema, value);
  parseInput(AudioSizeSchema, file, 413);
  return parseInput(AudioFormatSchema, file, 415);
}
