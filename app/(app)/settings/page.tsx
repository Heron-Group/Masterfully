import type { Metadata } from "next";
import { Suspense } from "react";
import { ui } from "@/components/ui";
import { AccountSection, AiSection, AppearanceSection, DataSection } from "./sections";

export const metadata: Metadata = { title: "Settings" };

/** Settings as a full page (for direct links); the sidebar opens the same sections in a window. */
export default function SettingsPage() {
  return (
    <main className={ui.page}>
      <h1 className={`${ui.h1} mb-10`}>Settings</h1>
      <Suspense fallback={<p className="text-sm text-faint">Loading…</p>}>
        <div className="space-y-12">
          <AccountSection />
          <AppearanceSection />
          <AiSection />
          <DataSection />
        </div>
      </Suspense>
    </main>
  );
}
