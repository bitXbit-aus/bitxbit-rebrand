import { createClient } from "@supabase/supabase-js";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  // Client that respects RLS (same as middleware)
  const ssrClient = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      get(name: string) {
        return request.cookies.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        request.cookies.set({ name, value, ...options });
        response = NextResponse.next({ request: { headers: request.headers } });
        response.cookies.set({ name, value, ...options });
      },
      remove(name: string, options: CookieOptions) {
        request.cookies.set({ name, value: "", ...options });
        response = NextResponse.next({ request: { headers: request.headers } });
        response.cookies.set({ name, value: "", ...options });
      },
    },
  });

  const { data: { user }, error: userError } = await ssrClient.auth.getUser();

  let roleFromRls: string | null = null;
  let roleError: string | null = null;

  if (user) {
    const { data, error } = await ssrClient
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();
    roleFromRls = data?.role ?? null;
    roleError = error?.message ?? null;
  }

  // Service role lookup to bypass RLS
  let roleFromServiceRole: string | null = null;
  if (user && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const serviceClient = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data } = await serviceClient
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();
    roleFromServiceRole = data?.role ?? null;
  }

  return NextResponse.json({
    userId: user?.id ?? null,
    userEmail: user?.email ?? null,
    userError: userError?.message ?? null,
    roleFromRls,
    roleError,
    roleFromServiceRole,
    cookiesPresent: request.cookies.getAll().map((c) => c.name),
  });
}
