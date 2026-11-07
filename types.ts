
export interface Expense {
  date: string; // YYYY-MM-DD
  amount: number;
  description: string;
  category?: string;
}

export interface BudgetItem {
  description: string;
  amount: number;
  category?: string;
  type: 'expense' | 'income'; // Distingue tra costo preventivato e rata prevista
  dueDate?: string; // YYYY-MM-DD
}

export interface PlannedInstallment {
  number: number;
  dueDate: string; // YYYY-MM-DD
  amount: number;
  description: string;
  category?: string;
}

export interface Installment {
  number: number;
  date: Date;
  dueDate?: string; // YYYY-MM-DD
  description?: string;
  amount: number;
  cumulativeAmount?: number;
  isManual: boolean;
  hasBudget: boolean;
  hasDebt: boolean;
  isActive: boolean;
}

export interface MonthlyData {
  label: string; // Display label (e.g., "Gen 24" or "Q1 2024")
  sortKey: string; // For sorting (e.g. "2024-01")
  total: number;
  count: number;
}

export type Granularity = 'month' | 'quarter' | 'year';

export interface FilterState {
  startDate: string;
  endDate: string;
  selectedCategories: string[];
  granularity: Granularity;
}

export enum ProcessingStatus {
  IDLE = 'IDLE',
  UPLOADING = 'UPLOADING',
  ANALYZING = 'ANALYZING',
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR'
}
