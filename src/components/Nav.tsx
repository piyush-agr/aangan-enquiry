"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Overview" },
  { href: "/enquiries", label: "Enquiries" },
  { href: "/attention", label: "Needs attention" },
  { href: "/costs", label: "Costs" },
  { href: "/simulator", label: "Call simulator" },
  { href: "/settings", label: "Settings" },
];

export function Nav({ attention }: { attention: number }) {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Main">
      {ITEMS.map((i) => {
        const active = i.href === "/" ? path === "/" : path.startsWith(i.href);
        return (
          <Link key={i.href} href={i.href} aria-current={active ? "page" : undefined}>
            {i.label}
            {i.href === "/attention" && attention > 0 ? <span className="count" aria-label={`${attention} open`}>{attention}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
