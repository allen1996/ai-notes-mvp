import { useClerk, useUser } from "@clerk/react";
import { ChevronUp, CircleAlert, LogOut, Settings } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Spinner } from "@client/components/ui/Spinner.tsx";

export function AccountControls() {
  const { user } = useUser();
  const { signOut, openUserProfile } = useClerk();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  async function logout() {
    setBusy(true);
    setError("");
    try {
      await signOut({ redirectUrl: window.location.origin });
    } catch {
      setError("Sign out failed. Please try again.");
      setBusy(false);
    }
  }
  return (
    <div
      className="account-control"
      ref={root}
      onBlur={(event) => {
        // Touch taps can blur without focusing another element before click fires.
        if (
          event.relatedTarget &&
          !event.currentTarget.contains(event.relatedTarget as Node)
        ) setOpen(false);
      }}
    >
      <button
        className="account-trigger"
        ref={trigger}
        aria-label="Open account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen(!open)}
      >
        {user?.imageUrl
          ? <img className="account-avatar" src={user.imageUrl} alt="" />
          : (
            <span className="account-avatar">
              {user?.firstName?.[0] ?? "A"}
            </span>
          )}
        <strong>{user?.firstName || user?.username || "Your account"}</strong>
        <ChevronUp size={15} />
      </button>
      {open && (
        <div
          className="account-menu"
          role="menu"
          aria-label="Account menu"
          id={menuId}
          ref={menu}
          onKeyDown={(event) => {
            const buttons = Array.from(
              menu.current?.querySelectorAll<HTMLButtonElement>(
                "button:not(:disabled)",
              ) ?? [],
            );
            if (
              !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) ||
              !buttons.length
            ) return;
            event.preventDefault();
            const current = buttons.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            const next = event.key === "Home"
              ? 0
              : event.key === "End"
              ? buttons.length - 1
              : (current + (event.key === "ArrowDown" ? 1 : -1) +
                buttons.length) % buttons.length;
            buttons[next]?.focus();
          }}
        >
          <div className="account-menu-identity">
            <strong>{user?.fullName || "Your account"}</strong>
            <span>{user?.primaryEmailAddress?.emailAddress}</span>
          </div>
          <button
            role="menuitem"
            disabled={busy}
            onClick={() => {
              setOpen(false);
              openUserProfile();
            }}
          >
            <Settings size={15} />Manage account
          </button>
          <button role="menuitem" disabled={busy} onClick={logout}>
            {busy ? <Spinner size={15} /> : <LogOut size={15} />}
            {busy ? "Signing out…" : "Sign out"}
          </button>
          {error && (
            <p className="logout-error" role="alert">
              <CircleAlert size={13} />
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
