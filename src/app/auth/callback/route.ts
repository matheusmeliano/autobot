import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const type = requestUrl.searchParams.get("type");
  const nextParam = requestUrl.searchParams.get("next") ?? "/app";
  const nextUrl = nextParam.startsWith("/") ? nextParam : "/app";
  const isLoginReturn = nextUrl.startsWith("/login");

  if (code || tokenHash) {
    const supabase = await createSupabaseServerClient({ canSetCookies: true });
    if (code) {
      await supabase.auth.exchangeCodeForSession(code);
      if (isLoginReturn) {
        await supabase.auth.signOut();
      }
    } else if (tokenHash && type) {
      await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as any });
      if (isLoginReturn) {
        await supabase.auth.signOut();
      }
    }
  }

  return NextResponse.redirect(new URL(nextUrl, requestUrl.origin));
}
