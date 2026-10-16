import type { InputHTMLAttributes, ReactNode } from 'react';

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-mist-300">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-mist-400">{hint}</span>}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className="input" />;
}
