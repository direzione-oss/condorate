
import { Expense, Granularity, MonthlyData } from '../types';
import html2canvas from 'html2canvas';

export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = (error) => reject(error);
  });
};

export const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
  }).format(amount);
};

export const formatDate = (dateString: string): string => {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat('it-IT', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
};

export const getQuarter = (date: Date): number => {
  return Math.floor(date.getMonth() / 3) + 1;
};

export const aggregateExpenses = (expenses: Expense[], granularity: Granularity): MonthlyData[] => {
  const map = new Map<string, number>();

  expenses.forEach(expense => {
    const date = new Date(expense.date);
    if (isNaN(date.getTime())) return;

    let key = '';
    
    switch (granularity) {
      case 'year':
        key = `${date.getFullYear()}`;
        break;
      case 'quarter':
        key = `${date.getFullYear()}-Q${getQuarter(date)}`;
        break;
      case 'month':
      default:
        // Format YYYY-MM for sorting consistency
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        key = `${date.getFullYear()}-${month}`;
        break;
    }

    const current = map.get(key) || 0;
    map.set(key, current + expense.amount);
  });

  return Array.from(map.entries())
    .map(([sortKey, total]) => {
      // Generate display label
      let label = sortKey;
      if (granularity === 'month') {
        const [y, m] = sortKey.split('-');
        const d = new Date(parseInt(y), parseInt(m) - 1);
        label = d.toLocaleString('it-IT', { month: 'short', year: '2-digit' });
      }
      
      return {
        sortKey,
        label,
        total,
        count: 0
      };
    })
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
};

export const CATEGORY_COLORS = [
  '#3B82F6', // Blue
  '#10B981', // Emerald
  '#F59E0B', // Amber
  '#EF4444', // Red
  '#8B5CF6', // Violet
  '#EC4899', // Pink
  '#6366F1', // Indigo
  '#F97316', // Orange
  '#14B8A6', // Teal
  '#64748B', // Slate
];

export const getCategoryColor = (index: number) => {
  return CATEGORY_COLORS[index % CATEGORY_COLORS.length];
};

export const downloadElementAsImage = async (elementId: string, fileName: string) => {
  const element = document.getElementById(elementId);
  if (!element) return;
  
  try {
    const canvas = await html2canvas(element, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false
    });
    
    const image = canvas.toDataURL("image/png");
    const link = document.createElement('a');
    link.href = image;
    link.download = `${fileName}.png`;
    link.click();
  } catch (err) {
    console.error("Errore nel download dell'immagine:", err);
  }
};
