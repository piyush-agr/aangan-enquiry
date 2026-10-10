/**
 * 24-hour arrival ring. Each spoke is one hour (IST, midnight at the top); spoke length = calls that hour,
 * the red part = missed/failed. The brass arc marks the 10:00–19:00 front-desk window, so after-hours
 * demand is visible at a glance.
 */
export function HourRing({ hours }: { hours: { hour: number; total: number; missed: number }[] }) {
  const size = 320;
  const c = size / 2;
  const inner = 62;
  const outer = 146;
  const max = Math.max(1, ...hours.map((h) => h.total));
  const angle = (h: number) => (h / 24) * Math.PI * 2 - Math.PI / 2;
  const pt = (r: number, a: number) => [c + r * Math.cos(a), c + r * Math.sin(a)] as const;
  const arc = (r: number, h0: number, h1: number) => {
    const [x0, y0] = pt(r, angle(h0));
    const [x1, y1] = pt(r, angle(h1));
    return `M ${x0} ${y0} A ${r} ${r} 0 ${h1 - h0 > 12 ? 1 : 0} 1 ${x1} ${y1}`;
  };
  const total = hours.reduce((a, h) => a + h.total, 0);
  const outside = hours.filter((h) => h.hour < 10 || h.hour >= 19).reduce((a, h) => a + h.total, 0);
  return (
    <figure className="ring-wrap" style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${size} ${size}`} width="100%" role="img" aria-label={`Calls by hour of day: ${total} calls, ${outside} outside 10am–7pm front-desk hours.`}>
        <circle cx={c} cy={c} r={outer + 6} fill="var(--plaster)" stroke="var(--line)" />
        <path d={arc(outer + 2, 10, 19)} stroke="var(--brass)" strokeWidth="8" fill="none" strokeLinecap="butt" />
        <circle cx={c} cy={c} r={inner - 6} fill="var(--stone)" />
        {hours.map((h) => {
          const a = angle(h.hour + 0.5);
          const len = h.total ? 10 + ((outer - inner - 14) * h.total) / max : 0;
          const missLen = h.total ? (len * h.missed) / h.total : 0;
          const [x0, y0] = pt(inner, a);
          const [x1, y1] = pt(inner + len - missLen, a);
          const [x2, y2] = pt(inner + len, a);
          const [tx, ty] = pt(inner - 16, angle(h.hour));
          return (
            <g key={h.hour}>
              <title>{`${String(h.hour).padStart(2, "0")}:00 — ${h.total} call${h.total === 1 ? "" : "s"}${h.missed ? `, ${h.missed} missed/failed` : ""}`}</title>
              {h.total ? <line x1={x0} y1={y0} x2={x1} y2={y1} stroke="var(--ink)" strokeWidth="9" /> : <circle cx={x0} cy={y0} r="1.5" fill="var(--ink-3)" />}
              {h.missed ? <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--sindoor)" strokeWidth="9" /> : null}
              {h.hour % 6 === 0 ? (
                <text x={tx} y={ty} fontSize="11" textAnchor="middle" dominantBaseline="middle" fill="var(--ink-2)">
                  {h.hour === 0 ? "12am" : h.hour === 6 ? "6am" : h.hour === 12 ? "noon" : "6pm"}
                </text>
              ) : null}
            </g>
          );
        })}
        <text x={c} y={c - 4} textAnchor="middle" fontSize="26" fontWeight="700" fill="var(--ink)" style={{ fontFamily: "var(--font-head)" }}>
          {total}
        </text>
        <text x={c} y={c + 16} textAnchor="middle" fontSize="11" fill="var(--ink-2)">
          calls
        </text>
      </svg>
      <figcaption className="ring-legend">
        <span><span className="sw" style={{ background: "var(--brass)" }} />Front desk 10am–7pm</span>
        <span><span className="sw" style={{ background: "var(--ink)" }} />Calls</span>
        <span><span className="sw" style={{ background: "var(--sindoor)" }} />Missed or failed</span>
      </figcaption>
    </figure>
  );
}
