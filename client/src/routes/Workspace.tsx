import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowRight,
  AudioLines,
  Check,
  CircleAlert,
  CircleHelp,
  Clock3,
  FolderClosed,
  FolderOpen,
  Menu,
  Plus,
  Search,
  Unplug,
  X,
} from "lucide-react";
import type { AppConfig, Matter, Meeting } from "@lib/types/meeting.ts";
import { formatDuration, isProcessing } from "@lib/utils/meeting.ts";
import { useApi } from "@client/hooks/useApi.ts";
import { Empty } from "@client/components/ui/Empty.tsx";
import { Modal } from "@client/components/ui/Modal.tsx";
import { Spinner } from "@client/components/ui/Spinner.tsx";
import { Status } from "@client/components/ui/Status.tsx";
import { MeetingDetail } from "@client/components/meetings/MeetingDetail.tsx";
import { NewMeeting } from "@client/components/meetings/NewMeeting.tsx";
import { AccountControls } from "@client/components/auth/AccountControls.tsx";

import type { AiUsage } from "@lib/types/usage.ts";
import { UsageAllowance } from "@client/components/auth/UsageAllowance.tsx";
import { Upgrade } from "@client/routes/Upgrade.tsx";
import type { Filter, Page } from "@client/types/navigation.ts";
import { Integrations } from "@client/routes/Integrations.tsx";
import { NewMatter } from "@client/components/matters/NewMatter.tsx";

function defaultMeetingId(meetings: Meeting[]) {
  return window.matchMedia("(max-width: 760px)").matches
    ? null
    : meetings[0]?.id ?? null;
}

