# Foto de Perfil / Avatar Upload Implementation Plan

## Repository Research

### 1. Banco de Dados Supabase — PERFEITO (coluna já existe!)

- **Tabela `public.profiles`** criada em [`20260514_saas_schema.sql`](file:///c:/Users/mathe/Downloads/Projetos/AutoBot/supabase/migrations/20260514_saas_schema.sql#L1-L9):
  - Já tem **`avatar_url text NULL`** na linha 7, desde o schema inicial.
  - **NÃO precisa migration ALTER TABLE** para adicionar coluna.
  - RLS policies já existentes (`profiles_update_own` etc) permitem usuário autenticado atualizar SEU próprio avatar_url (confirma usando `user_id = auth.uid()`).

- **Falta SÓ:** Storage bucket novo + RLS policies de storage (não tabela nova).

### 2. Renderização atual do Avatar (AppShell.tsx) — NÃO usa avatar_url ainda

- **Localização do fetch do profile:** [`AppShell.tsx:188-189`](file:///c:/Users/mathe/Downloads/Projetos/AutoBot/src/components/app/AppShell.tsx#L188-L189)
  ```
  supabase.from("profiles").select("plano, theme, nome, access_scope").maybeSingle()
  ```
  **→ Falta `avatar_url` no SELECT!** Depois precisa guardar em state.

- **Locais onde o avatar é renderizado (2 locais, sidebar e drawer mobile):**
  1. **Sidebar desktop (≥1201px):** [`AppShell.tsx:536-550`](file:///c:/Users/mathe/Downloads/Projetos/AutoBot/src/components/app/AppShell.tsx#L536-L550)
     - Atual lógica: `if isUSDCurrencyEmail(email) → logo USA 12x12` SENÃO → `avatarLabel` (1a letra do nome)
     - **Nova lógica:** `if (avatarUrl) → <img src={avatarUrl}>` PRIORIDADE 1; SENÃO mantém logo USA ou fallback letra.
     - **Precisa virar `<button type="button">` clicável, abre modal.** Apenas para email USA também pode permitir trocar? Sim, porque o usuário USA (atendimento) também pode querer foto de perfil. O avatar de logo USA é só o fallback atual; se ele setar avatar_url próprio, mostra o avatar.

  2. **Drawer mobile hambúrguer (<1201px):** [`AppShell.tsx:707-731`](file:///c:/Users/mathe/Downloads/Projetos/AutoBot/src/components/app/AppShell.tsx#L707-L731)
     - Mesma lógica da sidebar.

### 3. Arquitetura Upload existente (padrão a reaproveitar)

- **Atendimento já tem upload Supabase Storage via browser:** [`upload-client.ts`](file:///c:/Users/mathe/Downloads/Projetos/AutoBot/src/lib/atendimento/upload-client.ts#L1-L83)
  - Usa XMLHttpRequest nativo com headers `Authorization: Bearer session.access_token` e `apikey NEXT_PUBLIC_ANON_KEY`
  - Mostra progresso via `xhr.upload.onprogress`
  - Depois pega public URL via `storage.from(BUCKET).getPublicUrl(path)`

- **Cria bucket automaticamente (server side):** `lib/atendimento/server.ts L3140-3146` — tenta listar buckets; se não encontrar cria via `admin.storage.createBucket(bucket, {public: true, fileSizeLimit: 5242880})`. Podemos fazer igual no server action de upload (auto-criar bucket se não existir).

- **Ações Server Action existentes (padrão a seguir):** [`configuracoes/actions.ts`](file:///c:/Users/mathe/Downloads/Projetos/AutoBot/src/app/app/configuracoes/actions.ts)
  - Padrão unificado: `"use server"` + Zod schema + `createSupabaseServerClient()` + `supabase.auth.getUser()` → `supabase.from("profiles").upsert({ user_id }) onConflict user_id`
  - **Vamos adicionar 3 novas Server Actions NO MESMO arquivo** (ou separado? Mesmo arquivo para manter consistência):
    1. `uploadProfileAvatarAction(formData: FormData)` — recebe arquivo, valida, upload, retorna `{ok: true, publicUrl, path}`
    2. `deleteProfileAvatarAction()` — remove arquivo do storage + seta `avatar_url = NULL` no profile
    3. *(opcional, não precisa)* `updateProfileAvatarAction(url)` — salva só o URL no banco (será chamado dentro de upload/delete actions internamente)

### 4. UI Modal existente

- **Componente `AppModal`** já usado no projeto (TemplatesClient, Novo cliente etc). Podemos reutilizar ele para abrir o popup de trocar foto quando clicar no avatar.

## Arquivos e Módulos a alterar

1. **Novo arquivo migration SQL** — `supabase/migrations/20260918_create_profile_avatars_storage_bucket.sql`
   - Cria bucket `profile_avatars` (público, file size limit 5MB) e RLS policies só permitem auth user subir/remover SEU path `auth.uid()/arquivo.ext`.

2. **`src/app/app/configuracoes/actions.ts`** — Adicionar 2 Server Actions:
   - `uploadProfileAvatarAction(formData: FormData)` — valida imagem (mime image/*, ≤5MB), auto-cria bucket se não existir usando service role admin client, deleta arquivo antigo se existir, faz upload, atualiza `profiles.avatar_url` no banco, retorna novo publicUrl.
   - `deleteProfileAvatarAction()` — deleta arquivo do storage + seta `avatar_url = NULL` no profile, retorna ok.

3. **`src/components/app/AppShell.tsx`** — 4 alterações:
   a. **Fetch:** Adicionar `avatar_url` no SELECT do profile + state `avatarUrl` + setter.
   b. **Componente novo:** `<AvatarEditButton />` ou wrapper inline → renderiza avatar img/letra/logo USA e é `<button type="button">` que `onClick → setAvatarModalOpen(true)`.
   c. **Adicionar modal AppModal `AvatarChangeModal` importado inline ou em arquivo separado:** Preview atual + input file (accept image/*) + label botão escolher arquivo + barra progresso + botão remover foto (se houver) + estados loading/sucesso/erro. Faz call server actions e depois atualiza state `avatarUrl` local + router.refresh? Ou seta direto para não precisar reload.
   d. **Trocar os 2 blocos atuais de avatar (sidebar + drawer mobile) por wrapper clicável:** `if avatarUrl → img src=avatarUrl rounded-full object-cover`.

4. **(Opcional, pode ficar dentro AppShell) Novo arquivo pequeno** `AvatarChangeModal.tsx` em `src/components/app/` → separa o modal do AppShell para não deixar arquivo 2x maior. Preferível separar.

## Implementation Steps (ordem de dependência)

### Passo 1 — Migration Storage (primeiro, banco)

Criar `supabase/migrations/20260918_create_profile_avatars_storage_bucket.sql`:
```sql
-- Bucket profile_avatars (via storage.buckets insert pois createBucket é RPC admin,
-- migration faz via SQL direto no schema storage para garantir em qualquer ambiente)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'profile_avatars',
  'profile_avatars',
  true,
  5242880,  -- 5 MB exato
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml']
)
ON CONFLICT (id) DO NOTHING;

-- RLS no storage.objects
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Apagar policies antigas se existir
DROP POLICY IF EXISTS "profile_avatars_select_auth_public" ON storage.objects;
DROP POLICY IF EXISTS "profile_avatars_upload_own" ON storage.objects;
DROP POLICY IF EXISTS "profile_avatars_update_own" ON storage.objects;
DROP POLICY IF EXISTS "profile_avatars_delete_own" ON storage.objects;

-- SELECT: qualquer pessoa (public) pode ver avatares pois o bucket é público
CREATE POLICY "profile_avatars_select_auth_public" ON storage.objects
FOR SELECT TO public
USING (bucket_id = 'profile_avatars');

-- INSERT: só authenticated, path COMEÇA COM auth.uid()/, tamanho <= 5MB, mime imagem
CREATE POLICY "profile_avatars_upload_own" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'profile_avatars' AND
  (storage.foldername(name))[1] = auth.uid()::text AND
  LOWER(RIGHT(name, 4)) IN ('.jpg','jpeg','.png','.webp','.gif','.svg')
);

-- UPDATE: mesmo dono
CREATE POLICY "profile_avatars_update_own" ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'profile_avatars' AND
  (storage.foldername(name))[1] = auth.uid()::text
);

-- DELETE: mesmo dono
CREATE POLICY "profile_avatars_delete_own" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'profile_avatars' AND
  (storage.foldername(name))[1] = auth.uid()::text
);
```

Depois executar migration remota via `supabase_apply_migration` tool.

### Passo 2 — Server Actions (configuracoes/actions.ts)

Adicionar import `createSupabaseAdminClient` se existir (para criar bucket em runtime se migration não rodou em todos ambientes), `zod`, etc.

2.1. **`uploadProfileAvatarAction(formData: FormData)`:**
- Pegar arquivo do form `const file = formData.get("avatar") as File`.
- Validações client-side + server-side:
  - `file instanceof File` → erro `Nenhum arquivo selecionado.`
  - `file.size <= 5 * 1024 * 1024` (5242880 bytes) → erro `Arquivo muito grande. Tamanho máximo permitido: 5MB.`
  - `file.type.startsWith("image/")` E `file.type` está em allow list (jpeg, png, webp, gif, svg+xml) → erro `Tipo de arquivo não permitido. Use uma imagem (JPG, PNG, WEBP ou GIF).`
- `createSupabaseServerClient()` → `supabase.auth.getUser()` → `userId`.
- (Safe try) Tentar criar bucket via `admin.storage.createBucket('profile_avatars', {public: true, fileSizeLimit: 5242880, allowedMimeTypes: [...]})` → não throw se já existir.
- Gerar storage path: `${userId}/avatar-${Date.now()}-${cryptoRandomHex(6)}.${getExtFromMime(file.type)}`. Ex: `550e8400-e29b-41d4-a716-446655440000/avatar-1763491456-4f8c2e.png`
- (Se o usuário já tinha avatar_url antigo, extrair o path do storage do public URL antigo → chamar `storage.from('profile_avatars').remove([oldPath])` ANTES de subir o novo, pra não acumular lixo).
- `storage.from('profile_avatars').upload(path, file, { contentType: file.type, upsert: false, cacheControl: '3600' })`
- Pegar `const { data } = getPublicUrl(path)` → novo URL.
- `profiles.upsert({ user_id: userId, avatar_url: data.publicUrl }, { onConflict: user_id })`
- Retornar `{ ok: true, newUrl: data.publicUrl }`.

2.2. **`deleteProfileAvatarAction()`:**
- `createSupabaseServerClient()` → userId.
- Buscar profile atual: `select avatar_url from profiles where user_id = userId`.
- Se `avatar_url` existir → extrai path do storage (split bucket name + `/` + parte depois) → `storage.remove([path])` (try catch sem throw se der 404).
- `profiles.update({ avatar_url: null }).eq('user_id', userId)`.
- Retornar `{ ok: true }`.

### Passo 3 — Componente AvatarChangeModal

Criar `src/components/app/AvatarChangeModal.tsx` (Client Component, "use client" já herdado, AppShell já é use client):

Props:
```ts
type Props = {
  open: boolean;
  onClose: () => void;
  currentAvatarUrl: string | null;
  displayName: string;
  email: string;
  onAvatarChanged: (newUrl: string | null) => void;
}
```

Conteúdo do modal (AppModal fullscreen mobile, tamanho padrão):
- Header: `Foto de perfil` + `Você pode usar JPG, PNG ou WEBP. Tamanho máximo: 5MB.`
- Preview centralizado:
  - if `currentAvatarUrl` → `<img src={currentAvatarUrl} rounded-full w-28 h-28 object-cover>`
  - else → letra inicial igual fallback atual
- Input arquivo escondido, botão estilizado "Escolher imagem":
  - `<input id=avatar type=file accept="image/*" hidden />`
  - `<label htmlFor=avatar>` estilizado pill terracota (igual botão Novo cliente): "Escolher imagem"
- Quando arquivo selecionado → validação client-side imediata (tamanho ≤ 5MB, mime image/*):
  - Se passar → `const formData = new FormData(); formData.append("avatar", file); startTransition(() => uploadProfileAvatarAction(formData))`
  - Mostrar estado `isUploading` (Loader2 + "Enviando…")
  - Se sucesso → `onAvatarChanged(result.newUrl)` + `modalToast.success("Foto atualizada!")`
  - Se erro → `modalToast.error(err)`
- Botão "Remover foto atual" (renderiza apenas se `currentAvatarUrl` existir):
  - `startTransition(deleteProfileAvatarAction())` → sucesso `onAvatarChanged(null)` + toast "Foto removida."
- Botão "Fechar" X no canto direito (padrão AppModal).
- Nenhum input de texto, não precisa de form; usa transições React Server Actions padrão `useTransition`.

### Passo 4 — AppShell integração final

4.1. **Fetch profile + state avatarUrl:**
- Linha 189: adicionar `avatar_url` no SELECT.
- Adicionar `const [avatarUrl, setAvatarUrl] = useState<string | null>(null);`
- No `checkAccess()` depois fetch: `setAvatarUrl(String(profile?.avatar_url ?? "").trim() || null)`
- Nota: para email USA (`isUSDCurrencyEmail(email)`) SE `avatarUrl != null` → mostra avatarUrl (prioridade). Se `avatarUrl == null` → continua mostrando logo USA (comportamento original). Para email normal: mostra avatarUrl se tiver senão letra.

4.2. **Wrapper avatar clicável (criar helper `AvatarBlock` inline ou função):**
```tsx
function AvatarBlock({
  variant = "sidebar",
  onClick,
}: {
  variant: "sidebar" | "drawer";
  onClick?: () => void;
}) {
  const showImage = avatarUrl != null;
  const image = showImage ? avatarUrl : (isUSDCurrencyEmail(email) ? "/logo%20-%20online-music-usa-3.png" : null);
  return (
    <button
      type="button"
      onClick={onClick}
      title="Alterar foto de perfil"
      className={[
        "group relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border transition-all",
        variant === "sidebar"
          ? "h-12 w-12 " + (isUSDCurrencyEmail(email) && !showImage ? "bg-black p-0" : "border-[color:var(--app-active)] bg-[color:var(--app-active)] font-bold tracking-tight text-[#9a3412]")
          : "h-12 w-12 " + (isUSDCurrencyEmail(email) && !showImage ? "bg-black p-0" : "border border-[var(--app-border)] bg-[var(--app-solid-surface-2)] font-bold tracking-tight text-[var(--app-text-85)]"),
        "hover:ring-2 hover:ring-[var(--app-accent-color)] hover:ring-offset-2 hover:ring-offset-[var(--app-solid-surface)]",
      ].join(" ")}
    >
      {image ? (
        <img src={image} alt="Foto de perfil" loading="lazy" className="h-[120%] w-[120%] shrink-0 object-cover scale-110" />
      ) : (
        <span>{avatarLabel || "U"}</span>
      )}
      {/* Mini ícone de câmera no canto inferior direito do avatar (hover) */}
      <span className="absolute inset-x-0 bottom-0 flex h-6 w-full items-center justify-center bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100">
        <CameraIcon />
      </span>
    </button>
  );
}
```
Usar `Camera` do lucide-react (já existe `import { Bot, Loader2, Menu, X }`, adicionar `Camera`).

4.3. **Trocar sidebar avatar antigo (L536-550) por `<AvatarBlock variant="sidebar" onClick={openAvatarModal}/>`** + drawer avatar (L707-731) por mesma coisa `variant="drawer"`.

4.4. **No return do AppShell, adicionar perto do payment modal:**
```tsx
<AvatarChangeModal
  open={avatarModalOpen}
  onClose={() => setAvatarModalOpen(false)}
  currentAvatarUrl={avatarUrl}
  displayName={displayName}
  email={email}
  onAvatarChanged={(newUrl) => {
    setAvatarUrl(newUrl);
    router.refresh(); // opcional, mas garante consistência
  }}
/>
```

### Passo 5 — Page Configurações (opcional, não obrigatório por agora)

Poderia adicionar o mesmo bloco de alterar foto também na página `/app/configuracoes` mas o usuário pediu somente o clique no avatar do header, não precisa por enquanto.

## Dependencies and Considerations

1. **Supabase Admin Client:** Para auto-criar bucket em runtime (se migration não rodou em todos ambientes), precisamos ter `createSupabaseAdminClient` import. Se não existir, criar em `lib/supabase/admin.ts` similar ao atual `server.ts` mas com service role. Já existe provavelmente porque `atendimento/server.ts` usa admin.storage.createBucket.
2. **Idempotência:** Se o usuário fizer upload de um arquivo e der erro no meio, a ação deleteProfileAvatar deve ser safe (try/catch no remove, não throw).
3. **Cache-control:** Public URL do avatar deve ter `cacheControl: 'no-cache'` ou `3600` curto pois o usuário pode trocar foto e querer ver resultado imediatamente.
4. **Security: SVG XSS:** allowed mime types permitimos image/svg+xml mas Supabase Storage bloqueia script inline automaticamente? Para evitar risco podemos OPCIONALMENTE restringir mime types para só raster (jpeg/png/webp/gif), SEM SVG. Menos risco. → **No plano vamos SEM SVG por segurança.**
5. **URL do Supabase Storage:** `process.env.NEXT_PUBLIC_SUPABASE_URL` já existe, usado em upload-client atual.
6. **Nenhuma alteração fora de /app:** a feature é só dentro rotas autenticadas /app.
7. **Persistência:** `saveTheme` e outras funções não tocadas; só `avatar_url` do profile é atualizado via Server Action segura.

## Validation (executar após implementação)

1. **TSC typecheck:** `npx tsc --noEmit` exit 0 (obrigatório antes de commit).
2. **Migration aplicar remoto:** `supabase_apply_migration` no arquivo 20260918_create_profile_avatars_storage_bucket.sql.
3. **Testes manuais:**
   - Abrir `/app/clientes` desktop, ver avatar sidebar canto superior esquerdo. Passar mouse → aparece overlay câmera preta opaca. Clicar → abre modal correto.
   - Upload de imagem JPG 2MB → sucesso, avatar imediatamente mostra nova foto no sidebar e no drawer mobile. Banco profiles.avatar_url atualizado. Ver storage.objects: arquivo em path `<UUID>/avatar-....jpeg`.
   - Tentar upload 6MB → erro: "Arquivo muito grande. Máximo 5MB."
   - Tentar upload `.exe` ou `.pdf` renomeado como .jpg → bloqueado por server side mime check.
   - Clicar em "Remover foto atual" → URL no banco fica NULL, avatar volta para letra/logo USA. Storage arquivo deletado (ver objetos).
   - Usuário USA (atendimento) setar foto → mostra foto; remover foto → volta logo USA (fallback correto).
   - Drawer mobile hambúrguer: avatar clicável lá também, mesma UX.
4. **Build local/Vercel:** Não quebrar ações porque import de server actions é topo de arquivo `"use server"`.

## Riscos

- **Risco:** Migration SQL direto para storage.buckets depende de o role Supabase migration ter permissão no schema storage. → Handle: se a migration falhar, fallback de `admin.storage.createBucket` dentro do server action garante funcionamento.
- **Risco:** Colisão de nome de arquivo se dois uploads no mesmo milissegundo. → Handle: adicionar `crypto.randomUUID` ou `Date.now() + 6 hex randômicos` no nome do arquivo (já no plano).
- **Risco:** Foto antiga não apagada do storage (acumula lixo). → Handle: antes do upload novo, extrair path do avatar_url antigo e chamar `storage.remove([path])` (try catch para não quebrar se não existir).
- **Risco:** Usuário faz upload e não vê nova foto imediatamente por cache CDN. → Handle: cacheControl no upload = "max-age=0, no-cache" ou 60s baixo; e adicionar `?v=${timestamp}` query param na URL do <img src=avatarUrl + ?v=... quando muda.
