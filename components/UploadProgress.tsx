import { UploadProgress } from '@/types';
import { CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/solid';

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

  return (
    <div className="space-y-4">
      {/* Stage Label */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">
          {stageLabels[progress.stage]}
        </h3>
        {isComplete && <CheckCircleIcon className="w-6 h-6 text-green-500" />}
        {isError && <XCircleIcon className="w-6 h-6 text-red-500" />}
      </div>

      {/* Progress Bar */}
      {!isError && (
        <div className="relative">
          <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${
                isComplete ? 'bg-green-500' : 'bg-blue-500'
              }`}
              style={{ width: `${progress.progress}%` }}
            />
          </div>
          <p className="text-sm text-gray-400 mt-2">
            {progress.progress}% - {progress.message}
          </p>
        </div>
      )}

      {/* Error Message */}
      {isError && (
        <div className="p-4 bg-red-900/20 border border-red-500 rounded-lg">
          <p className="text-red-400">{progress.message}</p>
        </div>
      )}

      {/* Stage Indicators */}
      {!isComplete && !isError && (
        <div className="flex justify-between text-xs text-gray-500">
          <span className={progress.stage === 'encrypting' ? 'text-blue-400' : ''}>
            Encrypt
          </span>
          <span className={progress.stage === 'uploading' ? 'text-blue-400' : ''}>
            Upload
          </span>
          <span className={progress.stage === 'registering' ? 'text-blue-400' : ''}>
            Register
          </span>
          <span className={progress.stage === 'finalizing' ? 'text-blue-400' : ''}>
            Finalize
          </span>
        </div>
      )}
    </div>
  );
}