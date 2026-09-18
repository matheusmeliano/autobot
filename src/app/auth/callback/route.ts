import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

function getSupabaseUrl() {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    process.env.SUPABASE_URL ??
    process.env.VITE_SUPABASE_URL
  );
}

function getSupabaseAnonKey() {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    process.env.VITE_SUPABASE_ANON_KEY
  );
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const type = requestUrl.searchParams.get("type");
  const nextParam = requestUrl.searchParams.get("next");
  const isRecovery = type === "recovery";
  const resolvedNextParam = isRecovery ? (nextParam ?? "/redefinir-senha") : (nextParam ?? "/app");
  const nextUrl = resolvedNextParam.startsWith("/") ? resolvedNextParam : "/app";
  const isLoginReturn = nextUrl.startsWith("/login");
  const isPasswordResetReturn = isRecovery || nextUrl.startsWith("/redefinir-senha");

  if (code || tokenHash) {
    const url = getSupabaseUrl();
    const anonKey = getSupabaseAnonKey();
    if (!url || !anonKey) {
      return NextResponse.redirect(new URL(nextUrl, requestUrl.origin));
    }

    const cookiesToReplay: { name: string; value: string; options: any }[] = [];
    let response = NextResponse.next({
      request: {
        headers: request.headers,
      },
    });

    const supabase = createServerClient(url, anonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookiesToReplay.push({ name, value, options });
            response.cookies.set(name, value, options);
          });
        },
      },
    });
    const {
      data: { session: sessionBefore },
    } = await supabase.auth.getSession();

    if (code) {
      await supabase.auth.exchangeCodeForSession(code);
    } else if (tokenHash && type) {
      await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as any });
    }

    const hadSessionBefore = Boolean(sessionBefore);

    if (!hadSessionBefore && !isPasswordResetReturn) {
      await supabase.auth.signOut();

      if (!isLoginReturn) {
        const loginUrl = new URL("/login", requestUrl.origin);
        loginUrl.searchParams.set("next", nextUrl);
        loginUrl.searchParams.set("link", "1");
        const redirect = NextResponse.redirect(loginUrl);
        cookiesToReplay.forEach(({ name, value, options }) => {
          redirect.cookies.set(name, value, options);
        });
        return redirect;
      }
    }

    const redirect = NextResponse.redirect(new URL(nextUrl, requestUrl.origin));
    cookiesToReplay.forEach(({ name, value, options }) => {
      redirect.cookies.set(name, value, options);
    });
    return redirect;
  }

  return NextResponse.redirect(new URL(nextUrl, requestUrl.origin));
}
