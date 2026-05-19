"use client";

import { useMemo, useState, useTransition } from "react";
import { modalToast } from "@/lib/modalToast";
import { BRAZIL_TIMEZONES, type BrazilTimeZone } from "@/lib/timezone";
import { updateTimezoneAction } from "@/app/app/configuracoes/actions";

function labelForTimeZone(tz: BrazilTimeZone) {
  if (tz === "America/Sao_Paulo") return "Brasília (GMT-3)";
  if (tz === "America/Cuiaba") return "Cuiabá (GMT-4)";
  if (tz === "America/Manaus") return "Manaus (GMT-4)";
  if (tz === "America/Rio_Branco") return "Rio Branco (GMT-5)";
  if (tz === "America/Noronha") return "Fernando de Noronha (GMT-2)";
  return tz;
}

export function TimezoneSettings({ initialTimeZone }: { initialTimeZone: BrazilTimeZone }) {
  const [isPending, startTransition] = useTransition();
  const [timeZone, setTimeZone] = useState<BrazilTimeZone>(initialTimeZone);

  const options = useMemo(
    () =>
      BRAZIL_TIMEZONES.map((tz) => ({
        tz,
        label: labelForTimeZone(tz),
      })),
    [],
  );

  const save = () => {
    startTransition(async () => {
      const res = await updateTimezoneAction({ timezone: timeZone });
      if (!res.ok) {
        modalToast.error(res.error ?? "Falha ao salvar.");
        return;
      }
      modalToast.success("Fuso horário atualizado.");
    });
  };

  return (
    <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="text-sm font-semibold">Fuso horário</div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <select
          value={timeZone}
          onChange={(e) => setTimeZone(e.target.value as BrazilTimeZone)}
          className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white outline-none focus:border-white/20 [color-scheme:dark] [&>option]:bg-[#070A10] [&>option]:text-white"
        >
          {options.map((o) => (
            <option key={o.tz} value={o.tz}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={save}
          disabled={isPending}
          className="inline-flex w-full items-center justify-center rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black hover:bg-white/90 disabled:opacity-60"
        >
          Salvar
        </button>
      </div>
    </div>
  );
}

