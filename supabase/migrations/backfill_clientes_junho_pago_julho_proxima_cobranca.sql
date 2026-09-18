update public.debtor_charges
set
  recurrence_month = 7,
  recurrence_year = 2026
where recurrence_month = 6
  and recurrence_year = 2026
  and id in (
    '8f8bdd41-c619-4914-84f5-9a6998e59917',
    'b6e5eb9e-7d3f-4ea3-8243-b53b32e2ec10',
    '443861c2-b4ac-4313-bf5d-1b1f14f03a3d',
    '634452ee-fc89-4670-8984-66318a347268',
    'fad34ef8-6131-42d6-94eb-7d79f8aa8ea5',
    '77b10331-42f9-4b5d-9397-91596bf3c8a4',
    'a6667314-897d-4ca6-91a4-cface963fb84',
    '5a9feec0-a550-45b5-ae59-5a28a42fb773'
  );
