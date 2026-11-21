import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { loginRedirectPath } from "@/lib/auth/paths";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Entrar</CardTitle>
          <CardDescription>Usa el correo y la contraseña de tu cuenta.</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm next={loginRedirectPath(next)} />
        </CardContent>
      </Card>
    </main>
  );
}
