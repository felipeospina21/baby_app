"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Tab-style navigation between the Naps (/) and Night Sleep (/sleep) modules. */
export function ModuleNav() {
  const pathname = usePathname();
  const tabs = [
    { href: "/", label: "Naps" },
    { href: "/sleep", label: "Night Sleep" },
  ];

  return (
    <nav className="flex w-full max-w-md gap-1 rounded-full bg-white/5 p-1 text-sm">
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex-1 rounded-full px-4 py-2 text-center font-medium transition ${
              active
                ? "bg-white/15 text-white"
                : "text-white/60 hover:text-white"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
