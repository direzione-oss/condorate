import { GoogleGenAI, Type } from "@google/genai";
import { Expense, BudgetItem, PlannedInstallment } from "../types";

export interface FinancialStatementResult {
  expenses: Expense[];
  openingBalance: number;
  closingBalance: number;
  totalReportedExpenses: number;
  totalReportedIncome?: number;
  pastDebt?: number;
  reserveFund?: number;
  fiscalStartDate?: string;
  fiscalEndDate?: string;
}

export interface BudgetEstimateResult {
  items: BudgetItem[];
  fiscalStartDate?: string; // YYYY-MM-DD (inizio anno gestione preventivo)
  fiscalEndDate?: string; // YYYY-MM-DD (termine anno gestione preventivo)
  startingCash: number; // Cassa iniziale / saldo conto corrente di partenza
  pastDebt: number; // Debito pregresso o disavanzo gestione passata
  reserveFundTarget: number; // Fondo cassa o fondo riserva preventivato
  totalBudgetExpenses: number; // Totale spese preventivate
  plannedInstallments: PlannedInstallment[]; // Piano rate previste (scadenza, importo, descrizione)
}

function getGenAI(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
  if (!apiKey) {
    throw new Error("Chiave API Gemini non trovata. Verifica la configurazione in .env.local.");
  }
  return new GoogleGenAI({ apiKey });
}

function cleanBase64(data: string): string {
  const commaIdx = data.indexOf(",");
  if (commaIdx !== -1) {
    return data.slice(commaIdx + 1).trim();
  }
  return data.trim();
}

/**
 * Normalizza una data opzionale in YYYY-MM-DD. Restituisce undefined se vuota o non valida.
 */
export function normalizeOptionalDate(rawDate?: string): string | undefined {
  if (!rawDate || typeof rawDate !== "string") return undefined;
  const trimmed = rawDate.trim();
  if (!trimmed) return undefined;

  // Se già ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  // Se solo anno YYYY (es. "2025")
  if (/^\d{4}$/.test(trimmed)) {
    return `${trimmed}-01-01`;
  }

  // Formato italiano DD/MM/YYYY o DD-MM-YYYY o DD.MM.YYYY
  const itFullMatch = trimmed.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (itFullMatch) {
    const day = itFullMatch[1].padStart(2, "0");
    const month = itFullMatch[2].padStart(2, "0");
    const year = itFullMatch[3];
    return `${year}-${month}-${day}`;
  }

  // Formato italiano DD/MM/YY
  const itShortMatch = trimmed.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2})$/);
  if (itShortMatch) {
    const day = itShortMatch[1].padStart(2, "0");
    const month = itShortMatch[2].padStart(2, "0");
    const year = `20${itShortMatch[3]}`;
    return `${year}-${month}-${day}`;
  }

  // Tentativo di parsing standard Date
  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split("T")[0];
  }

  return undefined;
}

/**
 * Normalizza qualsiasi formato di data (italiano GG/MM/AAAA, ISO AAAA-MM-GG, ecc.) in formato standard YYYY-MM-DD.
 */
export function normalizeDate(rawDate?: string): string {
  return normalizeOptionalDate(rawDate) || new Date().toISOString().split("T")[0];
}

/**
 * Analizza il JSON anche se parzialmente troncato per via di documenti PDF molto lunghi,
 * recuperando tutti gli elementi completi senza fallire né causare loop infiniti.
 */
function parseJsonSafely(text: string): any {
  if (!text) return null;
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  }
  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf("{");
    if (firstBrace === -1) return null;
    const sub = cleaned.substring(firstBrace);

    // 1. Tentativo con l'ultima graffa chiusa
    const lastBrace = sub.lastIndexOf("}");
    if (lastBrace > 0) {
      try {
        return JSON.parse(sub.substring(0, lastBrace + 1));
      } catch {
        // Continua con riparazione array troncato
      }
    }

    // 2. Riparazione di array JSON troncato (es. {"expenses": [ {...}, {...}, {"date":... )
    // Troviamo l'ultimo oggetto completo "}," o "}" dentro l'array e chiudiamo "]}"
    let searchPos = sub.length;
    while (searchPos > 0) {
      const prevCloseObj = sub.lastIndexOf("}", searchPos - 1);
      if (prevCloseObj <= 0) break;
      const candidateBase = sub.substring(0, prevCloseObj + 1);
      for (const suffix of ["]}", "]}]}"]) {
        try {
          return JSON.parse(candidateBase + suffix);
        } catch {
          // Riprova col precedente oggetto chiuso
        }
      }
      searchPos = prevCloseObj;
    }
    return null;
  }
}

