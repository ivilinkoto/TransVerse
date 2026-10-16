import Link from 'next/link';
import { Logo } from '@/components/brand/Logo';

/** Simple readable layout for the public legal pages. */
export function LegalShell({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-asphalt-950">
      <header className="border-b border-asphalt-800 px-4 py-4 sm:px-6"><Logo href="/" /></header>
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="font-display text-3xl font-bold">{title}</h1>
        <p className="mt-1 text-sm text-mist-400">В сила от {updated}</p>
        <div className="legal mt-8 space-y-6 text-[15px] leading-relaxed text-mist-200 [&_h2]:mt-8 [&_h2]:font-display [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-white [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1">{children}</div>
        <p className="mt-12 text-sm text-mist-400"><Link href="/terms" className="hover:text-white">Общи условия</Link> · <Link href="/privacy" className="hover:text-white">Поверителност</Link> · <Link href="/" className="hover:text-white">Начало</Link></p>
      </main>
    </div>
  );
}

/** Seller details from the server configuration (never invented). */
export function SellerDetails({ seller }: { seller: { name: string; id: string; address: string; email: string } }) {
  if (!seller.name) return <p className="rounded-lg border border-amber-sig/40 bg-amber-sig/10 px-3 py-2 text-sm text-amber-sig">Данните на търговеца ще бъдат публикувани преди началото на продажбите.</p>;
  return (
    <ul>
      <li>Търговец: {seller.name}</li>
      {seller.id && <li>ЕИК / идентификационен номер: {seller.id}</li>}
      {seller.address && <li>Адрес: {seller.address}</li>}
      {seller.email && <li>Имейл за връзка: <a className="text-cyan-glow underline" href={`mailto:${seller.email}`}>{seller.email}</a></li>}
    </ul>
  );
}
