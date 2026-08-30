const fs = require("fs");
const path = require("path");

const ROOT = __dirname;

function rel(p) { return path.relative(ROOT, p).replace(/\\/g, "/"); }

function read(p) { return fs.readFileSync(p, "utf8"); }
function write(p, s) { fs.writeFileSync(p, s, "utf8"); }

const P_ACTIONS = path.join(ROOT, "src/app/app/configuracoes/actions.ts");
const P_ADMIN_LAYOUT = path.join(ROOT, "src/app/admin/layout.tsx");

// 1) updateThemeAction -> force dark
let actions = read(P_ACTIONS);
actions = actions.replace(
  /export async function updateThemeAction\(input: unknown\) \{[\s\S]*?theme: parsed\.data\.theme,[\s\S]*?\{ onConflict: "user_id" \},[\s\S]*?\n  \}\n\n  return \{ ok: true \};\n\}/m,
  `export async function updateThemeAction(input: unknown) {
  const parsed = themeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Tema inválido." };

  const themeForced = "dark" as const;

  const supabase = await createSupabaseServerClient();
  const { data: userRes } = await supabase.auth.getUser();
  const userId = userRes.user?.id;
  if (!userId) return { ok: false, error: "Sem sessão." };

  const { error } = await supabase.from("profiles").upsert(
    {
      user_id: userId,
      theme: themeForced,
    },
    { onConflict: "user_id" },
  );

  if (error) {
    const msg = error.message ?? "";
    const missingColumn = /theme/i.test(msg) && /column/i.test(msg);
    if (missingColumn) {
      return {
        ok: false,
        error: "Rode a migration para adicionar a coluna theme em profiles e tente novamente.",
      };
    }
    return { ok: false, error: msg };
  }

  return { ok: true };
}`
);
write(P_ACTIONS, actions);
console.log("[ok] " + rel(P_ACTIONS) + " updateThemeAction force dark");

// 2) admin layout force dark
let admin = read(P_ADMIN_LAYOUT);
admin = admin.replace(
  /const savedTheme = normalizeStoredTheme\(profile\?\.theme\);\s*const initialTheme = savedTheme \?\? "dark";\s*const themeStorageKey = getThemeStorageKey\(user\.id\);\s*const initialBackground = initialTheme === "light" \? "#f8fafc" : "#070A10";/,
  `const savedTheme = null;
  const initialTheme = "dark";
  const themeStorageKey = getThemeStorageKey(user.id);
  const initialBackground = "#070A10";`
);
admin = admin.replace(
  /\(function\(\) \{\s*var fallbackTheme = \$\{JSON\.stringify\(initialTheme\)\};\s*try \{\s*var storageKey = \$\{JSON\.stringify\(themeStorageKey\)\};\s*var theme = \$\{JSON\.stringify\(savedTheme\)\};\s*if \(theme !== "light" && theme !== "dark"\) \{\s*var storedTheme = localStorage\.getItem\(storageKey\);\s*theme = storedTheme === "light" \|\| storedTheme === "dark" \? storedTheme : fallbackTheme;\s*\} else \{\s*localStorage\.setItem\(storageKey, theme\);\s*\}\s*var el = document\.documentElement;\s*el\.classList\.add\("app-theme"\);\s*el\.setAttribute\("data-app-theme-scope", "admin"\);\s*el\.setAttribute\("data-theme", theme\);\s*\} catch \(e\) \{\s*var el = document\.documentElement;\s*el\.classList\.add\("app-theme"\);\s*el\.setAttribute\("data-app-theme-scope", "admin"\);\s*el\.setAttribute\("data-theme", fallbackTheme\);\s*\}\s*\}\)\(\);/,
  `(function() {
            var fallbackTheme = "dark";
            try {
              var storageKey = ${'${JSON.stringify(themeStorageKey)}'};
              var theme = "dark";
              localStorage.setItem(storageKey, theme);
              var el = document.documentElement;
              el.classList.add("app-theme");
              el.setAttribute("data-app-theme-scope", "admin");
              el.setAttribute("data-theme", theme);
            } catch (e) {
              var el = document.documentElement;
              el.classList.add("app-theme");
              el.setAttribute("data-app-theme-scope", "admin");
              el.setAttribute("data-theme", fallbackTheme);
            }
          })();`
);
write(P_ADMIN_LAYOUT, admin);
console.log("[ok] " + rel(P_ADMIN_LAYOUT) + " admin layout force dark");
