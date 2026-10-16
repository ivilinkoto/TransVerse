import type { ReactNode } from 'react';
import { Logo } from '@/components/brand/Logo';
import { VehicleIllustration } from '@/components/vehicles/VehicleIllustration';

export function AuthShell({ title, subtitle, children, aside }: { title: string; subtitle: string; children: ReactNode; aside: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <main className="flex flex-col px-4 py-6 sm:px-10">
        <Logo />
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">
          <h1 className="font-display text-3xl font-bold">{title}</h1>
          <p className="mt-2 text-mist-300">{subtitle}</p>
          <div className="mt-8">{children}</div>
        </div>
      </main>
      <aside className="road-grid relative hidden flex-col justify-end overflow-hidden border-l border-asphalt-800 bg-asphalt-900 p-10 lg:flex">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_60%_40%,rgba(47,123,255,0.25),transparent_70%)]" />
        <div className="relative">{aside}</div>
        <VehicleIllustration modelId="danubia-t440" trailerModelId="reefer-13" color="#0f766e" className="relative mt-10 w-full drop-shadow-[0_30px_40px_rgba(0,0,0,0.6)]" />
      </aside>
    </div>
  );
}
