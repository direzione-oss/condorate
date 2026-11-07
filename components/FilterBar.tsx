import React from 'react';
import { FilterState, Granularity } from '../types';

interface FilterBarProps {
  filterState: FilterState;
  availableCategories: string[];
  onFilterChange: (newState: Partial<FilterState>) => void;
}

export const FilterBar: React.FC<FilterBarProps> = ({ 
  filterState, 
  availableCategories, 
  onFilterChange 
}) => {
  
  const handleCategoryToggle = (category: string) => {
    const current = filterState.selectedCategories;
    const isSelected = current.includes(category);
    
    if (isSelected) {
      onFilterChange({ selectedCategories: current.filter(c => c !== category) });
    } else {
      onFilterChange({ selectedCategories: [...current, category] });
    }
  };

  const toggleAllCategories = () => {
    if (filterState.selectedCategories.length === availableCategories.length) {
      onFilterChange({ selectedCategories: [] });
    } else {
      onFilterChange({ selectedCategories: [...availableCategories] });
    }
  };

  return (
    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-6">
        <h3 className="text-lg font-semibold text-slate-800">Filtri e Visualizzazione</h3>
        
        {/* Granularity Toggle */}
        <div className="bg-slate-100 p-1 rounded-lg inline-flex">
          {(['month', 'quarter', 'year'] as Granularity[]).map((g) => (
            <button
              key={g}
              onClick={() => onFilterChange({ granularity: g })}
              className={`
                px-4 py-1.5 text-sm font-medium rounded-md transition-all
                ${filterState.granularity === g 
                  ? 'bg-white text-blue-600 shadow-sm' 
                  : 'text-slate-500 hover:text-slate-700'}
              `}
            >
              {g === 'month' ? 'Mese' : g === 'quarter' ? 'Trimestre' : 'Anno'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Date Range */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-500 uppercase">Da</label>
          <input
            type="date"
            value={filterState.startDate}
            onChange={(e) => onFilterChange({ startDate: e.target.value })}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-500 uppercase">A</label>
          <input
            type="date"
            value={filterState.endDate}
            onChange={(e) => onFilterChange({ endDate: e.target.value })}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Categories */}
        <div className="lg:col-span-2 space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-slate-500 uppercase">Categorie</label>
            <button 
              onClick={toggleAllCategories}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium"
            >
              {filterState.selectedCategories.length === availableCategories.length ? 'Deseleziona tutto' : 'Seleziona tutto'}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {availableCategories.map(cat => (
              <button
                key={cat}
                onClick={() => handleCategoryToggle(cat)}
                className={`
                  px-3 py-1 text-xs rounded-full border transition-colors
                  ${filterState.selectedCategories.includes(cat)
                    ? 'bg-blue-50 border-blue-200 text-blue-700 font-medium'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}
                `}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};