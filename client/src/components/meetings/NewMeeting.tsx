import { type FormEvent, useEffect, useState } from "react";
import {
  ArrowUpRight,
  FileAudio,
  Mic,
  Pause,
  Play,
  Sparkles,
  Square,
  UploadCloud,
} from "lucide-react";
import { ApiError } from "@client/lib/api.ts";
import type { AiUsage } from "@lib/types/usage.ts";
import type { AppConfig, Meeting } from "@lib/types/meeting.ts";
import { formatDuration } from "@lib/utils/meeting.ts";
import { useApi } from "@client/hooks/useApi.ts";
import { Modal } from "@client/components/ui/Modal.tsx";
import { Spinner } from "@client/components/ui/Spinner.tsx";
import { useRecorder } from "@client/hooks/useRecorder.ts";
import { validateNewMeeting } from "@client/schemas/new-meeting.ts";

export function NewMeeting(
  { config, close, created, usage, upgrade, startWithExample = false }: {
    config: AppConfig;
    startWithExample?: boolean;
    usage: AiUsage | null;
    upgrade: () => void;
    close: () => void;
    created: (meeting: Meeting) => void;
  },
) {
  const api = useApi();
  const [mode, setMode] = useState<"microphone" | "upload" | "demo">(
    startWithExample || usage?.remaining === 0 ? "demo" : "microphone",
  );
  const [title, setTitle] = useState("");
  const [consent, setConsent] = useState(false);
  const [upload, setUpload] = useState<File | null>(null);
  const [duration, setDuration] = useState(0);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const recorder = useRecorder();
  const file = mode === "microphone" ? recorder.file : upload;
  const exhausted = usage?.remaining === 0;
  const active = recorder.state === "recording" || recorder.state === "paused";
  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const validationError = validateNewMeeting({ source: mode, consent, file });
    if (validationError) {
      setError(validationError);
      return;
    }
    setBusy(true);
    try {
      let meeting: Meeting;
      if (mode === "demo") {
        meeting = await api.createDemo(
          title.trim() || "First home, next chapter",
          consent,
        );
      } else {
        const form = new FormData();
        form.append("audio", file!);
        form.append("title", title.trim());
        form.append("consent", String(consent));
        form.append("source", mode);
        form.append(
          "duration",
          String(mode === "microphone" ? recorder.seconds : duration),
        );
        meeting = await api.upload(form);
      }
      created(meeting);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "AI_QUOTA_EXHAUSTED") {
        upgrade();
        return;
      }
      setError((cause as Error).message);
      setBusy(false);
    }
  }
  function chooseFile(selected?: File) {
    if (!selected) return;
    if (selected.size > config.maxUploadBytes) {
      setError("Choose a recording smaller than 50 MB.");
      return;
    }
    setError("");
    setUpload(selected);
    setDuration(0);
    if (!title) {
      setTitle(selected.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "));
    }
  }
  return (
    <Modal
      title="New meeting"
      close={() => {
        if (!busy) close();
      }}
    >
      <form onSubmit={submit}>
        {exhausted && (
          <div className="quota-notice">
            <p>You’ve used all 3 free AI notes. Examples are still free.</p>
            <button type="button" className="text-button" onClick={upgrade}>
              View upgrade plans
            </button>
          </div>
        )}
        <div
          className="capture-tabs"
          role="tablist"
          aria-label="Capture method"
        >
          {[
            ["microphone", Mic, "Record"],
            ["upload", UploadCloud, "Upload audio"],
            ["demo", Sparkles, "Try an example"],
          ].map(([value, Icon, label]) => {
            const I = Icon as typeof Mic;
            return (
              <button
                type="button"
                role="tab"
                aria-selected={mode === value}
                key={value as string}
                disabled={active || busy || (exhausted && value !== "demo")}
                className={mode === value ? "active" : ""}
                onClick={() => {
                  setMode(value as typeof mode);
                  setConsent(false);
                  setError("");
                }}
              >
                <I size={16} />
                {label as string}
              </button>
            );
          })}
        </div>
        <label className="field">
          Meeting title<input
            maxLength={200}
            placeholder={mode === "demo"
              ? "First home, next chapter"
              : "e.g. Initial consultation with Sarah"}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required={mode !== "demo"}
            disabled={busy}
          />
        </label>
        {mode === "demo"
          ? (
            <div className="example-card">
              <span className="sample-icon">
                <Sparkles size={24} />
              </span>
              <h3>Try an example</h3>
              <p>
                Explore notes and a transcript from a fictional consultation.
              </p>
              <span className="tiny-label">
                3 min 47 sec
              </span>
            </div>
          )
          : mode === "upload"
          ? (
            <label
              className={`upload-zone ${upload ? "has-file" : ""}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                chooseFile(e.dataTransfer.files[0]);
              }}
            >
              <input
                type="file"
                aria-label="Choose audio recording"
                accept=".mp3,.mp4,.m4a,.wav,.webm,.ogg,.flac"
                onChange={(e) => chooseFile(e.target.files?.[0])}
                disabled={busy}
              />
              {upload ? <FileAudio size={28} /> : <UploadCloud size={28} />}
              <strong>
                {upload ? upload.name : "Drop your recording here"}
              </strong>
              <span>
                {upload
                  ? `${
                    (upload.size / 1024 / 1024).toFixed(1)
                  } MB · Click to replace`
                  : "or click to choose a file"}
              </span>
              <small>MP3, M4A, MP4, WAV, WebM, OGG, FLAC · Up to 50 MB</small>
            </label>
          )
          : (
            <div className={`record-panel ${active ? "is-recording" : ""}`}>
              <div className="record-wave" aria-hidden="true">
                {Array.from(
                  { length: 37 },
                  (_, i) => (
                    <i
                      key={i}
                      style={{
                        height: `${10 + ((i * 13 + 7) % 35)}px`,
                        animationDelay: `${i * .06}s`,
                      }}
                    />
                  ),
                )}
              </div>
              <span className="record-time">
                {formatDuration(recorder.seconds)}
              </span>
              <p>
                {recorder.state === "recording"
                  ? "Recording…"
                  : recorder.state === "paused"
                  ? "Paused"
                  : recorder.state === "stopped"
                  ? "Recording ready"
                  : "Ready to record"}
              </p>
              <div className="record-controls">
                {!active
                  ? (
                    <button
                      type="button"
                      className="button secondary"
                      disabled={!consent || busy}
                      onClick={recorder.start}
                    >
                      <Mic size={16} />
                      {recorder.file ? "Record again" : "Start recording"}
                    </button>
                  )
                  : (
                    <>
                      <button
                        type="button"
                        className="button secondary"
                        onClick={recorder.state === "paused"
                          ? recorder.resume
                          : recorder.pause}
                      >
                        {recorder.state === "paused"
                          ? <Play size={16} />
                          : <Pause size={16} />}
                        {recorder.state === "paused" ? "Resume" : "Pause"}
                      </button>
                      <button
                        type="button"
                        className="button danger"
                        onClick={recorder.stop}
                      >
                        <Square size={14} />Finish recording
                      </button>
                    </>
                  )}
              </div>
              <small>
                Microphone only. For online meetings, upload a recording.
              </small>
            </div>
          )}
        {preview && (
          <audio
            className="capture-preview"
            controls
            src={preview}
            onLoadedMetadata={(e) => {
              const value = e.currentTarget.duration;
              if (Number.isFinite(value)) setDuration(value);
            }}
          />
        )}
        {config.aiProvider === "mock" && mode !== "demo" && (
          <div className="notice">
            <Sparkles size={16} />
            <span>
              AI notes aren’t connected. You can save and play recordings.
            </span>
          </div>
        )}
        <label className="consent">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            disabled={active || busy}
          />
          <span>
            {mode === "demo"
              ? "I understand this is a fictional example."
              : "I have permission from everyone involved to record and process this conversation."}
          </span>
        </label>
        {(error || recorder.error) && (
          <p role="alert" className="form-error">{error || recorder.error}</p>
        )}
        <div className="modal-footer">
          <button
            className="button primary"
            disabled={busy || active || !consent ||
              (mode !== "demo" && (!file || exhausted || !usage))}
          >
            {busy
              ? <Spinner />
              : mode === "demo"
              ? <Sparkles size={16} />
              : <ArrowUpRight size={16} />}
            {busy
              ? "Creating meeting…"
              : mode === "demo"
              ? "Create example"
              : config.aiProvider === "assemblyai"
              ? "Generate notes"
              : "Save recording"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
