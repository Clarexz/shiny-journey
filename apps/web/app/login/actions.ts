"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loginRedirectPath } from "@/lib/auth/paths";
import { LoginSchema, type LoginInput } from "./schema";

export interface LoginResult {
  error: string;
}

export async function signIn(input: LoginInput): Promise<LoginResult> {
  const parsed = LoginSchema.safeParse(input);
  if (!parsed.success) return { error: "Revisa el correo y la contraseña" };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  // Mensaje genérico: no revela si el correo existe.
  if (error) return { error: "Correo o contraseña incorrectos" };

  redirect(loginRedirectPath(parsed.data.next));
}
