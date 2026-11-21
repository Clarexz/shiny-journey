import { NextResponse } from "next/server";
import { requireTenantContext } from "@/lib/auth/context";
import { errorResponse } from "@/lib/auth/errors";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await requireTenantContext();
    return NextResponse.json({
      user: { id: ctx.user.id, email: ctx.user.email ?? null },
      profile: { fullName: ctx.profile.full_name, role: ctx.role },
      tenantId: ctx.tenantId,
      tenant: ctx.tenant
        ? {
            id: ctx.tenant.id,
            slug: ctx.tenant.slug,
            name: ctx.tenant.name,
            modulesEnabled: ctx.tenant.modules_enabled,
          }
        : null,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
