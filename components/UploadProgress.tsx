import { UploadProgress } from '@/types';
import { CheckCircleIcon, XCircleIcon, ArrowPathIcon } from '@heroicons/react/24/solid';

interface UploadProgressProps {
  progress: UploadProgress;
}

export default function UploadProgressDisplay({ progress }: UploadProgressProps) {
  const stageLabels = {
    encrypting: 'Encrypting Video',
    uploading: 'Uploading to Shelbynet',
    registering: 'Registering on Blockchain',
    finalizing: 'Finalizing Upload',
    complete: 'Upload Complete',
    error: 'Upload Failed',
    preparing: 'Preparing Video',
    processing: 'Processing Video',
  };

  const isComplete = progress.stage === 'complete';
  const isError = progress.stage === 'error';
  const isActive = !isComplete && !isError;

  return (
    <div className="space-y-4">
      {/* Stage Label with Spinner */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {isActive && (
            <div className="relative">
              <ArrowPathIcon className="w-6 h-6 text-white animate-spin" />
            </div>
          )}
          <h3 className="text-lg font-black tracking-tight text-white">
            {stageLabels[progress.stage]}
          </h3>
        </div>
        {isComplete && <CheckCircleIcon className="w-6 h-6 text-green-500" />}
        {isError && <XCircleIcon className="w-6 h-6 text-red-500" />}
      </div>

      {/* Progress Bar */}
      {!isError && (
        <div className="relative">
          <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${
                isComplete ? 'bg-green-500' : 'bg-white'
              }`}
              style={{ width: `${progress.progress}%` }}
            />
          </div>
          <div className="flex items-center justify-between mt-2">
            <p className="text-sm text-zinc-400 font-medium">
              {progress.message}
            </p>
            <p className="text-sm text-white font-black">
              {Math.floor(progress.progress)}%
            </p>
          </div>
        </div>
      )}

      {/* Error Message */}
      {isError && (
        <div className="p-4 bg-red-900/20 border border-red-500 rounded-xl">
          <p className="text-red-400 font-medium">{progress.message}</p>
        </div>
      )}

      {/* Stage Indicators */}
      {!isComplete && !isError && (
        <div className="flex justify-between text-xs font-bold uppercase tracking-wider">
          <span className={progress.stage === 'encrypting' || progress.stage === 'preparing' ? 'text-white' : 'text-zinc-600'}>
            Encrypt
          </span>
          <span className={progress.stage === 'registering' ? 'text-white' : 'text-zinc-600'}>
            Register
          </span>
          <span className={progress.stage === 'uploading' ? 'text-white' : 'text-zinc-600'}>
            Upload
          </span>
          <span className={progress.stage === 'finalizing' ? 'text-white' : 'text-zinc-600'}>
            Finalize
          </span>
        </div>
      )}
    </div>
  );
}