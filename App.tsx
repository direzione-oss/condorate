import React, { useState, useMemo, useEffect, useRef } from 'react';
import { FileUpload } from './components/FileUpload';
import { ExpenseChart } from './components/ExpenseChart';
import { FilterBar } from './components/FilterBar';
import { CategoryChart } from './components/CategoryChart';
import { ExpenseTable } from './components/ExpenseTable';
import { BudgetPlanner } from './components/BudgetPlanner';
import { AuthScreen } from './components/AuthScreen';
import { ActivationScreen } from './components/ActivationScreen';
import { AdminModal } from './components/AdminModal';
import { parseFinancialStatement } from './services/geminiService';
import { fileToBase64, formatCurrency } from './utils/fileUtils';
import {
  Expense,
  ProcessingStatus,
  FilterState,
  Installment,
  AuthUser,
  PaymentConfig,
} from './types';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

const TOKEN_KEY = 'condorate_auth_token';

const defaultPaymentConfig: PaymentConfig = {
  paymentUrl: 'https://www.paypal.com/ncp/payment/PT6CMLQUZ4PNN',
  iban: 'IT75K0538711109000042551402',
  bankBeneficiary: 'Studio Serra',
  contactEmail: 'direzione@serrastudio.it',
  contactPhone: '3384119923',
  plansText:
    '• Singola Analisi Finanziaria: 2 €\n• Pacchetto 5 Analisi: 8 €\n• Abbonamento Annuale Studio (Analisi Illimitate): 100 €/anno',
  welcomeMessage:
    "Il tuo account è stato registrato con successo. Per abilitare l'accesso a CondoRate e caricare i tuoi crediti di analisi, completa il pagamento ed attendi l'attivazione da parte di Studio Serra.",
};

