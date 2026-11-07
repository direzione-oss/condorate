import React, { useEffect, useState } from 'react';
import { AuditLogEntry, AuthUser, PaymentConfig } from '../types';

interface AdminModalProps {
  token: string;
  onClose: () => void;
  onUpdated: () => void;
}

export const AdminModal: React.FC<AdminModalProps> = ({ token, onClose, onUpdated }) => {
  const [tab, setTab] = useState<'users' | 'payments' | 'logs'>('users');
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [paymentConfig, setPaymentConfig] = useState<PaymentConfig>({
    paymentUrl: 'https://www.paypal.com/ncp/payment/PT6CMLQUZ4PNN',
    iban: 'IT75K0538711109000042551402',
    bankBeneficiary: 'Studio Serra',
    contactEmail: 'direzione@serrastudio.it',
    contactPhone: '3384119923',
    plansText: '',
    welcomeMessage: '',
    promoEnabled: true,
    promoCode: 'ANACI-2026',
    promoCredits: 5,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // New user form
  const [showNewUser, setShowNewUser] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCompany, setNewCompany] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newCredits, setNewCredits] = useState('5');
  const [newExpiresAt, setNewExpiresAt] = useState('');

  const fetchOverview = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/overview', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setUsers(data.users || []);
        setPaymentConfig(data.paymentConfig || paymentConfig);
        setAuditLogs(data.auditLogs || []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOverview();
  }, []);

  const flash = (msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(null), 3000);
  };

  const updateUser = async (id: string, patch: Record<string, any>) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${id}/update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (res.ok) {
        setUsers(data.users);
        onUpdated();
        flash('Utente aggiornato con successo!');
      } else {
        alert(data.error || 'Errore aggiornamento utente');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/admin/users/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: newName,
          company: newCompany,
          email: newEmail,
          phone: newPhone,
          password: newPassword,
          status: 'active',
          credits: Number(newCredits),
          expiresAt: newExpiresAt || null,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setUsers(data.users);
        setShowNewUser(false);
        setNewName('');
        setNewCompany('');
        setNewEmail('');
        setNewPhone('');
        setNewPassword('');
        onUpdated();
        flash('Nuovo cliente creato e attivato!');
      } else {
        alert(data.error || 'Errore creazione cliente');
      }
    } finally {
      setSaving(false);
    }
  };

  const deleteUser = async (u: AuthUser) => {
    if (!confirm(`Vuoi davvero eliminare l'account di ${u.name} (${u.email})?`)) return;
    const res = await fetch(`/api/admin/users/${u.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (res.ok) {
      setUsers(data.users);
      onUpdated();
      flash('Utente eliminato.');
    }
  };

  const savePaymentSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/admin/payment-config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(paymentConfig),
      });
      if (res.ok) {
        onUpdated();
        flash('Impostazioni di pagamento salvate!');
      }
    } finally {
      setSaving(false);
    }
  };

  const oneYearFromNow = () => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    return d.toISOString().split('T')[0];
  };

  const pendingCount = users.filter((u) => u.status === 'pending').length;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500 text-slate-950 flex items-center justify-center font-bold">
              <i className="fas fa-user-shield text-lg"></i>
            </div>
            <div>
              <h2 className="text-lg font-extrabold">Pannello Amministratore — CondoRate</h2>
              <p className="text-xs text-slate-400">
                Approva gli iscritti, assegna crediti di analisi e configura i pagamenti
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center"
          >
            <i className="fas fa-times"></i>
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="bg-slate-100 px-6 py-2.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setTab('users')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
                tab === 'users'
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-200'
              }`}
            >
              <i className="fas fa-users"></i>
              <span>Clienti Registrati ({users.length})</span>
              {pendingCount > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-amber-400 text-slate-950 font-extrabold">
                  {pendingCount} in attesa
                </span>
              )}
            </button>
            <button
              onClick={() => setTab('payments')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
                tab === 'payments'
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-200'
              }`}
            >
              <i className="fas fa-credit-card"></i>
              <span>Configura Pagamenti / IBAN / Tariffe</span>
            </button>
            <button
              onClick={() => setTab('logs')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
                tab === 'logs'
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-200'
              }`}
            >
              <i className="fas fa-history"></i>
              <span>Storico Analisi ({auditLogs.length})</span>
            </button>
          </div>

          {message && (
            <div className="px-3 py-1 rounded-lg bg-emerald-100 text-emerald-800 text-xs font-bold flex items-center gap-1.5">
              <i className="fas fa-check-circle"></i>
              <span>{message}</span>
            </div>
          )}
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto flex-grow space-y-6">
          {loading ? (
            <div className="py-16 text-center text-slate-500">Caricamento dati...</div>
          ) : tab === 'users' ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-slate-500">
                  Clicca sui pulsanti rapidi per <strong>approvare un utente dopo il pagamento</strong>{' '}
                  o modifica direttamente crediti e data di scadenza.
                </div>
                <button
                  onClick={() => setShowNewUser(!showNewUser)}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl shadow-sm transition flex items-center gap-2"
                >
                  <i className="fas fa-plus"></i>
                  <span>Nuovo Cliente Manuale</span>
                </button>
              </div>

              {showNewUser && (
                <form
                  onSubmit={handleCreateUser}
                  className="bg-slate-50 border border-slate-200 rounded-2xl p-5 grid grid-cols-1 sm:grid-cols-3 gap-3"
                >
                  <input
                    type="text"
                    required
                    placeholder="Nome e Cognome *"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="px-3 py-2 rounded-xl border border-slate-300 text-xs"
                  />
                  <input
                    type="text"
                    placeholder="Studio / Condominio"
                    value={newCompany}
                    onChange={(e) => setNewCompany(e.target.value)}
                    className="px-3 py-2 rounded-xl border border-slate-300 text-xs"
                  />
                  <input
                    type="email"
                    required
                    placeholder="Email *"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    className="px-3 py-2 rounded-xl border border-slate-300 text-xs"
                  />
                  <input
                    type="text"
                    placeholder="Telefono"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    className="px-3 py-2 rounded-xl border border-slate-300 text-xs"
                  />
                  <input
                    type="text"
                    required
                    placeholder="Password iniziale *"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="px-3 py-2 rounded-xl border border-slate-300 text-xs"
                  />
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      placeholder="Crediti (-1 = illimitati)"
                      value={newCredits}
                      onChange={(e) => setNewCredits(e.target.value)}
                      className="w-28 px-3 py-2 rounded-xl border border-slate-300 text-xs"
                    />
                    <input
                      type="date"
                      value={newExpiresAt}
                      onChange={(e) => setNewExpiresAt(e.target.value)}
                      className="flex-1 px-3 py-2 rounded-xl border border-slate-300 text-xs"
                    />
                    <button
                      type="submit"
                      disabled={saving}
                      className="px-4 py-2 bg-slate-900 text-white text-xs font-bold rounded-xl"
                    >
                      Crea
                    </button>
                  </div>
                </form>
              )}

              <div className="space-y-3">
                {users.map((u) => (
                  <div
                    key={u.id}
                    className={`rounded-2xl border p-4 transition ${
                      u.status === 'pending'
                        ? 'bg-amber-50/70 border-amber-300'
                        : u.status === 'suspended'
                        ? 'bg-rose-50/40 border-rose-200'
                        : 'bg-white border-slate-200'
                    }`}
                  >
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                      {/* User Info */}
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-extrabold text-slate-900 text-sm">{u.name}</span>
                          {u.company && (
                            <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded-md font-medium">
                              {u.company}
                            </span>
                          )}
                          {u.role === 'admin' ? (
                            <span className="text-[10px] px-2 py-0.5 bg-purple-100 text-purple-800 rounded-full font-bold uppercase">
                              Amministratore
                            </span>
                          ) : u.status === 'pending' ? (
                            <span className="text-[10px] px-2.5 py-0.5 bg-amber-400 text-slate-950 rounded-full font-extrabold uppercase">
                              ⏳ In Attesa di Approvazione
                            </span>
                          ) : u.status === 'active' ? (
                            <span className="text-[10px] px-2.5 py-0.5 bg-emerald-100 text-emerald-800 rounded-full font-bold uppercase">
                              ✅ Attivo
                            </span>
                          ) : (
                            <span className="text-[10px] px-2.5 py-0.5 bg-rose-100 text-rose-800 rounded-full font-bold uppercase">
                              ⛔ Sospeso
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 flex flex-wrap items-center gap-3">
                          <span>
                            <i className="fas fa-envelope mr-1"></i>
                            {u.email}
                          </span>
                          {u.phone && (
                            <span>
                              <i className="fas fa-phone mr-1"></i>
                              {u.phone}
                            </span>
                          )}
                          <span>
                            Analisi effettuate: <strong>{u.analysesCount || 0}</strong>
                          </span>
                          <span>
                            Iscritto il: {new Date(u.createdAt).toLocaleDateString('it-IT')}
                          </span>
                        </div>
                      </div>

                      {/* Quick Action Buttons + Controls */}
                      <div className="flex flex-wrap items-center gap-2">
                        {u.role !== 'admin' && (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                updateUser(u.id, {
                                  status: 'active',
                                  credits: (u.credits > 0 ? u.credits : 0) + 1,
                                })
                              }
                              className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition"
                              title="Attiva l'utente e aggiungi 1 analisi"
                            >
                              ✅ Attiva (+1 analisi)
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                updateUser(u.id, {
                                  status: 'active',
                                  credits: (u.credits > 0 ? u.credits : 0) + 5,
                                })
                              }
                              className="px-3 py-1.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold transition"
                              title="Attiva l'utente e aggiungi 5 analisi"
                            >
                              +5 analisi
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                updateUser(u.id, {
                                  status: 'active',
                                  credits: -1,
                                  expiresAt: oneYearFromNow(),
                                })
                              }
                              className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition"
                              title="Attiva abbonamento illimitato per 1 anno"
                            >
                              ♾️ Illimitato 1 Anno
                            </button>

                            {/* Direct Credits Input */}
                            <div className="flex items-center gap-1 bg-slate-100 px-2 py-1 rounded-xl border border-slate-200">
                              <span className="text-[10px] font-bold text-slate-500">Crediti:</span>
                              <input
                                type="number"
                                value={u.credits}
                                onChange={(e) =>
                                  updateUser(u.id, { credits: Number(e.target.value) })
                                }
                                className="w-14 px-1.5 py-0.5 rounded bg-white border border-slate-300 text-xs font-bold text-center"
                                title="-1 per illimitati"
                              />
                            </div>

                            {/* Direct Expiration Date Input */}
                            <div className="flex items-center gap-1 bg-slate-100 px-2 py-1 rounded-xl border border-slate-200">
                              <span className="text-[10px] font-bold text-slate-500">Scad:</span>
                              <input
                                type="date"
                                value={u.expiresAt || ''}
                                onChange={(e) =>
                                  updateUser(u.id, { expiresAt: e.target.value || null })
                                }
                                className="px-1.5 py-0.5 rounded bg-white border border-slate-300 text-xs"
                              />
                            </div>

                            {/* Status Toggle */}
                            {u.status === 'active' ? (
                              <button
                                type="button"
                                onClick={() => updateUser(u.id, { status: 'suspended' })}
                                className="px-2.5 py-1.5 rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-900 text-xs font-bold"
                                title="Sospendi accesso"
                              >
                                <i className="fas fa-pause"></i>
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => updateUser(u.id, { status: 'active' })}
                                className="px-2.5 py-1.5 rounded-xl bg-emerald-100 hover:bg-emerald-200 text-emerald-900 text-xs font-bold"
                                title="Riattiva accesso"
                              >
                                <i className="fas fa-play"></i>
                              </button>
                            )}

                            {/* Reset Password */}
                            <button
                              type="button"
                              onClick={() => {
                                const np = prompt(
                                  `Inserisci la nuova password per ${u.name} (${u.email}):`
                                );
                                if (np && np.trim().length >= 4) {
                                  updateUser(u.id, { newPassword: np.trim() });
                                }
                              }}
                              className="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold"
                              title="Cambia password utente"
                            >
                              <i className="fas fa-key"></i>
                            </button>

                            <button
                              type="button"
                              onClick={() => deleteUser(u)}
                              className="px-2.5 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 text-xs font-bold"
                              title="Elimina utente"
                            >
                              <i className="fas fa-trash"></i>
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : tab === 'payments' ? (
            <form onSubmit={savePaymentSettings} className="space-y-4 max-w-3xl">
              {/* Promo Code Configuration Box */}
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <i className="fas fa-gift text-amber-600 text-lg"></i>
                    <h4 className="text-sm font-extrabold text-amber-950 uppercase tracking-wide">
                      Codice Promo per Prova Gratuita (Senza Pagamento)
                    </h4>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-amber-900">
                    <input
                      type="checkbox"
                      checked={paymentConfig.promoEnabled !== false}
                      onChange={(e) =>
                        setPaymentConfig({ ...paymentConfig, promoEnabled: e.target.checked })
                      }
                      className="w-4 h-4 accent-amber-600 rounded"
                    />
                    <span>Codice Promo Attivo</span>
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-amber-900 uppercase mb-1">
                      Codice Promo Segreto (da dare agli invitati)
                    </label>
                    <input
                      type="text"
                      autoComplete="off"
                      value={paymentConfig.promoCode || 'ANACI-2026'}
                      onChange={(e) =>
                        setPaymentConfig({
                          ...paymentConfig,
                          promoCode: e.target.value.toUpperCase(),
                        })
                      }
                      placeholder="Es. ANACI-2026"
                      className="w-full px-4 py-2.5 rounded-xl border border-amber-300 bg-white text-sm font-mono font-extrabold uppercase"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-amber-900 uppercase mb-1">
                      Analisi Gratuite Sbloccate dal Codice
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={paymentConfig.promoCredits || 1}
                      onChange={(e) =>
                        setPaymentConfig({
                          ...paymentConfig,
                          promoCredits: Math.max(1, Number(e.target.value)),
                        })
                      }
                      className="w-full px-4 py-2.5 rounded-xl border border-amber-300 bg-white text-sm font-bold"
                    />
                  </div>
                </div>
                <p className="text-[11px] text-amber-800">
                  Chi inserisce questo codice (in fase di registrazione o nella pagina di
                  attivazione) entra subito senza pagare con il numero di analisi gratuite indicato
                  qui sopra.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Link Pagamento Diretto Online (Stripe / PayPal / SumUp)
                </label>
                <input
                  type="url"
                  placeholder="Es. https://buy.stripe.com/... oppure https://www.paypal.com/paypalme/..."
                  value={paymentConfig.paymentUrl}
                  onChange={(e) =>
                    setPaymentConfig({ ...paymentConfig, paymentUrl: e.target.value })
                  }
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Se compilato, gli utenti in attesa vedranno il bottone diretto "Apri Link
                  Pagamento Online".
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center">
                <div className="sm:col-span-4">
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                    Intestatario Conto / Studio
                  </label>
                  <input
                    type="text"
                    autoComplete="off"
                    value={paymentConfig.bankBeneficiary}
                    onChange={(e) =>
                      setPaymentConfig({ ...paymentConfig, bankBeneficiary: e.target.value })
                    }
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm"
                  />
                </div>
                <div className="sm:col-span-5">
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                    Coordinate Bonifico (Codice Conto)
                  </label>
                  <input
                    type="text"
                    autoComplete="off"
                    name="bank_coord_custom"
                    placeholder="IT00 X000 0000 0000 0000 0000 000"
                    value={paymentConfig.iban}
                    onChange={(e) => setPaymentConfig({ ...paymentConfig, iban: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm font-mono"
                  />
                </div>
                <div className="sm:col-span-3 flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl p-2.5">
                  <img
                    src="/paypal-qr.png"
                    alt="PayPal QR"
                    className="w-14 h-14 object-contain rounded-lg bg-white p-1 border border-blue-100 flex-shrink-0"
                  />
                  <div className="text-[11px] leading-tight text-blue-900">
                    <strong className="block">QR PayPal Attivo</strong>
                    <span className="text-blue-700">Mostrato accanto all'IBAN</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                    Email Contatto Assistenza / Invio Contabile
                  </label>
                  <input
                    type="email"
                    value={paymentConfig.contactEmail}
                    onChange={(e) =>
                      setPaymentConfig({ ...paymentConfig, contactEmail: e.target.value })
                    }
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                    Telefono / WhatsApp Studio
                  </label>
                  <input
                    type="text"
                    value={paymentConfig.contactPhone}
                    onChange={(e) =>
                      setPaymentConfig({ ...paymentConfig, contactPhone: e.target.value })
                    }
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Listino Piani e Pacchetti (mostrato ai clienti non ancora attivi)
                </label>
                <textarea
                  rows={4}
                  value={paymentConfig.plansText}
                  onChange={(e) =>
                    setPaymentConfig({ ...paymentConfig, plansText: e.target.value })
                  }
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                  Messaggio di Benvenuto nella pagina di Attivazione
                </label>
                <textarea
                  rows={2}
                  value={paymentConfig.welcomeMessage}
                  onChange={(e) =>
                    setPaymentConfig({ ...paymentConfig, welcomeMessage: e.target.value })
                  }
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm"
                />
              </div>

              <button
                type="submit"
                disabled={saving}
                className="px-6 py-3 bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm rounded-xl shadow-md transition"
              >
                Salva Configurazione Pagamenti
              </button>
            </form>
          ) : (
            <div className="space-y-2">
              {auditLogs.length === 0 ? (
                <div className="py-12 text-center text-slate-400 text-sm">
                  Nessuna analisi registrata finora.
                </div>
              ) : (
                auditLogs.map((log) => (
                  <div
                    key={log.id}
                    className="p-3.5 rounded-xl border border-slate-200 flex items-center justify-between text-xs"
                  >
                    <div>
                      <span className="font-bold text-slate-900">{log.condoName}</span>
                      <span className="text-slate-400 mx-2">•</span>
                      <span className="text-slate-600">{log.userEmail}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-800 font-bold">
                        Completata
                      </span>
                      <span className="text-slate-400">
                        {new Date(log.createdAt).toLocaleString('it-IT')}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
