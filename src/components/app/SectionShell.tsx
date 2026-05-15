import Link from "next/link";

export function SectionShell({
  eyebrow,
  title,
  description,
  ctaLabel,
  ctaHref,
}: {
  eyebrow: string;
  title: string;
  description: string;
  ctaLabel: string;
  ctaHref: string;
}) {
  return (
    <div>
      <div className="text-xs font-semibold tracking-[0.2em] text-white/45">
        {eyebrow}
      </div>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">
        {title}
      </h1>
      <div className="mt-2 max-w-2xl text-sm leading-relaxed text-white/60">
        {description}
      </div>

      <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <div className="text-sm font-semibold">Nada por aqui ainda</div>
        <div className="mt-2 text-sm text-white/60">
          Esta tela já está pronta no layout. O próximo passo é ligar no Supabase
          (tabelas + RLS por user_id) e plugar os componentes de CRUD e
          relatórios.
        </div>
        <div className="mt-4">
          <Link
            href={ctaHref}
            className="inline-flex items-center justify-center rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-white/90"
          >
            {ctaLabel}
          </Link>
        </div>
      </div>
    </div>
  );
}

