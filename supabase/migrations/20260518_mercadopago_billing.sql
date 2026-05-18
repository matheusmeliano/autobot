alter table subscriptions
  add column if not exists provider text,
  add column if not exists provider_plan_id text,
  add column if not exists provider_subscription_id text,
  add column if not exists provider_status text,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_subscriptions_provider_subscription_id
  on subscriptions(provider_subscription_id);

create table if not exists billing_plans (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  slug text not null,
  provider_plan_id text not null,
  amount_cents int not null,
  currency text not null default 'BRL',
  interval text not null default 'month',
  interval_count int not null default 1,
  created_at timestamptz not null default now()
);

create unique index if not exists uniq_billing_plans_provider_slug
  on billing_plans(provider, slug);

alter table billing_plans enable row level security;

create table if not exists billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  plan_slug text not null,
  provider_plan_id text not null,
  provider_subscription_id text not null,
  status text not null default 'created',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uniq_billing_subscriptions_provider_subscription_id
  on billing_subscriptions(provider, provider_subscription_id);

create index if not exists idx_billing_subscriptions_user_id
  on billing_subscriptions(user_id);

alter table billing_subscriptions enable row level security;

create table if not exists billing_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  event_type text,
  payload jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists uniq_billing_events_provider_event_id
  on billing_events(provider, event_id);

alter table billing_events enable row level security;
