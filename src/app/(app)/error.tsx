"use client";
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="panel">
      <h1>This page couldn&apos;t load</h1>
      <p>{/database|ECONNREFUSED|connect/i.test(error.message) ? "The database isn't reachable. Check DATABASE_URL and that the database is running." : "Something went wrong loading the data."} Reference: {error.digest ?? "n/a"}</p>
      <button className="btn" onClick={reset}>Try again</button>
    </div>
  );
}
