interface ExpirationPickerProps {
  value: number;
  onChange: (days: number) => void;
}

export default function ExpirationPicker({ value, onChange }: ExpirationPickerProps) {
  const options = [
    { label: '7 days', value: 7 },
    { label: '30 days', value: 30 },
    { label: '90 days', value: 90 },
    { label: '1 year', value: 365 },
    { label: 'Permanent', value: 36500 }, // ~100 years
  ];

  const expirationDate = new Date();
  expirationDate.setDate(expirationDate.getDate() + value);

  return (
    <div className="space-y-2">
      <label className="block text-xs font-black uppercase tracking-widest text-zinc-400 mb-3">
        Video Availability
      </label>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`px-4 py-2 rounded-xl text-sm font-black transition-colors
              ${value === option.value
                ? 'bg-brand-red text-white shadow-[0_0_20px_rgba(246,27,46,0.2)]'
                : 'bg-zinc-900/60 text-zinc-300 border border-zinc-800 hover:bg-zinc-800/80'}
            `}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-zinc-500 mt-1">
        {value >= 36500
          ? 'This video will be available permanently'
          : `Available until ${expirationDate.toLocaleDateString()}`}
      </p>
    </div>
  );
}