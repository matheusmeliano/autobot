alter table if exists profiles alter column timezone drop default;

update profiles
set timezone = null
where timezone is not null;
