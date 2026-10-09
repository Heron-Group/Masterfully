"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export const NAV_ITEMS = [
  { href: "/journal", label: "Journal" },
  { href: "/library", label: "Library" },
  { href: "/groups", label: "Groups" },
  { href: "/settings", label: "Settings" },
] as const;

export function NavLinks() {
  const pathname = usePathname();
  return <NavList active={(href) => pathname === href || pathname.startsWith(`${href}/`)} />;
}

/** Also used as the Suspense fallback, with nothing marked active. */
export function NavList({ active = () => false }: { active?: (href: string) => boolean }) {
  return (
    <ul className="flex items-center sm:gap-2">
      {NAV_ITEMS.map((item) => {
        const current = active(item.href);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={current ? "page" : undefined}
              className={`rounded px-2 py-1 text-sm transition-colors ${
                current ? "text-ink" : "text-muted hover:text-ink"
              }`}
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