export function Workspace() {
  const api = useApi();
  const deletedIds = useRef(new Set<string>());
  const [usage, setUsage] = useState<AiUsage | null>(null);
  const [page, setPage] = useState<Page>("meetings");
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [matters, setMatters] = useState<Matter[]>([]);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [matterFilter, setMatterFilter] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [newMeeting, setNewMeeting] = useState(false);
  const [startWithExample, setStartWithExample] = useState(false);
  const [newMatter, setNewMatter] = useState(false);
  const [help, setHelp] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [toast, setToast] = useState("");
  const selected = meetings.find((m) => m.id === selectedId);
  const busy = meetings.some((m) => isProcessing(m.status));
  useEffect(() => {
    if (!sidebarOpen) return;
    const viewport = window.matchMedia("(max-width: 760px)");
    let unlock: (() => void) | undefined;
    const syncScrollLock = () => {
      if (!viewport.matches) {
        unlock?.();
        unlock = undefined;
        return;
      }
      if (unlock) return;
      const { scrollX, scrollY } = window;
      const root = document.documentElement;
      root.style.setProperty("--navigation-scroll-offset", `${-scrollY}px`);
      root.classList.add("mobile-navigation-open");
      unlock = () => {
        root.classList.remove("mobile-navigation-open");
        root.style.removeProperty("--navigation-scroll-offset");
        window.scrollTo({ left: scrollX, top: scrollY, behavior: "instant" });
      };
    };
    syncScrollLock();
    viewport.addEventListener("change", syncScrollLock);
    return () => {
      viewport.removeEventListener("change", syncScrollLock);
      unlock?.();
    };
  }, [sidebarOpen]);
  const refresh = useCallback(async () => {
    try {
      const [records, cases, settings, allowance] = await Promise.all([
        api.meetings(),
        api.matters(),
        api.config(),
        api.usage(),
      ]);
      const items = records.filter((item) => !deletedIds.current.has(item.id));
      setMeetings(items);
      setUsage(allowance);
      setMatters(cases);
      setConfig(settings);
      setError("");
      setSelectedId((current) =>
        items.some((item) => item.id === current)
          ? current
          : defaultMeetingId(items)
      );
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }, [api]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(async () => {
      try {
        setMeetings(
          (await api.meetings()).filter((item) =>
            !deletedIds.current.has(item.id)
          ),
        );
        setUsage(await api.usage());
        setError("");
      } catch (cause) {
        setError((cause as Error).message);
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [busy, api]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  const refreshUsage = useCallback(async () => {
    try {
      setUsage(await api.usage());
    } catch {
      /* Keep the last confirmed allowance; the API still enforces the limit. */
    }
  }, [api]);
  useEffect(() => {
    const focus = () => {
      void refreshUsage();
    };
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [refreshUsage]);
  function openNewMeeting(example = false) {
    setStartWithExample(example);
    setNewMeeting(true);
  }
  function upgrade() {
    setNewMeeting(false);
    navigate("upgrade");
    void refreshUsage();
  }
  function deleted(id: string) {
    deletedIds.current.add(id);
    const next = meetings.filter((meeting) => meeting.id !== id);
    setMeetings(next);
    setSelectedId((current) =>
      current === id ? defaultMeetingId(next) : current
    );
    setMobileDetail(false);
    setToast("Meeting deleted");
    void refreshUsage();
  }
  function updated(meeting: Meeting) {
    void refreshUsage();
    setMeetings((items) => items.map((m) => m.id === meeting.id ? meeting : m));
  }
  function navigate(next: Page) {
    setPage(next);
    setSidebarOpen(false);
    setMatterFilter(null);
  }
  const filtered = meetings.filter((m) => {
    const matter = matters.find((v) => v.id === m.matterId);
    return (filter === "all" || m.status === filter) &&
      (!matterFilter || m.matterId === matterFilter) &&
      `${m.title} ${matter?.name ?? ""} ${matter?.client ?? ""} ${
        matter?.reference ?? ""
      }`.toLowerCase().includes(query.toLowerCase());
  });
  return (
    <div className="app-shell">
      <aside
        id="workspace-navigation"
        className={`sidebar ${sidebarOpen ? "open" : ""}`}
      >
        <button
          className="icon-button sidebar-close"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
        >
          <X size={22} />
        </button>
        <button
          className="brand"
          onClick={() => navigate("meetings")}
          aria-label="Meet home"
        >
          <span className="brand-mark">
            <i />
            <i />
            <i />
          </span>
          <span>
            meet<span className="brand-period">.</span>
          </span>
        </button>
        <nav aria-label="Main navigation">
          <button
            className={page === "meetings" ? "active" : ""}
            onClick={() => navigate("meetings")}
          >
            <AudioLines size={18} />Meetings<span className="nav-count">
              {meetings.length}
            </span>
          </button>
          <button
            className={page === "matters" ? "active" : ""}
            onClick={() => navigate("matters")}
          >
            <FolderClosed size={18} />Matters
          </button>
          <button
            className={page === "integrations" ? "active" : ""}
            onClick={() => navigate("integrations")}
          >
            <Unplug size={18} />Integrations
          </button>
        </nav>
        <div className="sidebar-bottom">
          <button onClick={() => setHelp(true)}>
            <CircleHelp size={17} />Getting started<ArrowDownLeft size={14} />
          </button>
          <UsageAllowance usage={usage} upgrade={upgrade} />
          <AccountControls />
        </div>
      </aside>
      <main className="main-shell">
        <div className="page-content">
          <div className="page-heading">
            <div className="page-title">
              <button
                className="icon-button menu-toggle"
                aria-label="Open navigation"
                aria-controls="workspace-navigation"
                aria-expanded={sidebarOpen}
                onClick={() => setSidebarOpen(true)}
              >
                <Menu size={21} />
              </button>
              <h1>
                {page === "meetings"
                  ? "Meetings"
                  : page === "matters"
                  ? "Matters"
                  : page === "integrations"
                  ? "Integrations"
                  : "Upgrade"}
              </h1>
            </div>
            {(page === "meetings" || page === "matters") && (
              <button
                className="button primary new-button"
                disabled={page !== "matters" && !config}
                onClick={() =>
                  page === "matters" ? setNewMatter(true) : openNewMeeting()}
              >
                <Plus size={18} />
                {page === "matters" ? "New matter" : "New meeting"}
              </button>
            )}
          </div>
          {error && (
            <div className="notice error global-error" role="alert">
              <CircleAlert size={18} />
              <span>{error}</span>
              <button className="text-button" onClick={refresh}>
                Try again
              </button>
            </div>
          )}
          {loading
            ? (
              <div className="loading-state">
                <Spinner size={28} />
                <p>Loading meetings…</p>
              </div>
            )
            : page === "meetings"
            ? (
              <>
                <section
                  className={`meeting-workspace ${
                    mobileDetail ? "show-detail" : ""
                  }`}
                  aria-label="Meeting workspace"
                >
                  <aside className="meeting-list-column">
                    <div className="list-heading">
                      <h2>
                        All meetings <span>{meetings.length}</span>
                      </h2>
                    </div>
                    <label className="search">
                      <Search size={16} />
                      <input
                        aria-label="Search meetings"
                        placeholder="Search meetings or matters"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </label>
                    <div
                      className="list-filters"
                      role="group"
                      aria-label="Filter meetings"
                    >
                      {[["all", "All"], ["ready", "To review"], [
                        "saved",
                        "Saved",
                      ]].map(([value, label]) => (
                        <button
                          key={value}
                          aria-pressed={filter === value}
                          className={filter === value ? "active" : ""}
                          onClick={() => setFilter(value as Filter)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {matterFilter && (
                      <button
                        className="matter-filter"
                        onClick={() => setMatterFilter(null)}
                      >
                        {matters.find((m) => m.id === matterFilter)?.reference}
                        <X size={12} />
                      </button>
                    )}
                    <div className="meeting-list">
                      {filtered.length
                        ? filtered.map((m) => {
                          const matter = matters.find((v) =>
                            v.id === m.matterId
                          );
                          return (
                            <button
                              className={`meeting-list-item ${
                                m.id === selectedId ? "selected" : ""
                              }`}
                              key={m.id}
                              onClick={() => {
                                setSelectedId(m.id);
                                setMobileDetail(true);
                              }}
                            >
                              <div className="list-item-top">
                                <span>
                                  {new Date(m.createdAt).toLocaleDateString(
                                    undefined,
                                    { month: "short", day: "numeric" },
                                  )}
                                  <i />
                                  {new Date(m.createdAt).toLocaleTimeString(
                                    undefined,
                                    { hour: "numeric", minute: "2-digit" },
                                  )}
                                </span>
                              </div>
                              <h3>{m.title}</h3>
                              <p>
                                <FolderClosed size={12} />
                                {matter?.client ?? "No matter assigned"}
                              </p>
                              <div className="list-item-footer">
                                <Status status={m.status} />
                                <span>
                                  <Clock3 size={12} />
                                  {formatDuration(m.duration)}
                                </span>
                              </div>
                            </button>
                          );
                        })
                        : (
                          <Empty
                            icon={<Search size={25} />}
                            title="No meetings found"
                          >
                            {query || filter !== "all" || matterFilter
                              ? "Try another search or filter."
                              : "Start your first meeting to see it here."}
                          </Empty>
                        )}
                    </div>
                  </aside>
                  {selected
                    ? (
                      <MeetingDetail
                        key={selected.id}
                        meeting={selected}
                        matters={matters}
                        updated={updated}
                        notify={setToast}
                        back={() => setMobileDetail(false)}
                        deleted={deleted}
                        upgrade={upgrade}
                      />
                    )
                    : (
                      <Empty
                        icon={<HeadphonesIcon />}
                        title="Select a meeting"
                      >
                        <button
                          className="button primary"
                          disabled={!config}
                          onClick={() => openNewMeeting()}
                        >
                          <Plus size={16} />Create a meeting
                        </button>
                      </Empty>
                    )}
                </section>
              </>
            )
            : page === "matters"
            ? (
              <section className="matters-section">
                <div className="section-intro">
                  <span>
                    {matters.length}{" "}
                    {matters.length === 1 ? "matter" : "matters"}
                  </span>
                </div>
                <div className="matter-grid">
                  {matters.map((matter, i) => {
                    const count = meetings.filter((meeting) =>
                      meeting.matterId === matter.id
                    ).length;
                    return (
                      <button
                        className="matter-card"
                        key={matter.id}
                        onClick={() => {
                          setMatterFilter(matter.id);
                          setFilter("all");
                          setQuery("");
                          setPage("meetings");
                          const matching = meetings.filter((m) =>
                            m.matterId === matter.id
                          );
                          setSelectedId(defaultMeetingId(matching));
                          setMobileDetail(false);
                        }}
                      >
                        <span className={`matter-folder color-${i % 3}`}>
                          <FolderOpen size={24} />
                        </span>
                        <span className="tiny-label">{matter.reference}</span>
                        <h3>{matter.name}</h3>
                        <p>{matter.client}</p>
                        <div>
                          <span>
                            {count} {count === 1 ? "meeting" : "meetings"}
                          </span>
                          <ArrowRight size={17} />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            )
            : page === "integrations"
            ? <Integrations config={config} />
            : (
              <Upgrade
                usage={usage}
                back={() => navigate("meetings")}
                example={() => openNewMeeting(true)}
              />
            )}
        </div>
      </main>
      {newMeeting && config && (
        <NewMeeting
          config={config}
          usage={usage}
          startWithExample={startWithExample}
          upgrade={upgrade}
          close={() => setNewMeeting(false)}
          created={(meeting) => {
            void refreshUsage();
            setMeetings((items) => [meeting, ...items]);
            setSelectedId(meeting.id);
            setPage("meetings");
            setFilter("all");
            setQuery("");
            setMatterFilter(null);
            setMobileDetail(true);
            setNewMeeting(false);
          }}
        />
      )}
      {newMatter && (
        <NewMatter
          close={() => setNewMatter(false)}
          created={(matter) => {
            setMatters((values) => [...values, matter]);
            setNewMatter(false);
            setToast("Matter created");
          }}
        />
      )}
      {help && (
        <Modal
          title="How it works"
          close={() => setHelp(false)}
        >
          <div className="help-content">
            <ol>
              <li>
                <strong>Record or upload.</strong>
                <p>
                  Record your microphone, upload audio, or try a fictional
                  example.
                </p>
              </li>
              <li>
                <strong>Review your notes.</strong>
                <p>
                  Edit the summary, check action items, and add your own notes.
                </p>
              </li>
              <li>
                <strong>Save to a matter.</strong>
                <p>
                  Choose a matter and save your reviewed notes with a time
                  entry.
                </p>
              </li>
            </ol>
            <button
              className="button primary"
              onClick={() => {
                setHelp(false);
                openNewMeeting();
              }}
              disabled={!config}
            >
              New meeting<ArrowRight size={16} />
            </button>
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <span>
            <Check size={15} />
          </span>
          {toast}
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

function HeadphonesIcon() {
  return <AudioLines size={32} />;
}
