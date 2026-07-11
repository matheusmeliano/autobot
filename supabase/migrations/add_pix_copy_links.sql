create table if not exists public.pix_copy_links (
  token text primary key,
  pix_key text not null,
  debtor_name text,
  amount text,
  user_id uuid,
  debtor_id uuid,
  schedule_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_pix_copy_links_created_at
  on public.pix_copy_links(created_at desc);

create index if not exists idx_pix_copy_links_schedule_id
  on public.pix_copy_links(schedule_id);

alter table public.pix_copy_links enable row level security;

drop policy if exists pix_copy_links_authenticated_read on public.pix_copy_links;
create policy pix_copy_links_authenticated_read
  on public.pix_copy_links
  for select
  to authenticated
  using (true);
