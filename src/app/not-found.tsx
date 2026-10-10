import Link from "next/link";
export default function NotFound() {
  return (
    <div className="login"><div className="panel"><h1>Not found</h1><p>That page or enquiry doesn&apos;t exist.</p><Link href="/">Back to the overview</Link></div></div>
  );
}
