
import React, { useMemo } from 'react';
import {
  ComposedChart,
  Bar,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { Expense, Granularity } from '../types';
import { formatCurrency, aggregateExpenses, downloadElementAsImage } from '../utils/fileUtils';

interface ExpenseChartProps {
  expenses: Expense[];
  granularity: Granularity;
  installments?: Installment[];
}

export const ExpenseChart: React.FC<ExpenseChartProps> = ({ expenses, granularity, installments }) => {
  const chartId = "historical-chart-container";
  
        const chartData = useMemo(() => {
    const rawData = aggregateExpenses(expenses, granularity);
    let cumulative = 0;
    return rawData.map(d => {
      cumulative += d.total;
      return {
        ...d,
        cumulative
      };
    });
  }, [expenses, granularity]);

  const stats = useMemo(() => {
    if (chartData.length === 0) return null;
    const total = chartData.reduce((acc, d) => acc + d.total, 0);
    const avg = total / chartData.length;
    const max = Math.max(...chartData.map(d => d.total));
    const maxMonth = chartData.find(d => d.total === max)?.label;
    
    return { total, avg, max, maxMonth };
  }, [chartData]);

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-white/95 backdrop-blur-sm p-4 border border-slate-200 shadow-xl rounded-2xl z-50 min-w-[200px]">
          <p className="font-black text-slate-800 mb-2 border-b pb-1 border-slate-100 uppercase text-[10px] tracking-widest">{data.label}</p>
          <div className="space-y-1">
                        <div className="flex justify-between items-center gap-4">
              <span className="text-xs text-slate-500">Spesa Periodo:</span>
              <span className="text-sm font-bold text-indigo-600">{formatCurrency(data.total)}</span>
            </div>
            
            <div className="flex justify-between items-center gap-4">
              <span className="text-xs text-slate-500">Progressivo:</span>
              <span className="text-sm font-bold text-slate-700">{formatCurrency(data.cumulative)}</span>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  if (chartData.length === 0) return (
    <div className="flex items-center justify-center h-[450px] bg-white border border-slate-200 rounded-3xl text-slate-400 font-medium italic">
      Nessun dato da visualizzare per i filtri selezionati
    </div>
  );

    

  return (
    <div id={chartId} className="bg-white p-8 rounded-3xl shadow-sm border border-slate-200 w-full animate-fade-in relative">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <h3 className="text-xl font-black text-slate-800 tracking-tight">Analisi Flussi Storici</h3>
          <p className="text-xs text-slate-500 font-medium">Distribuzione temporale delle uscite registrate a consuntivo.</p>
        </div>
        
        <div className="flex items-center gap-3 w-full md:w-auto">
          {stats && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              <div className="bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-100 whitespace-nowrap">
                <p className="text-[8px] font-black text-slate-400 uppercase tracking-tighter">Media</p>
                <p className="text-xs font-bold text-slate-700">{formatCurrency(stats.avg)}</p>
              </div>
              <div className="bg-indigo-50 px-3 py-1.5 rounded-xl border border-indigo-100 whitespace-nowrap">
                <p className="text-[8px] font-black text-indigo-400 uppercase tracking-tighter">Picco</p>
                <p className="text-xs font-bold text-indigo-700">{formatCurrency(stats.max)}</p>
              </div>
            </div>
          )}
          
          <button 
            onClick={() => downloadElementAsImage(chartId, 'andamento_spese_condominio')}
            className="no-print p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all"
            title="Scarica Grafico"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </button>
        </div>
      </div>

      <div className="h-[350px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartData}
            margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                    <XAxis 
              dataKey="label" 
              stroke="#94a3b8" 
              fontSize={10}
              tickMargin={12}
              axisLine={false}
              tickLine={false}
              fontWeight={700}
            />
            <YAxis 
              stroke="#94a3b8" 
              fontSize={10}
              tickFormatter={(value) => `€${value}`}
              axisLine={false}
              tickLine={false}
              fontWeight={600}
            />
            <Tooltip content={<CustomTooltip />} cursor={{fill: '#f8fafc'}} />
            
            <Area 
              type="monotone" 
              dataKey="cumulative" 
              fill="#6366f1" 
              fillOpacity={0.05}
              stroke="none" 
              isAnimationActive={false}
            />

                                    <Bar dataKey="total" radius={[6, 6, 0, 0]} barSize={24} isAnimationActive={false}>
              {chartData.map((entry, index) => (
                <Cell 
                  key={`cell-${index}`} 
                  fill={stats && entry.total > stats.avg * 1.5 ? "#f43f5e" : "#6366f1"} 
                  fillOpacity={0.8}
                />
              ))}
            </Bar>

            <Line 
              type="monotone" 
              dataKey="total" 
              stroke="#4338ca" 
              strokeWidth={3} 
              dot={{ r: 4, fill: '#fff', strokeWidth: 2, stroke: '#4338ca' }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
