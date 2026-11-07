import React, { useState } from 'react';
import { AuthUser, PaymentConfig } from '../types';

interface AuthScreenProps {
  onAuthenticated: (token: string, user: AuthUser, paymentConfig: PaymentConfig) => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onAuthenticated }) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const body =
        mode === 'login'
          ? { email, password }
          : { name, company, email, phone, password, promoCode };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Errore durante l'autenticazione.");
      }
      onAuthenticated(data.token, data.user, data.paymentConfig);
    } catch (err: any) {
      setError(err?.message || 'Errore di connessione al server.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto py-6 space-y-10 animate-fade-in">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
        {/* Left column: Value proposition */}
        <div className="lg:col-span-7 space-y-6">
          <span className="inline-block px-3 py-1 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold uppercase tracking-wider">
            Piattaforma Professionale Riservata
          </span>
          <h2 className="text-3xl md:text-4xl font-extrabold text-slate-900 leading-tight">
            Analisi Bilancio, Cash Flow e Pianificazione Rate AI
          </h2>
          <p className="text-slate-600 text-base leading-relaxed">
            <strong>CondoRate</strong> analizza con l'Intelligenza Artificiale i consuntivi e i
            preventivi condominiali, ricostruisce l'andamento storico delle spese, verifica la
            quadratura contabile e simula il piano rateale ottimale con proiezione mensile di cassa
            e report PDF professionale.
          </p>

          <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-6 space-y-3">
            <h3 className="font-bold text-slate-900 flex items-center gap-2">
              <i className="fas fa-lock text-indigo-600"></i>
              <span>Come funziona l'accesso al servizio:</span>
            </h3>
            <ol className="text-sm text-slate-700 space-y-2 list-decimal list-inside">
              <li>
                <strong>Registrati gratuitamente</strong> inserendo i dati del tuo Studio o
                Condominio.
              </li>
              <li>
                <strong>Hai un Codice Promo?</strong> Inseriscilo per sbloccare subito la tua prova
                gratuita, oppure scegli il tuo pacchetto analisi (PayPal o Bonifico).
              </li>
              <li>
                <strong>Avvia subito le tue analisi finanziarie</strong> e scarica il report
                completo in PDF.
              </li>
            </ol>
          </div>
        </div>

        {/* Right column: Auth Card */}
        <div className="lg:col-span-5">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-xl p-8">
            {/* Mode Tabs */}
            <div className="grid grid-cols-2 bg-slate-100 p-1 rounded-xl mb-6">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError(null);
                }}
                className={`py-2.5 text-sm font-bold rounded-lg transition ${
                  mode === 'login'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Accedi
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setError(null);
                }}
                className={`py-2.5 text-sm font-bold rounded-lg transition ${
                  mode === 'register'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                Registrati
              </button>
            </div>

            <h3 className="text-xl font-bold text-slate-900 mb-1">
              {mode === 'login' ? 'Bentornato su CondoRate' : 'Richiedi Abilitazione'}
            </h3>
            <p className="text-xs text-slate-500 mb-6">
              {mode === 'login'
                ? 'Inserisci le tue credenziali per accedere alla dashboard di analisi.'
                : "Compila il modulo per creare il tuo account e procedere all'attivazione."}
            </p>

            {error && (
              <div className="mb-4 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium flex items-center gap-2">
                <i className="fas fa-exclamation-triangle"></i>
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'register' && (
                <>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                      Nome e Cognome *
                    </label>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Es. Mario Rossi"
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                        Studio / Società
                      </label>
                      <input
                        type="text"
                        value={company}
                        onChange={(e) => setCompany(e.target.value)}
                        placeholder="Studio Amm. Rossi"
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                        Telefono
                      </label>
                      <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="+39 333 ..."
                        className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  </div>
                </>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Indirizzo Email *
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="nome@studio.it"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Password *
                </label>
                <input
                  type="password"
                  required
                  minLength={4}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {mode === 'register' && (
                <div className="pt-1">
                  <label className="block text-xs font-bold text-amber-700 uppercase mb-1 flex items-center gap-1.5">
                    <i className="fas fa-gift text-amber-500"></i>
                    <span>Codice Promo / Prova Gratuita (Opzionale)</span>
                  </label>
                  <input
                    type="text"
                    autoComplete="off"
                    value={promoCode}
                    onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                    placeholder="Se hai un codice invito inseriscilo qui"
                    className="w-full px-4 py-2.5 rounded-xl border border-amber-300 bg-amber-50/50 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-bold rounded-xl shadow-lg transition flex items-center justify-center gap-2 mt-2"
              >
                {loading ? (
                  <>
                    <i className="fas fa-circle-notch animate-spin"></i>
                    <span>Attendere...</span>
                  </>
                ) : mode === 'login' ? (
                  <>
                    <i className="fas fa-sign-in-alt"></i>
                    <span>Accedi alla Piattaforma</span>
                  </>
                ) : (
                  <>
                    <i className="fas fa-user-plus"></i>
                    <span>{promoCode ? 'Attiva con Codice Promo' : 'Crea Account e Continua'}</span>
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};
