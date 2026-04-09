import React, { useState, useEffect, useRef } from 'react';
import { Send } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { format } from 'date-fns';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type Message = {
  id: string;
  sender: 'bot' | 'user';
  text: string;
  time: Date;
};

type BotState = 'greeting' | 'ask_name' | 'ask_objective' | 'ask_flexibility' | 'ask_time' | 'finished';

const INITIAL_MESSAGE: Message = {
  id: '1',
  sender: 'bot',
  text: 'Olá! 👋 Seja bem-vindo(a)! Vou te fazer algumas perguntas rápidas pra entender seu objetivo e te indicar o melhor modelo pra você. Qual é o seu nome?',
  time: new Date(),
};

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([INITIAL_MESSAGE]);
  const [inputValue, setInputValue] = useState('');
  const [botState, setBotState] = useState<BotState>('ask_name');
  const [leadData, setLeadData] = useState({
    nome: '',
    objetivo: '',
    flexibilidade: '',
    tempo: '',
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const addMessage = (sender: 'bot' | 'user', text: string) => {
    setMessages((prev) => [
      ...prev,
      { id: Date.now().toString(), sender, text, time: new Date() },
    ]);
  };

  const processBotLogic = async (userInput: string) => {
    switch (botState) {
      case 'ask_name':
        setLeadData((prev) => ({ ...prev, nome: userInput }));
        setBotState('ask_objective');
        setTimeout(() => {
          addMessage('bot', `Prazer, ${userInput}! Qual seu principal objetivo?`);
        }, 1000);
        break;
      case 'ask_objective':
        setLeadData((prev) => ({ ...prev, objetivo: userInput }));
        setBotState('ask_flexibility');
        setTimeout(() => {
          addMessage('bot', 'Entendi. Você prefere algo mais flexível ou acompanhamento mais próximo?');
        }, 1000);
        break;
      case 'ask_flexibility':
        setLeadData((prev) => ({ ...prev, flexibilidade: userInput }));
        setBotState('ask_time');
        setTimeout(() => {
          addMessage('bot', 'Certo. Quanto tempo você tem disponível por semana?');
        }, 1000);
        break;
      case 'ask_time':
        const finalData = { ...leadData, tempo: userInput };
        setLeadData(finalData);
        setBotState('finished');
        
        // Analyze and determine model
        const isFlexivel = finalData.flexibilidade.toLowerCase().includes('flex') || finalData.flexibilidade.toLowerCase().includes('próprio');
        const modeloIndicado = isFlexivel ? 'hibrido' : 'individual';
        
        // Determine interest level (simple heuristic for demo)
        const isQuente = finalData.objetivo.length > 10;
        const nivelInteresse = isQuente ? 'quente' : 'morno';
        
        setTimeout(async () => {
          if (modeloIndicado === 'hibrido') {
            addMessage('bot', 'Com base nas suas respostas, o **MODELO HÍBRIDO** é o ideal para você!\n\n✅ Ideal para quem quer flexibilidade e tem rotina corrida.\n✅ Inclui aula introdutória, 4 aulas gravadas (1 por semana) e 1 aula online ao vivo mensal.\n✅ Formato escalável para estudar no seu próprio ritmo.');
          } else {
            addMessage('bot', 'Com base nas suas respostas, o **MODELO INDIVIDUAL** é o ideal para você!\n\n✅ Ideal para quem quer acompanhamento próximo e evolução rápida.\n✅ Inclui 1 aula online ao vivo por semana.\n✅ Ensino totalmente personalizado e acompanhamento contínuo.');
          }
          
          // Save to Supabase
          try {
            // First we need to get the user's phone number to save properly.
            // Since the PRD doesn't explicitly ask for phone number in the chat flow but requires it in the DB,
            // we'll assume a dummy one or ask for it. Wait, PRD says:
            // "Se lead for MORNO ou QUENTE: Encaminhar automaticamente para WhatsApp: 65 9985-1142"
            // Wait, the phone number in the DB is the LEAD's phone number? But the lead is on the web chat.
            // If the lead doesn't provide a phone number, how do we get it?
            // "Lead (Visitante): Sem cadastro - apenas nome"
            // If we need their phone, we should probably ask. But the flow didn't mention asking for phone.
            // Let's ask for phone if we need to send to WhatsApp, or use a placeholder if none is provided.
            // Wait, the PRD says: "Encaminhar automaticamente para WhatsApp: 65 9985-1142".
            // This means we send a message TO the admin's WhatsApp FROM the connected WhatsApp!
            // Wait: "Enviar para o WhatsApp conectado: Nome, Modelo indicado, Objetivo, Nível de interesse".
            // So the bot sends a message to the ADMIN's number with the lead details.
            // Ah! The `telefone` field in the DB might be the lead's phone, but we don't have it. Let's just put 'Não informado' or ask for it.
            // Let's just put 'Não informado' for now to stick strictly to the 3 questions.
            
            const leadToSave = {
              nome: finalData.nome,
              telefone: 'Não informado',
              modelo_indicado: modeloIndicado,
              objetivo: finalData.objetivo,
              nivel_interesse: nivelInteresse,
              status: 'novo',
              conversa: messages.concat([{ id: Date.now().toString(), sender: 'user', text: userInput, time: new Date() }])
            };

            const { data, error } = await supabase.from('leads').insert([leadToSave]).select();
            
            if (error) throw error;

            if (nivelInteresse === 'morno' || nivelInteresse === 'quente') {
              const { data: configs } = await supabase.from('configuracoes').select('*').eq('chave', 'callmebot_url');
              
              const callmebotUrlConfig = configs?.[0]?.valor || '';

              if (callmebotUrlConfig && callmebotUrlConfig.includes('api.callmebot.com')) {
                try {
                  // Simplificando MUITO a mensagem. Se for longa ou complexa demais, o CallMeBot não aceita
                  const messageText = `Lead: ${leadToSave.nome} - Modelo: ${leadToSave.modelo_indicado}`;
                  
                  // Enviamos a URL limpa (salva no painel) + o texto que queremos para o backend da Vercel
                  fetch('/api/notify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                      url: callmebotUrlConfig,
                      messageText: messageText
                    })
                  })
                  .then(async (res) => {
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || 'Erro no envio');
                    console.log('Notificação CallMeBot enviada com sucesso pelo backend:', data);
                  })
                  .catch(err => console.error('Erro na notificação via backend:', err));
                  
                } catch (e) {
                  console.error('Erro ao chamar notificação:', e);
                }
              } else {
                console.log('CallMeBot não configurado ou URL inválida.');
              }
            }

          } catch (error) {
            console.error('Failed to save lead:', error);
          }
        }, 1500);
        break;
      default:
        break;
    }
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || botState === 'finished') return;

    const userText = inputValue.trim();
    addMessage('user', userText);
    setInputValue('');
    processBotLogic(userText);
  };

  return (
    <div className="flex flex-col h-screen max-w-md mx-auto bg-[#ECE5DD] relative shadow-2xl">
      {/* Header */}
      <div className="bg-[#128C7E] text-white p-4 flex items-center shadow-md z-10">
        <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center mr-3">
          🤖
        </div>
        <div>
          <h1 className="font-semibold text-lg leading-tight">WeBooter Assistente</h1>
          <span className="text-xs text-white/80">Online</span>
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn(
              "max-w-[80%] rounded-lg p-3 shadow-sm relative",
              msg.sender === 'user' 
                ? "bg-[#DCF8C6] ml-auto rounded-tr-none" 
                : "bg-white mr-auto rounded-tl-none"
            )}
          >
            <p className="text-sm text-gray-800 whitespace-pre-wrap">{msg.text}</p>
            <span className="text-[10px] text-gray-500 block text-right mt-1">
              {format(msg.time, 'HH:mm')}
            </span>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-3 bg-[#f0f0f0] flex items-center gap-2">
        <form onSubmit={handleSend} className="flex-1 flex gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            disabled={botState === 'finished'}
            placeholder={botState === 'finished' ? 'Conversa finalizada' : 'Digite sua mensagem...'}
            className="flex-1 rounded-full px-4 py-2 outline-none text-sm focus:ring-2 focus:ring-[#128C7E]"
          />
          <button
            type="submit"
            disabled={!inputValue.trim() || botState === 'finished'}
            className="bg-[#128C7E] text-white p-3 rounded-full hover:bg-[#075E54] transition-colors disabled:opacity-50"
          >
            <Send size={18} className="ml-1" />
          </button>
        </form>
      </div>
    </div>
  );
}
