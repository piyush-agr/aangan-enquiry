/** Plain GET form: works without JavaScript, keeps the period in the URL so views are shareable. */
export function PeriodForm({ from, to, demo, action }: { from: string; to: string; demo: boolean; action: string }) {
  return (
    <form className="filters" method="get" action={action}>
      <label className="f">
        From
        <input type="date" name="from" defaultValue={from} />
      </label>
      <label className="f">
        To
        <input type="date" name="to" defaultValue={to} />
      </label>
      <label className="f" style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingBottom: 8 }}>
        <input type="checkbox" name="demo" value="1" defaultChecked={demo} style={{ minHeight: 0 }} />
        Include demo calls
      </label>
      <button className="btn ghost" type="submit">
        Update
      </button>
    </form>
  );
}

export function isoDay(d: Date) {
  return new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}
