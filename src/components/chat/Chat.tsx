import React, { useEffect, useRef, useState } from "react";
import { Send, Lock } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { format } from "date-fns";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type Message = {
  id: string;
  sender: "bot" | "user";
  text: string;
  time: Date;
};

type BotState = "chatting" | "finished";

const INITIAL_MESSAGE = {
  id: "init",
  sender: "bot" as const,
  text: "Olá! 👋 Seja bem-vindo(a)! Vou te fazer algumas perguntas rápidas pra entender seu objetivo e te indicar o melhor modelo de aulas pra você. Qual é o seu nome?",
  time: new Date(),
};

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([INITIAL_MESSAGE]);
  const [inputValue, setInputValue] = useState("");
  const [botState, setBotState] = useState<BotState>("chatting");
  const [leadData, setLeadData] = useState({
    nome: "",
    telefone: "",
    objetivo: "",
    flexibilidade: "",
    tempo: "",
  });
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const addMessage = (sender: "user" | "bot", text: string) => {
    setMessages((prev) => [
      ...prev,
      { id: Date.now().toString(), sender, text, time: new Date() },
    ]);
  };

  const processBotLogic = async (userInput: string) => {
    setIsTyping(true);

    const userMessage: Message = {
      id: Date.now().toString(),
      sender: "user",
      text: userInput,
      time: new Date(),
    };
    const currentMessages = [...messages, userMessage];

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: currentMessages.map((m) => ({ sender: m.sender, text: m.text })),
          leadData,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Erro do servidor: ${res.status}`);
      }

      const data = await res.json();

      const newLeadData = { ...leadData };
      if (data.extractedData) {
        if (data.extractedData.nome) newLeadData.nome = data.extractedData.nome;
        if (data.extractedData.telefone)
          newLeadData.telefone = data.extractedData.telefone;
        if (data.extractedData.objetivo)
          newLeadData.objetivo = data.extractedData.objetivo;
        if (data.extractedData.flexibilidade)
          newLeadData.flexibilidade = data.extractedData.flexibilidade;
        setLeadData(newLeadData);
      }

      addMessage("bot", data.reply);

      if (data.isFinished) {
        setBotState("finished");

        const isFlexivel =
          newLeadData.flexibilidade?.toLowerCase().includes("híbrido") ||
          newLeadData.flexibilidade?.toLowerCase().includes("flex") ||
          data.reply.toLowerCase().includes("híbrido");
        const modeloIndicado = isFlexivel ? "hibrido" : "individual";

        const isQuente = (newLeadData.objetivo?.length || 0) > 10;
        const nivelInteresse = isQuente ? "quente" : "morno";

        try {
          const fullConversation = [
            ...currentMessages,
            {
              id: Date.now().toString() + "-bot",
              sender: "bot",
              text: data.reply,
              time: new Date(),
            },
          ];

          const leadToSave = {
            nome: newLeadData.nome || "Não informado",
            telefone: newLeadData.telefone || "Não informado",
            modelo_indicado: modeloIndicado,
            objetivo: newLeadData.objetivo || "Não informado",
            nivel_interesse: nivelInteresse,
            status: "novo",
            conversa: fullConversation,
          };

          const { error } = await supabase.from("leads").insert([leadToSave]);
          if (error) throw error;

          if (nivelInteresse === "morno" || nivelInteresse === "quente") {
            const { data: configs } = await supabase
              .from("configuracoes")
              .select("*")
              .in("chave", ["zapi_url", "zapi_token", "zapi_phone"]);

            const zapiUrl = configs?.find((c) => c.chave === "zapi_url")?.valor;
            const zapiToken =
              configs?.find((c) => c.chave === "zapi_token")?.valor || "";
            const zapiPhone = configs?.find((c) => c.chave === "zapi_phone")?.valor;

            if (zapiUrl && zapiPhone) {
              const messageText = `🚨 *Novo lead qualificado no AutoBot!*\nAcesse o painel: ${window.location.origin}/painel\n\n👤 *Nome:* ${leadToSave.nome}\n📱 *WhatsApp:* ${leadToSave.telefone}\n🎯 *Objetivo na música:* ${leadToSave.objetivo}\n📅 *Disponibilidade/Tempo:* ${newLeadData.flexibilidade || "Não informado"}\n📚 *Modelo Identificado:* ${leadToSave.modelo_indicado.toUpperCase()}`;

              fetch("/api/notify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  url: zapiUrl,
                  token: zapiToken,
                  phone: zapiPhone,
                  messageText,
                }),
              }).catch(() => {});
            }
          }
        } catch {
        }
      }
    } catch (error: any) {
      addMessage(
        "bot",
        `Oops, erro técnico: ${
          error.message || "Falha na conexão com a IA"
        }. Verifique o console ou a configuração da API.`
      );
    } finally {
      setIsTyping(false);
    }
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || botState === "finished") return;

    const userText = inputValue.trim();
    addMessage("user", userText);
    setInputValue("");
    processBotLogic(userText);
  };

  return (
    <div className="relative flex h-[100dvh] w-full flex-col overflow-hidden border-x border-gray-200 bg-[#ECE5DD]">
      <div className="z-10 flex shrink-0 items-center justify-between border-b border-[#075E54] bg-[#128C7E] p-4 text-white">
        <div className="flex items-center">
          <div className="mr-3 flex h-10 w-10 items-center justify-center rounded-full bg-white/20">
            🤖
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-tight">
              AutoBot Assistente
            </h1>
            <span className="text-xs text-white/80">Online</span>
          </div>
        </div>

        <a
          href="/painel"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full p-2 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          title="Acessar Painel de Controle"
        >
          <Lock size={18} />
        </a>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4 md:px-10 lg:px-32">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.sender === "user" ? "justify-end" : "justify-start"} items-end gap-2`}
          >
            {msg.sender === "bot" && (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#075E54] bg-[#128C7E] text-sm text-white shadow-sm">
                🤖
              </div>
            )}

            <div
              className={cn(
                "relative max-w-[85%] rounded-lg border p-3 md:max-w-[70%] lg:max-w-[50%]",
                msg.sender === "user"
                  ? "rounded-br-none border-[#c1e8a8] bg-[#DCF8C6]"
                  : "rounded-bl-none border-gray-200 bg-white"
              )}
            >
              <div
                className={cn(
                  "absolute bottom-0 h-0 w-0 border-[6px] border-transparent",
                  msg.sender === "user"
                    ? "right-[-6px] border-b-[#c1e8a8] border-l-[#c1e8a8]"
                    : "left-[-6px] border-b-gray-200 border-r-gray-200"
                )}
              />
              <div
                className={cn(
                  "absolute bottom-[1px] z-10 h-0 w-0 border-[5px] border-transparent",
                  msg.sender === "user"
                    ? "right-[-4px] border-b-[#DCF8C6] border-l-[#DCF8C6]"
                    : "left-[-4px] border-b-white border-r-white"
                )}
              />

              <p className="relative z-20 whitespace-pre-wrap text-sm text-gray-800">
                {msg.text}
              </p>
              <span className="relative z-20 mt-1 block text-right text-[10px] text-gray-500">
                {format(msg.time, "HH:mm")}
              </span>
            </div>
          </div>
        ))}

        {isTyping && (
          <div className="flex items-end justify-start gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#075E54] bg-[#128C7E] text-sm text-white shadow-sm">
              🤖
            </div>
            <div className="relative flex h-[42px] items-center gap-1 rounded-lg rounded-bl-none border border-gray-200 bg-white p-3">
              <div className="absolute bottom-0 left-[-6px] h-0 w-0 border-[6px] border-transparent border-b-gray-200 border-r-gray-200" />
              <div className="absolute bottom-[1px] left-[-4px] z-10 h-0 w-0 border-[5px] border-transparent border-b-white border-r-white" />

              <span
                className="h-2 w-2 animate-bounce rounded-full bg-gray-400"
                style={{ animationDelay: "0ms" }}
              />
              <span
                className="h-2 w-2 animate-bounce rounded-full bg-gray-400"
                style={{ animationDelay: "150ms" }}
              />
              <span
                className="h-2 w-2 animate-bounce rounded-full bg-gray-400"
                style={{ animationDelay: "300ms" }}
              />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="flex shrink-0 flex-col items-center gap-2 border-t border-gray-300 bg-[#f0f0f0] p-3">
        <form
          onSubmit={handleSend}
          className="flex w-full gap-2 md:w-3/4 lg:w-1/2"
        >
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            disabled={botState === "finished" || isTyping}
            placeholder={
              botState === "finished"
                ? "Conversa finalizada"
                : isTyping
                  ? "Aguarde..."
                  : "Digite sua mensagem..."
            }
            className="flex-1 rounded-full border border-gray-300 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-[#128C7E] disabled:cursor-not-allowed disabled:bg-gray-100"
          />
          <button
            type="submit"
            disabled={!inputValue.trim() || botState === "finished" || isTyping}
            className="rounded-full bg-[#128C7E] p-3 text-white transition-colors hover:bg-[#075E54] disabled:opacity-50"
          >
            <Send size={18} className="ml-1" />
          </button>
        </form>
        <div className="mt-1 text-[10px] text-gray-400">
          Desenvolvido pela{" "}
          <a
            href="https://www.heybrothers.site/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-gray-500 transition-colors hover:text-[#128C7E]"
          >
            HEYBROTHERS
          </a>
          .
        </div>
      </div>
    </div>
  );
}

