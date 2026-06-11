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
      <div className="text-xs font-semibold tracking-[0.2em] text-[var(--app-text-45)]">
        {eyebrow}
      </div>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">
        {title}
      </h1>
      <div className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--app-text-60)]">
        {description}
      </div>

      <div className="mt-8 rounded-2xl border border-[var(--app-border)] bg-[var(--app-card-2)] p-6">
        <div className="text-sm font-semibold">Nada por aqui ainda</div>
        <div className="mt-2 text-sm text-[var(--app-text-60)]">
          Esta tela já está pronta no layout. O próximo passo é ligar no Supabase
          (tabelas + RLS por user_id) e plugar os componentes de CRUD e
          relatórios.
        </div>
        <div className="mt-4">
          <Link
            href={ctaHref}
            className="inline-flex items-center justify-center rounded-xl bg-[var(--app-btn-primary-bg)] px-4 py-2 text-sm font-semibold text-[var(--app-btn-primary-fg)] hover:bg-[var(--app-btn-primary-bg-hover)]"
          >
            {ctaLabel}
          </Link>
        </div>
      </div>
    </div>
  );
}
