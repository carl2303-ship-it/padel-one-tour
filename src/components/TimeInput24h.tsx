import React from 'react';

type TimeInput24hProps = {
  value: string; // format: "HH:mm"
  onChange: (value: string) => void;
  className?: string;
};

export default function TimeInput24h({ value, onChange, className = '' }: TimeInput24hProps) {
  const [hours, minutes] = (value || '00:00').split(':').map(v => v.padStart(2, '0'));

  const handleHourChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange(`${e.target.value}:${minutes}`);
  };

  const handleMinuteChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange(`${hours}:${e.target.value}`);
  };

  // Generate hour options (00-23)
  const hourOptions = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0'));
  
  // Generate minute options (00, 15, 30, 45 or all 00-59)
  const minuteOptions = ['00', '15', '30', '45'];

  return (
    <div className={`inline-flex items-center gap-1 ${className}`}>
      <select
        value={hours}
        onChange={handleHourChange}
        className="px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
      >
        {hourOptions.map(h => (
          <option key={h} value={h}>{h}</option>
        ))}
      </select>
      <span className="text-gray-500 font-medium">:</span>
      <select
        value={minuteOptions.includes(minutes) ? minutes : '00'}
        onChange={handleMinuteChange}
        className="px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
      >
        {minuteOptions.map(m => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>
    </div>
  );
}
