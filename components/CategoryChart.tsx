
import React, { useMemo } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { Expense } from '../types';
import { formatCurrency, getCategoryColor, downloadElementAsImage } from '../utils/fileUtils';

interface CategoryChartProps {
  expenses: Expense[];
}

export const CategoryChart: React.FC<CategoryChartProps> = ({ expenses }) => {
  const chartId = "category-chart-container-inner";
  
  const data = useMemo(() => {
    if (!expenses.length) return [];
    
    const categoryMap = new Map<string, number>();
    let totalAmount = 0;

    expenses.forEach(exp => {
      const cat = exp.category || 'Altro';
      const current = categoryMap.get(cat) || 0;
      categoryMap.set(cat, current + exp.amount);
      totalAmount += exp.amount;
    });

    return Array.from(categoryMap.entries())
      .map(([name, value]) => ({
        name,
        value,
        percentage: (value / totalAmount) * 100
      }))
      .sort((a, b) => b.value - a.value);
  }, [expenses]);

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-white p-3 border border-slate-200 shadow-lg rounded-lg">
          <p className="font-bold text-slate-800">{data.name}</p>
          <p className="text-slate-600">
            {formatCurrency(data.value)} ({data.percentage.toFixed(1)}%)
          </p>
        </div>
      );
    }
    return null;
  };

  if (data.length === 0) return (
    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 w-full h-[450px] flex items-center justify-center text-slate-400 italic">
      In attesa di dati...
    </div>
  );

  return (
    <div id={chartId} className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 w-full h-[450px] flex flex-col relative">
      <div className="flex justify-between items-start mb-4">
        <h3 className="text-lg font-semibold text-slate-800">Ripartizione per Categoria</h3>
        <button 
          onClick={() => downloadElementAsImage(chartId, 'categorie_spese_condominio')}
          className="no-print p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all"
          title="Scarica Grafico"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </button>
      </div>
      
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={100}
              paddingAngle={2}
              dataKey="value"
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={getCategoryColor(index)} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
            <Legend 
              layout="vertical" 
              verticalAlign="middle" 
              align="right"
              wrapperStyle={{ fontSize: '10px', color: '#475569', fontWeight: 'bold' }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
