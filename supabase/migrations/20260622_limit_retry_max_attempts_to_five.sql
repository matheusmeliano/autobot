update public.debtors
set retry_max_attempts = 5
where retry_max_attempts > 5;
