alter table if exists public.profiles add column if not exists theme text;

alter table if exists public.profiles
  drop constraint if exists profiles_theme_check;

alter table if exists public.profiles
  add constraint profiles_theme_check
  check (theme in ('light', 'dark') or theme is null);

