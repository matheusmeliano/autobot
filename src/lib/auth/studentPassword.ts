export function buildStudentAuthPassword(rawPassword: string | null | undefined): string {
  const trimmed = String(rawPassword ?? "").trim();
  if (!trimmed) return "";
  return trimmed.length >= 6 ? trimmed : `aluno::${trimmed}`;
}
