"use server";

import { redirect } from "next/navigation";
import { login, logout } from "@/lib/auth";
import { safeNext } from "@/lib/auth/redirects";

export type LoginState = { error?: string };

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const result = await login(String(formData.get("password") ?? ""));
  if (!result.ok) return { error: result.error };
  redirect(safeNext(formData.get("next")));
}

export async function logoutAction(): Promise<void> {
  await logout();
  redirect("/login");
}
