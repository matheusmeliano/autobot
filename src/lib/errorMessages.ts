const EXACT: Array<[string, string]> = [
  ["unsupported_file_type", "Tipo de arquivo não permitido."],
  ["upload_auth_missing", "Não foi possível autenticar o envio. Atualize a página e tente novamente."],
  ["upload_failed", "Não foi possível enviar o arquivo. Tente novamente."],
  ["unauthorized", "Acesso negado. Faça login novamente."],
  ["forbidden", "Acesso proibido. Você não tem permissão para realizar essa ação."],
  ["bucket not found", "Erro no armazenamento. Contate o suporte."],
  ["Missing Supabase credentials", "Configuração do Supabase ausente. Verifique as variáveis de ambiente."],
  ["Missing Supabase service role credentials", "Configuração de admin do Supabase ausente. Contate o suporte."],
  ["useAppTheme must be used within AppThemeProvider", "Erro interno de tema. Atualize a página."],
  ["An unexpected response was received from the server.", "Resposta inesperada do servidor. Atualize a página e tente novamente."],
  ["Failed to fetch", "Sem conexão com a internet. Verifique sua rede e tente novamente."],
  ["NetworkError when attempting to fetch resource.", "Erro de rede. Verifique sua conexão e tente novamente."],
  ["Network Error", "Erro de rede. Verifique sua conexão e tente novamente."],
  ["Load failed", "Não foi possível carregar os dados. Verifique sua conexão."],
  ["Data inválida", "Data inválida. Verifique o campo e tente novamente."],
  ["Data/hora inválida", "Data e hora inválidas. Verifique o campo e tente novamente."],
  ["File too large", "Arquivo muito grande. Tente um arquivo menor."],
  ["File is too large", "Arquivo muito grande. Tamanho máximo permitido: 5 MB."],
  ["Invalid file type", "Tipo de arquivo não permitido."],
  ["Invalid file", "Arquivo inválido."],
  ["Request failed with status code 413", "Arquivo muito grande. O servidor rejeitou o envio."],
  ["Request failed with status code 400", "Requisição inválida. Verifique os dados e tente novamente."],
  ["Request failed with status code 401", "Sua sessão expirou. Faça login novamente."],
  ["Request failed with status code 403", "Você não tem permissão para essa ação."],
  ["Request failed with status code 404", "Recurso não encontrado."],
  ["Request failed with status code 413", "Arquivo muito grande. O servidor rejeitou o envio."],
  ["Request failed with status code 422", "Dados inválidos. Verifique os campos e tente novamente."],
  ["Request failed with status code 429", "Muitas tentativas. Aguarde um momento e tente novamente."],
  ["Request failed with status code 500", "Erro interno do servidor. Tente novamente mais tarde."],
  ["Request failed with status code 502", "Servidor fora do ar temporariamente. Tente novamente."],
  ["Request failed with status code 503", "Servidor indisponível. Tente novamente mais tarde."],
  ["Request failed with status code 504", "O servidor demorou muito para responder. Tente novamente."],
  ["Internal Server Error", "Erro interno do servidor. Tente novamente mais tarde."],
  ["Server Error", "Erro do servidor. Tente novamente mais tarde."],
  ["Bad Gateway", "Conexão com o servidor falhou. Tente novamente."],
  ["Service Unavailable", "Serviço indisponível. Tente novamente mais tarde."],
  ["Gateway Timeout", "O servidor demorou muito para responder. Tente novamente."],
  ["Not Found", "Página ou recurso não encontrado."],
  ["Unauthorized", "Acesso negado. Faça login novamente."],
  ["Forbidden", "Acesso proibido. Você não tem permissão para essa ação."],
  ["Too Many Requests", "Muitas tentativas. Aguarde um momento e tente novamente."],
  ["Client-Token não configurado no WhatsApp.", "Token do WhatsApp não configurado. Contate o suporte."],
  ["WhatsApp do atendimento não configurado.", "WhatsApp do atendimento não configurado. Contate o suporte."],
];

