import React, { useState, useMemo, useEffect } from 'react';
import { 
  ComposedChart, 
  Line, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  ReferenceLine, 
} from 'recharts';
import { FileUpload } from './FileUpload';
import { BudgetItem, ProcessingStatus, Expense, Installment, PlannedInstallment } from '../types';
import { fileToBase64, formatCurrency, downloadElementAsImage } from '../utils/fileUtils';
import { parseBudgetEstimate } from '../services/geminiService';

interface BudgetPlannerProps {
  historicalExpenses: Expense[];
  initialBalance: number; 
  historicalFiscalStartDate?: string;
  historicalFiscalEndDate?: string;
  onBudgetFileAnalyzed?: (filename: string) => void;
  onInstallmentsChange?: (installments: Installment[]) => void;
}

type SimulationMethod = 'category-dates' | 'global-dates' | 'uniform';

interface SimulatedCategoryDetail {
  category: string;
  amount: number;
}

interface CashFlowData {
  month: string;
  year: string;
  fullDate: Date;
  expense: number;
  isReal: boolean;
  income: number;
  netFlow: number;
  balance: number;
  historicalWeightPct: number;
  topCategories: SimulatedCategoryDetail[];
  installmentNames: string[];
  isOpening?: boolean;
  isTargetMonth?: boolean;
  hasBudget?: boolean;
  hasDebt?: boolean;
}

// Normalizza il nome della categoria per fare matching intelligente tra Consuntivo e Preventivo
function normalizeCategoryKey(rawCategory?: string): string {
  const c = (rawCategory || 'Altro').toLowerCase().trim();
  if (c.includes('riscald') || c.includes('gas') || c.includes('metano') || c.includes('caldaia') || c.includes('termic')) return 'Riscaldamento';
  if (c.includes('luce') || c.includes('energ') || c.includes('elettr') || c.includes('enel') || c.includes('forza motrice')) return 'Luce/Energia';
  if (c.includes('acqua') || c.includes('idric') || c.includes('acquedotto')) return 'Acqua';
  if (c.includes('puliz') || c.includes('igiene') || c.includes('giardin') || c.includes('verde')) return 'Pulizia';
  if (c.includes('ascensor') || c.includes('elevat')) return 'Ascensore';
  if (c.includes('assicur') || c.includes('polizza') || c.includes('fabbricat')) return 'Assicurazione';
  if (c.includes('amministrat') || c.includes('compenso') || c.includes('gestione') || c.includes('studio')) return 'Compenso Amministratore';
  if (c.includes('straordinar') || c.includes('lavori')) return 'Manutenzione Straordinaria';
  if (c.includes('manutenz') || c.includes('ordinar') || c.includes('riparaz')) return 'Manutenzione Ordinaria';
  if (c.includes('general') || c.includes('banca') || c.includes('bancari') || c.includes('postali') || c.includes('cancelleria') || c.includes('f24') || c.includes('ritenut')) return 'Spese Generali';
  return rawCategory?.trim() || 'Altro';
}

