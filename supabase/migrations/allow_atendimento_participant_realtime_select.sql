begin;

drop policy if exists atendimento_leads_participant_select_own on public.atendimento_leads;
create policy atendimento_leads_participant_select_own
  on public.atendimento_leads
  for select
  to authenticated
  using (auth.uid() = auth_user_id);

drop policy if exists atendimento_conversations_participant_select_own on public.atendimento_conversations;
create policy atendimento_conversations_participant_select_own
  on public.atendimento_conversations
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.atendimento_leads lead
      where lead.id = atendimento_conversations.lead_id
        and lead.auth_user_id = auth.uid()
    )
  );

drop policy if exists atendimento_messages_participant_select_own on public.atendimento_messages;
create policy atendimento_messages_participant_select_own
  on public.atendimento_messages
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.atendimento_conversations conversation
      join public.atendimento_leads lead on lead.id = conversation.lead_id
      where conversation.id = atendimento_messages.conversation_id
        and lead.auth_user_id = auth.uid()
    )
  );

commit;
