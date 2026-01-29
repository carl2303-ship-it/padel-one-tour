import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { X } from 'lucide-react';

interface AdminPasswordResetProps {
  onClose: () => void;
}

export function AdminPasswordReset({ onClose }: AdminPasswordResetProps) {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string; password?: string } | null>(null);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResult(null);

    try {
      const { data, error } = await supabase.functions.invoke('reset-player-password', {
        body: { phone_number: phoneNumber },
      });

      if (error) {
        setResult({
          success: false,
          message: `Error: ${error.message}`,
        });
      } else if (data.error) {
        setResult({
          success: false,
          message: data.error,
        });
      } else {
        setResult({
          success: true,
          message: data.message,
          password: data.password,
        });
      }
    } catch (err) {
      setResult({
        success: false,
        message: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-gray-900">Reset Player Password</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <form onSubmit={handleReset} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Phone Number
            </label>
            <input
              type="tel"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="+351969365060"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
            <p className="text-xs text-gray-500 mt-1">
              Include country code (e.g., +351969365060)
            </p>
          </div>

          {result && (
            <div
              className={`p-4 rounded-md ${
                result.success ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
              }`}
            >
              <p className="font-medium">{result.message}</p>
              {result.password && (
                <p className="mt-2 font-mono text-sm">
                  New password: <strong>{result.password}</strong>
                </p>
              )}
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Resetting...' : 'Reset Password'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>

        <div className="mt-4 p-3 bg-blue-50 rounded-md">
          <p className="text-xs text-blue-800">
            <strong>Note:</strong> This will reset the player's password to the standard format:
            Player[last4digits]! (e.g., Player5060!)
          </p>
        </div>
      </div>
    </div>
  );
}
