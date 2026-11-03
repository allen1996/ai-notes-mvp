import { ClerkProvider, SignIn, useAuth } from "@clerk/react";
import { AudioLines } from "lucide-react";
import { type ReactNode, useSyncExternalStore } from "react";
import { AuthenticatedApi } from "@client/components/auth/AuthenticatedApi.tsx";
import { Workspace } from "@client/routes/Workspace.tsx";
import { Spinner } from "@client/components/ui/Spinner.tsx";

export function AuthScreen() {
  const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.trim();
  if (!publishableKey || !/^pk_(test|live)_/.test(publishableKey)) {
    return (
      <AuthShell>
        <div className="auth-setup">
          <h2>Set up sign-in</h2>
          <p>Add your Clerk keys to enable sign-in.</p>
          <a
            href="https://dashboard.clerk.com"
            target="_blank"
            rel="noreferrer"
            className="button primary"
          >
            Open Clerk dashboard
          </a>
        </div>
      </AuthShell>
    );
  }
  return (
    <ClerkProvider
      publishableKey={publishableKey}
      afterSignOutUrl="/"
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
      telemetry={false}
      appearance={{
        variables: {
          colorPrimary: "#FF4824",
          colorForeground: "#171717",
          borderRadius: "1rem",
          fontFamily: "DM Sans, sans-serif",
        },
      }}
    >
      <AuthGate />
    </ClerkProvider>
  );
}

const mobileAuthQuery = "(max-width: 800px)";

function subscribeToMobileAuth(onChange: () => void) {
  const query = window.matchMedia(mobileAuthQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function isMobileAuth() {
  return window.matchMedia(mobileAuthQuery).matches;
}

function AuthGate() {
  const mobile = useSyncExternalStore(subscribeToMobileAuth, isMobileAuth);
  const { isLoaded, isSignedIn, userId, sessionId } = useAuth();
  if (!isLoaded) {
    return (
      <AuthShell>
        <div className="auth-loading">
          <Spinner size={25} />
          <p>Loading…</p>
        </div>
      </AuthShell>
    );
  }
  if (!isSignedIn) {
    return (
      <AuthShell>
        <div className="auth-sign-in">
          <h2>Continue to Meet</h2>
          <p className="auth-subtitle">Sign in to your workspace.</p>
          <SignIn
            routing="hash"
            withSignUp
            transferable
            appearance={{
              variables: mobile
                ? {
                  colorBackground: "#191919",
                  colorForeground: "#f5f5f5",
                  colorNeutral: "#ffffff",
                  colorMuted: "#242424",
                  colorMutedForeground: "#a3a3a3",
                  colorInput: "#242424",
                  colorInputForeground: "#f5f5f5",
                  colorPrimaryForeground: "#111111",
                  colorDanger: "#ff9b89",
                  colorBorder: "#383838",
                  colorRing: "#ff6547",
                  borderRadius: "0.75rem",
                }
                : { colorBackground: "#ffffff" },
              elements: {
                rootBox: { width: "100%" },
                cardBox: {
                  width: "100%",
                  boxShadow: "none",
                  background: "transparent",
                  borderRadius: "0",
                  overflow: "visible",
                },
                card: {
                  width: "100%",
                  boxShadow: "none",
                  background: "transparent",
                  border: "0",
                  borderRadius: "0",
                  padding: "0",
                  margin: "0",
                },
                footer: {
                  background: mobile ? "transparent" : "#ffffff",
                  backgroundImage: "none",
                  padding: "0",
                  margin: "12px 0 0",
                },
                footerAction: { padding: "20px 0", margin: "0" },
                footerItem: { padding: "16px 0 0" },
                header: { display: "none" },
                formFieldInput: mobile
                  ? {
                    minHeight: "46px",
                    borderRadius: "12px",
                    border: "1px solid #383838",
                  }
                  : { minHeight: "44px", borderRadius: "14px" },
                socialButtonsBlockButton: mobile
                  ? {
                    minHeight: "48px",
                    borderRadius: "12px",
                    background: "#242424",
                    border: "1px solid #383838",
                    color: "#f5f5f5",
                  }
                  : { minHeight: "48px", borderRadius: "14px" },
                formButtonPrimary: {
                  color: "#111111",
                  fontWeight: "700",
                  minHeight: mobile ? "46px" : "44px",
                  borderRadius: mobile ? "12px" : "999px",
                },
                footerActionLink: { color: mobile ? "#ff8a73" : "#a62d14" },
              },
            }}
            forceRedirectUrl="/"
            signUpForceRedirectUrl="/"
            fallback={
              <div className="auth-loading">
                <Spinner />
                <p>Loading sign-in…</p>
              </div>
            }
          />
        </div>
      </AuthShell>
    );
  }
  // Remount on account/session change, clearing all meeting state and audio URLs on logout.
  return (
    <AuthenticatedApi key={`${userId}:${sessionId}`}>
      <Workspace />
    </AuthenticatedApi>
  );
}

function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="auth-shell">
      <section className="auth-story">
        <div className="auth-brand">
          <AudioLines size={30} />
          <strong>
            meet<span>.</span>
          </strong>
        </div>
        <div className="auth-story-main">
          <div className="auth-copy">
            <h1 aria-label="Less admin. More focus.">
              Less admin.<br />
              <span className="auth-rotating-copy" aria-hidden="true">
                {[
                  "More focus.",
                  "Clearer notes.",
                  "Better meetings.",
                  "More present.",
                ].map((phrase, index) => (
                  <span
                    className="auth-headline-option"
                    key={phrase}
                    style={{ animationDelay: `${index * 4}s` }}
                  >
                    {phrase}
                  </span>
                ))}
              </span>
            </h1>
            <p>
              Record your conversations. Leave with clear notes and next steps.
            </p>
          </div>
          <div className="auth-symbol" aria-hidden="true">
            <img src="/vxt-symbol.svg" alt="" />
          </div>
        </div>
      </section>
      <section className="auth-panel" aria-label="Meet sign-in">
        <div className="auth-brand auth-mobile-brand">
          <img src="/vxt-symbol.svg" alt="" />
          <strong>
            meet<span>.</span>
          </strong>
        </div>
        {children}
      </section>
    </main>
  );
}
