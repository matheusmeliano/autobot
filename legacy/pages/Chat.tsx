import React, { useState, useEffect, useRef } from 'react';
import { Send, Lock } from 'lucide-react';
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

type BotState = 'chatting' | 'finished';

const INITIAL_MESSAGE = {
  id: 'init',
  sender: 'bot' as const,
  text: 'Olá! 👋 Seja bem-vindo(a)! Vou te fazer algumas perguntas rápidas pra entender seu objetivo e te indicar o melhor modelo de aulas pra você. Qual é o seu nome?',
  time: new Date()
};

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([INITIAL_MESSAGE]);
  const [inputValue, setInputValue] = useState('');
  const [botState, setBotState] = useState<BotState>('chatting');
  const [leadData, setLeadData] = useState({
    nome: '',
    telefone: '',
    objetivo: '',
    flexibilidade: '',
    tempo: '',
  });
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const addMessage = (sender: 'user' | 'bot', text: string) => {
    setMessages((prev) => [
      ...prev,
      { id: Date.now().toString(), sender, text, time: new Date() },
    ]);
  };

  const processBotLogic = async (userInput: string) => {
    setIsTyping(true);

    const userMessage: Message = { id: Date.now().toString(), sender: 'user', text: userInput, time: new Date() };
    const currentMessages = [...messages, userMessage];

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: currentMessages.map(m => ({ sender: m.sender, text: m.text })),
          leadData
        })
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Erro do servidor: ${res.status}`);
      }

      const data = await res.json();
      
      const newLeadData = { ...leadData };
      if (data.extractedData) {
        if (data.extractedData.nome) newLeadData.nome = data.extractedData.nome;
        if (data.extractedData.telefone) newLeadData.telefone = data.extractedData.telefone;
        if (data.extractedData.objetivo) newLeadData.objetivo = data.extractedData.objetivo;
        if (data.extractedData.flexibilidade) newLeadData.flexibilidade = data.extractedData.flexibilidade;
        setLeadData(newLeadData);
      }

      addMessage('bot', data.reply);

      if (data.isFinished) {
        setBotState('finished');
        
        const isFlexivel = newLeadData.flexibilidade?.toLowerCase().includes('híbrido') || newLeadData.flexibilidade?.toLowerCase().includes('flex') || data.reply.toLowerCase().includes('híbrido');
        const modeloIndicado = isFlexivel ? 'hibrido' : 'individual';
        
        const isQuente = (newLeadData.objetivo?.length || 0) > 10;
        const nivelInteresse = isQuente ? 'quente' : 'morno';
        
        try {
          const fullConversation = [
            ...currentMessages,
            { id: Date.now().toString() + '-bot', sender: 'bot', text: data.reply, time: new Date() }
          ];

          const leadToSave = {
            nome: newLeadData.nome || 'Não informado',
            telefone: newLeadData.telefone || 'Não informado',
            modelo_indicado: modeloIndicado,
            objetivo: newLeadData.objetivo || 'Não informado',
            nivel_interesse: nivelInteresse,
            status: 'novo',
            conversa: fullConversation
          };

          const { error } = await supabase.from('leads').insert([leadToSave]);
          if (error) throw error;

          if (nivelInteresse === 'morno' || nivelInteresse === 'quente') {
            const { data: configs } = await supabase.from('configuracoes').select('*').in('chave', ['zapi_url', 'zapi_token', 'zapi_phone']);
            
            const zapiUrl = configs?.find(c => c.chave === 'zapi_url')?.valor;
            const zapiToken = configs?.find(c => c.chave === 'zapi_token')?.valor || '';
            const zapiPhone = configs?.find(c => c.chave === 'zapi_phone')?.valor;

            if (zapiUrl && zapiPhone) {
              const messageText = `🚨 *Novo lead qualificado no AutoBot!*\nAcesse o painel: ${window.location.origin}/painel\n\n👤 *Nome:* ${leadToSave.nome}\n📱 *WhatsApp:* ${leadToSave.telefone}\n🎯 *Objetivo na música:* ${leadToSave.objetivo}\n📅 *Disponibilidade/Tempo:* ${newLeadData.flexibilidade || 'Não informado'}\n📚 *Modelo Identificado:* ${leadToSave.modelo_indicado.toUpperCase()}`;
              
              fetch('/api/notify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: zapiUrl, token: zapiToken, phone: zapiPhone, messageText })
              }).catch(err => console.error('Erro na notificação via backend:', err));
            }
          }
        } catch (error) {
          console.error('Failed to save lead:', error);
        }
      }
    } catch (error: any) {
      console.error('Erro ao processar mensagem via IA:', error);
      addMessage('bot', `Oops, erro técnico: ${error.message || 'Falha na conexão com a IA'}. Verifique o console ou a configuração da API.`);
    } finally {
      setIsTyping(false);
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
    <div className="flex flex-col h-[100dvh] w-full bg-[#ECE5DD] relative border-x border-gray-200 overflow-hidden"></div>
  );
}

