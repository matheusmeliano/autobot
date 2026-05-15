-- create table
CREATE TABLE leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome VARCHAR(100) NOT NULL,
    telefone VARCHAR(20) NOT NULL,
    modelo_indicado VARCHAR(20) CHECK (modelo_indicado IN ('hibrido', 'individual')),
    objetivo TEXT,
    nivel_interesse VARCHAR(20) CHECK (nivel_interesse IN ('quente', 'morno', 'frio')),
    status VARCHAR(20) DEFAULT 'novo' CHECK (status IN ('novo', 'atendimento', 'finalizado')),
    conversa JSONB DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- create indexes
CREATE INDEX idx_leads_telefone ON leads(telefone);
CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_leads_nivel_interesse ON leads(nivel_interesse);
CREATE INDEX idx_leads_created_at ON leads(created_at DESC);

-- grant permissions
GRANT SELECT ON leads TO anon;
GRANT ALL PRIVILEGES ON leads TO authenticated;
GRANT ALL PRIVILEGES ON leads TO service_role;

-- create table
CREATE TABLE configuracoes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chave VARCHAR(50) UNIQUE NOT NULL,
    valor TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- insert default WhatsApp number
INSERT INTO configuracoes (chave, valor) VALUES 
('whatsapp_numero', '65 9985-1142'),
('whatsapp_conectado', 'false');

-- grant permissions
GRANT SELECT ON configuracoes TO anon;
GRANT ALL PRIVILEGES ON configuracoes TO authenticated;
GRANT ALL PRIVILEGES ON configuracoes TO service_role;

-- enable realtime for leads table
ALTER TABLE leads REPLICA IDENTITY FULL;

-- create policy for realtime updates
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuracoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Leads read access" ON leads FOR SELECT USING (true);
CREATE POLICY "Leads insert access" ON leads FOR INSERT WITH CHECK (true);
CREATE POLICY "Leads update access" ON leads FOR UPDATE USING (true);

CREATE POLICY "Configuracoes read access" ON configuracoes FOR SELECT USING (true);
CREATE POLICY "Configuracoes update access" ON configuracoes FOR UPDATE USING (true);
CREATE POLICY "Configuracoes insert access" ON configuracoes FOR INSERT WITH CHECK (true);
