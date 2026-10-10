import type { ReactNode } from "react";

/** A single figure with its definition always available (title tooltip + screen-reader text). */
export function Fig({ label, value, sub, def, na }: { label: string; value: ReactNode; sub?: ReactNode; def: string; na?: boolean }) {
  return (
    <div className={`fig${na ? " na" : ""}`}>
      <dt>
        {label}
        <abbr className="info" title={def} aria-label={`How this is calculated: ${def}`}>
          i
        </abbr>
      </dt>
      <dd>
        {value}
        {sub ? <small>{sub}</small> : null}
      </dd>
    </div>
  );
}
