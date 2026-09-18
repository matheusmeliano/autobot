import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { format } from 'date-fns';
import { Phone, LogOut, MessageSquare, Trash2, LayoutDashboard, Settings, Filter, Check, X, ExternalLink } from 'lucide-react';

export default function AdminDashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const activeTab = location.pathname.includes('integracao') ? 'integracao' : 'painel';

  const [leads, setLeads] = useState<any[]>([]);
  const [zapiUrl, setZapiUrl] = useState('');
  const [zapiToken, setZapiToken] = useState('');
  const [zapiPhone, setZapiPhone] = useState('');
  const [filterModel, setFilterModel] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);
  const [leadToDelete, setLeadToDelete] = useState<{id: string, nome: string} | null>(null);
  const [selectedLead, setSelectedLead] = useState<any>(null);

  useEffect(() => {
    if (!localStorage.getItem('admin_auth')) {
      navigate('/admin/login');
      return;
    }
    
    fetchLeads();
    fetchConfig();

    const leadsSubscription = supabase
      .channel('leads_channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, payload => {
        if (payload.eventType === 'DELETE') {
          setLeads(prev => prev.filter(lead => lead.id !== payload.old.id));
        } else {
          fetchLeads();
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(leadsSubscription);
    };
  }, [navigate]);

  const fetchLeads = async () => {
    const { data } = await supabase.from('leads').select('*').order('created_at', { ascending: false });
    if (data) setLeads(data);
  };

  const fetchConfig = async () => {
    const { data, error } = await supabase.from('configuracoes').select('*');
    if (error) {
      console.error('Erro ao buscar configurações:', error);
      return;
    }
    if (data && data.length > 0) {
      const url = data.find(c => c.chave === 'zapi_url');
      const token = data.find(c => c.chave === 'zapi_token');
      const phone = data.find(c => c.chave === 'zapi_phone');
      
      if (url) setZapiUrl(url.valor);
      if (token) setZapiToken(token.valor);
      if (phone) setZapiPhone(phone.valor);
    }
  };

  const [isTesting, setIsTesting] = useState(false);

  const handleUpdateConfig = async () => {
    const updates = [];
    if (zapiUrl.trim()) updates.push({ chave: 'zapi_url', valor: zapiUrl.trim() });
    if (zapiToken.trim()) updates.push({ chave: 'zapi_token', valor: zapiToken.trim() });
    if (zapiPhone.trim()) updates.push({ chave: 'zapi_phone', valor: zapiPhone.trim() });

    if (updates.length === 0) {
      alert('Preencha ao menos um campo para salvar.');
      return;
    }
    
    try {
      const { error } = await supabase.from('configuracoes').upsert(updates, { onConflict: 'chave' });
      if (error) throw error;
      alert('Configurações salvas com sucesso!');
      fetchConfig();
    } catch (err: any) {
      alert('Erro ao salvar as configurações: ' + err.message);
    }
  };

  const handleTestZapi = async () => {
    if (!zapiUrl || !zapiPhone) {
      alert('Salve as configurações primeiro antes de testar.');
      return;
    }
    setIsTesting(true);
    try {
      const res = await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: zapiUrl,
          token: zapiToken || '',
          phone: zapiPhone,
          messageText: '🤖 Teste de conexão AutoBot -> Z-API concluído com sucesso!'
        })
      });
      const data = await res.json();
      if (res.ok) {
        alert('Mensagem enviada com sucesso! Verifique seu WhatsApp.');
      } else {
        alert('Erro ao enviar: ' + (data.error || JSON.stringify(data)));
      }
    } catch (err: any) {
      alert('Erro ao conectar com o servidor: ' + err.message);
    } finally {
      setIsTesting(false);
    }
  };

  const updateLeadStatus = async (id: string, status: string) => {
    await supabase.from('leads').update({ status }).eq('id', id);
  };

  const handleDeleteLead = async () => {
    if (leadToDelete) {
      try {
        const { error } = await supabase.from('leads').delete().eq('id', leadToDelete.id);
        if (error) throw error;
        setLeads(prev => prev.filter(lead => lead.id !== leadToDelete.id));
        setLeadToDelete(null);
      } catch (err: any) {
        alert('Erro ao excluir o lead: ' + err.message);
      }
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('admin_auth');
    navigate('/admin/login');
  };

  const filteredLeads = leads.filter(lead => {
    if (filterModel && lead.modelo_indicado !== filterModel) return false;
    if (filterStatus && lead.status !== filterStatus) return false;
    return true;
  });

  return (
    <div className="h-[100dvh] w-full bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white border border-gray-200 rounded-xl p-6 max-w-lg w-full text-center">
        <div className="text-lg font-bold text-gray-800">Arquivo legado</div>
        <div className="mt-2 text-sm text-gray-600">
          Este AdminDashboard é do projeto antigo (React Router). Vamos migrar para /admin no Next.js mantendo o layout e funcionalidades.
        </div>
      </div>
    </div>
  );
}

