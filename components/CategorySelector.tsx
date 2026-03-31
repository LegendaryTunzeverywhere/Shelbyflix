import { useState, useRef, useEffect } from 'react';
import { VideoCategory } from '@/types';
import { ChevronDownIcon } from '@heroicons/react/24/outline';

interface CategorySelectorProps {
  value: VideoCategory;
  onChange: (category: VideoCategory) => void;
}

export default function CategorySelector({ value, onChange }: CategorySelectorProps) {
  const categories = Object.values(VideoCategory);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  return (
    <div className="space-y-2">
      <label className="block text-xs font-black uppercase tracking-widest text-zinc-400 mb-3">
        Category *
      </label>
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="w-full flex items-center justify-between px-4 py-3 bg-zinc-900/60 border border-zinc-800 rounded-xl text-white hover:border-zinc-700 hover:bg-zinc-900 focus:outline-none focus:border-brand-red focus:ring-1 focus:ring-brand-red transition-all text-sm font-medium group"
        >
          <span className={value ? 'text-white' : 'text-zinc-500'}>
            {value || 'Select a category'}
          </span>
          <ChevronDownIcon className={`w-4 h-4 text-zinc-500 group-hover:text-brand-red transition-all ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        {/* Dropdown menu */}
        {isOpen && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl z-50 overflow-hidden max-h-80 overflow-y-auto">
            <div className="p-2">
              {categories.map((category) => (
                <button
                  key={category}
                  type="button"
                  onClick={() => {
                    onChange(category);
                    setIsOpen(false);
                  }}
                  className={`w-full px-3 py-2.5 text-left rounded-lg text-sm font-medium transition-all ${
                    value === category
                      ? 'bg-brand-red text-white'
                      : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'
                  }`}
                >
                  {category}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}