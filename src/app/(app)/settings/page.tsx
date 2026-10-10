import { ActualCostForm, ClearDemoButton, CopyBlock, RateForm } from "@/components/SettingsForms";
import { demoCount } from "@/lib/analytics/queries";
import { requireUser } from "@/lib/auth/guard";
import { config, integrationStatus } from "@/lib/config/env";
import { agentDescription, agentGreeting, knowledgeDocument } from "@/lib/conversation/vaani-agent-pack";

export default async function SettingsPage() {
  const user = await requireUser();
  const s = integrationStatus();
  const base = config().APP_BASE_URL;
  const demos = await demoCount();
  const yes = (b: boolean) => (b ? <span className="tag t-SENT">Set</span> : <span className="tag t-UNKNOWN">Missing</span>);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Connections, cost rates and the text for the VaaniYantra agent. Secrets live in environment variables and are never shown here.</p>
        </div>
      </div>
      {s.warnings.length ? <div className="alert"><ul style={{ margin: 0, paddingLeft: 18 }}>{s.warnings.map((w) => <li key={w}>{w}</li>)}</ul></div> : null}
      <div className="grid g2">
        <section className="panel">
          <h2>Voice: VaaniYantra</h2>
          <dl className="kv">
            <dt>Mode</dt><dd>{s.voiceMode === "MOCK" ? "Mock (simulator only)" : s.voiceMode === "LIVE" ? "Live" : "Misconfigured"}</dd>
            <dt>API key</dt><dd>{yes(s.vaani.apiKey)} <span className="small muted">for transcripts and start times</span></dd>
            <dt>Webhook secret</dt><dd>{yes(s.vaani.webhookSecret)} <span className="small muted">required; unsigned webhooks are rejected</span></dd>
            <dt>Agent ID filter</dt><dd>{yes(s.vaani.agentId)} <span className="small muted">optional</span></dd>
            <dt>Webhook URL</dt><dd><code>{base ? `${base.replace(/\/$/, "")}/api/webhooks/vaaniyantra` : "Set APP_BASE_URL to see it"}</code><br /><span className="small muted">Register in VaaniYantra under Settings → Webhooks, for call.completed and call.failed.</span></dd>
          </dl>
        </section>
        <section className="panel">
          <h2>Designer handoff: Telegram</h2>
          <dl className="kv">
            <dt>Status</dt><dd>{s.telegram.configured ? "Connected" : "Not set up: handoffs are kept in the dashboard as “Telegram not set up”"}</dd>
            <dt>Urgent chat</dt><dd>{s.telegram.urgentChat ? "Separate chat for escalations" : "Uses the designer chat"}</dd>
            <dt>Demo messages</dt><dd>{s.telegram.sendDemo ? "Sent, marked as DEMO" : "Previewed only, never sent"}</dd>
            <dt>Background retry job</dt><dd>{s.cron ? "Enabled" : "Off (set CRON_SECRET)"}</dd>
          </dl>
        </section>
      </div>

      <section className="panel" style={{ marginTop: 16 }}>
        <h2>Cost rates</h2>
        <p className="small muted">Enter the rate shown on your provider&apos;s billing page. Calls without a rate are shown as unknown rather than free.</p>
        {user.role === "ADMIN" ? <RateForm /> : <p className="muted">Only admins can change rates.</p>}
        <h3 style={{ marginTop: 18 }}>Record an actual invoice</h3>
        {user.role === "ADMIN" ? <ActualCostForm /> : null}
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <h2>Text for the VaaniYantra agent</h2>
        <p className="small muted">Paste these into Agents → New agent. They come from the same rules the server enforces and contain no price figures.</p>
        <div className="grid g3">
          <CopyBlock label="greeting" text={agentGreeting()} />
          <CopyBlock label="description" text={agentDescription()} />
          <CopyBlock label="knowledge document" text={knowledgeDocument()} />
        </div>
      </section>

      {user.role === "ADMIN" ? (
        <section className="panel flat" style={{ marginTop: 16 }}>
          <h2>Demo data</h2>
          <p className="small">Removes simulator records only. Real enquiries are never deleted here.</p>
          <ClearDemoButton count={demos} />
        </section>
      ) : null}
    </>
  );
}
