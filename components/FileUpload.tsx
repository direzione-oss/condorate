
import React, { useRef, useState } from 'react';

interface FileUploadProps {
  onFilesSelect: (files: File[]) => void;
  disabled?: boolean;
  title: string;
  subtitle: string;
}

export const FileUpload: React.FC<FileUploadProps> = ({ onFilesSelect, disabled, title, subtitle }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [formatWarning, setFormatWarning] = useState<string | null>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    setFormatWarning(null);
    if (disabled) return;

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const validFiles: File[] = [];
      Array.from(e.dataTransfer.files).forEach((file: File) => {
        const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
        const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(file.name);
        if (isPdf || isImage) {
          validFiles.push(file);
        }
      });

      if (validFiles.length > 0) {
        onFilesSelect(validFiles);
      } else {
        setFormatWarning("Carica solo documenti PDF o immagini di registri contabili.");
      }
    }
  };

  const handleClick = () => {
    if (!disabled && inputRef.current) {
      inputRef.current.click();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormatWarning(null);
    if (e.target.files && e.target.files.length > 0) {
      onFilesSelect(Array.from(e.target.files));
    }
  };

  return (
    <div
      onClick={handleClick}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`
        relative w-full max-w-xl mx-auto border-2 border-dashed rounded-xl p-10 text-center transition-all duration-300 cursor-pointer
        ${disabled ? 'opacity-50 cursor-not-allowed bg-slate-100 border-slate-300' : ''}
        ${isDragging 
          ? 'border-blue-500 bg-blue-50 scale-105' 
          : 'border-slate-300 hover:border-blue-400 hover:bg-slate-50'}
      `}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf,image/png,image/jpeg,image/webp"
        multiple
        className="hidden"
        onChange={handleInputChange}
        disabled={disabled}
      />
      
      <div className="flex flex-col items-center justify-center space-y-4">
        <div className={`p-4 rounded-full ${isDragging ? 'bg-blue-200' : 'bg-slate-100'}`}>
          <svg className="w-10 h-10 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <div>
          <h3 className="text-lg font-semibold text-slate-700">
            {isDragging ? 'Rilascia i file qui' : title}
          </h3>
          <p className="text-sm text-slate-500 mt-1">
            {subtitle}
          </p>
          {formatWarning && (
            <p className="text-xs text-rose-600 font-medium mt-2">{formatWarning}</p>
          )}
        </div>
      </div>
    </div>
  );
};
