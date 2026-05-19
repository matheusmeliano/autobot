"use client";

import { useMemo, useState, useTransition } from "react";
import { modalToast } from "@/lib/modalToast";
import { BRAZIL_TIMEZONES, type BrazilTimeZone } from "@/lib/timezone";
import { updateTimezoneAction } from "@/app/app/configuracoes/actions";

function labelForTimeZone(tz: BrazilTimeZone) {
  if (tz === "America/Noronha") return "Fernando de Noronha (GMT-2)";
  if (tz === "America/Sao_Paulo") return "Brasília (GMT-3)";
  if (tz === "America/Araguaina") return "Araguaína (GMT-3)";
  if (tz === "America/Bahia") return "Salvador (GMT-3)";
  if (tz === "America/Belem") return "Belém (GMT-3)";
  if (tz === "America/Fortaleza") return "Fortaleza (GMT-3)";
  if (tz === "America/Maceio") return "Maceió (GMT-3)";
  if (tz === "America/Recife") return "Recife (GMT-3)";
  if (tz === "America/Santarem") return "Santarém (GMT-3)";
  if (tz === "America/Boa_Vista") return "Boa Vista (GMT-4)";
  if (tz === "America/Campo_Grande") return "Campo Grande (GMT-4)";
  if (tz === "America/Cuiaba") return "Cuiabá (GMT-4)";
  if (tz === "America/Porto_Velho") return "Porto Velho (GMT-4)";
  if (tz === "America/Manaus") return "Manaus (GMT-4)";
  if (tz === "America/Eirunepe") return "Eirunepé (GMT-5)";
  if (tz === "America/Rio_Branco") return "Rio Branco (GMT-5)";
  return tz;
}

export function TimezoneSettings({
  initialTimeZone,
}: {
  initialTimeZone: BrazilTimeZone | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [timeZone, setTimeZone] = useState<BrazilTimeZone | "">(initialTimeZone ?? "");

  const options = useMemo(
    () =>
      BRAZIL_TIMEZONES.map((tz) => ({
        tz,
        label: labelForTimeZone(tz),
      })),
    [],
  );

  const save = () => {
    if (!timeZone) {
      modalToast.error("Selecione seu fuso horário para continuar.");
      return;
    }
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
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-white/90">Fuso horário</div>
          <div className="mt-1 text-xs text-white/55">
            Usado para validar e exibir datas/horários dos agendamentos.
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center">
        <select
          value={timeZone}
          onChange={(e) => {
            const v = e.target.value;
            setTimeZone(v ? (v as BrazilTimeZone) : "");
          }}
          className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 text-sm text-white outline-none focus:border-white/20 focus:ring-2 focus:ring-white/10 [color-scheme:dark] [&>option]:bg-[#070A10] [&>option]:text-white"
        >
          <option value="">Selecione seu fuso horário</option>
          {options.map((o) => (
            <option key={o.tz} value={o.tz}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={save}
          disabled={isPending || !timeZone}
          className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-white px-6 text-sm font-semibold text-black hover:bg-white/90 disabled:opacity-60 md:w-auto"
        >
          Salvar
        </button>
      </div>
    </div>
  );
}
