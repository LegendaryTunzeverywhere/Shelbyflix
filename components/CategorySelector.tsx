import { VideoCategory } from '@/types';

interface CategorySelectorProps {
  value: VideoCategory;
  onChange: (category: VideoCategory) => void;
}

export default function CategorySelector({ value, onChange }: CategorySelectorProps) {
  const categories = Object.values(VideoCategory);

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-200">
        Category *
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as VideoCategory)}
        className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        required
      >
        <option value="">Select a category</option>
        {categories.map((cat) => (
          <option key={cat} value={cat}>
            {cat}
          </option>
        ))}
      </select>
    </div>
  );
}