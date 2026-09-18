import { Suspense } from "react";
import CadastroRecorrenteBody from "./client";

export default function CadastroRecorrentePage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-sky-50 flex items-center justify-center p-6">
          <div className="bg-white rounded-3xl shadow-xl shadow-indigo-100/50 border border-slate-100 px-10 py-12 text-center text-slate-600">
            Carregando...
          </div>
        </main>
      }
    >
      <CadastroRecorrenteBody />
    </Suspense>
  );
}
