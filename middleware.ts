import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isGlobalAdminEmail } from "@/lib/auth/admin";

function getSupabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
}

function getSupabaseAnonKey() {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.VITE_SUPABASE_ANON_KEY
  );
}

export async function middleware(request: NextRequest) {
  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();

  if (!url || !anonKey) {
    const pathname = request.nextUrl.pathname;
    if (pathname === "/app" || pathname.startsWith("/app/")) {
      const next = `${request.nextUrl.pathname}${request.nextUrl.search}`;
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/login";
      redirectUrl.search = "";
      redirectUrl.searchParams.set("next", next);
      return NextResponse.redirect(redirectUrl);
    }
    if (pathname === "/admin" || pathname.startsWith("/admin/")) {
      const next = `${request.nextUrl.pathname}${request.nextUrl.search}`;
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/login";
      redirectUrl.search = "";
      redirectUrl.searchParams.set("next", next);
      return NextResponse.redirect(redirectUrl);
    }
    return NextResponse.next();
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
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user ?? null;

  const pathname = request.nextUrl.pathname;
  const confirmed = request.nextUrl.searchParams.get("confirmed");
  if (user && (pathname === "/login" || pathname === "/signup")) {
    if (pathname === "/login" && confirmed === "1") {
      return response;
    }
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/app";
    redirectUrl.search = "";
    response = NextResponse.redirect(redirectUrl);
    cookiesToReplay.forEach(({ name, value, options }) => {
      response.cookies.set(name, value, options);
    });
  }

  if (pathname === "/app" || pathname.startsWith("/app/")) {
    if (!user) {
      const next = `${request.nextUrl.pathname}${request.nextUrl.search}`;
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/login";
      redirectUrl.search = "";
      redirectUrl.searchParams.set("next", next);
      response = NextResponse.redirect(redirectUrl);
      cookiesToReplay.forEach(({ name, value, options }) => {
        response.cookies.set(name, value, options);
      });
    }
  }

  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    if (!isGlobalAdminEmail(user?.email)) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = user ? "/app" : "/login";
      redirectUrl.search = "";
      if (!user) {
        const next = `${request.nextUrl.pathname}${request.nextUrl.search}`;
        redirectUrl.searchParams.set("next", next);
      }
      response = NextResponse.redirect(redirectUrl);
      cookiesToReplay.forEach(({ name, value, options }) => {
        response.cookies.set(name, value, options);
      });
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