// Modelli veloci in ordine di priorità (con thinking disattivato per risposta immediata)
const CANDIDATE_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
];

async function generateWithTimeout<T>(promise: Promise<T>, timeoutMs: number, abortSignal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout di ${Math.round(timeoutMs / 1000)}s superato durante l'analisi del PDF.`));
    }, timeoutMs);

    if (abortSignal) {
      if (abortSignal.aborted) {
        clearTimeout(timer);
        reject(new Error("Analisi annullata dall'utente."));
        return;
      }
      abortSignal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new Error("Analisi annullata dall'utente."));
      });
    }

    promise
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

export const parseFinancialStatement = async (
  base64Pdf: string,
  mimeType: string = "application/pdf",
  fileName?: string,
  onProgress?: (msg: string) => void,
  abortSignal?: AbortSignal
): Promise<FinancialStatementResult> => {
  const ai = getGenAI();
  const cleanedData = cleanBase64(base64Pdf);
  const effectiveMime = mimeType && mimeType.includes("/") ? mimeType : "application/pdf";

  let lastError: any = null;

  for (const model of CANDIDATE_MODELS) {
    if (abortSignal?.aborted) {
      throw new Error("Analisi annullata dall'utente.");
    }
    try {
      if (onProgress) {
        onProgress(`Estrazione movimenti da ${fileName || "documento"} (${model})...`);
      }

      const apiPromise = ai.models.generateContent({
        model,
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: effectiveMime,
                data: cleanedData,
              },
            },
            {
              text: `Sei un esperto contabile specializzato in rendiconti condominiali italiani.
Analizza questo consuntivo${fileName ? ` (${fileName})` : ""} ed estrai rapidamente i dati in JSON:

1. MOVIMENTI DI SPESA (expenses):
   - date: data in formato "YYYY-MM-DD" (converti "15/03/2024" -> "2024-03-15"). Se manca il giorno usa "01".
   - amount: importo numerico positivo in Euro.
   - description: fornitore/causale sintetico (max 60 caratteri).
   - category: una tra "Luce/Energia", "Acqua", "Pulizia", "Ascensore", "Riscaldamento", "Assicurazione", "Compenso Amministratore", "Manutenzione Ordinaria", "Manutenzione Straordinaria", "Spese Generali", "Altro".

2. SALDI DI GESTIONE:
   - openingBalance: Saldo iniziale cassa/banca all'apertura (0 se non indicato).
   - closingBalance: Saldo finale cassa/banca a chiusura (avanzo positivo, disavanzo negativo, 0 se non indicato).
   - pastDebt: Eventuale debito pregresso o disavanzo non coperto (0 se assente).
   - reserveFund: Eventuale fondo cassa/riserva (0 se assente).
   - totalReportedExpenses: Totale ufficiale uscite dichiarato nel documento (0 se non indicato).
   - totalReportedIncome: Totale entrate dichiarato (0 se non indicato).
   - fiscalStartDate: Inizio esercizio "YYYY-MM-DD".
   - fiscalEndDate: Fine esercizio "YYYY-MM-DD".`,
            },
          ],
        },
        config: {
          temperature: 0.1,
          maxOutputTokens: 65536,
          thinkingConfig: { thinkingBudget: 0 },
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              openingBalance: { type: Type.NUMBER },
              closingBalance: { type: Type.NUMBER },
              pastDebt: { type: Type.NUMBER },
              reserveFund: { type: Type.NUMBER },
              totalReportedExpenses: { type: Type.NUMBER },
              totalReportedIncome: { type: Type.NUMBER },
              fiscalStartDate: { type: Type.STRING },
              fiscalEndDate: { type: Type.STRING },
              expenses: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    date: { type: Type.STRING },
                    amount: { type: Type.NUMBER },
                    description: { type: Type.STRING },
                    category: { type: Type.STRING },
                  },
                  required: ["amount", "description"],
                },
              },
            },
            required: ["expenses"],
          },
        },
      });

      const response = await generateWithTimeout(apiPromise, 90000, abortSignal);
      const text = response.text?.trim();
      if (!text) continue;

      const parsed = parseJsonSafely(text);
      if (!parsed || !Array.isArray(parsed.expenses)) continue;

      const validExpenses: Expense[] = parsed.expenses
        .filter((item: any) => typeof item.amount === "number" && item.amount > 0)
        .map((item: any) => ({
          date: normalizeDate(item.date),
          amount: Math.abs(Number(item.amount)),
          description: String(item.description || "Spesa condominiale").trim(),
          category: String(item.category || "Altro").trim(),
        }));

      if (validExpenses.length === 0) {
        lastError = new Error(
          `Nessun movimento di spesa rilevato nel documento${fileName ? ` (${fileName})` : ""}.`
        );
        continue;
      }

      const openingBalance = typeof parsed.openingBalance === "number" ? parsed.openingBalance : 0;
      const closingBalance = typeof parsed.closingBalance === "number" ? parsed.closingBalance : 0;
      const pastDebt = typeof parsed.pastDebt === "number" ? Math.abs(parsed.pastDebt) : 0;
      const reserveFund = typeof parsed.reserveFund === "number" ? Math.abs(parsed.reserveFund) : 0;
      const totalReportedIncome = typeof parsed.totalReportedIncome === "number" ? parsed.totalReportedIncome : undefined;

      const totalReportedExpenses =
        typeof parsed.totalReportedExpenses === "number" && parsed.totalReportedExpenses > 0
          ? parsed.totalReportedExpenses
          : validExpenses.reduce((sum, e) => sum + e.amount, 0);

      return {
        expenses: validExpenses,
        openingBalance,
        closingBalance,
        totalReportedExpenses,
        totalReportedIncome,
        pastDebt,
        reserveFund,
        fiscalStartDate: normalizeOptionalDate(parsed.fiscalStartDate),
        fiscalEndDate: normalizeOptionalDate(parsed.fiscalEndDate),
      };
    } catch (err: any) {
      if (abortSignal?.aborted) throw err;
      console.warn(`Tentativo modello ${model} non riuscito:`, err?.message || err);
      lastError = err;
    }
  }

  console.error("Tutti i tentativi di analisi PDF sono falliti:", lastError);
  throw new Error(
    `Impossibile analizzare il file${fileName ? ` "${fileName}"` : ""}: ${
      lastError?.message || "Verifica che il documento sia un PDF o immagine leggibile."
    }`
  );
};

