delete from whatsapp_instances wi
where wi.id not in (
  select distinct on (user_id) id
  from whatsapp_instances
  order by user_id, created_at desc, id desc
);

create unique index if not exists uniq_whatsapp_instances_user_id
  on whatsapp_instances(user_id);
