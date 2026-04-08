import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock } from 'lucide-react';

export default function AdminLogin() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (username === 'webooter' && password === 'I4l94W|9R=v{') {
      localStorage.setItem('admin_auth', 'true');
      navigate('/admin');
    } else {
      setError('Credenciais inválidas');
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-md">
        <div className="flex justify-center mb-6">
          <div className="bg-[#128C7E] p-3 rounded-full text-white">
            <Lock size={24} />
          </div>
        </div>
        <h1 className="text-2xl font-bold text-center text-gray-800 mb-6">Painel Administrativo</h1>
        
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
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#128C7E] outline-none"
              required
            />
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
  );
}
