DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'app_settings') THEN
    CREATE TABLE public.app_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL DEFAULT 'null'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS app_settings_key_idx ON public.app_settings(key);
