import React, { useState } from 'react';
import { AuthUser, PaymentConfig } from '../types';

interface ActivationScreenProps {
  token: string;
  user: AuthUser;
  paymentConfig: PaymentConfig;
  onRefreshStatus: () => Promise<void>;
}

export const ActivationScreen: React.FC<ActivationScreenProps> = ({
  token,
  user,
  paymentConfig,
  onRefreshStatus,
}) => {
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [promoCode, setPromoCode] = useState('');
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);

  const isExpired =
    user.expiresAt && new Date(user.expiresAt + 'T23:59:59') < new Date();
  const isOutOfCredits =
    user.status === 'active' && !isExpired && user.credits !== -1 && user.credits <= 0;

  let badgeText = 'In Attesa di Attivazione';
  let badgeColor = 'bg-amber-100 text-amber-800 border-amber-200';
  let titleText = `Benvenuto, ${user.name}! Il tuo account è in attesa di abilitazione`;

  if (user.status === 'suspended') {
    badgeText = 'Account Sospeso';
    badgeColor = 'bg-rose-100 text-rose-800 border-rose-200';
    titleText = 'Il tuo account è temporaneamente sospeso';
  } else if (isExpired) {
    badgeText = `Abbonamento Scaduto (${user.expiresAt})`;
    badgeColor = 'bg-rose-100 text-rose-800 border-rose-200';
    titleText = 'Il tuo periodo di abbonamento è terminato';
  } else if (isOutOfCredits) {
    badgeText = 'Crediti di Analisi Esauriti';
    badgeColor = 'bg-amber-100 text-amber-800 border-amber-200';
    titleText = 'Hai utilizzato tutte le analisi del tuo pacchetto';
  }

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefreshStatus();
    } finally {
      setTimeout(() => setRefreshing(false), 600);
    }
  };

  const handleRedeemPromo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!promoCode.trim()) return;
    setPromoLoading(true);
    setPromoError(null);
    try {
      const res = await fetch('/api/auth/redeem-promo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ promoCode }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Codice promo non valido.');
      }
      await onRefreshStatus();
    } catch (err: any) {
      setPromoError(err?.message || 'Errore verifica codice promo.');
    } finally {
      setPromoLoading(false);
    }
  };

  const copyIban = () => {
    if (!paymentConfig.iban) return;
    navigator.clipboard.writeText(paymentConfig.iban);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-4xl mx-auto py-8 animate-fade-in">
      <div className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden">
        {/* Top Banner */}
        <div className="bg-slate-900 text-white p-8 text-center">
          <span
            className={`inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-xs font-bold border mb-4 ${badgeColor}`}
          >
            <i className="fas fa-clock"></i>
            <span>{badgeText}</span>
          </span>
          <h2 className="text-2xl md:text-3xl font-extrabold mb-2">{titleText}</h2>
          <p className="text-slate-300 text-sm max-w-xl mx-auto">
            {paymentConfig.welcomeMessage}
          </p>
        </div>

        <div className="p-8 space-y-8">
          {/* Promo Code Box */}
          {paymentConfig.promoEnabled !== false && user.status !== 'suspended' && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h3 className="text-sm font-extrabold uppercase tracking-wider text-amber-900 flex items-center gap-2">
                    <i className="fas fa-gift text-amber-600 text-base"></i>
                    <span>Hai un Codice Promo o Invito Gratuito?</span>
                  </h3>
                  <p className="text-xs text-amber-800 mt-1">
                    Inserisci il codice fornito da Studio Serra per sbloccare subito il tuo account
                    senza pagamento.
                  </p>
                </div>

                <form onSubmit={handleRedeemPromo} className="flex items-center gap-2">
                  <input
                    type="text"
                    autoComplete="off"
                    value={promoCode}
                    onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                    placeholder="CODICE PROMO"
                    className="px-4 py-2.5 rounded-xl border border-amber-300 bg-white text-xs font-mono font-bold uppercase focus:outline-none focus:ring-2 focus:ring-amber-500 w-44"
                  />
                  <button
                    type="submit"
                    disabled={promoLoading || !promoCode.trim()}
                    className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-extrabold text-xs rounded-xl shadow-sm transition whitespace-nowrap"
                  >
                    {promoLoading ? 'Verifica...' : 'Attiva Ora'}
                  </button>
                </form>
              </div>
              {promoError && (
                <div className="mt-3 text-xs font-bold text-rose-600 flex items-center gap-1.5">
                  <i className="fas fa-exclamation-circle"></i>
                  <span>{promoError}</span>
                </div>
              )}
            </div>
          )}

          {/* Pricing / Plans Box */}
          {paymentConfig.plansText && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-6">
              <h3 className="text-sm font-extrabold uppercase tracking-wider text-indigo-900 mb-3 flex items-center gap-2">
                <i className="fas fa-tags text-indigo-600"></i>
                <span>Piani e Pacchetti di Analisi Disponibili</span>
              </h3>
              <div className="text-slate-800 text-sm whitespace-pre-line leading-relaxed font-medium">
                {paymentConfig.plansText}
              </div>
            </div>
          )}

          {/* Direct Payment (PayPal QR) & Bank Transfer (IBAN) Side-by-Side */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Option 1: PayPal QR Code & Online Payment */}
            <div className="border border-slate-200 rounded-2xl p-6 flex flex-col justify-between bg-slate-50/60">
              <div>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center">
                    <i className="fab fa-paypal text-xl"></i>
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-900 text-base">
                      1. Pagamento Rapido PayPal
                    </h4>
                    <p className="text-xs text-slate-500">
                      Inquadra il QR Code con il telefono o l'app PayPal
                    </p>
                  </div>
                </div>

                <div className="my-4 flex flex-col items-center justify-center bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                  <img
                    src="/paypal-qr.png"
                    alt="QR Code PayPal Studio Serra"
                    className="w-44 h-44 object-contain"
                  />
                  <span className="text-[11px] font-bold text-blue-700 mt-2">
                    Scansiona per pagare con PayPal
                  </span>
                </div>
              </div>

              {paymentConfig.paymentUrl && (
                <a
                  href={paymentConfig.paymentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full py-3.5 px-4 bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm rounded-xl shadow-md transition flex items-center justify-center gap-2 text-center mt-2"
                >
                  <i className="fas fa-external-link-alt"></i>
                  <span>Apri Link Pagamento Online</span>
                </a>
              )}
            </div>

            {/* Option 2: Bank Transfer (IBAN) & Direct Contact */}
            <div className="border border-slate-200 rounded-2xl p-6 flex flex-col justify-between bg-slate-50/60">
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center">
                    <i className="fas fa-university text-lg"></i>
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-900 text-base">
                      2. Bonifico Bancario / Studio Serra
                    </h4>
                    <p className="text-xs text-slate-500">
                      Coordinate bancarie per bonifico ordinario o istantaneo
                    </p>
                  </div>
                </div>

                <div className="text-xs text-slate-600 space-y-3 mb-6 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                  <p>
                    <strong>Intestatario:</strong>{' '}
                    <span className="text-slate-900 font-semibold">
                      {paymentConfig.bankBeneficiary || 'Studio Serra'}
                    </span>
                  </p>
                  {paymentConfig.iban ? (
                    <div>
                      <span className="block font-bold text-slate-700 mb-1">IBAN:</span>
                      <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between gap-2">
                        <span className="font-mono font-bold text-slate-900 text-xs break-all">
                          {paymentConfig.iban}
                        </span>
                        <button
                          type="button"
                          onClick={copyIban}
                          className="px-2.5 py-1 rounded-lg bg-indigo-100 text-indigo-700 hover:bg-indigo-200 font-bold text-[11px] flex-shrink-0 transition"
                        >
                          {copied ? 'Copiato!' : 'Copia'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-slate-400 italic">
                      Richiedi le coordinate IBAN allo Studio cliccando qui sotto.
                    </p>
                  )}
                  <p>
                    <strong>Causale:</strong>{' '}
                    <span className="text-slate-800">Attivazione CondoRate - {user.email}</span>
                  </p>
                  {paymentConfig.contactPhone && (
                    <p>
                      <strong>Telefono / WhatsApp:</strong>{' '}
                      <span className="text-slate-900 font-semibold">
                        {paymentConfig.contactPhone}
                      </span>
                    </p>
                  )}
                </div>
              </div>

              <a
                href={`mailto:${paymentConfig.contactEmail || 'direzione@serrastudio.it'}?subject=${encodeURIComponent(
                  `Conferma Pagamento CondoRate - ${user.name}`
                )}&body=${encodeURIComponent(
                  `Buongiorno Studio Serra,\n\nho registrato l'account ${user.email} (${user.company || user.name}) su CondoRate ed effettuato il pagamento. Richiedo l'attivazione dei crediti.\n\nCordiali saluti,\n${user.name}\nTel: ${user.phone}`
                )}`}
                className="w-full py-3.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm rounded-xl shadow-md transition flex items-center justify-center gap-2 text-center"
              >
                <i className="fas fa-paper-plane"></i>
                <span>Invia Conferma Pagamento allo Studio</span>
              </a>
            </div>
          </div>

          {/* Refresh Status Bar */}
          <div className="pt-4 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-xs text-slate-500">
              Account registrato come <strong>{user.email}</strong>. Non appena l'amministratore
              abilita il tuo profilo, clicca sul pulsante qui accanto per entrare.
            </div>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              className="w-full sm:w-auto px-6 py-3 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl transition flex items-center justify-center gap-2 flex-shrink-0"
            >
              <i className={`fas fa-sync-alt ${refreshing ? 'animate-spin' : ''}`}></i>
              <span>Verifica Stato Attivazione</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