const CONTAINS: Array<[string, string]> = [
  ["an unexpected response was received from the server", "Resposta inesperada do servidor. Atualize a página e tente novamente."],
  ["an error occurred in the server", "Ocorreu um erro no servidor. Tente novamente em instantes."],
  ["application error", "Erro no aplicativo. Atualize a página e tente novamente."],
  ["client-side exception", "Erro na página. Atualize e tente novamente."],
  ["timeout", "A operação demorou muito. Tente novamente."],
  ["timed out", "A operação demorou muito. Tente novamente."],
  ["aborted", "A operação foi cancelada. Tente novamente."],
  ["abort", "A operação foi cancelada. Tente novamente."],
  ["network error", "Erro de rede. Verifique sua conexão e tente novamente."],
  ["failed to fetch", "Não foi possível conectar ao servidor. Verifique sua internet e tente novamente."],
  ["load failed", "Não foi possível carregar os dados. Verifique sua conexão."],
  ["enospc", "Espaço em disco insuficiente."],
  ["out of memory", "Memória insuficiente. Feche outras abas e tente novamente."],
  ["quota", "Limite de armazenamento atingido."],
  ["permission denied", "Permissão negada."],
  ["access denied", "Acesso negado."],
  ["invalid token", "Sua sessão expirou. Faça login novamente."],
  ["jwt expired", "Sua sessão expirou. Faça login novamente."],
  ["token expired", "Sua sessão expirou. Faça login novamente."],
  ["unexpected token", "Erro ao processar dados. Atualize a página."],
  ["json parse error", "Erro ao processar dados. Atualize a página."],
  ["undefined is not", "Erro interno. Atualize a página e tente novamente."],
  ["null is not", "Erro interno. Atualize a página e tente novamente."],
  ["cannot read properties", "Erro interno. Atualize a página e tente novamente."],
  ["bucket not found", "Erro no armazenamento. Contate o suporte."],
  ["file too large", "Arquivo muito grande. Tente um arquivo menor."],
  ["file is too large", "Arquivo muito grande. Tamanho máximo permitido: 5 MB."],
  ["exceeds the maximum", "Arquivo muito grande. O tamanho excede o limite permitido."],
  ["maximum file size", "Arquivo muito grande. Verifique o limite de tamanho."],
  ["invalid file type", "Tipo de arquivo não permitido."],
  ["unsupported file", "Tipo de arquivo não suportado."],
  ["mime", "Tipo de arquivo não permitido."],
  ["file extension", "Extensão de arquivo não permitida."],
  ["upload", "Não foi possível concluir o envio. Tente novamente."],
  ["storage", "Erro no armazenamento. Tente novamente em instantes."],
  ["supabase", "Erro ao conectar com o banco. Tente novamente."],
  ["database", "Erro no banco de dados. Tente novamente."],
  ["internal error", "Erro interno. Tente novamente mais tarde."],
  ["server error", "Erro no servidor. Tente novamente mais tarde."],
  ["image", "Não foi possível processar a imagem. Tente um arquivo diferente."],
  ["arquivo", "Não foi possível processar o arquivo. Tente novamente."],
];

const DEFAULT_FALLBACK =
  "Ocorreu um problema ao processar sua solicitação. Atualize a página e tente novamente.";

export function translateErrorMessage(input: unknown): string {
  if (input == null) return DEFAULT_FALLBACK;
  let raw: string;
  if (typeof input === "string") raw = input;
  else if (input instanceof Error) raw = String(input.message ?? "");
  else raw = String(input);
  raw = raw.trim();
  if (!raw) return DEFAULT_FALLBACK;

  const exactTrim = raw;
  const exactLower = exactTrim.toLowerCase();

  for (const [from, to] of EXACT) {
    if (from.toLowerCase() === exactLower) return to;
  }

  for (const [from, to] of CONTAINS) {
    if (exactLower.includes(from)) return to;
  }

  if (/^status\s+code\s*\d{3}.*$/i.test(raw)) {
    return "Erro de comunicação com o servidor. Tente novamente.";
  }
  if (/^https?:\/\//i.test(raw)) {
    return DEFAULT_FALLBACK;
  }

  return raw;
}

export function translateErrorToHuman(input: unknown) {
  const message = translateErrorMessage(input);
  return {
    message,
    isTranslated:
      !(typeof input === "string" && input.trim() === message.trim()) &&
      !(input instanceof Error && String(input.message ?? "").trim() === message.trim()),
  };
}

export { DEFAULT_FALLBACK };
