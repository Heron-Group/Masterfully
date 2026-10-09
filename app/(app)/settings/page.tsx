import type { Metadata } from "next";
import { SignOutButton } from "@/components/sign-out-button";
import { StagePlaceholder } from "@/components/stage-placeholder";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <>
      <StagePlaceholder title="Settings" stage={5} />
      <section className="mx-auto w-full max-w-3xl px-4 pb-12">
        <SignOutButton />
      </section>
    </>
  );
}