function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<AuthUser | null>(null);
  const [paymentConfig, setPaymentConfig] = useState<PaymentConfig>(defaultPaymentConfig);
  const [authChecking, setAuthChecking] = useState<boolean>(true);
  const [showAdmin, setShowAdmin] = useState<boolean>(false);
  const [pendingCount, setPendingCount] = useState<number>(0);

  const [status, setStatus] = useState<ProcessingStatus>(ProcessingStatus.IDLE);
  const [allExpenses, setAllExpenses] = useState<Expense[]>([]);
  const [openingBalance, setOpeningBalance] = useState<number>(0);
  const [closingBalance, setClosingBalance] = useState<number>(0);
  const [extractedBalance, setExtractedBalance] = useState<number>(0);
  const [reportedTotal, setReportedTotal] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [progressMsg, setProgressMsg] = useState<string>('');
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [analyzedFiles, setAnalyzedFiles] = useState<string[]>([]);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [installmentsData, setInstallmentsData] = useState<Installment[]>([]);
  const [historicalFiscalStart, setHistoricalFiscalStart] = useState<string | undefined>(undefined);
  const [historicalFiscalEnd, setHistoricalFiscalEnd] = useState<string | undefined>(undefined);

  const [filters, setFilters] = useState<FilterState>({
    startDate: '',
    endDate: '',
    selectedCategories: [],
    granularity: 'month',
  });

  const refreshProfile = async (activeToken = token) => {
    if (!activeToken) {
      setAuthChecking(false);
      return;
    }
    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${activeToken}` },
      });
      if (!res.ok) {
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setUser(null);
        return;
      }
      const data = await res.json();
      setUser(data.user);
      if (data.paymentConfig) setPaymentConfig(data.paymentConfig);

      if (data.user?.role === 'admin') {
        const admRes = await fetch('/api/admin/overview', {
          headers: { Authorization: `Bearer ${activeToken}` },
        });
        if (admRes.ok) {
          const admData = await admRes.json();
          const pCount = (admData.users || []).filter(
            (u: AuthUser) => u.status === 'pending'
          ).length;
          setPendingCount(pCount);
        }
      }
    } catch (err) {
      console.error('Auth check failed:', err);
    } finally {
      setAuthChecking(false);
    }
  };

  useEffect(() => {
    refreshProfile(token);
  }, []);

  const handleAuthenticated = (
    newToken: string,
    loggedUser: AuthUser,
    payCfg: PaymentConfig
  ) => {
    localStorage.setItem(TOKEN_KEY, newToken);
    setToken(newToken);
    setUser(loggedUser);
    if (payCfg) setPaymentConfig(payCfg);
    if (loggedUser.role === 'admin') {
      refreshProfile(newToken);
    }
  };

  const handleLogout = async () => {
    if (token) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    reset();
  };

  const isUserAllowedToAnalyze = (u: AuthUser | null): boolean => {
    if (!u) return false;
    if (u.role === 'admin') return true;
    if (u.status !== 'active') return false;
    if (u.expiresAt && new Date(u.expiresAt + 'T23:59:59') < new Date()) return false;
    if (u.credits !== -1 && u.credits <= 0) return false;
    return true;
  };

  const availableCategories = useMemo(() => {
    const cats = new Set(allExpenses.map((e) => e.category || 'Altro'));
    return Array.from(cats).sort();
  }, [allExpenses]);

  useEffect(() => {
    if (allExpenses.length > 0) {
      const dates = allExpenses.map((e) => e.date).sort();
      const minDate = dates[0];
      const maxDate = dates[dates.length - 1];

      setFilters((prev) => ({
        ...prev,
        startDate: minDate,
        endDate: maxDate,
        selectedCategories: Array.from(new Set(allExpenses.map((e) => e.category || 'Altro'))).sort(),
      }));
    }
  }, [allExpenses]);

  const filteredExpenses = useMemo(() => {
    return allExpenses.filter((expense) => {
      const expenseDate = expense.date;
      const isAfterStart = !filters.startDate || expenseDate >= filters.startDate;
      const isBeforeEnd = !filters.endDate || expenseDate <= filters.endDate;
      const isCategorySelected = filters.selectedCategories.includes(expense.category || 'Altro');
      return isAfterStart && isBeforeEnd && isCategorySelected;
    });
  }, [allExpenses, filters]);

  const extractedTotalSum = useMemo(() => {
    return allExpenses.reduce((sum, e) => sum + e.amount, 0);
  }, [allExpenses]);

  const dataIntegrityStatus = useMemo(() => {
    if (reportedTotal === 0) return 'unknown';
    const diff = Math.abs(extractedTotalSum - reportedTotal);
    if (diff < 1) return 'perfect';
    if (diff < reportedTotal * 0.05) return 'warning';
    return 'critical';
  }, [extractedTotalSum, reportedTotal]);

  useEffect(() => {
    if (status !== ProcessingStatus.ANALYZING) {
      setElapsedSeconds(0);
      return;
    }
    const interval = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [status]);

  const handleCancelAnalysis = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setStatus(ProcessingStatus.IDLE);
    setProgressMsg('');
  };

  const handleHistoricalFiles = async (files: File[]) => {
    if (!token) return;

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setStatus(ProcessingStatus.UPLOADING);
    setError(null);
    setAllExpenses([]);
    setOpeningBalance(0);
    setClosingBalance(0);
    setExtractedBalance(0);
    setReportedTotal(0);
    setAnalyzedFiles(files.map((f) => f.name));

    const accumulatedExpenses: Expense[] = [];
    let totalOpening = 0;
    let totalClosing = 0;
    let totalReported = 0;
    let detectedFiscalStart: string | undefined = undefined;
    let detectedFiscalEnd: string | undefined = undefined;

    try {
      // 1. Check access & credits on server before starting
      const checkRes = await fetch('/api/auth/check-access', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!checkRes.ok) {
        const checkData = await checkRes.json();
        if (checkData.user) setUser(checkData.user);
        throw new Error(checkData.error || 'Accesso non abilitato o crediti esauriti.');
      }

      setStatus(ProcessingStatus.ANALYZING);
      for (const file of files) {
        setProgressMsg(`Lettura e analisi del documento: ${file.name}`);
        const base64 = await fileToBase64(file);
        const result = await parseFinancialStatement(
          base64,
          file.type,
          file.name,
          (msg) => setProgressMsg(msg),
          controller.signal
        );
        accumulatedExpenses.push(...result.expenses);
        totalOpening += result.openingBalance || 0;
        totalClosing += result.closingBalance || 0;
        totalReported += result.totalReportedExpenses;
        if (result.fiscalStartDate && !detectedFiscalStart)
          detectedFiscalStart = result.fiscalStartDate;
        if (result.fiscalEndDate && !detectedFiscalEnd) detectedFiscalEnd = result.fiscalEndDate;
      }

      // Consume 1 credit and log analysis on backend
      const consumeRes = await fetch('/api/auth/consume-credit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          condoName: files.map((f) => f.name).join(', '),
          overallScore: 100,
        }),
      });
      if (consumeRes.ok) {
        const consumeData = await consumeRes.json();
        if (consumeData.user) setUser(consumeData.user);
      }

      setAllExpenses(accumulatedExpenses);
      setOpeningBalance(totalOpening);
      setClosingBalance(totalClosing);
      setExtractedBalance(totalClosing !== 0 ? totalClosing : totalOpening);
      setReportedTotal(totalReported);
      setHistoricalFiscalStart(detectedFiscalStart);
      setHistoricalFiscalEnd(detectedFiscalEnd);
      setStatus(ProcessingStatus.SUCCESS);
    } catch (err: any) {
      if (controller.signal.aborted) {
        setStatus(ProcessingStatus.IDLE);
        return;
      }
      setStatus(ProcessingStatus.ERROR);
      setError(err?.message || "Errore durante l'analisi del file.");
    }
  };

  const handleFilterChange = (newState: Partial<FilterState>) => {
    setFilters((prev) => ({ ...prev, ...newState }));
  };

  const handleBudgetFileAnalyzed = (filename: string) => {
    setAnalyzedFiles((prev) => Array.from(new Set([...prev, filename])));
  };

  const handleInstallmentsChange = (installments: Installment[]) => {
    setInstallmentsData(installments);
  };

  const reset = () => {
    setStatus(ProcessingStatus.IDLE);
    setAllExpenses([]);
    setOpeningBalance(0);
    setClosingBalance(0);
    setExtractedBalance(0);
    setReportedTotal(0);
    setError(null);
    setAnalyzedFiles([]);
  };

  const generatePDFReport = async () => {
    if (isGeneratingReport) return;
    setIsGeneratingReport(true);

    try {
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const doc = new jsPDF('p', 'mm', 'a4');
      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 15;
      const contentWidth = pageWidth - margin * 2;

      doc.setFillColor(79, 70, 229);
      doc.rect(0, 0, pageWidth, 50, 'F');

      doc.setTextColor(255, 255, 255);
      doc.setFontSize(24);
      doc.setFont('helvetica', 'bold');
      doc.text('CondoRate Report', margin, 25);

      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.text('STUDIOSERRA - ANALISI PROFESSIONALE AI', margin, 33);
      doc.text(
        `Generato: ${new Date().toLocaleDateString('it-IT')} ${new Date().toLocaleTimeString('it-IT')}`,
        margin,
        38
      );

      let currentY = 65;

      doc.setTextColor(30, 41, 59);
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('1. DOCUMENTAZIONE ANALIZZATA', margin, currentY);
      currentY += 8;

      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      analyzedFiles.forEach((file) => {
        if (currentY > 280) {
          doc.addPage();
          currentY = 20;
        }
        doc.text(`- ${file}`, margin + 5, currentY);
        currentY += 5;
      });

      currentY += 8;
      if (currentY > 260) {
        doc.addPage();
        currentY = 20;
      }
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('2. SINTESI FINANZIARIA', margin, currentY);
      currentY += 8;

      doc.setFillColor(248, 250, 252);
      doc.roundedRect(margin, currentY, contentWidth, 32, 2, 2, 'F');

      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.text(`Saldo d'apertura (iniziale):`, margin + 5, currentY + 8);
      doc.setFont('helvetica', 'bold');
      doc.text(formatCurrency(openingBalance), margin + 85, currentY + 8);

      doc.setFont('helvetica', 'normal');
      doc.text(`Totale Uscite Rilevate:`, margin + 5, currentY + 16);
      doc.setFont('helvetica', 'bold');
      doc.text(formatCurrency(extractedTotalSum), margin + 85, currentY + 16);

      doc.setFont('helvetica', 'normal');
      doc.text(`Saldo finale di chiusura:`, margin + 5, currentY + 24);
      doc.setFont('helvetica', 'bold');
      doc.text(
        formatCurrency(closingBalance !== 0 ? closingBalance : extractedBalance),
        margin + 85,
        currentY + 24
      );

      currentY += 42;

      const sections = [
        { id: 'historical-chart', title: '3. ANDAMENTO STORICO SPESE' },
        { id: 'category-chart-container', title: '4. DISTRIBUZIONE PER CATEGORIE' },
        { id: 'budget-projection', title: '5. PROIEZIONE DI CASSA' },
        { id: 'installment-list-report', title: '6. PIANO DELLE RATE PREVISTE' },
        { id: 'cash-flow-table-report', title: '7. DETTAGLIO ANALISI FLUSSI' },
      ];

      for (const section of sections) {
        const el = document.getElementById(section.id);
        if (!el) continue;

        const canvas = await html2canvas(el, {
          scale: 2,
          useCORS: true,
          backgroundColor: '#ffffff',
          logging: false,
        });

        const imgData = canvas.toDataURL('image/png');
        const imgHeight = (canvas.height * contentWidth) / canvas.width;

        if (currentY + imgHeight + 20 > 285) {
          doc.addPage();
          currentY = 20;
        }

        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(30, 41, 59);
        doc.text(section.title, margin, currentY);
        currentY += 6;
        doc.addImage(imgData, 'PNG', margin, currentY, contentWidth, imgHeight, undefined, 'FAST');
        currentY += imgHeight + 15;
      }

      doc.save(`Report_CondoRate_${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (err) {
      console.error('PDF generation error:', err);
      alert('Errore nella generazione del report. Riprova.');
    } finally {
      setIsGeneratingReport(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-20 font-sans">
      <header className="bg-slate-900 text-white sticky top-0 z-30 shadow-lg no-print">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center space-x-3">
            <div className="bg-indigo-600 p-2 rounded-lg shadow-md flex items-center justify-center">
              <svg
                className="w-6 h-6 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">
                Condo<span className="text-indigo-400">Rate</span>
              </h1>
              <p className="text-[10px] uppercase tracking-widest text-indigo-400 font-semibold">
                Analisi Finanziaria & Piano Rate AI
              </p>
            </div>
          </div>

          {user && (
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              {status === ProcessingStatus.SUCCESS && (
                <>
                  <button
                    onClick={generatePDFReport}
                    disabled={isGeneratingReport}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-black hover:bg-indigo-500 transition-all uppercase tracking-wider flex items-center gap-2 shadow-sm disabled:opacity-50"
                  >
                    {isGeneratingReport ? 'Analisi...' : 'Scarica PDF'}
                    {!isGeneratingReport && (
                      <svg
                        className="w-3.5 h-3.5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                        />
                      </svg>
                    )}
                  </button>
                  <button
                    onClick={reset}
                    className="px-3.5 py-2 bg-slate-800 text-slate-200 rounded-xl text-xs font-bold hover:bg-slate-700 transition-all uppercase tracking-wider border border-slate-700"
                  >
                    Reset
                  </button>
                </>
              )}

              {/* Credits & Expiration Badge */}
              <div className="hidden md:flex items-center gap-2 bg-slate-800 border border-slate-700 rounded-xl px-3 py-1.5 text-xs">
                <i className="fas fa-coins text-indigo-400"></i>
                <span className="text-slate-300">Crediti:</span>
                <span className="font-bold text-white">
                  {user.role === 'admin' || user.credits === -1
                    ? 'Illimitati'
                    : `${user.credits} analisi`}
                </span>
                {user.expiresAt && (
                  <span className="text-slate-400 border-l border-slate-700 pl-2">
                    Scad: {user.expiresAt}
                  </span>
                )}
              </div>

              {/* Admin Panel Button */}
              {user.role === 'admin' && (
                <button
                  onClick={() => setShowAdmin(true)}
                  className="relative px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition flex items-center gap-2 shadow-sm"
                >
                  <i className="fas fa-user-shield"></i>
                  <span>Gestione Utenti & Pagamenti</span>
                  {pendingCount > 0 && (
                    <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-rose-600 text-white font-extrabold animate-pulse">
                      {pendingCount}
                    </span>
                  )}
                </button>
              )}

              {/* User Info & Logout */}
              <div className="flex items-center gap-2 bg-slate-800/80 rounded-xl px-3 py-1.5 border border-slate-700/70">
                <div className="text-right">
                  <div className="text-xs font-bold text-white leading-tight">{user.name}</div>
                  <div className="text-[10px] text-slate-400 leading-tight">
                    {user.company || user.email}
                  </div>
                </div>
                <button
                  onClick={handleLogout}
                  title="Esci dall'account"
                  className="ml-2 p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-700/60 transition"
                >
                  <i className="fas fa-sign-out-alt"></i>
                </button>
              </div>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-12">
        {showAdmin && token && user?.role === 'admin' && (
          <AdminModal
            token={token}
            onClose={() => setShowAdmin(false)}
            onUpdated={() => refreshProfile(token)}
          />
        )}

        {authChecking ? (
          <div className="py-24 text-center text-slate-500 text-sm">
            Verifica accesso in corso...
          </div>
        ) : !user ? (
          <AuthScreen onAuthenticated={handleAuthenticated} />
        ) : !isUserAllowedToAnalyze(user) && status !== ProcessingStatus.SUCCESS ? (
          <ActivationScreen
            token={token || ''}
            user={user}
            paymentConfig={paymentConfig}
            onRefreshStatus={() => refreshProfile(token)}
          />
        ) : (
          <>
            {status === ProcessingStatus.IDLE && (
              <div className="space-y-16 animate-fade-in">
                <section className="bg-indigo-900 rounded-[2.5rem] p-8 md:p-12 text-white shadow-2xl relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-12 opacity-10">
                    <svg className="w-64 h-64" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z" />
                    </svg>
                  </div>
                  <div className="relative z-10 max-w-3xl">
                    <h2 className="text-3xl md:text-5xl font-black mb-6 tracking-tight">
                      Verifica Finanziaria AI
                    </h2>
                    <p className="text-indigo-200 text-lg mb-10 font-medium">
                      Carica i documenti necessari per generare il report di quadratura
                      professionale:
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="bg-white/10 backdrop-blur-md p-6 rounded-3xl border border-white/10">
                        <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center font-black mb-3">
                          1
                        </div>
                        <h4 className="font-bold text-xs uppercase tracking-wider mb-1">
                          Consuntivo Passato
                        </h4>
                        <p className="text-[10px] text-indigo-100 opacity-70">
                          Registro movimenti con date e importi per lo storico.
                        </p>
                      </div>
                      <div className="bg-white/10 backdrop-blur-md p-6 rounded-3xl border border-white/10">
                        <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center font-black mb-3">
                          2
                        </div>
                        <h4 className="font-bold text-xs uppercase tracking-wider mb-1">
                          Preventivo Futuro
                        </h4>
                        <p className="text-[10px] text-indigo-100 opacity-70">
                          Bilancio preventivo e piano di riparto per la proiezione.
                        </p>
                      </div>
                      <div className="bg-white/10 backdrop-blur-md p-6 rounded-3xl border border-white/10">
                        <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center font-black mb-3">
                          3
                        </div>
                        <h4 className="font-bold text-xs uppercase tracking-wider mb-1">
                          Movimenti Attuali
                        </h4>
                        <p className="text-[10px] text-indigo-100 opacity-70">
                          Nuovi pagamenti fino ad oggi (opzionale).
                        </p>
                      </div>
                    </div>
                  </div>
                </section>

                <div className="flex flex-col items-center justify-center py-8">
                  <div className="text-center max-w-2xl mb-12">
                    <div className="inline-block px-3 py-1 bg-indigo-100 text-indigo-700 text-[10px] font-black rounded-full mb-4 uppercase tracking-[0.2em]">
                      Punto di Partenza
                    </div>
                    <h3 className="text-3xl font-black text-slate-900 mb-4 tracking-tight">
                      Carica il Consuntivo Gestione Passata
                    </h3>
                    <p className="text-slate-600 font-medium italic">
                      Questo documento è fondamentale per analizzare lo storico e definire il saldo
                      di partenza.
                    </p>
                  </div>
                  <FileUpload
                    onFilesSelect={handleHistoricalFiles}
                    title="Trascina o Seleziona il PDF del Consuntivo"
                    subtitle="Analizzeremo le spese passate per costruire la base dati."
                  />
                </div>
              </div>
            )}

            {status === ProcessingStatus.ANALYZING && (
              <div className="flex flex-col items-center justify-center py-32 animate-fade-in">
                <div className="w-24 h-24 relative mb-8 flex items-center justify-center">
                  <div className="absolute inset-0 border-4 border-indigo-100 rounded-full"></div>
                  <div className="absolute inset-0 border-4 border-indigo-600 rounded-full border-t-transparent animate-spin"></div>
                  <span className="text-sm font-black text-indigo-600">{elapsedSeconds}s</span>
                </div>
                <h3 className="text-2xl font-black text-slate-800 tracking-tight">
                  Elaborazione Veloce in Corso...
                </h3>
                <p className="text-slate-500 mt-2 font-medium">{progressMsg}</p>
                <button
                  onClick={handleCancelAnalysis}
                  className="mt-6 px-6 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-black uppercase tracking-wider rounded-xl transition-all"
                >
                  Annulla
                </button>
              </div>
            )}

            {status === ProcessingStatus.ERROR && (
              <div className="max-w-xl mx-auto mt-10 bg-red-50 border border-red-200 rounded-3xl p-10 text-center shadow-xl animate-slide-up">
                <h3 className="text-xl font-black text-red-800 mb-2">Errore di Lettura</h3>
                <p className="text-red-600 mb-8 font-medium">{error}</p>
                <button
                  onClick={reset}
                  className="px-10 py-4 bg-red-600 text-white font-black rounded-2xl hover:bg-red-700 shadow-lg shadow-red-200 transition-all"
                >
                  Riprova
                </button>
              </div>
            )}

            {status === ProcessingStatus.SUCCESS && (
              <div className="space-y-12 animate-slide-up">
                <div
                  id="integrity-card"
                  className="bg-white p-8 rounded-[2rem] border border-slate-200 shadow-sm"
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div>
                      <h2 className="text-3xl font-black text-slate-800 tracking-tight">
                        Analisi Registro Contabile
                      </h2>
                      <div className="flex items-center gap-4 mt-2 flex-wrap">
                        <p className="text-slate-500 text-sm font-medium">
                          Saldo Apertura:{' '}
                          <span className="font-bold text-indigo-600">
                            {formatCurrency(openingBalance)}
                          </span>
                        </p>
                        <span className="w-1 h-1 bg-slate-300 rounded-full"></span>
                        <p className="text-slate-500 text-sm font-medium">
                          Uscite Rilevate:{' '}
                          <span className="font-bold text-slate-800">
                            {formatCurrency(extractedTotalSum)}
                          </span>
                        </p>
                        <span className="w-1 h-1 bg-slate-300 rounded-full"></span>
                        <p className="text-slate-500 text-sm font-medium">
                          Saldo Chiusura:{' '}
                          <span
                            className={`font-bold ${
                              closingBalance >= 0 ? 'text-emerald-600' : 'text-rose-600'
                            }`}
                          >
                            {formatCurrency(closingBalance !== 0 ? closingBalance : extractedBalance)}
                          </span>
                        </p>
                      </div>
                    </div>
                    <div
                      className={`px-8 py-4 rounded-[1.5rem] border ${
                        dataIntegrityStatus === 'perfect'
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-100'
                          : 'bg-rose-50 text-rose-800 border-rose-100'
                      }`}
                    >
                      <p className="text-[10px] font-black uppercase tracking-widest leading-none mb-2">
                        Quadratura
                      </p>
                      <p className="text-sm font-bold">
                        {dataIntegrityStatus === 'perfect' ? 'Confermata' : 'Verifica Necessaria'}
                      </p>
                    </div>
                  </div>
                </div>

                <FilterBar
                  filterState={filters}
                  availableCategories={availableCategories}
                  onFilterChange={handleFilterChange}
                />

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  <div className="lg:col-span-2" id="historical-chart">
                    <ExpenseChart
                      expenses={filteredExpenses}
                      granularity={filters.granularity}
                      installments={installmentsData}
                    />
                  </div>
                  <div className="lg:col-span-1" id="category-chart-container">
                    <CategoryChart expenses={filteredExpenses} />
                  </div>
                </div>

                <ExpenseTable
                  expenses={filteredExpenses}
                  onUpdateExpense={(originalExp, updatedExp) => {
                    setAllExpenses((prev) => {
                      const idx = prev.indexOf(originalExp);
                      if (idx === -1) return prev;
                      const next = [...prev];
                      next[idx] = updatedExp;
                      return next;
                    });
                  }}
                />

                <BudgetPlanner
                  historicalExpenses={allExpenses}
                  initialBalance={
                    closingBalance !== 0
                      ? closingBalance
                      : openingBalance !== 0
                      ? openingBalance
                      : extractedBalance
                  }
                  historicalFiscalStartDate={historicalFiscalStart}
                  historicalFiscalEndDate={historicalFiscalEnd}
                  onBudgetFileAnalyzed={handleBudgetFileAnalyzed}
                  onInstallmentsChange={handleInstallmentsChange}
                />

                <div className="flex flex-col items-center justify-center pt-12 border-t border-slate-200 no-print">
                  <button
                    onClick={generatePDFReport}
                    disabled={isGeneratingReport}
                    className="group flex items-center gap-4 px-12 py-6 bg-indigo-600 text-white rounded-[2rem] font-black text-xl shadow-2xl shadow-indigo-100 hover:bg-indigo-700 hover:-translate-y-1 transition-all disabled:opacity-50"
                  >
                    {isGeneratingReport ? 'Generazione Report...' : 'SCARICA REPORT PDF COMPLETO'}
                    <svg
                      className="w-6 h-6 group-hover:translate-x-1 transition-transform"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={3}
                        d="M17 8l4 4m0 0l-4 4m4-4H3"
                      />
                    </svg>
                  </button>
                  <p className="text-[10px] text-slate-400 mt-6 uppercase tracking-widest font-black">
                    StudioSerra - Consulenza AI Condominiale
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default App;
