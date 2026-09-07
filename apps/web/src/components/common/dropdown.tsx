import { type ReactNode, useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

interface DropdownProps {
  trigger: ReactNode;
  children: ReactNode;
  align?: 'left' | 'right';
}

export function Dropdown({ trigger, children, align = 'left' }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div ref={ref} className="relative inline-block">
      <div onClick={() => setOpen(!open)} className="cursor-pointer">
        {trigger}
      </div>
      {open && (
        <div className={`absolute z-50 mt-1 w-56 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg py-1 ${align === 'right' ? 'right-0' : 'left-0'}`}>
          <div onClick={() => setOpen(false)}>
            {children}
          </div>
        </div>
      )}
    </div>
  );
}

interface DropdownItemProps {
  onClick?: () => void;
  children: ReactNode;
  danger?: boolean;
}

export function DropdownItem({ onClick, children, danger }: DropdownItemProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 ${danger ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-300'}`}
    >
      {children}
    </button>
  );
}

interface SelectDropdownProps {
  value: string;
  onChange: (val: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}

export function SelectDropdown({ value, onChange, options, placeholder }: SelectDropdownProps) {
  return (
    <Dropdown
      trigger={
        <button className="flex items-center gap-2 px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 w-full">
          <span className="flex-1 text-left">{options.find(o => o.value === value)?.label || placeholder || 'Select...'}</span>
          <ChevronDown className="w-4 h-4 text-slate-400" />
        </button>
      }
    >
      {options.map((opt) => (
        <DropdownItem key={opt.value} onClick={() => onChange(opt.value)}>
          {opt.label}
        </DropdownItem>
      ))}
    </Dropdown>
  );
}
