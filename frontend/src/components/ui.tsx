import { useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react';
import { initials } from '../lib/format';

/** An illustration from /images/<key>.webp, with a coloured initials tile when the file is missing. */
export function Img({
  k,
  alt,
  className = '',
  fallback,
  fit = 'cover',
  style,
}: {
  k: string;
  alt: string;
  className?: string;
  fallback?: string;
  fit?: 'cover' | 'contain';
  style?: CSSProperties;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div
        role="img"
        aria-label={alt}
        style={style}
        className={`flex items-center justify-center bg-ink-100 text-xs font-semibold text-ink-600 ${className}`}
      >
        {initials(fallback ?? alt)}
      </div>
    );
  }
  return (
    <img
      src={`/images/${k}.webp`}
      alt={alt}
      style={style}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`${fit === 'cover' ? 'object-cover' : 'object-contain'} ${className}`}
    />
  );
}

export function Avatar({ k, name, size = 40 }: { k: string; name: string; size?: number }) {
  return (
    <Img
      k={k}
      alt={name}
      fallback={name}
      className="shrink-0 rounded-full ring-2 ring-white"
      style={{ width: size, height: size }}
    />
  );
}

const badgeStyles = {
  upcoming: 'bg-brand-100 text-brand-700',
  past: 'bg-ink-100 text-ink-600',
  cancelled: 'bg-bad-50 text-bad-600',
  ok: 'bg-ok-50 text-ok-600',
} as const;

export function Badge({ tone, children }: { tone: keyof typeof badgeStyles; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${badgeStyles[tone]}`}>
      {children}
    </span>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' };

const variants = {
  primary: 'bg-brand-500 text-ink-900 hover:bg-brand-400 disabled:bg-ink-200 disabled:text-ink-500',
  secondary: 'bg-white text-ink-800 ring-1 ring-ink-200 hover:bg-ink-50 disabled:text-ink-300',
  danger: 'bg-bad-600 text-white hover:bg-red-800 disabled:bg-ink-200',
  ghost: 'text-ink-600 hover:bg-ink-100',
} as const;

export function Button({ variant = 'primary', className = '', ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${variants[variant]} ${className}`}
    />
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-white p-4 shadow-sm ring-1 ring-ink-100 sm:p-5 ${className}`}>{children}</div>;
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-3 p-6 text-ink-500">
      <span className="size-5 animate-spin rounded-full border-2 border-ink-200 border-t-brand-500" />
      <span className="text-sm">{label}...</span>
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="rounded-xl bg-bad-50 px-4 py-3 text-sm text-bad-600 ring-1 ring-red-200">
      {children}
    </div>
  );
}

export function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl bg-white px-6 py-10 text-center ring-1 ring-ink-100">
      <Img k="app-empty" alt="" className="h-36 w-52 rounded-xl" />
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="max-w-sm text-sm text-ink-500">{text}</p>
      {action}
    </div>
  );
}
