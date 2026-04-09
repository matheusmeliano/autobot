import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { format } from 'date-fns';
import { LogOut, MessageSquare, Phone } from 'lucide-react';

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [leads, setLeads] = useState<any[]>([]);
  const [zapiUrl, setZapiUrl] = useState('https://api.z-api.io/instances/3F164C8A1B93C20D0787667E5D6D48C0/token/3D8FCF7021EAF473D498C56D/send-text');
  const [zapiToken, setZapiToken] = useState('F85308586a9354c43b7dc0df4876c5d11S');
  const [zapiPhone, setZapiPhone] = useState('556596933336');
  const [filterModel, setFilterModel] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
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
        fetchLeads();
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
    const { data } = await supabase.from('configuracoes').select('*');
    if (data) {
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
    if (!zapiUrl || !zapiPhone) {
      alert('Por favor, preencha a URL da Instância e o Seu Número!');
      return;
    }
    
    await supabase.from('configuracoes').upsert([
      { chave: 'zapi_url', valor: zapiUrl },
      { chave: 'zapi_token', valor: zapiToken || '' },
      { chave: 'zapi_phone', valor: zapiPhone }
    ], { onConflict: 'chave' });
    alert('Configurações da Z-API salvas com sucesso!');
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
          messageText: '🤖 Teste de conexão WeBooter -> Z-API concluído com sucesso!'
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
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <div className="w-64 bg-gray-900 text-white flex flex-col">
        <div className="p-6">
          <h2 className="text-2xl font-bold text-[#25D366]">WeBooter</h2>
          <p className="text-sm text-gray-400">Painel Administrativo</p>
        </div>

        <div className="flex-1 px-4 space-y-4">
          <div className="bg-gray-800 p-4 rounded-lg">
            <h3 className="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wider flex items-center">
              <Phone size={16} className="mr-2" /> WhatsApp (Z-API)
            </h3>
            
            <p className="text-xs text-gray-400 mb-4 leading-relaxed">
              Configure sua integração com a Z-API para receber os leads diretamente no seu WhatsApp.
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs mb-1 text-gray-300">URL da Instância (Z-API)</label>
                <input 
                  type="text" 
                  value={zapiUrl}
                  onChange={(e) => setZapiUrl(e.target.value)}
                  placeholder="Ex: https://api.z-api.io/instances/SUA_INSTANCIA/token/SEU_TOKEN"
                  className="w-full bg-gray-700 text-white border border-gray-600 rounded p-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs mb-1 text-gray-300">Client-Token (Z-API)</label>
                <input 
                  type="text" 
                  value={zapiToken}
                  onChange={(e) => setZapiToken(e.target.value)}
                  placeholder="Ex: Seu Client-Token que está no menu Segurança"
                  className="w-full bg-gray-700 text-white border border-gray-600 rounded p-2 text-sm"
                />
                <p className="text-[10px] text-gray-500 mt-1">Vá no painel da Z-API: Instância &gt; Segurança &gt; Client-Token</p>
              </div>

              <div>
                <label className="block text-xs mb-1 text-gray-300">Seu Número de WhatsApp (Destino)</label>
                <input 
                  type="text" 
                  value={zapiPhone}
                  onChange={(e) => setZapiPhone(e.target.value)}
                  placeholder="Ex: 5565999999999"
                  className="w-full bg-gray-700 text-white border border-gray-600 rounded p-2 text-sm"
                />
                <p className="text-[10px] text-gray-500 mt-1">Apenas números, com código do país (Ex: 55) e DDD.</p>
              </div>

              <div className="flex gap-2 mt-4">
                <button 
                  onClick={handleUpdateConfig}
                  className="flex-1 bg-[#128C7E] hover:bg-[#075E54] text-white py-2 px-3 rounded text-sm transition-colors"
                >
                  Salvar Configurações
                </button>
                
                <button 
                  onClick={handleTestZapi}
                  disabled={isTesting}
                  className="flex-1 bg-gray-600 hover:bg-gray-500 text-white py-2 px-3 rounded text-sm transition-colors disabled:opacity-50"
                >
                  {isTesting ? 'Testando...' : 'Testar Notificação'}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="p-4">
          <button 
            onClick={handleLogout}
            className="flex items-center text-gray-400 hover:text-white transition-colors"
          >
            <LogOut size={20} className="mr-2" /> Sair
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 p-8 overflow-y-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-2xl font-bold text-gray-800">Gestão de Leads</h1>
          
          <div className="flex gap-4">
            <select 
              value={filterModel} 
              onChange={(e) => setFilterModel(e.target.value)}
              className="border border-gray-300 rounded-md p-2 text-sm outline-none"
            >
              <option value="">Todos os Modelos</option>
              <option value="hibrido">Híbrido</option>
              <option value="individual">Individual</option>
            </select>

            <select 
              value={filterStatus} 
              onChange={(e) => setFilterStatus(e.target.value)}
              className="border border-gray-300 rounded-md p-2 text-sm outline-none"
            >
              <option value="">Todos os Status</option>
              <option value="novo">Novo</option>
              <option value="atendimento">Em Atendimento</option>
              <option value="finalizado">Finalizado</option>
            </select>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="p-4 text-sm font-semibold text-gray-600">Data</th>
                <th className="p-4 text-sm font-semibold text-gray-600">Nome</th>
                <th className="p-4 text-sm font-semibold text-gray-600">Modelo</th>
                <th className="p-4 text-sm font-semibold text-gray-600">Interesse</th>
                <th className="p-4 text-sm font-semibold text-gray-600">Status</th>
                <th className="p-4 text-sm font-semibold text-gray-600">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filteredLeads.map((lead) => (
                <tr key={lead.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                  <td className="p-4 text-sm text-gray-600">
                    {format(new Date(lead.created_at), 'dd/MM/yyyy HH:mm')}
                  </td>
                  <td className="p-4">
                    <div className="font-medium text-gray-800">{lead.nome}</div>
                    <div className="text-xs text-gray-500">{lead.telefone}</div>
                  </td>
                  <td className="p-4">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      lead.modelo_indicado === 'hibrido' ? 'bg-blue-100 text-blue-800' : 'bg-purple-100 text-purple-800'
                    }`}>
                      {lead.modelo_indicado === 'hibrido' ? 'Híbrido' : 'Individual'}
                    </span>
                  </td>
                  <td className="p-4">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      lead.nivel_interesse === 'quente' ? 'bg-red-100 text-red-800' : 
                      lead.nivel_interesse === 'morno' ? 'bg-yellow-100 text-yellow-800' : 
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {lead.nivel_interesse.toUpperCase()}
                    </span>
                  </td>
                  <td className="p-4">
                    <select 
                      value={lead.status}
                      onChange={(e) => updateLeadStatus(lead.id, e.target.value)}
                      className="text-sm border border-gray-200 rounded p-1 outline-none"
                    >
                      <option value="novo">Novo</option>
                      <option value="atendimento">Em Atendimento</option>
                      <option value="finalizado">Finalizado</option>
                    </select>
                  </td>
                  <td className="p-4 flex gap-2">
                    <button 
                      onClick={() => setSelectedLead(lead)}
                      className="p-2 text-gray-500 hover:text-[#128C7E] hover:bg-green-50 rounded transition-colors"
                      title="Ver Conversa"
                    >
                      <MessageSquare size={18} />
                    </button>
                  </td>
                </tr>
              ))}
              {filteredLeads.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-gray-500">
                    Nenhum lead encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Conversa */}
      {selectedLead && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50 rounded-t-lg">
              <div>
                <h3 className="font-bold text-lg text-gray-800">Conversa: {selectedLead.nome}</h3>
                <p className="text-sm text-gray-500">Objetivo: {selectedLead.objetivo}</p>
              </div>
              <button 
                onClick={() => setSelectedLead(null)}
                className="text-gray-500 hover:text-gray-800 text-2xl leading-none"
              >
                &times;
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#ECE5DD]">
              {selectedLead.conversa && Array.isArray(selectedLead.conversa) ? (
                selectedLead.conversa.map((msg: any, i: number) => (
                  <div
                    key={i}
                    className={`max-w-[80%] rounded-lg p-3 shadow-sm ${
                      msg.sender === 'user' 
                        ? 'bg-[#DCF8C6] ml-auto rounded-tr-none' 
                        : 'bg-white mr-auto rounded-tl-none'
                    }`}
                  >
                    <p className="text-sm text-gray-800 whitespace-pre-wrap">{msg.text}</p>
                  </div>
                ))
              ) : (
                <p className="text-center text-gray-500">Nenhuma conversa registrada.</p>
              )}
            </div>

            <div className="p-4 border-t border-gray-200 bg-gray-50 rounded-b-lg flex justify-end gap-3">
              <a 
                href={`https://wa.me/55${selectedLead.telefone.replace(/\D/g, '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center px-4 py-2 bg-[#25D366] text-white rounded-md hover:bg-[#128C7E] transition-colors text-sm font-medium"
              >
                <MessageSquare size={16} className="mr-2" /> Chamar no WhatsApp
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
