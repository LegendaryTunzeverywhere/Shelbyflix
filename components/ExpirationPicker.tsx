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
      <label className="block text-sm font-medium text-gray-200">
        Video Availability
      </label>
      
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              value === option.value
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <p className="text-xs text-gray-400">
        {value >= 36500 
          ? 'This video will be available permanently'
          : `Available until ${expirationDate.toLocaleDateString()}`
        }
      </p>
    </div>
  );
}