import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isGlobalAdminEmail } from "@/lib/auth/admin";
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

  if (user && (pathname === "/app" || pathname.startsWith("/app/"))) {
    const allowAssinatura = pathname === "/app/assinatura" || pathname.startsWith("/app/assinatura/");
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
      const status = rawStatus === "pausado" || rawStatus === "past_due" ? "cancelado" : rawStatus;
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
        response = NextResponse.redirect(redirectUrl);
        cookiesToReplay.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      }
    }
  }
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
  matcher: ["/app/:path*", "/admin/:path*", "/login", "/signup"],
};
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isGlobalAdminEmail } from "@/lib/auth/admin";
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

  if (user && (pathname === "/app" || pathname.startsWith("/app/"))) {
    const allowAssinatura = pathname === "/app/assinatura" || pathname.startsWith("/app/assinatura/");
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
      const status = rawStatus === "pausado" || rawStatus === "past_due" ? "cancelado" : rawStatus;
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
        response = NextResponse.redirect(redirectUrl);
        cookiesToReplay.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      }
    }
  }
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
  matcher: ["/app/:path*", "/admin/:path*", "/login", "/signup"],
};
