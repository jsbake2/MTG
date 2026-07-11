import { useState } from "react";
import { useAuth } from "@/store/auth";

export function Login() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "login") await login(username, password);
      else await register({ username, displayName: displayName || username, password, inviteCode });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center p-4">
      <form onSubmit={submit} className="panel w-full max-w-sm p-6">
        <h1 className="mb-1 font-display text-2xl text-table-accentSoft">⚔ MTG Home Table</h1>
        <p className="mb-5 text-sm text-table-muted">
          {mode === "login" ? "Sign in to build decks and play." : "Create your account with a family invite code."}
        </p>
        <div className="space-y-3">
          <input className="input w-full" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
          {mode === "register" && (
            <input className="input w-full" placeholder="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          )}
          <input className="input w-full" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
          {mode === "register" && (
            <input className="input w-full" placeholder="Invite code" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} />
          )}
        </div>
        {error && <div className="mt-3 rounded-md bg-red-900/40 px-3 py-2 text-sm text-red-200">{error}</div>}
        <button className="btn-primary mt-5 w-full" disabled={busy}>
          {busy ? "…" : mode === "login" ? "Sign in" : "Create account"}
        </button>
        <button
          type="button"
          className="mt-3 w-full text-center text-xs text-table-muted hover:text-table-ink"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError(null);
          }}
        >
          {mode === "login" ? "Have an invite code? Register" : "Already have an account? Sign in"}
        </button>
      </form>
    </div>
  );
}
