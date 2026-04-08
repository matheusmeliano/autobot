import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { format } from 'date-fns';
import { LogOut, Settings, MessageSquare, Phone, QrCode, RefreshCw } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [leads, setLeads] = useState<any[]>([]);
  const [whatsappStatus, setWhatsappStatus] = useState({ connected: false, qrCode: null as string | null });
  const [isConnecting, setIsConnecting] = useState(false);
  const [forwardNumber, setForwardNumber] = useState('');
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
    checkWhatsappStatus();

    const interval = setInterval(checkWhatsappStatus, 5000);

    const leadsSubscription = supabase
      .channel('leads_channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, payload => {
        fetchLeads();
      })
      .subscribe();

    return () => {
      clearInterval(interval);
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
      const num = data.find(c => c.chave === 'whatsapp_numero');
      if (num) setForwardNumber(num.valor);
    }
  };

  const checkWhatsappStatus = async () => {
    try {
      const res = await fetch('/api/whatsapp/status');
      const data = await res.json();
      if (data.success) {
        setWhatsappStatus({ connected: data.connected, qrCode: data.qrCode });
        if (data.qrCode || data.connected) {
          setIsConnecting(false);
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleConnectWhatsapp = async () => {
    try {
      setIsConnecting(true);
      await fetch('/api/whatsapp/connect', { method: 'POST' });
      // Poll immediately and then interval takes over
      setTimeout(checkWhatsappStatus, 2000);
    } catch (e) {
      console.error(e);
      setIsConnecting(false);
      alert('Erro ao tentar conectar com o WhatsApp. Verifique se o backend está rodando.');
    }
  };

  const handleUpdateNumber = async () => {
    await supabase.from('configuracoes').update({ valor: forwardNumber }).eq('chave', 'whatsapp_numero');
    alert('Número atualizado com sucesso!');
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
              <Phone size={16} className="mr-2" /> WhatsApp Status
            </h3>
            <div className="flex items-center mb-4">
              <div className={`w-3 h-3 rounded-full mr-2 ${whatsappStatus.connected ? 'bg-green-500' : 'bg-red-500'}`}></div>
              <span className="text-sm">{whatsappStatus.connected ? 'Conectado' : 'Desconectado'}</span>
            </div>
            
            {!whatsappStatus.connected && !whatsappStatus.qrCode && (
              <button 
                onClick={handleConnectWhatsapp}
                disabled={isConnecting}
                className={`w-full py-2 px-3 rounded text-sm transition-colors text-white ${
                  isConnecting ? 'bg-gray-600 cursor-not-allowed' : 'bg-[#128C7E] hover:bg-[#075E54]'
                }`}
              >
                {isConnecting ? 'Gerando QR Code...' : 'Conectar WhatsApp'}
              </button>
            )}

            {whatsappStatus.qrCode && !whatsappStatus.connected && (
              <div className="bg-white p-2 rounded flex flex-col items-center mt-2">
                <p className="text-xs text-gray-500 mb-2 text-center">Escaneie o QR Code</p>
                <QRCodeSVG value={whatsappStatus.qrCode} size={150} />
              </div>
            )}
            
            <p className="text-[10px] text-gray-500 mt-3 text-center leading-tight">
              ⚠️ Você deve conectar seu WhatsApp para a notificação funcionar!
            </p>
          </div>

          <div className="bg-gray-800 p-4 rounded-lg">
            <h3 className="text-sm font-semibold text-gray-400 mb-3 uppercase tracking-wider flex items-center">
              <Settings size={16} className="mr-2" /> Configuração
            </h3>
            <p className="text-xs text-gray-500 mb-3">
              Número que receberá as notificações de novos leads.
            </p>
            <label className="block text-xs mb-1">Número de Notificação</label>
            <input 
              type="text" 
              value={forwardNumber}
              onChange={(e) => setForwardNumber(e.target.value)}
              placeholder="Ex: 65 9985-1142"
              className="w-full bg-gray-700 text-white border border-gray-600 rounded p-2 text-sm mb-2"
            />
            <button 
              onClick={handleUpdateNumber}
              className="w-full bg-[#128C7E] hover:bg-[#075E54] text-white py-2 px-3 rounded text-sm transition-colors border border-transparent"
            >
              Salvar Número
            </button>
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
