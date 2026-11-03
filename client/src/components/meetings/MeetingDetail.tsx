import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Check,
  CheckCheck,
  CheckSquare2,
  ChevronDown,
  CircleAlert,
  Clock3,
  FileText,
  FolderOpen,
  Headphones,
  Mic,
  Pencil,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type { Matter, Meeting, Notes } from "@lib/types/meeting.ts";
import {
  billableMinutes,
  formatDuration,
  isProcessing,
} from "@lib/utils/meeting.ts";
import { DeleteMeeting } from "@client/components/meetings/DeleteMeeting.tsx";
import { ApiError } from "@client/lib/api.ts";
import { useApi } from "@client/hooks/useApi.ts";
import { Empty } from "@client/components/ui/Empty.tsx";
import { Spinner } from "@client/components/ui/Spinner.tsx";
import { Status } from "@client/components/ui/Status.tsx";

export function MeetingDetail(
  { meeting, matters, updated, notify, back, deleted, upgrade }: {
    meeting: Meeting;
    matters: Matter[];
    updated: (m: Meeting) => void;
    notify: (text: string) => void;
    back: () => void;
    deleted: (id: string) => void;
    upgrade: () => void;
  },
) {
  const api = useApi();
  const [deleting, setDeleting] = useState(false);
  const [tab, setTab] = useState<"notes" | "transcript" | "personal">("notes");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Notes | null>(meeting.notes);
  const [personal, setPersonal] = useState(meeting.personalNotes);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [transcriptQuery, setTranscriptQuery] = useState("");
  const audio = useRef<HTMLAudioElement>(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [audioError, setAudioError] = useState("");
  useEffect(() => {
    if (meeting.source === "demo") return;
    const controller = new AbortController();
    let objectUrl = "";
    setAudioUrl("");
    setAudioError("");
    void api.audio(meeting.id, controller.signal).then((blob) => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      setAudioUrl(objectUrl);
    }).catch((cause) => {
      if (!controller.signal.aborted) setAudioError((cause as Error).message);
    });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [meeting.id, meeting.source, api]);
  const matter = matters.find((m) => m.id === meeting.matterId);
  const saved = meeting.status === "saved";
  const ready = meeting.status === "ready";
  const processing = isProcessing(meeting.status);
  const date = new Date(meeting.createdAt);
  const personalDirty = personal !== meeting.personalNotes;
  useEffect(() => {
    if (!editing) setDraft(meeting.notes);
  }, [meeting.notes, editing]);
  async function mutate(operation: () => Promise<Meeting>, message?: string) {
    setBusy(true);
    setError("");
    try {
      updated(await operation());
      if (message) notify(message);
      return true;
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "AI_QUOTA_EXHAUSTED") {
        upgrade();
        return false;
      }
      setError((cause as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function saveNotes() {
    if (!draft) return;
    if (
      await mutate(
        () => api.patch(meeting.id, { notes: draft }),
        "File note updated",
      )
    ) {
      setEditing(false);
      setReviewed(false);
    }
  }
  async function saveToMatter() {
    if (personalDirty) {
      setError("Save your personal notes before saving to a matter.");
      setTab("personal");
      return;
    }
    await mutate(
      () => api.save(meeting.id),
      "Notes saved to matter",
    );
  }
  function download() {
    if (!meeting.notes) return;
    const body = `# ${meeting.title}\n\n${
      meeting.source === "demo" ? "FICTIONAL DEMO\n\n" : ""
    }${
      meeting.provider === "mock"
        ? "MOCK AI OUTPUT — not a real transcription of uploaded audio.\n\n"
        : ""
    }Date: ${date.toISOString()}\nMatter: ${
      matter ? `${matter.reference} — ${matter.name}` : "Unassigned"
    }\nDuration: ${
      formatDuration(meeting.duration)
    }\n\n## Summary\n\n${meeting.notes.summary}\n\n## Key points\n\n${
      meeting.notes.keyPoints.map((p) => `- ${p}`).join("\n")
    }\n\n## Action items\n\n${
      meeting.notes.actions.map((a) =>
        `- [${a.done ? "x" : " "}] ${a.text} (${a.owner})`
      ).join("\n")
    }\n\n## Personal notes\n\n${
      meeting.personalNotes || "None"
    }\n\n## Transcript\n\n${meeting.transcript}\n`;
    const url = URL.createObjectURL(
      new Blob([body], { type: "text/markdown;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${
      meeting.title.replace(/[^a-z0-9 -]/gi, "").slice(0, 80) || "meeting"
    }-notes.md`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify("Meeting notes downloaded");
  }
  function seek(milliseconds: number) {
    if (audio.current) {
      audio.current.currentTime = milliseconds / 1000;
      void audio.current.play().catch(() => {});
    }
  }
  const utterances = meeting.utterances.filter((u) =>
    u.text.toLowerCase().includes(transcriptQuery.toLowerCase())
  );
  return (
    <article className="meeting-detail">
      <div className="detail-top">
        <button className="text-button mobile-back" onClick={back}>
          <ArrowLeft size={16} />Meetings
        </button>
        <div className="detail-tools">
          <button
            className="icon-button delete-trigger"
            title="Delete meeting"
            aria-label="Delete meeting"
            onClick={() => setDeleting(true)}
          >
            <Trash2 size={17} />
          </button>
          <button
            className="icon-button"
            title="Download file note"
            aria-label="Download file note"
            disabled={!meeting.notes}
            onClick={download}
          >
            <ArrowDownToLine size={18} />
          </button>
        </div>
      </div>
      <div className="detail-heading">
        <div className="detail-type">
          <span className="round-icon">
            <Headphones size={21} />
          </span>
          <Status status={meeting.status} />
        </div>
        <h2>{meeting.title}</h2>
        <div className="meeting-meta">
          <span>
            {date.toLocaleDateString(undefined, {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </span>
          <i />{" "}
          <span>
            {date.toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
          <i />
          <span>
            <Clock3 size={13} />
            {meeting.duration
              ? formatDuration(meeting.duration)
              : "Duration pending"}
          </span>
        </div>
      </div>
      <div className="detail-layout">
        <div className="note-column">
          {meeting.source === "demo"
            ? (
              <div className="sample-notice">
                <Sparkles size={15} />
                <span>Example meeting · fictional data</span>
              </div>
            )
            : (
              <div className="audio-strip">
                <AudioLines size={18} />
                <audio
                  ref={audio}
                  aria-label="Meeting recording"
                  controls
                  preload="metadata"
                  src={audioUrl || undefined}
                />
              </div>
            )}
          {audioError && <p className="form-error" role="alert">{audioError}
          </p>}
          {meeting.source !== "demo" && !audioUrl && !audioError && (
            <p className="audio-status">Loading your recording…</p>
          )}
          <div
            className="detail-tabs"
            role="tablist"
            aria-label="Meeting content"
          >
            {[
              ["notes", Sparkles, "AI notes"],
              ["transcript", FileText, "Transcript"],
              ["personal", Pencil, "My notes"],
            ].map(([value, Icon, label]) => {
              const I = Icon as typeof Mic;
              return (
                <button
                  role="tab"
                  aria-selected={tab === value}
                  key={value as string}
                  className={tab === value ? "active" : ""}
                  onClick={() => setTab(value as typeof tab)}
                >
                  <I size={15} />
                  {label as string}
                  {value === "personal" && personalDirty && (
                    <i className="unsaved-dot" />
                  )}
                </button>
              );
            })}
          </div>
          {error && (
            <div className="notice error" role="alert">
              <CircleAlert size={17} />
              <span>{error}</span>
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <X size={15} />
              </button>
            </div>
          )}
          {processing
            ? (
              <div className="processing-card">
                <span className="processing-orb">
                  <AudioLines size={35} />
                </span>
                <h3>
                  {meeting.status === "summarizing"
                    ? "Writing notes…"
                    : "Transcribing…"}
                </h3>
                <p>
                  {meeting.provider === "mock"
                    ? "Preparing your example notes."
                    : "You can come back when your notes are ready."}
                </p>
                <div className="processing-steps">
                  <span className="complete">
                    <Check size={14} />Captured
                  </span>
                  <span
                    className={meeting.status === "summarizing"
                      ? "complete"
                      : "current"}
                  >
                    {meeting.status === "summarizing"
                      ? <Check size={14} />
                      : <Spinner size={14} />}Transcribing
                  </span>
                  <span
                    className={meeting.status === "summarizing"
                      ? "current"
                      : ""}
                  >
                    <Sparkles size={14} />Notes
                  </span>
                </div>
              </div>
            )
            : meeting.status === "failed"
            ? (
              <Empty
                icon={<CircleAlert size={32} />}
                title="This one needs another go."
              >
                <span>{meeting.error}</span>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => mutate(() => api.retry(meeting.id))}
                >
                  {busy ? <Spinner /> : <RotateCcw size={16} />}Retry processing
                </button>
              </Empty>
            )
            : tab === "notes" && meeting.notes
            ? (
              <div className="note-content">
                <div className="note-title">
                  {ready && !editing && (
                    <button
                      className="text-button"
                      onClick={() => {
                        setDraft(structuredClone(meeting.notes));
                        setEditing(true);
                      }}
                    >
                      <Pencil size={13} />Edit note
                    </button>
                  )}
                </div>
                {editing && draft
                  ? (
                    <div className="note-editor">
                      <label className="field">
                        Summary<textarea
                          rows={6}
                          value={draft.summary}
                          maxLength={20000}
                          onChange={(e) =>
                            setDraft({ ...draft, summary: e.target.value })}
                        />
                      </label>
                      <label className="field">
                        Key points <span className="muted">One per line</span>
                        <textarea
                          rows={7}
                          value={draft.keyPoints.join("\n")}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              keyPoints: e.target.value.split("\n"),
                            })}
                        />
                      </label>
                      <h4>Action items</h4>
                      {draft.actions.map((a, i) => (
                        <div className="action-editor" key={a.id}>
                          <input
                            aria-label={`Action ${i + 1}`}
                            value={a.text}
                            maxLength={4000}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                actions: draft.actions.map((v, index) =>
                                  index === i
                                    ? { ...v, text: e.target.value }
                                    : v
                                ),
                              })}
                          />
                          <input
                            aria-label={`Action ${i + 1} owner`}
                            value={a.owner}
                            maxLength={200}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                actions: draft.actions.map((v, index) =>
                                  index === i
                                    ? { ...v, owner: e.target.value }
                                    : v
                                ),
                              })}
                          />
                        </div>
                      ))}
                      <div className="editor-actions">
                        <button
                          className="button secondary"
                          disabled={busy}
                          onClick={() => setEditing(false)}
                        >
                          Cancel
                        </button>
                        <button
                          className="button primary"
                          disabled={busy || !draft.summary.trim()}
                          onClick={saveNotes}
                        >
                          {busy ? <Spinner /> : <Check size={15} />}Save changes
                        </button>
                      </div>
                    </div>
                  )
                  : (
                    <>
                      <h3>Summary</h3>
                      <p className="summary-text">{meeting.notes.summary}</p>
                      <h3>
                        Key points{" "}
                        <span className="section-count">
                          {meeting.notes.keyPoints.length.toString().padStart(
                            2,
                            "0",
                          )}
                        </span>
                      </h3>
                      <ul className="key-points">
                        {meeting.notes.keyPoints.map((point, i) => (
                          <li key={i}>{point}</li>
                        ))}
                      </ul>
                      <div className="action-heading">
                        <h3>
                          Action items{" "}
                          <span className="section-count">
                            {meeting.notes.actions.length.toString().padStart(
                              2,
                              "0",
                            )}
                          </span>
                        </h3>
                        <span>
                          {meeting.notes.actions.filter((a) => a.done)
                            .length}/{meeting.notes.actions.length} complete
                        </span>
                      </div>
                      {meeting.notes.actions.length
                        ? (
                          <div className="action-items">
                            {meeting.notes.actions.map((a) => (
                              <label
                                className={`action-item ${
                                  a.done ? "done" : ""
                                }`}
                                key={a.id}
                              >
                                <input
                                  type="checkbox"
                                  checked={a.done}
                                  disabled={!ready || busy}
                                  onChange={() => {
                                    setReviewed(false);
                                    void mutate(() =>
                                      api.patch(meeting.id, {
                                        notes: {
                                          ...meeting.notes!,
                                          actions: meeting.notes!.actions.map((
                                            v,
                                          ) =>
                                            v.id === a.id
                                              ? { ...v, done: !v.done }
                                              : v
                                          ),
                                        },
                                      })
                                    );
                                  }}
                                />
                                <span>
                                  <strong>{a.text}</strong>
                                  <small>{a.owner || "Unassigned"}</small>
                                </span>
                              </label>
                            ))}
                          </div>
                        )
                        : (
                          <p className="muted">
                            No agreed action items were identified.
                          </p>
                        )}
                    </>
                  )}
                {meeting.provider === "mock" && meeting.source !== "demo" && (
                  <p className="note-footnote">
                    This recording hasn’t been transcribed.
                  </p>
                )}
              </div>
            )
            : tab === "transcript"
            ? (
              <div className="transcript-content">
                <div className="transcript-head">
                  <h3>Transcript</h3>
                  <span className="tiny-label">
                    {meeting.utterances.length
                      ? `${
                        new Set(meeting.utterances.map((u) => u.speaker)).size
                      } SPEAKERS`
                      : "TRANSCRIPT"}
                  </span>
                </div>
                <label className="search transcript-search">
                  <Search size={16} />
                  <input
                    placeholder="Find in transcript…"
                    aria-label="Find in transcript"
                    value={transcriptQuery}
                    onChange={(e) => setTranscriptQuery(e.target.value)}
                  />
                </label>
                {meeting.utterances.length
                  ? utterances.length
                    ? utterances.map((u, i) => (
                      <div className="utterance" key={`${u.start}-${i}`}>
                        <span
                          className={`speaker-avatar ${
                            u.speaker === "B" ? "other" : ""
                          }`}
                        >
                          {u.speaker}
                        </span>
                        <div>
                          <div className="utterance-meta">
                            <strong>Speaker {u.speaker}</strong>
                            <button
                              className="text-button"
                              disabled={meeting.source === "demo"}
                              title={meeting.source === "demo"
                                ? "No audio for example meetings"
                                : "Play from this point"}
                              onClick={() =>
                                seek(u.start)}
                            >
                              {formatDuration(u.start / 1000)}
                            </button>
                          </div>
                          <p>{u.text}</p>
                        </div>
                      </div>
                    ))
                    : (
                      <p className="muted">
                        No matching words. Try a different search.
                      </p>
                    )
                  : <p className="summary-text">{meeting.transcript}</p>}
              </div>
            )
            : tab === "personal"
            ? (
              <div className="personal-content">
                <h3>My notes</h3>
                <textarea
                  aria-label="Personal meeting notes"
                  rows={8}
                  placeholder="Your notes go here…"
                  value={personal}
                  onChange={(e) => {
                    setPersonal(e.target.value);
                    setReviewed(false);
                  }}
                  disabled={!ready}
                  maxLength={20000}
                />
                <div className="personal-footer">
                  <span className="muted">
                    {personal.length.toLocaleString()} / 20,000
                  </span>
                  <button
                    className="button primary"
                    disabled={!ready || busy || !personalDirty}
                    onClick={() =>
                      mutate(
                        () =>
                          api.patch(meeting.id, { personalNotes: personal }),
                        "Personal notes saved",
                      )}
                  >
                    {busy ? <Spinner /> : <Check size={15} />}Save my notes
                  </button>
                </div>
              </div>
            )
            : null}
        </div>
        <aside className="context-column">
          <div className="context-card">
            <div className="context-title">
              <FolderOpen size={16} />
              <h3>Save to matter</h3>
            </div>
            <label className="field small">
              Matter<div className="select-wrap">
                <select
                  aria-label="Select matter"
                  value={meeting.matterId ?? ""}
                  disabled={!ready || busy || editing}
                  onChange={(e) => mutate(() => api.patch(meeting.id, {
                    matterId: e.target.value || null,
                  }))}
                >
                  <option value="">Choose a matter</option>
                  {matters.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.reference} · {m.name}
                    </option>
                  ))}
                </select>
                <ChevronDown size={13} />
              </div>
            </label>
            {matter && (
              <div className="matter-preview">
                <span className="matter-monogram">
                  {matter.client.split(" ").map((s) => s[0]).slice(0, 2).join(
                    "",
                  )}
                </span>
                <div>
                  <strong>{matter.client}</strong>
                  <span>{matter.reference}</span>
                </div>
              </div>
            )}
            <div className="time-entry">
              <span>
                <Clock3 size={15} />Time entry
              </span>
              <strong>
                {billableMinutes(meeting.duration)} <small>min</small>
              </strong>
            </div>
            <p className="time-hint">Rounded up in 6-minute increments.</p>
            {saved
              ? (
                <div className="save-success">
                  <CheckCheck size={18} />
                  <strong>Saved to matter</strong>
                  <span>
                    File note + {meeting.export?.minutes} min time entry
                  </span>
                  <small>
                    {new Date(meeting.export!.createdAt).toLocaleString()}
                  </small>
                </div>
              )
              : (
                <>
                  <label className="review-check">
                    <input
                      type="checkbox"
                      checked={reviewed}
                      disabled={!ready || editing}
                      onChange={(e) => setReviewed(e.target.checked)}
                    />
                    <span>I’ve reviewed these notes for accuracy.</span>
                  </label>
                  <button
                    className="button primary save-matter"
                    disabled={!ready || !matter || !reviewed || busy ||
                      editing || personalDirty}
                    onClick={saveToMatter}
                  >
                    {busy ? <Spinner /> : <FolderOpen size={16} />}Save to
                    matter<ArrowRight size={15} />
                  </button>
                </>
              )}
            <p className="integration-hint">
              Clio isn’t connected. This record won’t be sent to Clio.
            </p>
          </div>
          {meeting.source !== "demo" && (
            <div className="sample-disclosure">
              <CheckSquare2 size={14} />
              <span>
                Consent confirmed{" "}
                {new Date(meeting.consentAt).toLocaleDateString()}.
              </span>
            </div>
          )}
        </aside>
      </div>
      {deleting && (
        <DeleteMeeting
          meeting={meeting}
          close={() => setDeleting(false)}
          deleted={deleted}
          updated={updated}
        />
      )}
    </article>
  );
}