export const BudgetPlanner: React.FC<BudgetPlannerProps> = ({ 
  historicalExpenses, 
  initialBalance,
  historicalFiscalStartDate,
  historicalFiscalEndDate,
  onBudgetFileAnalyzed,
  onInstallmentsChange
}) => {
  const [budgetStatus, setBudgetStatus] = useState<ProcessingStatus>(ProcessingStatus.IDLE);
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [extractedBudgetItems, setExtractedBudgetItems] = useState<BudgetItem[]>([]);
  const [extractedPlannedInstallments, setExtractedPlannedInstallments] = useState<PlannedInstallment[]>([]);
  const [currentManagementExpenses] = useState<Expense[]>([]);
  
  // Dati iniziali di bilancio (cassa, debito, fondo)
  const [startingCash, setStartingCash] = useState<number>(0); 
  const [pastDebt, setPastDebt] = useState<number>(0);
  const [reserveFundTarget, setReserveFundTarget] = useState<number>(0);
  
  // Tracciamento metadati estratti per feedback utente
  const [docInitialDataBadge, setDocInitialDataBadge] = useState<string | null>(null);
  const [useDocumentRateMode, setUseDocumentRateMode] = useState<boolean>(true);
  const [simulationMethod, setSimulationMethod] = useState<SimulationMethod>('category-dates');

  // Rate e configurazione temporale
  const [budgetAllocation, setBudgetAllocation] = useState<boolean[]>([]);
  const [debtAllocation, setDebtAllocation] = useState<boolean[]>([]);
  
  const [installmentIntervalDays, setInstallmentIntervalDays] = useState<number>(30); 
  const [totalInstallments, setTotalInstallments] = useState<number>(12);
  const [manualInstallments, setManualInstallments] = useState<Record<number, number>>({});
  const [installmentDates, setInstallmentDates] = useState<Record<number, string>>({});
  const [installmentDescriptions, setInstallmentDescriptions] = useState<Record<number, string>>({});

  const [fiscalStartDate, setFiscalStartDate] = useState<string>(() => {
    const d = new Date();
    d.setMonth(0); d.setDate(1); 
    return d.toISOString().split('T')[0];
  });

  const [firstInstallmentDate, setFirstInstallmentDate] = useState<string>(() => {
    const d = new Date();
    d.setMonth(0); d.setDate(1);
    return d.toISOString().split('T')[0];
  });

  // Calcola la data di inizio dell'anno di preventivo (12 mesi) senza MAI farla coincidere con la data della prima rata
  const resolvePreventivoFiscalStart = (
    docFiscalStart?: string,
    docFiscalEnd?: string,
    installments?: PlannedInstallment[]
  ): string => {
    const toMonthStartStr = (y: number, mZeroBased: number) => {
      const d = new Date(y, mZeroBased, 1, 12, 0, 0);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    };

    // 1. Se il documento di Preventivo riporta esplicitamente la data di inizio gestione
    if (docFiscalStart) {
      const parts = docFiscalStart.split('-').map(Number);
      if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        return toMonthStartStr(parts[0], parts[1] - 1);
      }
    }

    // 2. Se il documento di Preventivo riporta la data di fine gestione (12 mesi a ritroso)
    if (docFiscalEnd) {
      const parts = docFiscalEnd.split('-').map(Number);
      if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        return toMonthStartStr(parts[0], parts[1] - 12);
      }
    }

    // Determina il mese di inizio dell'esercizio condominiale dal Consuntivo (gestione passata), oppure Gennaio (0)
    let startMonth = 0; // Default: 1° Gennaio
    let baseYearFromConsuntivo: number | null = null;

    if (historicalFiscalEndDate) {
      const parts = historicalFiscalEndDate.split('-').map(Number);
      if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        const nextDay = new Date(parts[0], parts[1], 1, 12, 0, 0); // mese successivo alla fine del consuntivo
        startMonth = nextDay.getMonth();
        baseYearFromConsuntivo = nextDay.getFullYear();
      }
    } else if (historicalFiscalStartDate) {
      const parts = historicalFiscalStartDate.split('-').map(Number);
      if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        startMonth = parts[1] - 1;
        baseYearFromConsuntivo = parts[0] + 1;
      }
    } else if (historicalExpenses.length > 0) {
      const sortedDates = historicalExpenses
        .map(e => e.date)
        .filter(Boolean)
        .sort();
      if (sortedDates.length > 0) {
        const firstParts = sortedDates[0].split('-').map(Number);
        if (firstParts.length === 3 && !isNaN(firstParts[0]) && !isNaN(firstParts[1])) {
          startMonth = firstParts[1] - 1;
          baseYearFromConsuntivo = firstParts[0] + 1;
        }
      }
    }

    // Se ci sono rate nel preventivo, allineiamo l'anno di inizio gestione (mantenendo fisso startMonth!)
    // in modo che la prima rata cada all'interno dei 12 mesi dell'anno di preventivo.
    if (installments && installments.length > 0 && installments[0].dueDate) {
      const instParts = installments[0].dueDate.split('-').map(Number);
      if (instParts.length === 3 && !isNaN(instParts[0]) && !isNaN(instParts[1])) {
        const instYear = instParts[0];
        const instMonth = instParts[1] - 1;
        const fiscalYear = instMonth >= startMonth ? instYear : instYear - 1;
        return toMonthStartStr(fiscalYear, startMonth);
      }
    }

    if (baseYearFromConsuntivo !== null) {
      return toMonthStartStr(baseYearFromConsuntivo, startMonth);
    }

    return toMonthStartStr(new Date().getFullYear(), startMonth);
  };

  const [docFiscalDates, setDocFiscalDates] = useState<{ start?: string; end?: string }>({});
  const [userEditedFiscalStart, setUserEditedFiscalStart] = useState<boolean>(false);

  // Aggiorna automaticamente l'inizio dell'anno di preventivo se cambiano i dati del Consuntivo (e l'utente non lo ha forzato a mano)
  useEffect(() => {
    if (userEditedFiscalStart) return;
    const resolved = resolvePreventivoFiscalStart(
      docFiscalDates.start,
      docFiscalDates.end,
      extractedPlannedInstallments
    );
    setFiscalStartDate(resolved);
  }, [historicalFiscalStartDate, historicalFiscalEndDate, historicalExpenses]);

  // Sincronizza la cassa iniziale dal consuntivo storico; il debito pregresso viene invece recuperato dal preventivo ("Saldi di fine es. precedente")
  useEffect(() => {
    if (initialBalance >= 0) {
      setStartingCash(initialBalance);
    } else {
      setStartingCash(0);
    }
  }, [initialBalance]);

  // Gestione caricamento ed estrazione del Bilancio Preventivo
  const handleBudgetUpload = async (files: File[]) => {
    if (files.length === 0) return;
    setBudgetStatus(ProcessingStatus.ANALYZING);
    setBudgetError(null);
    try {
      const file = files[0];
      const base64 = await fileToBase64(file);
      const result = await parseBudgetEstimate(base64, file.type, file.name);
      
      setExtractedBudgetItems(result.items);
      setDocFiscalDates({ start: result.fiscalStartDate, end: result.fiscalEndDate });
      setUserEditedFiscalStart(false);
      
      const resolvedFiscalStart = resolvePreventivoFiscalStart(
        result.fiscalStartDate,
        result.fiscalEndDate,
        result.plannedInstallments
      );
      setFiscalStartDate(resolvedFiscalStart);
      if (!result.plannedInstallments || result.plannedInstallments.length === 0) {
        setFirstInstallmentDate(resolvedFiscalStart);
      }

      const foundInitialDetails: string[] = [];

      // 1. APPLICAZIONE DEI DATI INIZIALI DAL PREVENTIVO
      if (typeof result.startingCash === 'number' && result.startingCash > 0) {
        setStartingCash(result.startingCash);
        foundInitialDetails.push(`Cassa iniziale: ${formatCurrency(result.startingCash)}`);
      }
      if (typeof result.pastDebt === 'number') {
        const cleanDebt = Math.max(0, result.pastDebt);
        setPastDebt(cleanDebt);
        if (cleanDebt > 0) {
          foundInitialDetails.push(`Debito pregresso (Saldi di fine es. precedente): ${formatCurrency(cleanDebt)}`);
        }
      }
      if (typeof result.reserveFundTarget === 'number' && result.reserveFundTarget > 0) {
        setReserveFundTarget(result.reserveFundTarget);
        foundInitialDetails.push(`Fondo: ${formatCurrency(result.reserveFundTarget)}`);
      }

      // 2. APPLICAZIONE DELLE RATE PREVISTE DAL PREVENTIVO (SCADENZARIO)
      if (result.plannedInstallments && result.plannedInstallments.length > 0) {
        setExtractedPlannedInstallments(result.plannedInstallments);
        const count = result.plannedInstallments.length;
        setTotalInstallments(count);
        
        if (result.plannedInstallments[0].dueDate) {
          setFirstInstallmentDate(result.plannedInstallments[0].dueDate);
        }

        const newDates: Record<number, string> = {};
        const newDescs: Record<number, string> = {};
        const newBudgetAlloc: boolean[] = [];
        const newDebtAlloc: boolean[] = [];

        result.plannedInstallments.forEach((inst, idx) => {
          newDates[idx] = inst.dueDate;
          newDescs[idx] = inst.description || `Rata ${inst.number || idx + 1}`;
          newBudgetAlloc.push(true);
          newDebtAlloc.push(true);
        });

        setManualInstallments({});
        setInstallmentDates(newDates);
        setInstallmentDescriptions(newDescs);
        setBudgetAllocation(newBudgetAlloc);
        setDebtAllocation(newDebtAlloc);
        setUseDocumentRateMode(true);
        foundInitialDetails.push(`${count} rate previste rilevate dallo scadenzario`);
      } else {
        setExtractedPlannedInstallments([]);
        setBudgetAllocation(new Array(totalInstallments).fill(true));
        setDebtAllocation(new Array(totalInstallments).fill(true));
        setManualInstallments({});
        setInstallmentDates({});
        setInstallmentDescriptions({});
        setUseDocumentRateMode(false);
      }

      if (foundInitialDetails.length > 0) {
        setDocInitialDataBadge(foundInitialDetails.join(' • '));
      }

      if (onBudgetFileAnalyzed) onBudgetFileAnalyzed(file.name);
      setBudgetStatus(ProcessingStatus.SUCCESS);
    } catch (error: any) {
      setBudgetStatus(ProcessingStatus.ERROR);
      setBudgetError(error?.message || "Errore durante l'analisi del preventivo.");
    }
  };

  const totalExpensesBudget = useMemo(() => {
    return extractedBudgetItems
      .filter(item => item.type === 'expense')
      .reduce((acc, item) => acc + item.amount, 0);
  }, [extractedBudgetItems]);

  const currentExpensesSum = useMemo(() => {
    return currentManagementExpenses.reduce((sum, exp) => sum + exp.amount, 0);
  }, [currentManagementExpenses]);

  // Le rate devono seguire esclusivamente il preventivo (+ eventuale debito pregresso da ripartire).
  // Cassa iniziale e Fondo sono solo riferimenti di partenza e arrivo della liquidità e non influiscono sulle rate.
  const totalToRate = useMemo(() => {
    const amount = totalExpensesBudget + pastDebt;
    return Math.max(0, amount);
  }, [totalExpensesBudget, pastDebt]);

  // Gestione cambio modalità (Rate da Documento vs Ripartizione Automatica uniforme)
  const handleResetToDocumentRate = () => {
    if (extractedPlannedInstallments.length === 0) return;
    const newDates: Record<number, string> = {};
    const newDescs: Record<number, string> = {};
    const newBudgetAlloc: boolean[] = [];
    const newDebtAlloc: boolean[] = [];

    extractedPlannedInstallments.forEach((inst, idx) => {
      newDates[idx] = inst.dueDate;
      newDescs[idx] = inst.description || `Rata ${idx + 1}`;
      newBudgetAlloc.push(true);
      newDebtAlloc.push(true);
    });

    if (extractedPlannedInstallments[0]?.dueDate) {
      setFirstInstallmentDate(extractedPlannedInstallments[0].dueDate);
    }
    setTotalInstallments(extractedPlannedInstallments.length);
    setManualInstallments({});
    setInstallmentDates(newDates);
    setInstallmentDescriptions(newDescs);
    setBudgetAllocation(newBudgetAlloc);
    setDebtAllocation(newDebtAlloc);
    setUseDocumentRateMode(true);
  };

  const handleSwitchToAutoDistribution = () => {
    setManualInstallments({});
    setInstallmentDates({});
    setInstallmentDescriptions({});
    setBudgetAllocation(new Array(totalInstallments).fill(true));
    setDebtAllocation(new Array(totalInstallments).fill(true));
    setUseDocumentRateMode(false);
  };

  // Helper per parsare date YYYY-MM-DD in orario locale evitando slittamenti UTC
  const parseLocalDate = (dateStr: string): Date => {
    if (!dateStr) return new Date(NaN);
    const parts = dateStr.split('-').map(Number);
    if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
      return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
    }
    return new Date(dateStr);
  };

  const formatLocalDate = (d: Date): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  // Calcolo e costruzione del piano rateale
  const calculatedInstallments = useMemo<Installment[]>(() => {
    const start = parseLocalDate(firstInstallmentDate);
    if (isNaN(start.getTime())) return [];
    
    const bAutoIndices: number[] = [];
    const dAutoIndices: number[] = [];

    let totalManual = 0;
    for (let i = 0; i < totalInstallments; i++) {
      if (manualInstallments[i] !== undefined) {
        totalManual += manualInstallments[i];
      } else {
        if (budgetAllocation[i] ?? true) bAutoIndices.push(i);
        if (debtAllocation[i] ?? true) dAutoIndices.push(i);
      }
    }

    // Se nessuna rata ha B o D attivo, fallback su tutte le rate non manuali per garantire copertura
    const effectiveBIndices = bAutoIndices.length > 0
      ? bAutoIndices
      : Array.from({ length: totalInstallments }, (_, i) => i).filter(i => manualInstallments[i] === undefined);
    const effectiveDIndices = dAutoIndices.length > 0 ? dAutoIndices : effectiveBIndices;

    const netToRate = Math.max(0, totalToRate - totalManual);
    const denominator = totalExpensesBudget + pastDebt || 1;
    const quotaB_total = netToRate * (totalExpensesBudget / denominator);
    const quotaD_total = netToRate * (pastDebt / denominator);

    // Se siamo in modalità Rate da Preventivo, manteniamo i pesi proporzionali delle rate estratte dal documento
    const docWeights: number[] | null = (() => {
      if (!useDocumentRateMode || extractedPlannedInstallments.length !== totalInstallments) return null;
      const activeDocSum = effectiveBIndices.reduce((s, idx) => s + (extractedPlannedInstallments[idx]?.amount || 0), 0);
      if (activeDocSum <= 0) return null;
      return Array.from({ length: totalInstallments }, (_, idx) =>
        effectiveBIndices.includes(idx) ? (extractedPlannedInstallments[idx]?.amount || 0) / activeDocSum : 0
      );
    })();

    const unitB = effectiveBIndices.length > 0 ? quotaB_total / effectiveBIndices.length : 0;
    const unitD = effectiveDIndices.length > 0 ? quotaD_total / effectiveDIndices.length : 0;

    const list: Installment[] = [];
    for (let i = 0; i < totalInstallments; i++) {
      let d: Date;
      let dueDateStr: string;

      if (installmentDates[i]) {
        d = parseLocalDate(installmentDates[i]);
        dueDateStr = installmentDates[i];
      } else {
        const temp = new Date(start);
        temp.setDate(start.getDate() + (i * installmentIntervalDays));
        d = temp;
        dueDateStr = formatLocalDate(temp);
      }
      
      let amount = 0;
      let isManual = false;

      if (manualInstallments[i] !== undefined) {
        amount = manualInstallments[i];
        isManual = true;
      } else {
        if (effectiveBIndices.includes(i)) {
          amount += docWeights ? quotaB_total * docWeights[i] : unitB;
        }
        if (effectiveDIndices.includes(i)) {
          amount += unitD;
        }
      }

      list.push({
        number: i + 1,
        date: d,
        dueDate: dueDateStr,
        description: installmentDescriptions[i] || `Rata ${i + 1}`,
        amount: Math.round(amount * 100) / 100,
        isManual,
        hasBudget: budgetAllocation[i] ?? true,
        hasDebt: debtAllocation[i] ?? true,
        isActive: (budgetAllocation[i] || debtAllocation[i] || isManual) ?? true
      });
    }

    // Quadratura al centesimo sull'ultima rata automatica per garantire che Spese + Debiti - Rate = 0
    const autoIndices = list.map((inst, idx) => (!inst.isManual && inst.isActive ? idx : -1)).filter(idx => idx !== -1);
    if (autoIndices.length > 0) {
      const currentSum = list.reduce((s, inst) => s + inst.amount, 0);
      const roundingDiff = Math.round((totalToRate - currentSum) * 100) / 100;
      if (Math.abs(roundingDiff) > 0 && Math.abs(roundingDiff) < 5) {
        const lastAutoIdx = autoIndices[autoIndices.length - 1];
        list[lastAutoIdx].amount = Math.max(0, Math.round((list[lastAutoIdx].amount + roundingDiff) * 100) / 100);
      }
    }

    return list;
  }, [
    firstInstallmentDate, 
    totalInstallments, 
    installmentIntervalDays, 
    totalToRate, 
    totalExpensesBudget, 
    pastDebt, 
    manualInstallments, 
    installmentDates, 
    installmentDescriptions, 
    budgetAllocation, 
    debtAllocation,
    useDocumentRateMode,
    extractedPlannedInstallments
  ]);

  const installmentsSum = useMemo(() => calculatedInstallments.reduce((sum, inst) => sum + inst.amount, 0), [calculatedInstallments]);
  const isCoincident = Math.abs(installmentsSum - totalToRate) < 0.5;

  useEffect(() => {
    if (onInstallmentsChange) {
      onInstallmentsChange(calculatedInstallments);
    }
  }, [calculatedInstallments, onInstallmentsChange]);

  // 1. Curva stagionale globale del consuntivo (pesi mensili 0..11)
  const historicalSeasonality = useMemo(() => {
    const monthlyTotals = new Array(12).fill(0);
    let totalHistorical = 0;
    historicalExpenses.forEach(exp => {
      const d = new Date(exp.date);
      if (!isNaN(d.getTime())) {
        monthlyTotals[d.getMonth()] += exp.amount;
        totalHistorical += exp.amount;
      }
    });
    if (totalHistorical === 0) return new Array(12).fill(1 / 12);
    return monthlyTotals.map(val => val / totalHistorical);
  }, [historicalExpenses]);

  // 2. Curva stagionale per CATEGORIA basata sulle date del Consuntivo
  const categorySeasonalityMap = useMemo(() => {
    const map = new Map<string, number[]>();
    const totals = new Map<string, number>();

    historicalExpenses.forEach(exp => {
      const d = new Date(exp.date);
      if (isNaN(d.getTime())) return;
      const catKey = normalizeCategoryKey(exp.category || exp.description);
      const m = d.getMonth();
      if (!map.has(catKey)) {
        map.set(catKey, new Array(12).fill(0));
        totals.set(catKey, 0);
      }
      map.get(catKey)![m] += exp.amount;
      totals.set(catKey, (totals.get(catKey) || 0) + exp.amount);
    });

    const normalizedMap = new Map<string, number[]>();
    map.forEach((arr, catKey) => {
      const tot = totals.get(catKey) || 0;
      if (tot > 0) {
        normalizedMap.set(catKey, arr.map(v => v / tot));
      }
    });
    return normalizedMap;
  }, [historicalExpenses]);

  // 3. Simulazione mese per mese (0..11) delle uscite del Preventivo sulle date del Consuntivo
  const simulatedMonthlySchedule = useMemo(() => {
    // Ritorna per ciascun mese 0..11 del calendario l'importo simulato e il breakdown per categoria
    const monthTotals = new Array(12).fill(0);
    const monthCategoryBreakdown: Map<string, number>[] = Array.from({ length: 12 }, () => new Map<string, number>());

    const expenseItems = extractedBudgetItems.filter(it => it.type === 'expense');

    if (simulationMethod === 'uniform') {
      const monthlyUniform = totalExpensesBudget / 12;
      for (let m = 0; m < 12; m++) {
        monthTotals[m] = monthlyUniform;
        expenseItems.forEach(item => {
          const catKey = normalizeCategoryKey(item.category || item.description);
          monthCategoryBreakdown[m].set(catKey, (monthCategoryBreakdown[m].get(catKey) || 0) + item.amount / 12);
        });
      }
    } else if (simulationMethod === 'global-dates' || expenseItems.length === 0) {
      for (let m = 0; m < 12; m++) {
        const w = historicalSeasonality[m];
        monthTotals[m] = totalExpensesBudget * w;
        expenseItems.forEach(item => {
          const catKey = normalizeCategoryKey(item.category || item.description);
          monthCategoryBreakdown[m].set(catKey, (monthCategoryBreakdown[m].get(catKey) || 0) + item.amount * w);
        });
      }
    } else {
      // 'category-dates': proietta ogni voce del preventivo usando le date storiche di quella specifica categoria nel consuntivo
      expenseItems.forEach(item => {
        const catKey = normalizeCategoryKey(item.category || item.description);
        // Se la voce nel preventivo ha già una dueDate specifica, la assegniamo a quel mese
        if (item.dueDate) {
          const d = new Date(item.dueDate);
          if (!isNaN(d.getTime())) {
            const m = d.getMonth();
            monthTotals[m] += item.amount;
            monthCategoryBreakdown[m].set(catKey, (monthCategoryBreakdown[m].get(catKey) || 0) + item.amount);
            return;
          }
        }
        const weights = categorySeasonalityMap.get(catKey) || historicalSeasonality;
        for (let m = 0; m < 12; m++) {
          const amt = item.amount * weights[m];
          monthTotals[m] += amt;
          if (amt > 0) {
            monthCategoryBreakdown[m].set(catKey, (monthCategoryBreakdown[m].get(catKey) || 0) + amt);
          }
        }
      });
    }

    return { monthTotals, monthCategoryBreakdown };
  }, [extractedBudgetItems, totalExpensesBudget, simulationMethod, historicalSeasonality, categorySeasonalityMap]);

  // Intervallo temporale dell'anno del preventivo (da inizio a termine dei 12 mesi)
  const preventivoPeriodInfo = useMemo(() => {
    const rawFiscal = parseLocalDate(fiscalStartDate);
    const start = !isNaN(rawFiscal.getTime())
      ? new Date(rawFiscal.getFullYear(), rawFiscal.getMonth(), 1, 12, 0, 0)
      : new Date(new Date().getFullYear(), 0, 1, 12, 0, 0);
    const end = new Date(start.getFullYear(), start.getMonth() + 12, 0, 12, 0, 0);
    const fmt = (d: Date) =>
      d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const endIso = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
    return {
      start,
      end,
      endIso,
      startFormatted: fmt(start),
      endFormatted: fmt(end),
      label: `${fmt(start)} – ${fmt(end)}`,
    };
  }, [fiscalStartDate]);

  // Calcolo proiezione di cassa mese per mese (12 mesi dell'anno di preventivo da inizio al termine)
  const cashFlowData = useMemo<CashFlowData[]>(() => {
    // Il grafico evidenzia SEMPRE l'anno del preventivo da inizio a termine (12 mesi),
    // e NON inizia mai dalla data della prima rata.
    const start = preventivoPeriodInfo.start;

    const totalChartMonths = 12;
    const data: CashFlowData[] = [];
    const today = new Date();

    const actualMonthlyMap = new Map<string, number>();
    currentManagementExpenses.forEach(e => {
      const d = parseLocalDate(e.date);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      actualMonthlyMap.set(key, (actualMonthlyMap.get(key) || 0) + e.amount);
    });

    // Raggruppa le rate nei 12 mesi della gestione (eventuali rate fuori finestra vengono ricondotte al primo/ultimo mese della gestione)
    const installmentsByMonthIndex: Installment[][] = Array.from({ length: totalChartMonths }, () => []);
    calculatedInstallments.forEach(inst => {
      if (isNaN(inst.date.getTime())) return;
      const mDiff = (inst.date.getFullYear() - start.getFullYear()) * 12 + (inst.date.getMonth() - start.getMonth());
      const clampedIdx = Math.min(totalChartMonths - 1, Math.max(0, mDiff));
      installmentsByMonthIndex[clampedIdx].push(inst);
    });

    data.push({
      month: 'Inizio',
      year: start.getFullYear().toString().slice(-2),
      fullDate: new Date(start.getTime() - 1000),
      expense: 0,
      isReal: true,
      income: 0,
      netFlow: 0,
      balance: Math.round(startingCash * 100) / 100,
      historicalWeightPct: 0,
      topCategories: [],
      installmentNames: [],
      isOpening: true
    });

    let runningBalance = startingCash;
    // Transizione progressiva tra Cassa iniziale (partenza) e Fondo (arrivo a fine gestione):
    // poiché Spese + Debiti vengono azzerati dalle Rate a fine gestione, la liquidità chiude al valore del Fondo.
    const monthlyLiquidityTransition = (reserveFundTarget - startingCash) / totalChartMonths;

    for (let i = 0; i < totalChartMonths; i++) {
      const currentDate = new Date(start.getFullYear(), start.getMonth() + i, 1, 12, 0, 0);
      const isPastMonth = currentDate <= today;
      const calMonth = currentDate.getMonth() % 12;

      let monthlyExpense = 0;
      let topCategories: SimulatedCategoryDetail[] = [];

      if (isPastMonth && currentManagementExpenses.length > 0) {
        const key = `${currentDate.getFullYear()}-${currentDate.getMonth()}`;
        monthlyExpense = actualMonthlyMap.get(key) || 0;
      } else {
        monthlyExpense = simulatedMonthlySchedule.monthTotals[calMonth];
        const breakdownMap = simulatedMonthlySchedule.monthCategoryBreakdown[calMonth];
        topCategories = Array.from(breakdownMap.entries())
          .map(([category, amount]) => ({ category, amount }))
          .sort((a, b) => b.amount - a.amount)
          .slice(0, 3);
      }

      const monthlyDebtRepayment = pastDebt / totalChartMonths;
      const totalMonthlyOutflow = monthlyExpense + monthlyDebtRepayment;
      const weightPct = totalExpensesBudget > 0 ? (monthlyExpense / totalExpensesBudget) * 100 : (100 / totalChartMonths);

      const installmentsInMonth = installmentsByMonthIndex[i];
      const monthlyIncomeValue = installmentsInMonth.reduce((sum, inst) => sum + inst.amount, 0);

      const hasBudgetInMonth = installmentsInMonth.some(inst => inst.hasBudget);
      const hasDebtInMonth = installmentsInMonth.some(inst => inst.hasDebt);
      const installmentNames = installmentsInMonth.map(inst => inst.description || `Rata ${inst.number}`);

      const netFlow = monthlyIncomeValue - totalMonthlyOutflow;
      runningBalance += netFlow + monthlyLiquidityTransition;

      data.push({
        month: currentDate.toLocaleString('it-IT', { month: 'short' }),
        year: currentDate.getFullYear().toString().slice(-2),
        fullDate: currentDate,
        expense: totalMonthlyOutflow,
        isReal: isPastMonth,
        income: monthlyIncomeValue,
        netFlow,
        balance: Math.round(runningBalance * 100) / 100,
        historicalWeightPct: weightPct,
        topCategories,
        installmentNames,
        hasBudget: hasBudgetInMonth,
        hasDebt: hasDebtInMonth
      });
    }
    return data;
  }, [
    fiscalStartDate,
    firstInstallmentDate,
    useDocumentRateMode,
    simulatedMonthlySchedule,
    startingCash,
    reserveFundTarget,
    currentManagementExpenses,
    currentExpensesSum,
    calculatedInstallments,
    totalExpensesBudget,
    pastDebt
  ]);

  // 4. Diagnostica di Copertura Cassa (verifica se le nuove rate coprono sempre le uscite simulate)
  const coverageAnalysis = useMemo(() => {
    const operatingMonths = cashFlowData.filter(d => !d.isOpening);
    const deficitMonths = operatingMonths.filter(d => d.balance < -0.01);
    const belowReserveMonths = operatingMonths.filter(d => d.balance >= -0.01 && d.balance < reserveFundTarget - 0.01);

    let minBalance = startingCash;
    let minBalanceMonthLabel = 'Inizio';

    operatingMonths.forEach(d => {
      if (d.balance < minBalance) {
        minBalance = d.balance;
        minBalanceMonthLabel = `${d.month} '${d.year}`;
      }
    });

    const maxDeficit = minBalance < 0 ? Math.abs(minBalance) : 0;

    return {
      isFullyCovered: deficitMonths.length === 0,
      deficitMonths,
      belowReserveMonths,
      minBalance,
      minBalanceMonthLabel,
      maxDeficit,
    };
  }, [cashFlowData, startingCash, reserveFundTarget]);

  // 5. Ottimizzatore Automatico delle Rate per garantire Copertura Totale seguendo il Preventivo
  const handleOptimizeInstallmentsForCoverage = () => {
    const operatingMonths = cashFlowData.filter(d => !d.isOpening);
    if (operatingMonths.length === 0 || calculatedInstallments.length === 0) return;

    const n = calculatedInstallments.length;
    const newDates: Record<number, string> = {};
    const newManuals: Record<number, number> = {};
    const newDescs: Record<number, string> = {};

    const startFiscal = operatingMonths[0].fullDate;
    const sortedInst = [...calculatedInstallments].sort((a, b) => a.date.getTime() - b.date.getTime());

    const effectiveDates: Date[] = sortedInst.map((inst, idx) => {
      if (idx === 0 && inst.date > new Date(startFiscal.getFullYear(), startFiscal.getMonth() + 1, 0)) {
        if (startingCash < operatingMonths[0].expense) {
          return new Date(startFiscal.getFullYear(), startFiscal.getMonth(), 5);
        }
      }
      return inst.date;
    });

    // Ripartisce il totale del preventivo (totalToRate) sulle rate in base alle uscite simulate in ciascuna finestra temporale
    const windowExpensesByInstallment = new Array(n).fill(0);

    // Finestra della 1ª rata: dall'inizio fino al mese che precede la 2ª rata
    for (let k = 0; k < n; k++) {
      const windowStart = k === 0
        ? new Date(0)
        : new Date(effectiveDates[k].getFullYear(), effectiveDates[k].getMonth(), 1, 0, 0, 0);
      const windowEnd = k < n - 1
        ? new Date(effectiveDates[k + 1].getFullYear(), effectiveDates[k + 1].getMonth(), 0, 23, 59, 59)
        : new Date(9999, 11, 31);

      operatingMonths.forEach(m => {
        const mDate = new Date(m.fullDate.getFullYear(), m.fullDate.getMonth(), 15);
        if (mDate >= windowStart && mDate <= windowEnd) {
          windowExpensesByInstallment[k] += m.expense;
        }
      });
    }

    const sumWindowExpenses = windowExpensesByInstallment.reduce((a, b) => a + b, 0);
    const targetTotal = totalToRate;

    for (let k = 0; k < n; k++) {
      const y = effectiveDates[k].getFullYear();
      const m = String(effectiveDates[k].getMonth() + 1).padStart(2, '0');
      const d = String(effectiveDates[k].getDate()).padStart(2, '0');
      newDates[k] = `${y}-${m}-${d}`;
      const weight = sumWindowExpenses > 0 ? windowExpensesByInstallment[k] / sumWindowExpenses : 1 / n;
      newManuals[k] = Math.round(targetTotal * weight * 100) / 100;
      newDescs[k] = sortedInst[k]?.description || `Rata ${k + 1}`;
    }

    // Aggiustamento centesimi sull'ultima rata per quadratura perfetta con il Preventivo (totalToRate)
    const roundedSum = Object.values(newManuals).reduce((a, b) => a + b, 0);
    const diff = Math.round((targetTotal - roundedSum) * 100) / 100;
    if (Math.abs(diff) > 0 && n > 0) {
      newManuals[n - 1] = Math.max(0, Math.round((newManuals[n - 1] + diff) * 100) / 100);
    }

    if (newDates[0]) {
      setFirstInstallmentDate(newDates[0]);
    }
    setInstallmentDates(newDates);
    setManualInstallments(newManuals);
    setInstallmentDescriptions(newDescs);
    setUseDocumentRateMode(false);
  };

  const CustomXAxisTick = (props: any) => {
    const { x, y, payload } = props;
    const dataPoint = cashFlowData[payload.index];

    if (!dataPoint) return null;

    const isDeficit = !dataPoint.isOpening && dataPoint.balance < -0.01;

    return (
      <g transform={`translate(${x},${y})`}>
        <text
          x={0}
          y={0}
          dy={12}
          textAnchor="middle"
          fill={isDeficit ? '#e11d48' : '#64748b'}
          fontWeight={isDeficit ? 'bold' : 'normal'}
          fontSize={9}
        >
          {payload.value}
        </text>
        {dataPoint.hasBudget && (
          <g transform="translate(-10, 18)">
            <rect width="14" height="14" rx="2" fill="#6366f1" />
            <text x="7" y="7" dy="0.35em" textAnchor="middle" fill="#fff" fontSize="8" fontWeight="bold">B</text>
          </g>
        )}
        {dataPoint.hasDebt && (
          <g transform={`translate(${dataPoint.hasBudget ? 2 : -7}, 18)`}>
            <rect width="14" height="14" rx="2" fill="#f43f5e" />
            <text x="7" y="7" dy="0.35em" textAnchor="middle" fill="#fff" fontSize="8" fontWeight="bold">D</text>
          </g>
        )}
      </g>
    );
  };

  const CustomCashFlowTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data: CashFlowData = payload[0].payload;
      return (
        <div className="bg-white/95 backdrop-blur-sm p-4 border border-slate-200 shadow-xl rounded-2xl z-50 min-w-[240px] space-y-2">
          <div className="flex items-center justify-between border-b border-slate-100 pb-1.5">
            <span className="font-black text-slate-800 uppercase text-xs">
              {data.isOpening ? 'Apertura Esercizio' : `${data.month} 20${data.year}`}
            </span>
            {!data.isOpening && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                Peso storico: {data.historicalWeightPct.toFixed(1)}%
              </span>
            )}
          </div>

          <div className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-500">Entrate (Rate):</span>
              <span className="font-bold text-emerald-600">+{formatCurrency(data.income)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Uscite Simulate:</span>
              <span className="font-bold text-amber-600">-{formatCurrency(data.expense)}</span>
            </div>
            <div className="flex justify-between pt-1 border-t border-slate-100">
              <span className="font-bold text-slate-700">Saldo Cassa:</span>
              <span className={`font-black ${data.balance < 0 ? 'text-rose-600' : 'text-indigo-600'}`}>
                {formatCurrency(data.balance)}
              </span>
            </div>
          </div>

          {data.topCategories && data.topCategories.length > 0 && (
            <div className="pt-1.5 border-t border-slate-100">
              <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Principali uscite attese (da date consuntivo):</p>
              {data.topCategories.map((cat, idx) => (
                <div key={idx} className="flex justify-between text-[10px] text-slate-600">
                  <span className="truncate max-w-[140px]">{cat.category}</span>
                  <span className="font-bold">{formatCurrency(cat.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }
    return null;
  };

  const projectedFinalBalance = useMemo(() => {
    return cashFlowData.length > 0 ? cashFlowData[cashFlowData.length - 1].balance : 0;
  }, [cashFlowData]);

  const handleManualInstallmentChange = (index: number, value: string) => {
    const numValue = parseFloat(value);
    if (isNaN(numValue)) {
      const newManuals = { ...manualInstallments };
      delete newManuals[index];
      setManualInstallments(newManuals);
    } else {
      setManualInstallments(prev => ({ ...prev, [index]: numValue }));
    }
  };

  const handleInstallmentDateChange = (index: number, dateStr: string) => {
    if (index === 0) {
      setFirstInstallmentDate(dateStr);
    }
    setInstallmentDates(prev => ({ ...prev, [index]: dateStr }));
  };

  const toggleBudgetAllocation = (index: number) => {
    setBudgetAllocation(prev => {
      const next = [...prev];
      next[index] = !next[index];
      return next;
    });
  };

  const toggleDebtAllocation = (index: number) => {
    setDebtAllocation(prev => {
      const next = [...prev];
      next[index] = !next[index];
      return next;
    });
  };

  return (
    <div className="bg-white rounded-3xl shadow-xl border border-slate-200 overflow-hidden animate-slide-up">
      <div className="p-8 border-b border-slate-100 bg-slate-50 flex items-center justify-between flex-wrap gap-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-indigo-600 rounded-2xl shadow-lg shadow-indigo-200">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <div>
              <h2 className="text-2xl font-black text-slate-800 tracking-tight">Simulazione Uscite & Verifica Copertura Rate</h2>
              <p className="text-sm text-slate-500 font-medium">Simula le uscite del preventivo sulle date del consuntivo passato e verifica la tenuta di cassa delle nuove rate.</p>
            </div>
          </div>

          {budgetStatus === ProcessingStatus.SUCCESS && (
            <div className="flex items-center gap-2 flex-wrap no-print">
              {extractedPlannedInstallments.length > 0 && (
                <button
                  onClick={handleResetToDocumentRate}
                  className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all ${
                    useDocumentRateMode 
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200' 
                      : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  ✓ Rate da Preventivo ({extractedPlannedInstallments.length})
                </button>
              )}
              <button
                onClick={handleOptimizeInstallmentsForCoverage}
                className="px-3.5 py-1.5 rounded-xl text-xs font-black bg-emerald-600 text-white hover:bg-emerald-700 shadow-md shadow-emerald-100 transition-all flex items-center gap-1.5"
                title="Ricalcola gli importi delle rate per coprire tempestivamente tutti i picchi di spesa simulati"
              >
                <span>⚡ Ottimizza Copertura Cassa</span>
              </button>
              <button
                onClick={handleSwitchToAutoDistribution}
                className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all ${
                  !useDocumentRateMode && Object.keys(manualInstallments).length === 0
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200' 
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                }`}
              >
                Ripartizione Uniforme
              </button>
            </div>
          )}
      </div>

      <div className="p-8">
        {budgetStatus !== ProcessingStatus.SUCCESS ? (
          <div className="max-w-2xl mx-auto py-12 text-center space-y-4">
            {budgetError && (
              <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-rose-700 text-sm text-left">
                <p className="font-semibold mb-1">Attenzione:</p>
                <p>{budgetError}</p>
              </div>
            )}
            <FileUpload 
              onFilesSelect={handleBudgetUpload} 
              disabled={budgetStatus === ProcessingStatus.ANALYZING}
              title="Carica Preventivo Nuova Gestione"
              subtitle="Simuleremo le uscite del preventivo usando le date reali del consuntivo appena caricato per verificare la copertura delle nuove rate."
            />
          </div>
        ) : (
          <div className="space-y-8">
            {docInitialDataBadge && (
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-2 text-emerald-800 text-xs font-bold">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  <span>Dati rilevati dal preventivo:</span>
                  <span className="font-normal text-emerald-700">{docInitialDataBadge}</span>
                </div>
                <button 
                  onClick={() => setBudgetStatus(ProcessingStatus.IDLE)} 
                  className="text-[10px] text-emerald-700 underline font-bold hover:text-emerald-900 no-print"
                >
                  Carica un altro preventivo
                </button>
              </div>
            )}

            {/* BANNER VERIFICA COPERTURA FINANZIARIA DELLE NUOVE RATE */}
            <div
              className={`p-6 rounded-3xl border-2 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 ${
                coverageAnalysis.isFullyCovered
                  ? 'bg-emerald-50/70 border-emerald-200'
                  : 'bg-rose-50 border-rose-200'
              }`}
            >
              <div className="flex items-start gap-4">
                <div
                  className={`p-3.5 rounded-2xl shrink-0 ${
                    coverageAnalysis.isFullyCovered ? 'bg-emerald-500 text-white' : 'bg-rose-600 text-white animate-pulse'
                  }`}
                >
                  {coverageAnalysis.isFullyCovered ? (
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className={`text-base font-black ${coverageAnalysis.isFullyCovered ? 'text-emerald-900' : 'text-rose-900'}`}>
                      {coverageAnalysis.isFullyCovered
                        ? 'Copertura di Cassa Confermata in Tutti i Mesi'
                        : `Attenzione: Scopertura di Cassa Rilevata in ${coverageAnalysis.deficitMonths.length} ${coverageAnalysis.deficitMonths.length === 1 ? 'Mese' : 'Mesi'}`}
                    </h4>
                    <span
                      className={`text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full ${
                        coverageAnalysis.isFullyCovered ? 'bg-emerald-200/70 text-emerald-800' : 'bg-rose-200 text-rose-800'
                      }`}
                    >
                      Minimo annuo: {formatCurrency(coverageAnalysis.minBalance)} ({coverageAnalysis.minBalanceMonthLabel})
                    </span>
                  </div>
                  <p className={`text-xs mt-1 font-medium ${coverageAnalysis.isFullyCovered ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {coverageAnalysis.isFullyCovered ? (
                      <>
                        Simulando le uscite del preventivo sulle date storiche del consuntivo, le nuove rate garantiscono sempre liquidità positiva sul conto.
                        {coverageAnalysis.belowReserveMonths.length > 0 && (
                          <span className="font-bold"> Nota: in {coverageAnalysis.belowReserveMonths.length} mesi il saldo scende temporaneamente sotto la soglia del Fondo ({formatCurrency(reserveFundTarget)}).</span>
                        )}
                      </>
                    ) : (
                      <>
                        Nei mesi di{' '}
                        <span className="font-black underline">
                          {coverageAnalysis.deficitMonths.map(m => `${m.month} '${m.year}`).join(', ')}
                        </span>{' '}
                        le uscite simulate precedono l'incasso delle rate causando uno scoperto fino a{' '}
                        <span className="font-black">-{formatCurrency(coverageAnalysis.maxDeficit)}</span>. Anticipa le scadenze o clicca su "Ottimizza Copertura Cassa".
                      </>
                    )}
                  </p>
                </div>
              </div>

              {!coverageAnalysis.isFullyCovered && (
                <button
                  onClick={handleOptimizeInstallmentsForCoverage}
                  className="no-print shrink-0 px-5 py-3 bg-rose-600 hover:bg-rose-700 text-white rounded-2xl text-xs font-black uppercase tracking-wider shadow-lg shadow-rose-200 transition-all"
                >
                  ⚡ Correggi Piano Rate
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-slate-900 rounded-3xl p-6 text-white shadow-xl flex flex-col justify-between">
                    <div>
                      <h4 className="text-[10px] font-black uppercase opacity-60 mb-4">Analisi Fabbisogno Emissione (Preventivo)</h4>
                      <div className="space-y-2 text-xs">
                          <div className="flex justify-between">
                            <span>Spese Previste da Preventivo (B):</span> 
                            <span className="text-indigo-300 font-bold">+{formatCurrency(totalExpensesBudget)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Debito Pregresso - Saldi di fine es. precedente (D):</span> 
                            <span className="text-rose-400 font-bold">+{formatCurrency(pastDebt)}</span>
                          </div>
                          <div className="flex justify-between font-black text-base mt-2 pt-2 border-t border-indigo-500/30">
                              <span>Emissione Fabbisogno Rate:</span>
                              <span className="text-white">{formatCurrency(totalToRate)}</span>
                          </div>
                      </div>
                    </div>
                    <div className="mt-4 pt-3 border-t border-slate-800 grid grid-cols-2 gap-3 text-[11px]">
                      <div className="bg-slate-800/70 rounded-xl px-3 py-2">
                        <span className="block text-[9px] uppercase text-slate-400 font-bold">Partenza Liquidità (Cassa Iniziale)</span>
                        <span className="font-black text-emerald-400">{formatCurrency(startingCash)}</span>
                      </div>
                      <div className="bg-slate-800/70 rounded-xl px-3 py-2">
                        <span className="block text-[9px] uppercase text-slate-400 font-bold">Arrivo Liquidità (Fondo)</span>
                        <span className="font-black text-indigo-300">{formatCurrency(reserveFundTarget)}</span>
                      </div>
                    </div>
                </div>

                <div className="bg-indigo-50 rounded-3xl p-6 border border-indigo-100 flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                        <div>
                            <h4 className="text-[10px] font-black text-indigo-800 uppercase mb-1">Previsione Saldo Finale</h4>
                            <p className={`text-3xl font-black ${projectedFinalBalance < 0 ? 'text-rose-600' : 'text-indigo-900'}`}>
                              {formatCurrency(projectedFinalBalance)}
                            </p>
                            <p className="text-[9px] text-indigo-600 font-bold uppercase mt-1">
                              Saldo Previsto a Fine Gestione {reserveFundTarget > 0 ? `(Obiettivo Fondo: ${formatCurrency(reserveFundTarget)})` : ''}
                            </p>
                        </div>
                        <div className="p-3 bg-white rounded-2xl shadow-sm">
                             <svg className="w-8 h-8 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        </div>
                    </div>

                    {/* Selettore Metodo di Simulazione Uscite */}
                    <div className="mt-4 pt-3 border-t border-indigo-100 no-print">
                      <label className="block text-[9px] font-black text-indigo-700 uppercase mb-1.5">
                        Criterio Simulazione Uscite Preventivo:
                      </label>
                      <div className="grid grid-cols-3 gap-1.5">
                        <button
                          onClick={() => setSimulationMethod('category-dates')}
                          className={`px-2 py-1.5 rounded-lg text-[10px] font-black transition-all ${
                            simulationMethod === 'category-dates'
                              ? 'bg-indigo-600 text-white shadow-sm'
                              : 'bg-white text-indigo-700 hover:bg-indigo-100'
                          }`}
                          title="Proietta ogni categoria del preventivo esattamente nei mesi in cui quella categoria è stata pagata nel consuntivo"
                        >
                          Date per Categoria
                        </button>
                        <button
                          onClick={() => setSimulationMethod('global-dates')}
                          className={`px-2 py-1.5 rounded-lg text-[10px] font-black transition-all ${
                            simulationMethod === 'global-dates'
                              ? 'bg-indigo-600 text-white shadow-sm'
                              : 'bg-white text-indigo-700 hover:bg-indigo-100'
                          }`}
                          title="Proietta il totale del preventivo seguendo il peso mensile complessivo del consuntivo"
                        >
                          Curva Consuntivo
                        </button>
                        <button
                          onClick={() => setSimulationMethod('uniform')}
                          className={`px-2 py-1.5 rounded-lg text-[10px] font-black transition-all ${
                            simulationMethod === 'uniform'
                              ? 'bg-indigo-600 text-white shadow-sm'
                              : 'bg-white text-indigo-700 hover:bg-indigo-100'
                          }`}
                          title="Spalma il preventivo in 12 quote mensili costanti (1/12)"
                        >
                          1/12 Lineare
                        </button>
                      </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="space-y-6 no-print">
                <div className="bg-white p-6 rounded-3xl border border-slate-200 space-y-6 shadow-sm">
                  <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest text-center">Configurazione Dati Iniziali</h4>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-[9px] font-black text-emerald-600 uppercase mb-1">Cassa iniziale in banca (€)</label>
                      <input 
                        type="number" 
                        value={startingCash} 
                        onChange={(e) => setStartingCash(Math.max(0, parseFloat(e.target.value) || 0))} 
                        className="w-full p-2.5 bg-emerald-50 border border-emerald-100 text-emerald-700 rounded-xl text-sm font-black" 
                      />
                      <p className="text-[9px] text-slate-400 italic mt-0.5">Liquidità di partenza sul conto (non influisce sulle rate).</p>
                    </div>
                    <div>
                      <label className="block text-[9px] font-black text-rose-500 uppercase mb-1">Debito pregresso (€)</label>
                      <input 
                        type="number" 
                        value={pastDebt} 
                        onChange={(e) => setPastDebt(Math.max(0, parseFloat(e.target.value) || 0))} 
                        className="w-full p-2.5 bg-rose-50 border border-rose-100 text-rose-700 rounded-xl text-sm font-black" 
                      />
                      <p className="text-[9px] text-slate-400 italic mt-0.5">Recuperato da "Saldi di fine es. precedente" del preventivo.</p>
                    </div>
                    <div>
                      <label className="block text-[9px] font-black text-indigo-500 uppercase mb-1">Fondo (€)</label>
                      <input 
                        type="number" 
                        value={reserveFundTarget} 
                        onChange={(e) => setReserveFundTarget(Math.max(0, parseFloat(e.target.value) || 0))} 
                        className="w-full p-2.5 bg-indigo-50 border border-indigo-100 text-indigo-700 rounded-xl text-sm font-black" 
                      />
                      <p className="text-[9px] text-slate-400 italic mt-0.5">Liquidità di arrivo / riferimento (non influisce sulle rate).</p>
                    </div>
                    <div>
                      <label className="block text-[9px] font-black text-indigo-600 uppercase mb-1">Inizio anno preventivo</label>
                      <input 
                        type="date" 
                        value={fiscalStartDate} 
                        onChange={(e) => {
                          setFiscalStartDate(e.target.value);
                          setUserEditedFiscalStart(true);
                        }} 
                        className="w-full p-2.5 bg-indigo-50/60 border border-indigo-200 rounded-xl text-sm font-black text-indigo-800" 
                      />
                      <p className="text-[9px] text-slate-400 italic mt-0.5">
                        Periodo grafico (12 mesi): <span className="font-bold text-slate-600">{preventivoPeriodInfo.label}</span>
                      </p>
                    </div>
                    <div>
                      <label className="block text-[9px] font-black text-slate-500 uppercase mb-1">Data prima rata</label>
                      <input 
                        type="date" 
                        value={firstInstallmentDate} 
                        onChange={(e) => {
                          setFirstInstallmentDate(e.target.value);
                          setInstallmentDates({});
                          setUseDocumentRateMode(false);
                        }} 
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-black text-slate-700" 
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[9px] font-black text-slate-500 uppercase mb-1">Num. Rate</label>
                        <input 
                          type="number" 
                          value={totalInstallments} 
                          onChange={(e) => {
                            const count = Math.max(1, parseInt(e.target.value) || 1);
                            setTotalInstallments(count);
                            setManualInstallments({});
                            setInstallmentDates({});
                            setInstallmentDescriptions({});
                            setBudgetAllocation(new Array(count).fill(true));
                            setDebtAllocation(new Array(count).fill(false).map((_, i) => i < Math.min(6, count)));
                            setUseDocumentRateMode(false);
                          }} 
                          className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-black text-indigo-600"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] font-black text-slate-500 uppercase mb-1">Freq (GG)</label>
                        <input 
                          type="number" 
                          value={installmentIntervalDays} 
                          onChange={(e) => {
                            setInstallmentIntervalDays(Math.max(1, parseInt(e.target.value) || 30));
                            setInstallmentDates({});
                            setUseDocumentRateMode(false);
                          }} 
                          className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-black text-slate-700"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-2 space-y-6">
                <div id="budget-projection" className="bg-white p-8 rounded-[2rem] border border-slate-200 shadow-sm relative">
                   <div className="flex justify-between items-start mb-10 gap-4 flex-wrap">
                      <div>
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <h3 className="font-black text-xl text-slate-800">Proiezione di Cassa & Verifica Copertura</h3>
                          <span className="px-2.5 py-1 bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-lg text-[10px] font-black uppercase tracking-wider">
                            Anno Preventivo: {preventivoPeriodInfo.label}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 italic mt-1">
                          Confronto sull'intero esercizio di preventivo (da inizio a termine) tra uscite simulate (arancione), incassi nuove rate (verde) e saldo di cassa (linea blu).
                        </p>
                      </div>
                      <button 
                        onClick={() => downloadElementAsImage('budget-projection', 'proiezione_cassa_condominio')}
                        className="no-print p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all"
                        title="Scarica Proiezione"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      </button>
                   </div>
                   <div className="h-[260px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={cashFlowData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="month" tick={<CustomXAxisTick />} height={40} interval={0} axisLine={false} tickLine={false} />
                        <YAxis domain={['auto', 'auto']} fontSize={9} tickFormatter={(v) => `€${Math.round(v)}`} stroke="#94a3b8" axisLine={false} tickLine={false} />
                        <Tooltip content={<CustomCashFlowTooltip />} cursor={{fill: '#f8fafc'}} />
                        <Bar dataKey="income" name="Entrate / Rate" fill="#10b981" opacity={0.35} barSize={20} isAnimationActive={false} />
                        <Bar dataKey="expense" name="Uscite Simulate" fill="#f59e0b" opacity={0.45} barSize={20} isAnimationActive={false} />
                        <Line type="monotone" dataKey="balance" name="Saldo di Cassa" stroke="#4f46e5" strokeWidth={3} dot={{ r: 3, fill: '#4f46e5' }} isAnimationActive={false} />
                        {reserveFundTarget > 0 && (
                          <ReferenceLine y={reserveFundTarget} stroke="#10b981" strokeDasharray="3 3" label={{ position: 'left', value: 'Fondo', fill: '#10b981', fontSize: 10, fontWeight: 'bold' }} />
                        )}
                        <ReferenceLine y={0} stroke="#e11d48" strokeDasharray="3 3" strokeWidth={1.5} />
                      </ComposedChart>
                    </ResponsiveContainer>
                   </div>
                </div>

                <div id="installment-list-report" className="bg-white p-8 rounded-[2rem] border border-slate-200 shadow-sm flex flex-col">
                  <div className="flex justify-between items-center mb-6 flex-wrap gap-4">
                    <div>
                      <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest">Piano delle Nuove Rate</h4>
                      <p className="text-xs text-slate-500 font-medium">Verifica o simula scadenze e importi delle rate per coprire le uscite.</p>
                    </div>
                    {extractedPlannedInstallments.length > 0 && (
                      <span className="px-3 py-1 bg-indigo-50 text-indigo-700 text-xs font-bold rounded-lg border border-indigo-100">
                        {useDocumentRateMode ? '✓ Sincronizzato con Scadenzario Preventivo' : 'Piano Rate Simulato / Personalizzato'}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {calculatedInstallments.map((inst, i) => (
                      <div 
                        key={i} 
                        className={`flex flex-col p-4 rounded-2xl border transition-all ${
                          inst.isManual ? 'bg-indigo-50/70 border-indigo-200 shadow-sm' : 'bg-slate-50 border-slate-100'
                        } ${!inst.isActive ? 'opacity-40' : ''}`}
                      >
                        <div className="flex justify-between items-start mb-3">
                           <div>
                              <span className="text-[10px] font-black text-indigo-600 uppercase tracking-wide">
                                {inst.description || `Rata ${inst.number}`}
                              </span>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <span className="text-[10px] text-slate-400">Scadenza:</span>
                                <input 
                                  type="date"
                                  value={inst.dueDate || inst.date.toISOString().split('T')[0]}
                                  onChange={(e) => handleInstallmentDateChange(i, e.target.value)}
                                  className="text-[10px] font-bold text-slate-700 bg-transparent border-b border-dashed border-slate-300 focus:outline-none focus:border-indigo-500"
                                />
                              </div>
                           </div>
                           <div className="flex gap-1 no-print">
                              <button 
                                onClick={() => toggleBudgetAllocation(i)} 
                                className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black transition-all ${
                                  inst.hasBudget ? 'bg-indigo-600 text-white shadow-md' : 'bg-white text-slate-300 border border-slate-200 hover:border-indigo-300'
                                }`}
                                title="Attiva Quota Spese (B)"
                              >B</button>
                              <button 
                                onClick={() => toggleDebtAllocation(i)} 
                                className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black transition-all ${
                                  inst.hasDebt ? 'bg-rose-500 text-white shadow-md' : 'bg-white text-slate-300 border border-slate-200 hover:border-rose-300'
                                }`}
                                title="Attiva Quota Debito (D)"
                              >D</button>
                           </div>
                        </div>

                        <div className="flex justify-between items-end mt-auto pt-2 border-t border-slate-100">
                            <div className="flex items-center gap-1 text-[9px] text-slate-500 font-medium">
                                {inst.hasBudget && <span className="text-indigo-600 font-bold">Quota B</span>}
                                {inst.hasBudget && inst.hasDebt && <span>+</span>}
                                {inst.hasDebt && <span className="text-rose-600 font-bold">Quota D</span>}
                            </div>
                            <div className="flex items-center gap-1">
                                <span className="text-xs text-slate-400 font-bold">€</span>
                                <input 
                                    type="number"
                                    step="0.01"
                                    value={inst.amount.toFixed(2)}
                                    onChange={(e) => handleManualInstallmentChange(i, e.target.value)}
                                    className={`w-28 text-right font-black text-base bg-transparent border-b-2 transition-all focus:outline-none ${
                                      inst.isManual ? 'border-indigo-400 text-indigo-700' : 'border-transparent text-slate-800 focus:border-slate-300'
                                    }`}
                                />
                            </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className={`mt-8 p-6 rounded-3xl border-2 border-dashed flex flex-col md:flex-row justify-between items-center gap-6 ${isCoincident ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
                    <div className="flex items-center gap-5">
                      <div className={`p-4 rounded-2xl ${isCoincident ? 'bg-emerald-500 text-white' : 'bg-amber-500 text-white'}`}>
                        {isCoincident ? <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg> : <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 9v2m0 4h.01" /></svg>}
                      </div>
                      <div>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Totale Rate Pianificate</p>
                        <p className={`text-2xl font-black ${isCoincident ? 'text-emerald-700' : 'text-amber-700'}`}>{formatCurrency(installmentsSum)}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Obiettivo Emissione</p>
                      <p className="text-xl font-black text-slate-600">{formatCurrency(totalToRate)}</p>
                      {!isCoincident && <p className="text-[9px] font-bold text-rose-500 uppercase mt-1 animate-pulse">Differenza / Gap: {formatCurrency(totalToRate - installmentsSum)}</p>}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* SEZIONE 7 PER REPORT PDF E VERIFICA DETTAGLIATA MESE PER MESE */}
            <div id="cash-flow-table-report" className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-8 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h3 className="text-xl font-black text-slate-800 tracking-tight">
                    Prospetto Mensile Simulazione Uscite & Copertura Rate
                  </h3>
                  <p className="text-xs text-slate-500 font-medium mt-1">
                    Confronto analitico mese per mese tra le uscite del preventivo (distribuite sulle date del consuntivo) e gli incassi delle nuove rate.
                  </p>
                </div>
                <span className="px-3.5 py-1.5 rounded-xl bg-slate-100 text-slate-700 text-xs font-black">
                  Metodo: {simulationMethod === 'category-dates' ? 'Date Storiche per Categoria' : simulationMethod === 'global-dates' ? 'Curva Globale Consuntivo' : 'Lineare 1/12'}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-600">
                  <thead className="bg-slate-50 text-[10px] uppercase font-black text-slate-400 tracking-wider border-b border-slate-100">
                    <tr>
                      <th className="px-6 py-3.5">Mese</th>
                      <th className="px-6 py-3.5">Peso Storico & Principali Voci Attese</th>
                      <th className="px-6 py-3.5 text-right">Uscite Simulate</th>
                      <th className="px-6 py-3.5 text-right">Incasso Nuove Rate</th>
                      <th className="px-6 py-3.5 text-right">Flusso Netto</th>
                      <th className="px-6 py-3.5 text-right">Saldo Progressivo</th>
                      <th className="px-6 py-3.5 text-center">Copertura</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {cashFlowData.map((row, idx) => {
                      const isDeficit = !row.isOpening && row.balance < -0.01;
                      const isBelowReserve = !row.isOpening && !isDeficit && reserveFundTarget > 0 && row.balance < reserveFundTarget - 0.01;

                      return (
                        <tr
                          key={idx}
                          className={`transition-colors ${
                            row.isOpening
                              ? 'bg-slate-50/70 font-bold'
                              : isDeficit
                              ? 'bg-rose-50/70 hover:bg-rose-50'
                              : 'hover:bg-slate-50'
                          }`}
                        >
                          <td className="px-6 py-3.5 whitespace-nowrap font-black text-slate-800 uppercase">
                            {row.isOpening ? 'Saldo Iniziale' : `${row.month} '${row.year}`}
                          </td>
                          <td className="px-6 py-3.5">
                            {row.isOpening ? (
                              <span className="text-slate-400 italic">Cassa iniziale di partenza a inizio gestione</span>
                            ) : (
                              <div className="space-y-0.5">
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-slate-700">{row.historicalWeightPct.toFixed(1)}% del budget</span>
                                  {row.installmentNames.length > 0 && (
                                    <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold">
                                      Incasso: {row.installmentNames.join(', ')}
                                    </span>
                                  )}
                                </div>
                                {row.topCategories.length > 0 && (
                                  <p className="text-[10px] text-slate-400">
                                    {row.topCategories.map(c => `${c.category} (${formatCurrency(c.amount)})`).join(' • ')}
                                  </p>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="px-6 py-3.5 text-right font-bold text-amber-700 whitespace-nowrap">
                            {row.isOpening ? '-' : `-${formatCurrency(row.expense)}`}
                          </td>
                          <td className="px-6 py-3.5 text-right font-bold text-emerald-600 whitespace-nowrap">
                            {row.isOpening ? '-' : row.income > 0 ? `+${formatCurrency(row.income)}` : '€ 0,00'}
                          </td>
                          <td className={`px-6 py-3.5 text-right font-bold whitespace-nowrap ${row.netFlow >= 0 ? 'text-emerald-700' : 'text-slate-600'}`}>
                            {row.isOpening ? '-' : `${row.netFlow >= 0 ? '+' : ''}${formatCurrency(row.netFlow)}`}
                          </td>
                          <td className={`px-6 py-3.5 text-right font-black text-sm whitespace-nowrap ${isDeficit ? 'text-rose-600' : 'text-indigo-900'}`}>
                            {formatCurrency(row.balance)}
                          </td>
                          <td className="px-6 py-3.5 text-center whitespace-nowrap">
                            {row.isOpening ? (
                              <span className="px-2.5 py-1 rounded-full text-[10px] font-black bg-slate-200 text-slate-700 uppercase">
                                Apertura
                              </span>
                            ) : isDeficit ? (
                              <span className="px-2.5 py-1 rounded-full text-[10px] font-black bg-rose-600 text-white uppercase shadow-sm">
                                Scoperto
                              </span>
                            ) : isBelowReserve ? (
                              <span className="px-2.5 py-1 rounded-full text-[10px] font-black bg-amber-100 text-amber-800 border border-amber-200 uppercase">
                                Sotto Fondo
                              </span>
                            ) : (
                              <span className="px-2.5 py-1 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-200 uppercase">
                                Coperto
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
