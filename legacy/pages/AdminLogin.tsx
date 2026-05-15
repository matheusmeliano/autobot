import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Eye, EyeOff } from 'lucide-react';

export default function AdminLogin() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (username === 'autobot' && password === 'C079VTeqnCpA') {
      localStorage.setItem('admin_auth', 'true');
      navigate('/painel');
    } else {
      setError('Credenciais inválidas');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col p-4">
      <div className="flex-1 flex items-center justify-center">
        <div className="bg-white p-8 rounded-xl border border-gray-200 w-full max-w-md">
          <div className="flex justify-center mb-6">
          <div className="bg-[#128C7E] p-3 rounded-full text-white">
            <Lock size={24} />
          </div>
        </div>
        <h1 className="text-xl sm:text-2xl font-bold text-center text-gray-800 mb-6">Painel Administrativo</h1>
        
        {error && (
          <div className="bg-red-50 text-red-500 p-3 rounded-md mb-4 text-sm text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Login</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#128C7E] outline-none"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Senha</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full p-2 pr-10 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#128C7E] outline-none"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-[#128C7E] transition-colors"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>
          <button
              type="submit"
              className="w-full bg-[#128C7E] text-white py-2 px-4 rounded-md hover:bg-[#075E54] transition-colors font-medium"
            >
              Entrar
            </button>
          </form>
        </div>
      </div>

      <div className="flex justify-end text-[11px] text-gray-400 pt-4 pb-2 pr-2">
        <div>
          Desenvolvido pela{' '}
          <a 
            href="https://www.heybrothers.site/" 
            target="_blank" 
            rel="noopener noreferrer"
            className="font-semibold text-gray-500 hover:text-[#128C7E] transition-colors"
          >
            HEYBROTHERS
          </a>
          .
        </div>
      </div>
    </div>
  );
}
