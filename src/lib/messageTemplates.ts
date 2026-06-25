const MESSAGE_TEMPLATES_PAGE_SIZE = 200;

const MESSAGE_TEMPLATES_SELECT = "id, nome, conteudo, created_at";

type MessageTemplatesResult<T> = {
  data: T[] | null;
  error: { message?: string | null } | null;
};

export async function listAllMessageTemplates(supabase: any): Promise<MessageTemplatesResult<any>> {
  const rows: any[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("message_templates")
      .select(MESSAGE_TEMPLATES_SELECT)
      .order("created_at", { ascending: false })
      .range(offset, offset + MESSAGE_TEMPLATES_PAGE_SIZE - 1);

    if (error) return { data: null, error };

    const pageRows = data ?? [];
    rows.push(...pageRows);

    if (pageRows.length < MESSAGE_TEMPLATES_PAGE_SIZE) break;
    offset += MESSAGE_TEMPLATES_PAGE_SIZE;
  }

  return { data: rows, error: null };
}
