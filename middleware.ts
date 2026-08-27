import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isGlobalAdminEmail } from "@/lib/auth/admin";
import {
  getDefaultAuthenticatedPath,
  getSafeAuthenticatedPath,
  isAtendimentoPath,
  isAtendimentoOnlyAccessScope,
  normalizeAccessScope,
} from "@/lib/auth/access";
import { normalizePlan } from "@/lib/plans";

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

function isAppPath(pathname: string) {
  return pathname === "/app" || pathname.startsWith("/app/");
}

function isAdminPath(pathname: string) {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

function isAuthPath(pathname: string) {
  return pathname === "/login" || pathname === "/signup";
}

function splitDestination(destination: string) {
  const questionIndex = destination.indexOf("?");
  if (questionIndex === -1) {
    return { pathname: destination, search: "" };
  }
  return {
    pathname: destination.slice(0, questionIndex),
    search: destination.slice(questionIndex),
  };
}

function copyCookies(
  response: NextResponse,
  cookiesToReplay: { name: string; value: string; options: any }[],
) {
  cookiesToReplay.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, options);
  });
  return response;
}

function buildLoginRedirect(request: NextRequest, next: string, extras?: Record<string, string | undefined>) {
  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = "/login";
  redirectUrl.search = "";
  redirectUrl.searchParams.set("next", next);
  if (extras) {
    for (const [k, v] of Object.entries(extras)) {
      if (typeof v === "string" && v.trim()) redirectUrl.searchParams.set(k, v.trim());
    }
  }
  return redirectUrl;
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();

  if (!url || !anonKey) {
    if (isAppPath(pathname) || isAdminPath(pathname)) {
      const next = `${request.nextUrl.pathname}${request.nextUrl.search}`;
      return NextResponse.redirect(buildLoginRedirect(request, next));
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
  const confirmed = request.nextUrl.searchParams.get("confirmed");
  const next = `${request.nextUrl.pathname}${request.nextUrl.search}`;

  let accessScope = "app";
  if (user?.id) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("access_scope")
      .eq("user_id", user.id)
      .maybeSingle();
    accessScope = normalizeAccessScope((profile as any)?.access_scope);
  }

  if (isAuthPath(pathname) && user) {
    if (pathname === "/login" && confirmed === "1") {
      return response;
    }

    const requestedNext = String(request.nextUrl.searchParams.get("next") ?? "");
    const safeNext = getSafeAuthenticatedPath(accessScope, requestedNext);
    const redirectUrl = request.nextUrl.clone();
    const destination = splitDestination(safeNext);
    redirectUrl.pathname = destination.pathname;
    redirectUrl.search = destination.search;
    return copyCookies(NextResponse.redirect(redirectUrl), cookiesToReplay);
  }

  if (isAppPath(pathname)) {
    if (!user) {
      return copyCookies(NextResponse.redirect(buildLoginRedirect(request, next)), cookiesToReplay);
    }

    if (isAtendimentoOnlyAccessScope(accessScope)) {
      const redirectUrl = request.nextUrl.clone();
      const destination = splitDestination(getDefaultAuthenticatedPath(accessScope));
      redirectUrl.pathname = destination.pathname;
      redirectUrl.search = destination.search;
      return copyCookies(NextResponse.redirect(redirectUrl), cookiesToReplay);
    }

    const allowAssinatura =
      pathname === "/app/assinatura" || pathname.startsWith("/app/assinatura/");
    const allowConfiguracoes =
      pathname === "/app/configuracoes" || pathname.startsWith("/app/configuracoes/");

    if (!allowAssinatura && !allowConfiguracoes) {
      const { data: sub } = await supabase
        .from("subscriptions")
        .select("id, plano, status, vencimento, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const plan = normalizePlan(sub?.plano ?? "teste");
      const rawStatus = String(sub?.status ?? "").toLowerCase();
      const status =
        rawStatus === "pausado" || rawStatus === "past_due" ? "cancelado" : rawStatus;
      const vencimento = sub?.vencimento ?? null;
      const today = new Date().toISOString().slice(0, 10);
      const isExpired =
        typeof vencimento === "string" &&
        vencimento.length >= 10 &&
        vencimento.slice(0, 10) < today;

      if (isExpired && sub?.id && status !== "cancelado") {
        await supabase.from("subscriptions").update({ status: "cancelado" }).eq("id", sub.id);
      }

      const isBlocked =
        status === "cancelado" ||
        (plan !== "vitalicio" && isExpired) ||
        (plan === "teste" && isExpired);
      if (isBlocked) {
        if (request.method !== "GET" && request.method !== "HEAD") {
          return new Response("Acesso bloqueado.", { status: 403 });
        }
        const redirectUrl = request.nextUrl.clone();
        redirectUrl.pathname = "/app/assinatura";
        redirectUrl.search = "";
        redirectUrl.searchParams.set("blocked", "1");
        return copyCookies(NextResponse.redirect(redirectUrl), cookiesToReplay);
      }
    }
  }

  if (isAdminPath(pathname)) {
    if (!user) {
      return copyCookies(NextResponse.redirect(buildLoginRedirect(request, next)), cookiesToReplay);
    }

    if (isAtendimentoOnlyAccessScope(accessScope) || !isGlobalAdminEmail(user.email)) {
      const redirectUrl = request.nextUrl.clone();
      const destination = splitDestination(getDefaultAuthenticatedPath(accessScope));
      redirectUrl.pathname = destination.pathname;
      redirectUrl.search = destination.search;
      return copyCookies(NextResponse.redirect(redirectUrl), cookiesToReplay);
    }
  }

  if (isAtendimentoPath(pathname) && user && !isAtendimentoOnlyAccessScope(accessScope)) {
    const redirectUrl = request.nextUrl.clone();
    const destination = splitDestination(getDefaultAuthenticatedPath(accessScope));
    redirectUrl.pathname = destination.pathname;
    redirectUrl.search = destination.search;
    return copyCookies(NextResponse.redirect(redirectUrl), cookiesToReplay);
  }

  return response;
}

export const config = {
  matcher: ["/app/:path*", "/admin/:path*", "/atendimento", "/atendimento/:path*", "/login", "/signup"],
};
