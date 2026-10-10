import Link from "next/link";
import { ModeBar } from "@/components/ModeBar";
import { Nav } from "@/components/Nav";
import { attentionCount, demoCount } from "@/lib/analytics/queries";
import { requireUser } from "@/lib/auth/guard";
import { config } from "@/lib/config/env";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [attention, demos] = await Promise.all([attentionCount(config().VOICE_PROVIDER === "mock"), demoCount()]);
  return (
    <div className="shell">
      <aside className="side">
        <Link className="brand" href="/">
          Aangan Studio
          <small>Phone enquiries</small>
        </Link>
        <Nav attention={attention} />
        <div className="side-foot">
          Signed in as {user.name} ({user.role.toLowerCase()})
          <form action="/api/auth/logout" method="post">
            <button type="submit">Sign out</button>
          </form>
        </div>
      </aside>
      <main className="main" id="main">
        <ModeBar demoRecords={demos} />
        {children}
      </main>
    </div>
  );
}
