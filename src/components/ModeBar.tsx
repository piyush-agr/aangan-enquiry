import { integrationStatus } from "@/lib/config/env";

export function ModeBar({ demoRecords }: { demoRecords: number }) {
  const s = integrationStatus();
  return (
    <div className="mode-bar" role="status">
      {s.voiceMode === "MOCK" ? (
        <span className="mode mock">Mock mode: no real calls are being received</span>
      ) : s.voiceMode === "LIVE" ? (
        <span className="mode live">Live: VaaniYantra webhooks on</span>
      ) : (
        <span className="mode bad">VaaniYantra misconfigured — see Settings</span>
      )}
      <span className={`mode ${s.telegram.configured ? "live" : "off"}`}>{s.telegram.configured ? "Telegram connected" : "Telegram not set up"}</span>
      {demoRecords > 0 ? <span className="mode off">{demoRecords} demo records (hidden from metrics unless you include them)</span> : null}
    </div>
  );
}
