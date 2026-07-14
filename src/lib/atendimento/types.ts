import type { CAPTURED_FIELD_ORDER, ATENDIMENTO_STAGE_ORDER, ATENDIMENTO_STATUS_ORDER } from "./constants.ts";

export type AtendimentoStage = (typeof ATENDIMENTO_STAGE_ORDER)[number];
export type AtendimentoStatus = (typeof ATENDIMENTO_STATUS_ORDER)[number];
export type CapturedFieldName = (typeof CAPTURED_FIELD_ORDER)[number];

export type AtendimentoLead = {
  id: string;
  full_name: string | null;
  phone: string | null;
  cpf: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  timezone: string | null;
  best_contact_time: string | null;
  origin: string;
  status: AtendimentoStatus;
  funnel_stage: AtendimentoStage;
  assigned_user_email: string;
  created_at: string;
  updated_at: string;
  last_interaction_at: string | null;
  unread_count: number;
  is_new_for_attendant: boolean;
};

export type AtendimentoConversation = {
  id: string;
  lead_id: string;
  public_link_id: string | null;
  channel: string;
  public_slug: string;
  bot_enabled: boolean;
  last_message_preview: string | null;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AtendimentoMessage = {
  id: string;
  conversation_id: string;
  sender_role: "lead" | "bot" | "attendant" | "system";
  content_text: string | null;
  media_type: "text" | "audio" | "image" | "video" | "document" | "file";
  media_url: string | null;
  mime_type: string | null;
  file_name: string | null;
  file_size_bytes: number | null;
  external_message_id: string | null;
  status: "enviada" | "entregue" | "lida" | "recebida";
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  created_at: string;
};

export type AtendimentoFileRecord = {
  id: string;
  lead_id: string;
  conversation_id: string;
  sender_role: AtendimentoMessage["sender_role"];
  content_text: string | null;
  media_type: AtendimentoMessage["media_type"];
  media_url: string;
  mime_type: string | null;
  file_name: string | null;
  file_size_bytes: number | null;
  created_at: string;
};

export type AtendimentoHistoryEvent = {
  id: string;
  lead_id: string;
  conversation_id: string | null;
  event_type: string;
  title: string;
  details: Record<string, unknown> | null;
  actor_type: "bot" | "lead" | "attendant" | "system";
  actor_email: string | null;
  created_at: string;
};

export type AtendimentoExperimentalClassBookingSummary = {
  id: string;
  status: string | null;
  lesson_link: string | null;
  professor_timezone: string | null;
  lead_timezone: string | null;
  professor_date: string | null;
  professor_time: string | null;
  professor_start_at: string | null;
  lead_date: string | null;
  lead_time: string | null;
  lead_start_at: string | null;
  source: "table" | "history";
  created_at: string | null;
};

export type AtendimentoLeadListItem = AtendimentoLead & {
  conversation: AtendimentoConversation | null;
  last_message: AtendimentoMessage | null;
  experimental_class_booking: AtendimentoExperimentalClassBookingSummary | null;
};

export type AtendimentoSummary = {
  totalLeads: number;
  novosLeads: number;
  emAtendimento: number;
  aulasExperimentaisAgendadas: number;
  matriculasPendentes: number;
  matriculados: number;
  conversasNaoLidas: number;
};