export const parseBudgetEstimate = async (
  base64Pdf: string,
  mimeType: string = "application/pdf",
  fileName?: string
): Promise<BudgetEstimateResult> => {
  const ai = getGenAI();
  const cleanedData = cleanBase64(base64Pdf);
  const effectiveMime = mimeType && mimeType.includes("/") ? mimeType : "application/pdf";

  let lastError: any = null;

  for (const model of CANDIDATE_MODELS) {
    try {
      const apiPromise = ai.models.generateContent({
        model,
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: effectiveMime,
                data: cleanedData,
              },
            },
            {
              text: `Sei un esperto contabile specializzato in bilanci preventivi e piani rateali condominiali italiani.
Analizza questo preventivo${fileName ? ` (${fileName})` : ""} ed estrai in JSON:

1. STATO INIZIALE E PERIODO ESERCIZIO PREVENTIVO:
   - startingCash: Cassa iniziale / avanzo riportato all'inizio (numero positivo, 0 se assente).
   - pastDebt: Valore del debito pregresso recuperato ESATTAMENTE dal valore indicato nel preventivo alla voce o colonna "Saldi di fine es. precedente" (o "Saldo di fine es. precedente", "Saldi fine es. precedente", "Saldi fine esercizio precedente": prendi il totale generale di quella colonna/voce come numero positivo; 0 se assente).
   - reserveFundTarget: Fondo preventivato (numero positivo, 0 se assente).
   - fiscalStartDate: Data di inizio dell'anno/esercizio di gestione del preventivo in formato "YYYY-MM-DD" (cerca nell'intestazione del preventivo es. "Gestione dal 01/09/2025 al 31/08/2026", "Esercizio 01/10/2025 - 30/09/2026", "Preventivo 2025" -> "2025-01-01"). ATTENZIONE: NON usare MAI la data di scadenza della prima rata come fiscalStartDate! Se nel documento non è indicata la data di inizio esercizio, restituisci stringa vuota "".
   - fiscalEndDate: Data di termine dell'anno/esercizio di gestione del preventivo in formato "YYYY-MM-DD" (es. "2026-08-31", "2026-09-30", "2025-12-31"). NON usare la data dell'ultima rata! Se non indicata, restituisci stringa vuota "".
   - totalBudgetExpenses: Totale ufficiale spese preventivate della gestione (esclusi i "Saldi di fine es. precedente").

2. PIANO RATE PREVISTE (plannedInstallments):
   - Per ciascuna rata prevista nello scadenzario (1ª Rata, 2ª Rata, ecc.):
     * number: numero progressivo (1, 2, 3...)
     * dueDate: data scadenza "YYYY-MM-DD"
     * amount: importo complessivo della rata in Euro (somma di tutti i condomini per quella rata)
     * description: es. "1ª Rata Ordinaria"
     * category: "Ordinaria", "Straordinaria" o "Conguaglio"

3. VOCI DI SPESA PREVENTIVATE (items):
   - Tutte le voci di costo preventivate della gestione (type="expense"): descrizione sintetica, importo, categoria ("Luce/Energia", "Acqua", "Pulizia", "Ascensore", "Riscaldamento", "Assicurazione", "Compenso Amministratore", "Manutenzione Ordinaria", "Manutenzione Straordinaria", "Spese Generali", "Altro").
   - IMPORTANTE: NON inserire "Saldi di fine es. precedente" dentro items (va inserito solo nel campo pastDebt).`,
            },
          ],
        },
        config: {
          temperature: 0.1,
          maxOutputTokens: 65536,
          thinkingConfig: { thinkingBudget: 0 },
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              startingCash: { type: Type.NUMBER },
              pastDebt: { type: Type.NUMBER },
              reserveFundTarget: { type: Type.NUMBER },
              fiscalStartDate: { type: Type.STRING },
              fiscalEndDate: { type: Type.STRING },
              totalBudgetExpenses: { type: Type.NUMBER },
              plannedInstallments: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    number: { type: Type.INTEGER },
                    dueDate: { type: Type.STRING },
                    amount: { type: Type.NUMBER },
                    description: { type: Type.STRING },
                    category: { type: Type.STRING },
                  },
                  required: ["number", "dueDate", "amount"],
                },
              },
              items: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    amount: { type: Type.NUMBER },
                    description: { type: Type.STRING },
                    category: { type: Type.STRING },
                    type: { type: Type.STRING, enum: ["expense", "income"] },
                    dueDate: { type: Type.STRING },
                  },
                  required: ["amount", "description", "type"],
                },
              },
            },
            required: ["items"],
          },
        },
      });

      const response = await generateWithTimeout(apiPromise, 90000);
      const text = response.text?.trim();
      if (!text) continue;

      const parsed = parseJsonSafely(text);
      if (!parsed || !Array.isArray(parsed.items)) continue;

      const rawItems: BudgetItem[] = parsed.items
        .filter((item: any) => typeof item.amount === "number" && item.amount > 0)
        .map((item: any) => ({
          amount: Math.abs(Number(item.amount)),
          description: String(item.description || "Voce preventivo").trim(),
          category: String(item.category || "Generale").trim(),
          type: item.type === "income" ? ("income" as const) : ("expense" as const),
          dueDate: item.dueDate ? normalizeOptionalDate(item.dueDate) : undefined,
        }));

      // Verifica se tra le voci è stata erroneamente inserita la voce "Saldi di fine es. precedente"
      const prevBalanceRegex = /sald[oi]\s*(di\s*)?fine\s*es|sald[oi]\s*es(ercizio)?\s*prec|debito\s*pregresso/i;
      let extractedPastDebtFromItems = 0;
      const items: BudgetItem[] = rawItems.filter((item) => {
        if (prevBalanceRegex.test(item.description) || prevBalanceRegex.test(item.category || "")) {
          extractedPastDebtFromItems += item.amount;
          return false;
        }
        return true;
      });

      const rawInstallments = Array.isArray(parsed.plannedInstallments) ? parsed.plannedInstallments : [];
      let plannedInstallments: PlannedInstallment[] = rawInstallments
        .filter((inst: any) => typeof inst.amount === "number" && inst.amount > 0)
        .map((inst: any, idx: number) => ({
          number: typeof inst.number === "number" ? inst.number : idx + 1,
          dueDate: normalizeDate(inst.dueDate),
          amount: Math.abs(Number(inst.amount)),
          description: String(inst.description || `Rata ${idx + 1}`).trim(),
          category: String(inst.category || "Ordinaria").trim(),
        }))
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

      if (plannedInstallments.length === 0) {
        const incomeItems = items.filter((it) => it.type === "income");
        if (incomeItems.length > 0) {
          plannedInstallments = incomeItems.map((it, idx) => ({
            number: idx + 1,
            dueDate: it.dueDate || normalizeDate(parsed.fiscalStartDate),
            amount: it.amount,
            description: it.description || `Rata ${idx + 1}`,
            category: it.category || "Ordinaria",
          }));
        }
      }

      let fiscalStartDate = normalizeOptionalDate(parsed.fiscalStartDate);
      let fiscalEndDate = normalizeOptionalDate(parsed.fiscalEndDate);

      if (fiscalStartDate && fiscalEndDate) {
        const sParts = fiscalStartDate.split("-").map(Number);
        const eParts = fiscalEndDate.split("-").map(Number);
        if (sParts.length === 3 && eParts.length === 3) {
          const monthSpan = (eParts[0] - sParts[0]) * 12 + (eParts[1] - sParts[1]) + 1;
          // Se l'intervallo non è un esercizio annuale (~12 mesi) e coincide con le date delle rate, scartiamo
          if (monthSpan < 11 || monthSpan > 13) {
            if (plannedInstallments.length > 0 && fiscalStartDate.slice(0, 7) === plannedInstallments[0].dueDate.slice(0, 7)) {
              fiscalStartDate = undefined;
              fiscalEndDate = undefined;
            }
          }
        }
      } else if (
        fiscalStartDate &&
        !fiscalEndDate &&
        plannedInstallments.length > 0 &&
        fiscalStartDate.slice(0, 7) === plannedInstallments[0].dueDate.slice(0, 7)
      ) {
        // Se manca la data di fine gestione e la data di inizio coincide col mese della 1ª rata,
        // non assumiamo il mese della 1ª rata come inizio dell'anno di preventivo.
        fiscalStartDate = undefined;
      }

      if (!fiscalStartDate && fiscalEndDate) {
        const endParts = fiscalEndDate.split("-").map(Number);
        if (endParts.length === 3) {
          const startFromEnd = new Date(endParts[0], endParts[1] - 12, 1);
          const y = startFromEnd.getFullYear();
          const m = String(startFromEnd.getMonth() + 1).padStart(2, "0");
          fiscalStartDate = `${y}-${m}-01`;
        }
      }

      const startingCash = typeof parsed.startingCash === "number" ? Math.max(0, parsed.startingCash) : 0;
      const pastDebt =
        typeof parsed.pastDebt === "number" && Math.abs(parsed.pastDebt) > 0
          ? Math.abs(parsed.pastDebt)
          : extractedPastDebtFromItems;
      const reserveFundTarget = typeof parsed.reserveFundTarget === "number" ? Math.abs(parsed.reserveFundTarget) : 0;

      const totalBudgetExpenses =
        typeof parsed.totalBudgetExpenses === "number" && parsed.totalBudgetExpenses > 0
          ? parsed.totalBudgetExpenses
          : items.filter((i) => i.type === "expense").reduce((sum, i) => sum + i.amount, 0);

      return {
        items,
        fiscalStartDate,
        fiscalEndDate,
        startingCash,
        pastDebt,
        reserveFundTarget,
        totalBudgetExpenses,
        plannedInstallments,
      };
    } catch (err: any) {
      console.warn(`Tentativo modello ${model} su preventivo non riuscito:`, err?.message || err);
      lastError = err;
    }
  }

  console.error("Tutti i tentativi di analisi Preventivo sono falliti:", lastError);
  throw new Error(
    `Errore nell'analisi del preventivo${fileName ? ` "${fileName}"` : ""}: ${
      lastError?.message || "Verifica che il file contenga un preventivo o piano rateale leggibile."
    }`
  );
};
