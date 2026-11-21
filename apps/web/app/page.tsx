import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Panel</h1>
        <form action="/auth/logout" method="post">
          <Button type="submit" variant="outline" size="sm">
            Salir
          </Button>
        </form>
      </header>
      <p className="text-muted-foreground">Sesión iniciada como {user.email}.</p>
    </main>
  );
}
