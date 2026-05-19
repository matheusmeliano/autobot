alter table if exists profiles alter column timezone drop default;

alter table if exists profiles alter column timezone drop not null;

update profiles
set timezone = null
where timezone is not null;
