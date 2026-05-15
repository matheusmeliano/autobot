export function supabaseErrorToPt(message: string) {
  const raw = message ?? "";
  const m = raw.toLowerCase();

  if (m.includes("rate limit")) {
    return "Limite de emails atingido. Aguarde alguns minutos.";
  }

  if (m.includes("otp_expired") || m.includes("otp expired")) {
    return "O link expirou ou já foi usado. Solicite um novo link.";
  }

  if (m.includes("email link is invalid") || (m.includes("email link") && m.includes("expired"))) {
    return "O link é inválido ou expirou. Solicite um novo link.";
  }

  if (m.includes("invalid login credentials")) {
    return "Email ou senha incorretos.";
  }

  if (m.includes("user already registered")) {
    return "Este email já está cadastrado.";
  }

  if (m.includes("email not confirmed")) {
    return "Confirme seu email antes de entrar.";
  }

  if (m.includes("password should be at least") || m.includes("password") && m.includes("at least")) {
    return "A senha não atende aos requisitos mínimos.";
  }

  return raw;
}
