import React, { useState } from 'react';
import { Expense } from '../types';
import { formatCurrency, formatDate } from '../utils/fileUtils';

interface ExpenseTableProps {
  expenses: Expense[];
  onUpdateExpense?: (originalExpense: Expense, updatedExpense: Expense) => void;
}

export const ExpenseTable: React.FC<ExpenseTableProps> = ({ expenses, onUpdateExpense }) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  const filtered = expenses.filter(e => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      e.description.toLowerCase().includes(q) ||
      (e.category || '').toLowerCase().includes(q) ||
      e.date.includes(q)
    );
  });

  // Sort by date ascending so the chronological flow of the past year is immediately verifiable
  const sortedExpenses = [...filtered].sort((a, b) => a.date.localeCompare(b.date));
  const displayedExpenses = isExpanded ? sortedExpenses : sortedExpenses.slice(0, 10);

  return (
    <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="px-8 py-6 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-xl font-black text-slate-800 tracking-tight">
              Verifica Date di Spesa (Consuntivo Passato)
            </h3>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-indigo-50 text-indigo-700 border border-indigo-100">
              {expenses.length} movimenti
            </span>
          </div>
          <p className="text-xs text-slate-500 font-medium mt-1">
            Controlla e, se necessario, rettifica le date di uscita registrate a consuntivo: queste date guidano la simulazione delle uscite del nuovo preventivo.
          </p>
        </div>

        <div className="flex items-center gap-3 no-print">
          <input
            type="text"
            placeholder="Cerca fornitore, categoria o data..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 focus:outline-none focus:border-indigo-500 w-64"
          />
          {sortedExpenses.length > 10 && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all whitespace-nowrap"
            >
              {isExpanded ? 'Mostra meno' : `Mostra tutti (${sortedExpenses.length})`}
            </button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto max-h-[460px] overflow-y-auto">
        <table className="w-full text-left text-sm text-slate-600">
          <thead className="bg-slate-50 text-[10px] uppercase font-black text-slate-400 tracking-wider sticky top-0 z-10 border-b border-slate-100">
            <tr>
              <th className="px-6 py-3.5">Data di Uscita</th>
              <th className="px-6 py-3.5">Mese Storico</th>
              <th className="px-6 py-3.5">Descrizione / Fornitore</th>
              <th className="px-6 py-3.5">Categoria</th>
              <th className="px-6 py-3.5 text-right">Importo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {displayedExpenses.map((expense, index) => {
              const d = new Date(expense.date);
              const monthLabel = !isNaN(d.getTime())
                ? d.toLocaleString('it-IT', { month: 'long', year: 'numeric' })
                : '-';

              return (
                <tr key={`${expense.date}-${expense.description}-${index}`} className="hover:bg-slate-50/80 transition-colors">
                  <td className="px-6 py-3 whitespace-nowrap font-bold text-slate-700">
                    {onUpdateExpense ? (
                      <input
                        type="date"
                        value={expense.date}
                        onChange={(e) => {
                          if (e.target.value) {
                            onUpdateExpense(expense, { ...expense, date: e.target.value });
                          }
                        }}
                        className="text-xs font-bold text-slate-700 bg-transparent border-b border-dashed border-slate-300 focus:outline-none focus:border-indigo-600 py-0.5"
                        title="Modifica la data di spesa se necessario"
                      />
                    ) : (
                      formatDate(expense.date)
                    )}
                  </td>
                  <td className="px-6 py-3 whitespace-nowrap text-xs font-semibold text-slate-400 capitalize">
                    {monthLabel}
                  </td>
                  <td className="px-6 py-3 text-xs font-medium text-slate-800">
                    {expense.description}
                  </td>
                  <td className="px-6 py-3 whitespace-nowrap">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-lg text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-100">
                      {expense.category || 'Altro'}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-right font-black text-slate-900 whitespace-nowrap">
                    {formatCurrency(expense.amount)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="bg-slate-50 px-8 py-4 border-t border-slate-100 flex items-center justify-between text-xs font-bold text-slate-600">
        <span>
          Visualizzati {displayedExpenses.length} di {sortedExpenses.length} movimenti
        </span>
        <span className="text-sm font-black text-slate-800">
          Totale Filtrato: {formatCurrency(sortedExpenses.reduce((acc, curr) => acc + curr.amount, 0))}
        </span>
      </div>
    </div>
  );
};
