export type MeetingStatus =
  | "queued"
  | "transcribing"
  | "summarizing"
  | "ready"
  | "saved"
  | "deleting"
  | "failed";
export type MeetingSource = "microphone" | "upload" | "demo";
export interface ActionItem {
  id: string;
  text: string;
  owner: string;
  done: boolean;
}
export interface Notes {
  summary: string;
  keyPoints: string[];
  actions: ActionItem[];
}
export interface Utterance {
  speaker: string;
  start: number;
  end: number;
  text: string;
}
export interface Meeting {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status: MeetingStatus;
  source: MeetingSource;
  provider: "mock" | "assemblyai";
  consentAt: string;
  duration: number;
  matterId: string | null;
  notes: Notes | null;
  personalNotes: string;
  utterances: Utterance[];
  transcript: string;
  transcriptId?: string;
  audioPath?: string;
  audioMime?: string;
  error?: string;
  export?: ExportRecord;
}
export interface Matter {
  id: string;
  reference: string;
  name: string;
  client: string;
}
export interface ExportRecord {
  id: string;
  meetingId: string;
  matterId: string;
  createdAt: string;
  minutes: number;
  provider: "mock-clio";
  summary: string;
  keyPoints: string[];
  actions: ActionItem[];
  personalNotes: string;
  transcript: string;
}
export interface AppConfig {
  aiProvider: "mock" | "assemblyai";
  legalProvider: "mock-clio";
  maxUploadBytes: number;
}
