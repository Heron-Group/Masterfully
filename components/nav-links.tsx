"use client";

import { Library, NotebookPen, Settings, SquareStack, StickyNote, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export const NAV_ITEMS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/journal", label: "Journal", icon: NotebookPen },
  { href: "/notes", label: "Notes", icon: StickyNote },
  { href: "/library", label: "Library", icon: Library },
  { href: "/groups", label: "Groups", icon: SquareStack },
  { href: "/settings", label: "Settings", icon: Settings },
];


type Variant = "sidebar" | "bar";

export function NavLinks({ variant }: { variant: Variant }) {
  const pathname = usePathname();
  return <NavList variant={variant} active={(href) => pathname === href || pathname.startsWith(`${href}/`)} />;
}

/** Also used as the Suspense fallback, with nothing marked active. */
export function NavList({ variant, active = () => false }: { variant: Variant; active?: (href: string) => boolean }) {
  if (variant === "bar") {
    return (
      <ul className="flex items-center gap-1">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const current = active(href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={current ? "page" : undefined}
                aria-label={label}
                title={label}
                className={`flex h-9 items-center gap-1.5 rounded-md px-2.5 text-sm transition-colors ${
                  current ? "bg-accent-soft text-ink" : "text-muted hover:bg-accent-soft/60 hover:text-ink"
                }`}
              >
                <Icon size={18} strokeWidth={1.6} aria-hidden="true" />
                <span className={current ? "inline" : "sr-only"}>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <ul className="space-y-0.5">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const current = active(href);
        return (
          <li key={href}>
            <Link
              href={href}
              aria-current={current ? "page" : undefined}
              className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[15px] transition-colors ${
                current ? "bg-accent-soft font-medium text-ink" : "text-muted hover:bg-accent-soft/60 hover:text-ink"
              }`}
            >
              <Icon size={18} strokeWidth={1.6} aria-hidden="true" />
              {label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
