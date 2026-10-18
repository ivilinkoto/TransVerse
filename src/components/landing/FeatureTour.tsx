'use client';

import { useState, type ReactNode } from 'react';

export interface TourTab {
  id: string;
  label: string;
  icon: ReactNode;
  title: string;
  text: string;
  points: string[];
  mockup: ReactNode;
}

/** The public page's tour of the game: one tab per system, with a drawn picture. */
export function FeatureTour({ tabs }: { tabs: TourTab[] }) {
  const [active, setActive] = useState(tabs[0]?.id);
  const tab = tabs.find((t) => t.id === active) ?? tabs[0];
  if (!tab) return null;
  return (
    <div className="mt-10">
      <div role="tablist" aria-label="Системи в играта" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 sm:mx-0 sm:flex-wrap sm:px-0">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tour-tab-${t.id}`}
            aria-selected={t.id === tab.id}
            aria-controls="tour-panel"
            onClick={() => setActive(t.id)}
            className={`flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-2 text-sm transition ${t.id === tab.id ? 'border-volt-500/60 bg-volt-500/15 text-white' : 'border-asphalt-700 bg-asphalt-900/60 text-mist-300 hover:text-white'}`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>
      <div id="tour-panel" role="tabpanel" aria-labelledby={`tour-tab-${tab.id}`} className="panel mt-4 grid gap-6 p-5 sm:p-7 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
        <div>
          <h3 className="font-display text-2xl font-bold">{tab.title}</h3>
          <p className="mt-3 leading-relaxed text-mist-300">{tab.text}</p>
          <ul className="mt-5 space-y-2 text-sm">
            {tab.points.map((p) => (
              <li key={p} className="flex gap-2.5">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-glow" />
                <span className="text-mist-100">{p}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="min-w-0">{tab.mockup}</div>
      </div>
    </div>
  );
}
