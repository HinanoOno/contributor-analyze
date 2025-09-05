'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

type Mode = 'slack' | 'github';

const stepsSlack = [
  { href: '/slack-fetch', label: '1. 取得' },
  { href: '/slack-thread-evaluation', label: '2. 評価' },
  { href: '/ability-score', label: '3. 結果' },
];

const stepsGithub = [
  { href: '/github-data-fetch', label: '1. 取得' },
  { href: '/contributor-analyze', label: '2. 評価' },
  { href: '/ability-score', label: '3. 結果' },
];

export default function FixedHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<Mode>('slack');

  // Initialize mode from URL or localStorage
  useEffect(() => {
    const urlMode = (searchParams?.get('mode') as Mode | null) ?? null;
    const stored = (typeof window !== 'undefined' && localStorage.getItem('app-mode')) as Mode | null;
    const initial = urlMode || stored || 'slack';
    setMode(initial);
  }, [searchParams]);

  useEffect(() => {
    if (typeof window !== 'undefined') localStorage.setItem('app-mode', mode);
  }, [mode]);

  const steps = useMemo(() => (mode === 'github' ? stepsGithub : stepsSlack), [mode]);

  function switchMode(next: Mode) {
    if (next === mode) return;
    setMode(next);
    const nextSteps = next === 'github' ? stepsGithub : stepsSlack;
    // If current path does not belong to next mode, navigate to first step of that mode
    const belongs = nextSteps.some((s) => pathname?.startsWith(s.href));
    if (!belongs) router.push(nextSteps[0].href);
  }

  return (
    <header className="fixed top-0 inset-x-0 z-50 border-b border-neutral-200/70 dark:border-neutral-800/70 bg-white/70 dark:bg-black/30 backdrop-blur supports-[backdrop-filter]:bg-white/50 supports-[backdrop-filter]:dark:bg-black/20">
      <div className="mx-auto max-w-screen-2xl px-4 sm:px-6 lg:px-8">
        <div className="h-14 flex items-center justify-between gap-4">
          <Link href="/" className="font-semibold tracking-tight text-sm sm:text-base">
            Contributor Analyzer
          </Link>
          <div className="flex items-center gap-3">
            {/* Mode toggle */}
            <div className="inline-flex rounded-md border border-neutral-300 dark:border-neutral-700 overflow-hidden text-xs">
              <button
                type="button"
                onClick={() => switchMode('slack')}
                className={[
                  'px-2.5 py-1.5',
                  mode === 'slack'
                    ? 'bg-blue-600 text-white'
                    : 'bg-transparent text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100/70 dark:hover:bg-neutral-800/60',
                ].join(' ')}
              >
                Slack
              </button>
              <button
                type="button"
                onClick={() => switchMode('github')}
                className={[
                  'px-2.5 py-1.5 border-l border-neutral-300 dark:border-neutral-700',
                  mode === 'github'
                    ? 'bg-blue-600 text-white'
                    : 'bg-transparent text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100/70 dark:hover:bg-neutral-800/60',
                ].join(' ')}
              >
                GitHub
              </button>
            </div>

            {/* Steps */}
            <nav className="flex items-center gap-1 sm:gap-2 text-sm">
              {steps.map((s) => {
                const active = pathname?.startsWith(s.href);
                return (
                  <Link
                    key={s.href}
                    href={s.href}
                    className={[
                      'px-2.5 sm:px-3 py-1.5 rounded-md transition-colors',
                      active
                        ? 'bg-blue-600 text-white'
                        : 'text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100/70 dark:hover:bg-neutral-800/60',
                    ].join(' ')}
                  >
                    {s.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
      </div>
    </header>
  );
}
