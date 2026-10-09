"use server";

import { redirect } from "next/navigation";
import { login, logout } from "@/lib/auth";

export type LoginState = { error?: string };

/** Only allow redirects back into this app (no protocol-relative URLs). */
function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\")
    ? next
    : "/journal";
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const result = await login(String(formData.get("password") ?? ""));
  if (!result.ok) return { error: result.error };
  redirect(safeNext(formData.get("next")));
}

export async function logoutAction(): Promise<void> {
  await logout();
  redirect("/login");
}
