'use client';

import { useState, useRef } from 'react';
import type { VideoMetadata, VideoCategory } from '@/types';
import {
  XMarkIcon,
  PhotoIcon,
  CheckIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';

interface EditVideoModalProps {
  video: VideoMetadata;
  onClose: () => void;
  onSuccess: (updated: VideoMetadata) => void;
}

const CATEGORIES = [
  'Entertainment', 'Education', 'Gaming', 'Music',
  'Sports', 'News', 'Technology', 'Lifestyle', 'Comedy', 'Other',
];

export default function EditVideoModal({ video, onClose, onSuccess }: EditVideoModalProps) {
  const [title, setTitle] = useState(video.title);
  const [description, setDescription] = useState(video.description || '');
  const [category, setCategory] = useState(video.category);
  const [tags, setTags] = useState<string[]>(video.tags || []);
  const [tagInput, setTagInput] = useState('');
  const [thumbnailPreview, setThumbnailPreview] = useState(video.thumbnailUrl || '');
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  function addTag(e: React.KeyboardEvent) {
    if ((e.key === 'Enter' || e.key === ',') && tagInput.trim()) {
      e.preventDefault();
      const tag = tagInput.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
      if (tag && !tags.includes(tag) && tags.length < 10) {
        setTags([...tags, tag]);
      }
      setTagInput('');
    }
  }

  function removeTag(tag: string) {
    setTags(tags.filter(t => t !== tag));
  }

  async function handleThumbnailChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Convert to base64 data URL
    const reader = new FileReader();
    reader.onload = () => {
      setThumbnailPreview(reader.result as string);
      setThumbnailFile(file);
    };
    reader.readAsDataURL(file);
  }

  async function handleSave() {
    if (!title.trim()) { setError('Title is required'); return; }
    setSaving(true);
    setError('');

    try {
      const { supabase } = await import('@/lib/supabase');

      const updates: Record<string, any> = {
        title: title.trim(),
        description: description.trim(),
        category,
        tags,
      };

      // If thumbnail changed, use the new base64 data URL directly
      // (it's already a data URL from the FileReader)
      if (thumbnailFile && thumbnailPreview.startsWith('data:')) {
        updates.thumbnail_url = thumbnailPreview;
      }

      const { data, error: updateError } = await supabase
        .from('videos')
        .update(updates)
        .eq('video_id', video.videoId)
        .select()
        .single();

      if (updateError) throw new Error(updateError.message);

      // Build updated VideoMetadata
      const updated: VideoMetadata = {
        ...video,
        title: updates.title,
        description: updates.description,
        category: updates.category,
        tags: updates.tags,
        thumbnailUrl: updates.thumbnail_url ?? video.thumbnailUrl,
      };

      onSuccess(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-2xl bg-zinc-950 border border-zinc-800 rounded-3xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-800 flex-shrink-0">
          <div>
            <h2 className="text-white font-black text-lg tracking-tight">Edit Video</h2>
            <p className="text-zinc-500 text-xs mt-0.5 line-clamp-1">{video.title}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 bg-zinc-800 hover:bg-zinc-700 rounded-lg flex items-center justify-center transition-colors"
          >
            <XMarkIcon className="w-4 h-4 text-zinc-400" />
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
          <div className="flex flex-col sm:flex-row gap-5">
            {/* Left: form fields */}
            <div className="flex-1 space-y-4">
              {/* Title */}
              <div>
                <label className="block text-xs font-black text-zinc-500 uppercase tracking-widest mb-1.5">
                  Title <span className="text-brand-red">*</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  maxLength={200}
                  className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 focus:border-brand-red rounded-xl text-white text-sm outline-none transition-colors placeholder-zinc-600"
                />
                <p className="text-zinc-600 text-xs mt-1 text-right">{title.length}/200</p>
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-black text-zinc-500 uppercase tracking-widest mb-1.5">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  rows={4}
                  maxLength={2000}
                  className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 focus:border-brand-red rounded-xl text-white text-sm outline-none transition-colors resize-none placeholder-zinc-600"
                  placeholder="Describe your video..."
                />
              </div>

              {/* Category */}
              <div>
                <label className="block text-xs font-black text-zinc-500 uppercase tracking-widest mb-1.5">
                  Category
                </label>
                <select
                  value={category}
                  onChange={e => setCategory(e.target.value as VideoCategory)}
                  className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 focus:border-brand-red rounded-xl text-white text-sm outline-none transition-colors"
                >
                  {CATEGORIES.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              {/* Tags */}
              <div>
                <label className="block text-xs font-black text-zinc-500 uppercase tracking-widest mb-1.5">
                  Tags <span className="text-zinc-600 normal-case font-normal">(press Enter to add)</span>
                </label>
                <div className="flex flex-wrap gap-1.5 p-3 bg-zinc-900 border border-zinc-700 focus-within:border-brand-red rounded-xl min-h-[48px] transition-colors">
                  {tags.map(tag => (
                    <span key={tag} className="flex items-center gap-1 px-2.5 py-1 bg-zinc-800 border border-zinc-700 text-brand-purple text-xs rounded-full">
                      #{tag}
                      <button onClick={() => removeTag(tag)} className="text-zinc-500 hover:text-white transition-colors ml-0.5">
                        <XMarkIcon className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                  <input
                    type="text"
                    value={tagInput}
                    onChange={e => setTagInput(e.target.value)}
                    onKeyDown={addTag}
                    placeholder={tags.length < 10 ? 'Add tag...' : ''}
                    disabled={tags.length >= 10}
                    className="flex-1 min-w-[80px] bg-transparent text-white text-sm outline-none placeholder-zinc-600"
                  />
                </div>
              </div>
            </div>

            {/* Right: thumbnail */}
            <div className="sm:w-48 flex-shrink-0">
              <label className="block text-xs font-black text-zinc-500 uppercase tracking-widest mb-1.5">
                Thumbnail
              </label>
              <div
                className="aspect-video bg-zinc-900 border border-zinc-700 rounded-xl overflow-hidden cursor-pointer hover:border-brand-red/50 transition-colors relative group"
                onClick={() => fileInputRef.current?.click()}
              >
                {thumbnailPreview ? (
                  <img src={thumbnailPreview} alt="Thumbnail" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                    <PhotoIcon className="w-8 h-8 text-zinc-700" />
                    <p className="text-zinc-600 text-xs text-center px-2">Click to upload</p>
                  </div>
                )}
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <div className="flex flex-col items-center gap-1">
                    <PhotoIcon className="w-6 h-6 text-white" />
                    <p className="text-white text-xs font-bold">Change</p>
                  </div>
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleThumbnailChange}
              />
              <p className="text-zinc-600 text-xs mt-1.5 text-center">JPG, PNG, WebP</p>
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-950/40 border border-red-900/30 rounded-xl">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-zinc-800 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-5 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl font-bold text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !title.trim()}
            className="flex items-center gap-2 px-6 py-2.5 bg-brand-red hover:bg-red-700 disabled:bg-zinc-800 disabled:text-zinc-600 disabled:cursor-not-allowed text-white rounded-xl font-black text-sm tracking-widest transition-colors"
          >
            {saving ? (
              <>
                <ArrowPathIcon className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <CheckIcon className="w-4 h-4" />
                Save Changes
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}