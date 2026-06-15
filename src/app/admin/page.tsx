import { CalendarCheck, KeyRound, ShieldCheck } from "lucide-react";

import { appConfig, getSetupIssues } from "@/lib/config";
import { getGoogleConnectionStatus } from "@/lib/google";

export const dynamic = "force-dynamic";

export default function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string }>;
}) {
  const issues = getSetupIssues();
  const status = getGoogleConnectionStatus();

  return (
    <main className="admin-shell">
      <section className="admin-panel">
        <div className="admin-kicker">
          <ShieldCheck size={18} aria-hidden="true" />
          Owner setup
        </div>
        <h1>OpenMeet Admin</h1>
        <p className="muted">Calendar owner: {appConfig.ownerEmail}</p>

        <div className="status-list">
          <div className="status-row">
            <CalendarCheck size={18} aria-hidden="true" />
            <span>Google Calendar</span>
            <strong>{status.connected ? `Connected as ${status.email}` : "Not connected"}</strong>
          </div>
          <div className="status-row">
            <KeyRound size={18} aria-hidden="true" />
            <span>Environment</span>
            <strong>{issues.length === 0 ? "Ready" : `${issues.length} issue(s)`}</strong>
          </div>
        </div>

        {issues.length > 0 ? (
          <div className="setup-issues">
            {issues.map((issue) => (
              <p key={issue}>{issue}</p>
            ))}
          </div>
        ) : null}

        <form action="/api/admin/google/start" method="get" className="admin-form">
          <label htmlFor="secret">Admin secret</label>
          <div className="admin-action">
            <input
              id="secret"
              name="secret"
              type="password"
              autoComplete="current-password"
              placeholder="ADMIN_SECRET"
              required
            />
            <button type="submit">Connect Google</button>
          </div>
        </form>
      </section>
    </main>
  );
}
