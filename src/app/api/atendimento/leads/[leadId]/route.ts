import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAtendimentoUser } from "@/lib/atendimento/server";
import { isAtendimentoOnlyAccessScope, normalizeAccessScope } from "@/lib/auth/access";
import { z } from "zod";

function isExperimentalClassBookingsTableUnavailable(error: unknown) {
  const code = String((error as any)?.code ?? "").trim();
  const message = String((error as any)?.message ?? "");
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    /relation .*atendimento_experimental_class_bookings.*does not exist/i.test(message) ||
    /could not find the table .*atendimento_experimental_class_bookings.* in the schema cache/i.test(
      message,
    )
  );
}

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request, context: { params: Promise<{ leadId: string }> }) {
  try {
    const auth = await requireAtendimentoUser();
    if (!auth.ok) {
      return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const { leadId } = await context.params;
    const url = new URL(request.url);
    const skipEvents = url.searchParams.get("skipEvents") !== "0";
    const admin = createSupabaseAdminClient();

    const leadPromise = admin
      .from("atendimento_leads")
      .select("*")
      .eq("id", leadId)
      .eq("assigned_user_email", "atendimento.usa.music@gmail.com")
      .maybeSingle();
    const eventsPromise = skipEvents
      ? Promise.resolve({ data: [] as any[], error: null as any })
      : admin
          .from("atendimento_history_events")
          .select("*")
          .eq("lead_id", leadId)
          .order("created_at", { ascending: false })
          .limit(100);
    const [{ data: lead, error: leadError }, { data: events, error: eventsError }] = await Promise.all([
      leadPromise,
      eventsPromise,
    ]);

    if (leadError) {
      return Response.json({ ok: false, error: leadError.message }, { status: 500 });
    }
    if (eventsError) {
      return Response.json({ ok: false, error: eventsError.message }, { status: 500 });
    }
    if (!lead?.id) {
      return Response.json({ ok: false, error: "not_found" }, { status: 404 });
    }

    const { data: conversation, error: conversationError } = await admin
      .from("atendimento_conversations")
      .select("id")
      .eq("lead_id", leadId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (conversationError) {
      return Response.json({ ok: false, error: conversationError.message }, { status: 500 });
    }

    return Response.json({
      ok: true,
      lead: {
        ...(lead as any),
        is_new_for_attendant: (lead as any)?.is_new_for_attendant ?? false,
        conversation: conversation ?? null,
      },
      events: (events ?? []) as any[],
    });
  } catch (error) {
    return Response.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ leadId: string }> }) {
  const auth = await requireAtendimentoUser();
  if (!auth.ok) {
    return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const { leadId } = await context.params;
  let body: unknown = null;
  try {
    body = await request.json();
  } catch (_) {
    return Response.json({ ok: false, error: "body_invalido" }, { status: 400 });
  }

  const schema = z.object({
    full_name: z.string().trim().max(160).nullable().optional(),
    recurring_class_link: z.string().trim().max(500).nullable().optional(),
    city: z.string().trim().max(160).nullable().optional(),
    state: z.string().trim().max(160).nullable().optional(),
    country: z.string().trim().max(120).nullable().optional(),
    timezone: z.string().trim().max(120).nullable().optional(),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ ok: false, error: "dados_invalidos" }, { status: 400 });
  }

  const fullNameRaw = parsed.data.full_name;
  const safeFullName =
    fullNameRaw === undefined
      ? undefined
      : fullNameRaw === null
        ? null
        : String(fullNameRaw).trim() || null;

  const recurringLinkRaw = parsed.data.recurring_class_link;
  let safeRecurringLink: undefined | null | string = undefined;
  if (recurringLinkRaw === undefined) {
    safeRecurringLink = undefined;
  } else if (recurringLinkRaw === null) {
    safeRecurringLink = null;
  } else {
    const trimmed = String(recurringLinkRaw).trim();
    if (/^https?:\/\//i.test(trimmed)) {
      safeRecurringLink = trimmed;
    } else if (trimmed.length === 0) {
      safeRecurringLink = null;
    } else {
      safeRecurringLink = null;
    }
  }

  const cityRaw = parsed.data.city;
  const safeCity =
    cityRaw === undefined
      ? undefined
      : cityRaw === null
        ? null
        : String(cityRaw).trim() || null;

  const stateRaw = parsed.data.state;
  const safeState =
    stateRaw === undefined
      ? undefined
      : stateRaw === null
        ? null
        : String(stateRaw).trim() || null;

  const countryRaw = parsed.data.country;
  let safeCountry: undefined | null | string = undefined;
  if (countryRaw === undefined) {
    safeCountry = undefined;
  } else if (countryRaw === null) {
    safeCountry = null;
  } else {
    safeCountry = String(countryRaw).trim() || null;
  }

  const timezoneRaw = parsed.data.timezone;
  let safeTimezone: undefined | null | string = undefined;
  if (timezoneRaw === undefined) {
    safeTimezone = undefined;
  } else if (timezoneRaw === null) {
    safeTimezone = null;
  } else {
    safeTimezone = String(timezoneRaw).trim() || null;
  }

  function normalizeLocationKey(value: unknown): string {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .trim();
  }

  const hasCityOrStateIncoming =
    (safeCity !== undefined && safeCity !== null) ||
    (safeState !== undefined && safeState !== null);

  if (hasCityOrStateIncoming) {
    const normState = normalizeLocationKey(safeState ?? "");
    const normCity = normalizeLocationKey(safeCity ?? "");

    const usStateCodes = new Set<string>([
      "al","ak","az","ar","ca","co","ct","de","fl","ga","hi","id","il","in","ia","ks","ky","la","me","md","ma","mi","mn","ms","mo","mt","ne","nv","nh","nj","nm","ny","nc","nd","oh","ok","or","pa","ri","sc","sd","tn","tx","ut","vt","va","wa","wv","wi","wy","dc",
    ]);

    const usStateNameToCode: Record<string, string> = {
      alabama: "al",
      alaska: "ak",
      arizona: "az",
      arkansas: "ar",
      california: "ca",
      colorado: "co",
      connecticut: "ct",
      delaware: "de",
      florida: "fl",
      georgia: "ga",
      hawaii: "hi",
      idaho: "id",
      illinois: "il",
      indiana: "in",
      iowa: "ia",
      kansas: "ks",
      kentucky: "ky",
      louisiana: "la",
      maine: "me",
      maryland: "md",
      massachusetts: "ma",
      michigan: "mi",
      minnesota: "mn",
      mississippi: "ms",
      missouri: "mo",
      montana: "mt",
      nebraska: "ne",
      nevada: "nv",
      newhampshire: "nh",
      newjersey: "nj",
      newmexico: "nm",
      newyork: "ny",
      northcarolina: "nc",
      northdakota: "nd",
      ohio: "oh",
      oklahoma: "ok",
      oregon: "or",
      pennsylvania: "pa",
      rhodeisland: "ri",
      southcarolina: "sc",
      southdakota: "sd",
      tennessee: "tn",
      texas: "tx",
      utah: "ut",
      vermont: "vt",
      virginia: "va",
      washington: "wa",
      westvirginia: "wv",
      wisconsin: "wi",
      wyoming: "wy",
      districtofcolumbia: "dc",
    };

    const usStateCodeToTimezone: Record<string, string> = {
      al: "America/Chicago",
      ak: "America/Anchorage",
      az: "America/Phoenix",
      ar: "America/Chicago",
      ca: "America/Los_Angeles",
      co: "America/Denver",
      ct: "America/New_York",
      de: "America/New_York",
      fl: "America/New_York",
      ga: "America/New_York",
      hi: "Pacific/Honolulu",
      id: "America/Boise",
      il: "America/Chicago",
      in: "America/Indiana/Indianapolis",
      ia: "America/Chicago",
      ks: "America/Chicago",
      ky: "America/New_York",
      la: "America/Chicago",
      me: "America/New_York",
      md: "America/New_York",
      ma: "America/New_York",
      mi: "America/Detroit",
      mn: "America/Chicago",
      ms: "America/Chicago",
      mo: "America/Chicago",
      mt: "America/Denver",
      ne: "America/Chicago",
      nv: "America/Los_Angeles",
      nh: "America/New_York",
      nj: "America/New_York",
      nm: "America/Denver",
      ny: "America/New_York",
      nc: "America/New_York",
      nd: "America/Chicago",
      oh: "America/New_York",
      ok: "America/Chicago",
      or: "America/Los_Angeles",
      pa: "America/New_York",
      ri: "America/New_York",
      sc: "America/New_York",
      sd: "America/Chicago",
      tn: "America/Chicago",
      tx: "America/Chicago",
      ut: "America/Denver",
      vt: "America/New_York",
      va: "America/New_York",
      wa: "America/Los_Angeles",
      wv: "America/New_York",
      wi: "America/Chicago",
      wy: "America/Denver",
      dc: "America/New_York",
    };

    const brStateToTimezone: Record<string, string> = {
      ac: "America/Rio_Branco",
      al: "America/Maceio",
      ap: "America/Belem",
      am: "America/Manaus",
      ba: "America/Bahia",
      ce: "America/Fortaleza",
      df: "America/Sao_Paulo",
      es: "America/Sao_Paulo",
      go: "America/Sao_Paulo",
      ma: "America/Sao_Paulo",
      mt: "America/Cuiaba",
      ms: "America/Campo_Grande",
      mg: "America/Sao_Paulo",
      pa: "America/Belem",
      pb: "America/Fortaleza",
      pr: "America/Sao_Paulo",
      pe: "America/Recife",
      pi: "America/Fortaleza",
      rj: "America/Sao_Paulo",
      rn: "America/Fortaleza",
      rs: "America/Sao_Paulo",
      ro: "America/Porto_Velho",
      rr: "America/Boa_Vista",
      sc: "America/Sao_Paulo",
      sp: "America/Sao_Paulo",
      se: "America/Maceio",
      to: "America/Araguaina",
    };

    const brStateByNameToCode: Record<string, string> = {
      acre: "ac",
      alagoas: "al",
      amapa: "ap",
      amazonas: "am",
      bahia: "ba",
      ceara: "ce",
      distritofederal: "df",
      espiritosanto: "es",
      goias: "go",
      maranhao: "ma",
      matogrosso: "mt",
      matogrossodosul: "ms",
      minasgerais: "mg",
      para: "pa",
      paraiba: "pb",
      parana: "pr",
      pernambuco: "pe",
      piaui: "pi",
      riodejaneiro: "rj",
      riograndedonorte: "rn",
      riograndedosul: "rs",
      rondonia: "ro",
      roraima: "rr",
      santacatarina: "sc",
      saopaulo: "sp",
      sergipe: "se",
      tocantins: "to",
    };

    let usCode = normState.length === 2 ? (usStateCodes.has(normState) ? normState : "") : "";
    if (!usCode && normState) {
      usCode = usStateNameToCode[normState] ?? "";
    }

    let brCode = normState.length === 2 ? (brStateByNameToCode[normState] ? normState : "") : "";
    if (!brCode && normState) {
      brCode = brStateByNameToCode[normState] ?? "";
    }

    let derivedCountry: string | null = null;
    let derivedTimezone: string | null = null;

    if (usCode) {
      derivedCountry = "Estados Unidos";
      derivedTimezone = usStateCodeToTimezone[usCode] ?? "America/New_York";
    } else if (brCode) {
      derivedCountry = "Brasil";
      derivedTimezone = brStateToTimezone[brCode] ?? "America/Cuiaba";
    } else {
      if (normState) {
        if (
          normState.includes("florida") ||
          normState.includes("california") ||
          normState.includes("texas") ||
          normState.includes("newyork") ||
          normState.includes("washington") ||
          normState.includes("illinois") ||
          normState.includes("pensilvania") ||
          normState.includes("pennsylvania") ||
          normState.includes("ohio") ||
          normState.includes("georgia") ||
          normState.includes("northcarolina") ||
          normState.includes("michigan") ||
          normState.includes("newjersey") ||
          normState.includes("virginia") ||
          normState.includes("arizona") ||
          normState.includes("massachusetts") ||
          normState.includes("tennessee") ||
          normState.includes("indiana") ||
          normState.includes("missouri") ||
          normState.includes("maryland") ||
          normState.includes("wisconsin") ||
          normState.includes("colorado") ||
          normState.includes("minnesota") ||
          normState.includes("southcarolina") ||
          normState.includes("alabama") ||
          normState.includes("louisiana") ||
          normState.includes("kentucky") ||
          normState.includes("oregon") ||
          normState.includes("oklahoma") ||
          normState.includes("connecticut") ||
          normState.includes("nevada") ||
          normState.includes("arkansas") ||
          normState.includes("mississippi") ||
          normState.includes("kansas") ||
          normState.includes("newmexico") ||
          normState.includes("nebraska") ||
          normState.includes("westvirginia") ||
          normState.includes("idaho") ||
          normState.includes("hawaii") ||
          normState.includes("newhampshire") ||
          normState.includes("maine") ||
          normState.includes("rhodeisland") ||
          normState.includes("delaware") ||
          normState.includes("southdakota") ||
          normState.includes("northdakota") ||
          normState.includes("montana") ||
          normState.includes("vermont") ||
          normState.includes("wyoming") ||
          normState.includes("alaska")
        ) {
          derivedCountry = "Estados Unidos";
        } else if (
          normState.includes("portugal") ||
          normCity.includes("lisboa") ||
          normCity.includes("lisbon") ||
          normCity.includes("porto")
        ) {
          derivedCountry = "Portugal";
          derivedTimezone = "Europe/Lisbon";
        } else if (
          normState.includes("espanha") ||
          normState.includes("spain") ||
          normCity.includes("madrid") ||
          normCity.includes("barcelona")
        ) {
          derivedCountry = "Espanha";
          derivedTimezone = "Europe/Madrid";
        } else if (
          normState.includes("paraguai") ||
          normState.includes("paraguay") ||
          normCity.includes("asuncion") ||
          normCity.includes("assunca")
        ) {
          derivedCountry = "Paraguai";
          derivedTimezone = "America/Asuncion";
        } else if (
          normState.includes("argentina") ||
          normCity.includes("buenosaires")
        ) {
          derivedCountry = "Argentina";
          derivedTimezone = "America/Argentina/Buenos_Aires";
        }
      }

      if (!derivedCountry && normCity) {
        if (
          normCity.includes("miami") ||
          normCity.includes("orlando") ||
          normCity.includes("newyork") ||
          normCity.includes("losangeles") ||
          normCity.includes("lasvegas") ||
          normCity.includes("sanfrancisco") ||
          normCity.includes("sandiego") ||
          normCity.includes("chicago") ||
          normCity.includes("houston") ||
          normCity.includes("dallas") ||
          normCity.includes("austin") ||
          normCity.includes("seattle") ||
          normCity.includes("boston") ||
          normCity.includes("philadelphia") ||
          normCity.includes("phoenix") ||
          normCity.includes("denver") ||
          normCity.includes("atlanta") ||
          normCity.includes("detroit") ||
          normCity.includes("washington") ||
          normCity.includes("portland") ||
          normCity.includes("saltlakecity")
        ) {
          derivedCountry = "Estados Unidos";
        } else if (
          normCity.includes("lisboa") ||
          normCity.includes("lisbon") ||
          normCity.includes("porto")
        ) {
          derivedCountry = "Portugal";
          derivedTimezone = "Europe/Lisbon";
        } else if (normCity.includes("madrid") || normCity.includes("barcelona")) {
          derivedCountry = "Espanha";
          derivedTimezone = "Europe/Madrid";
        } else if (normCity.includes("asuncion") || normCity.includes("assunca")) {
          derivedCountry = "Paraguai";
          derivedTimezone = "America/Asuncion";
        } else if (normCity.includes("buenosaires")) {
          derivedCountry = "Argentina";
          derivedTimezone = "America/Argentina/Buenos_Aires";
        }
      }
    }

    if (!derivedCountry) {
      derivedCountry = "Brasil";
    }
    const normCountry = normalizeLocationKey(derivedCountry);

    if (!derivedTimezone) {
      if (normCountry === "estadosunidos") {
        if (
          normCity.includes("miami") ||
          normState === "fl" ||
          normState.includes("florida") ||
          normCity.includes("newyork") ||
          normState === "ny" ||
          normState.includes("newyork") ||
          normCity.includes("boston") ||
          normCity.includes("philadelphia") ||
          normCity.includes("washington") ||
          normCity.includes("atlanta")
        ) {
          derivedTimezone = "America/New_York";
        } else if (
          normCity.includes("losangeles") ||
          normState === "ca" ||
          normState.includes("california") ||
          normCity.includes("lasvegas") ||
          normCity.includes("sanfrancisco") ||
          normCity.includes("sandiego") ||
          normCity.includes("seattle") ||
          normCity.includes("portland") ||
          normState === "wa" ||
          normState.includes("washington") ||
          normState === "nv" ||
          normState.includes("nevada") ||
          normState === "or" ||
          normState.includes("oregon")
        ) {
          derivedTimezone = "America/Los_Angeles";
        } else if (
          normCity.includes("chicago") ||
          normState === "il" ||
          normState.includes("illinois") ||
          normCity.includes("houston") ||
          normCity.includes("dallas") ||
          normCity.includes("austin") ||
          normState === "tx" ||
          normState.includes("texas")
        ) {
          derivedTimezone = "America/Chicago";
        } else if (
          normCity.includes("denver") ||
          normState === "co" ||
          normState.includes("colorado") ||
          normCity.includes("phoenix") ||
          normState === "az" ||
          normState.includes("arizona") ||
          normCity.includes("saltlakecity")
        ) {
          derivedTimezone = "America/Denver";
        } else if (normCity.includes("honolulu") || normState === "hi" || normState.includes("hawaii")) {
          derivedTimezone = "Pacific/Honolulu";
        } else if (normCity.includes("anchorage") || normState === "ak" || normState.includes("alaska")) {
          derivedTimezone = "America/Anchorage";
        } else {
          derivedTimezone = "America/New_York";
        }
      } else if (normCountry === "portugal") {
        derivedTimezone = "Europe/Lisbon";
      } else if (normCountry === "espanha") {
        derivedTimezone = "Europe/Madrid";
      } else if (normCountry === "paraguai") {
        derivedTimezone = "America/Asuncion";
      } else if (normCountry === "argentina") {
        derivedTimezone = "America/Argentina/Buenos_Aires";
      } else {
        if (normCity.includes("saopaulo") || normCity.includes("sao paulo") || normCity.includes("campinas") || normCity.includes("ribeirao")) {
          derivedTimezone = "America/Sao_Paulo";
        } else if (normCity.includes("riodejaneiro") || normCity.includes("rio de janeiro") || normCity.includes("nit")) {
          derivedTimezone = "America/Sao_Paulo";
        } else if (normCity.includes("cuiaba")) {
          derivedTimezone = "America/Cuiaba";
        } else if (normCity.includes("campogrande")) {
          derivedTimezone = "America/Campo_Grande";
        } else if (normCity.includes("manaus")) {
          derivedTimezone = "America/Manaus";
        } else if (normCity.includes("belem") || normCity.includes("anapolis")) {
          derivedTimezone = "America/Belem";
        } else if (
          normCity.includes("recife") ||
          normCity.includes("fortaleza") ||
          normCity.includes("salvador") ||
          normCity.includes("maceio") ||
          normCity.includes("natal") ||
          normCity.includes("joaopessoa") ||
          normCity.includes("teresina")
        ) {
          derivedTimezone = "America/Fortaleza";
        } else if (
          normCity.includes("portoalegre") ||
          normCity.includes("curitiba") ||
          normCity.includes("florianopolis") ||
          normCity.includes("joinville") ||
          normCity.includes("blumenau")
        ) {
          derivedTimezone = "America/Sao_Paulo";
        } else if (
          normCity.includes("belohorizonte") ||
          normCity.includes("juizdefora") ||
          normCity.includes("uberlandia")
        ) {
          derivedTimezone = "America/Sao_Paulo";
        } else if (normCity.includes("brasilia")) {
          derivedTimezone = "America/Sao_Paulo";
        } else if (normCity.includes("portovelho")) {
          derivedTimezone = "America/Porto_Velho";
        } else if (normCity.includes("riobranco")) {
          derivedTimezone = "America/Rio_Branco";
        } else if (normCity.includes("boa vista") || normCity.includes("boavista")) {
          derivedTimezone = "America/Boa_Vista";
        } else if (normCity.includes("palmas") || normCity.includes("araguaina")) {
          derivedTimezone = "America/Araguaina";
        } else {
          derivedTimezone = "America/Cuiaba";
        }
      }
    }

    if (safeCountry === undefined && derivedCountry) {
      safeCountry = derivedCountry;
    }
    if (safeTimezone === undefined && derivedTimezone) {
      safeTimezone = derivedTimezone;
    }
  }

  const admin = createSupabaseAdminClient();
  const updateData: Record<string, unknown> = {};
  if (safeFullName !== undefined) updateData.full_name = safeFullName;
  if (safeRecurringLink !== undefined) updateData.recurring_class_link = safeRecurringLink;
  if (safeCity !== undefined) updateData.city = safeCity;
  if (safeState !== undefined) updateData.state = safeState;
  if (safeCountry !== undefined) updateData.country = safeCountry;
  if (safeTimezone !== undefined) updateData.timezone = safeTimezone;

  if (Object.keys(updateData).length === 0) {
    return Response.json({ ok: true, lead: null });
  }

  const { data: updated, error } = await admin
    .from("atendimento_leads")
    .update(updateData)
    .eq("id", leadId)
    .eq("assigned_user_email", "atendimento.usa.music@gmail.com")
    .select("id, full_name, recurring_class_link, city, state, country, timezone, updated_at")
    .maybeSingle();

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (!updated?.id) {
    return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  return Response.json({
    ok: true,
    lead: {
      id: String(updated.id ?? ""),
      full_name: String((updated as any).full_name ?? "").trim() || null,
      recurring_class_link: String((updated as any).recurring_class_link ?? "").trim() || null,
      city: String((updated as any).city ?? "").trim() || null,
      state: String((updated as any).state ?? "").trim() || null,
      country: String((updated as any).country ?? "").trim() || null,
      timezone: String((updated as any).timezone ?? "").trim() || null,
      updated_at: String((updated as any).updated_at ?? new Date().toISOString()),
    },
  });
}

export async function DELETE(_: Request, context: { params: Promise<{ leadId: string }> }) {
  const auth = await requireAtendimentoUser();
  if (!auth.ok) {
    return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const { leadId } = await context.params;
  const admin = createSupabaseAdminClient();

  const { data: lead, error: leadError } = await admin
    .from("atendimento_leads")
    .select("id, auth_user_id")
    .eq("id", leadId)
    .eq("assigned_user_email", "atendimento.usa.music@gmail.com")
    .maybeSingle();

  if (leadError) {
    return Response.json({ ok: false, error: leadError.message }, { status: 500 });
  }

  if (!lead?.id) {
    return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  const authUserId = String((lead as { auth_user_id?: string | null }).auth_user_id ?? "").trim();
  const [{ data: conversations, error: conversationsError }, profileResult] = await Promise.all([
    admin
      .from("atendimento_conversations")
      .select("id")
      .eq("lead_id", leadId),
    authUserId
      ? admin
          .from("profiles")
          .select("access_scope")
          .eq("user_id", authUserId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (conversationsError) {
    return Response.json({ ok: false, error: conversationsError.message }, { status: 500 });
  }

  if (profileResult.error) {
    return Response.json({ ok: false, error: profileResult.error.message }, { status: 500 });
  }

  const conversationIds = (conversations ?? [])
    .map((row) => String((row as { id?: string | null }).id ?? "").trim())
    .filter(Boolean);

  const deleteMessagesPromise =
    conversationIds.length > 0
      ? admin
          .from("atendimento_messages")
          .delete()
          .in("conversation_id", conversationIds)
      : Promise.resolve({ error: null });
  const [messagesResult, eventsResult, capturedFieldsResult] = await Promise.all([
    deleteMessagesPromise,
    admin.from("atendimento_history_events").delete().eq("lead_id", leadId),
    admin.from("atendimento_captured_fields").delete().eq("lead_id", leadId),
  ]);

  if (messagesResult.error) {
    return Response.json({ ok: false, error: messagesResult.error.message }, { status: 500 });
  }

  const { error: eventsError } = eventsResult;
  if (eventsError) {
    return Response.json({ ok: false, error: eventsError.message }, { status: 500 });
  }

  const { error: capturedFieldsError } = capturedFieldsResult;
  if (capturedFieldsError) {
    return Response.json({ ok: false, error: capturedFieldsError.message }, { status: 500 });
  }

  {
    const bookingsDelete = await admin
      .from("atendimento_experimental_class_bookings")
      .delete()
      .eq("lead_id", leadId);
    if (bookingsDelete.error && !isExperimentalClassBookingsTableUnavailable(bookingsDelete.error)) {
      return Response.json({ ok: false, error: bookingsDelete.error.message }, { status: 500 });
    }
  }

  const { error: conversationsDeleteError } = await admin
    .from("atendimento_conversations")
    .delete()
    .eq("lead_id", leadId);
  if (conversationsDeleteError) {
    return Response.json({ ok: false, error: conversationsDeleteError.message }, { status: 500 });
  }

  const { error: leadDeleteError } = await admin.from("atendimento_leads").delete().eq("id", leadId);
  if (leadDeleteError) {
    return Response.json({ ok: false, error: leadDeleteError.message }, { status: 500 });
  }

  if (
    authUserId &&
    isAtendimentoOnlyAccessScope(normalizeAccessScope((profileResult.data as any)?.access_scope))
  ) {
    const { error: deleteAuthUserError } = await admin.auth.admin.deleteUser(authUserId);
    if (deleteAuthUserError) {
      return Response.json({ ok: false, error: deleteAuthUserError.message }, { status: 500 });
    }
  }

  return Response.json({ ok: true });
}
