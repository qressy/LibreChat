import { useState, useMemo } from 'react';
import { Root, Trigger, Content, Portal } from '@radix-ui/react-popover';
import { cn } from '~/utils';

const STORAGE_KEY = 'comergent_ships_from';
const GLOBAL = 'global';

const COUNTRIES: { code: string; name: string; flag: string }[] = [
  { code: 'US', name: 'United States', flag: '🇺🇸' },
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧' },
  { code: 'IN', name: 'India', flag: '🇮🇳' },
  { code: 'DE', name: 'Germany', flag: '🇩🇪' },
  { code: 'FR', name: 'France', flag: '🇫🇷' },
  { code: 'JP', name: 'Japan', flag: '🇯🇵' },
  { code: 'AU', name: 'Australia', flag: '🇦🇺' },
  { code: 'CA', name: 'Canada', flag: '🇨🇦' },
  { code: 'SG', name: 'Singapore', flag: '🇸🇬' },
  { code: 'AE', name: 'UAE', flag: '🇦🇪' },
  { code: 'SA', name: 'Saudi Arabia', flag: '🇸🇦' },
  { code: 'NL', name: 'Netherlands', flag: '🇳🇱' },
  { code: 'SE', name: 'Sweden', flag: '🇸🇪' },
  { code: 'NO', name: 'Norway', flag: '🇳🇴' },
  { code: 'DK', name: 'Denmark', flag: '🇩🇰' },
  { code: 'IT', name: 'Italy', flag: '🇮🇹' },
  { code: 'ES', name: 'Spain', flag: '🇪🇸' },
  { code: 'BR', name: 'Brazil', flag: '🇧🇷' },
  { code: 'MX', name: 'Mexico', flag: '🇲🇽' },
  { code: 'ZA', name: 'South Africa', flag: '🇿🇦' },
  { code: 'KR', name: 'South Korea', flag: '🇰🇷' },
  { code: 'PL', name: 'Poland', flag: '🇵🇱' },
  { code: 'TR', name: 'Turkey', flag: '🇹🇷' },
  { code: 'TH', name: 'Thailand', flag: '🇹🇭' },
  { code: 'MY', name: 'Malaysia', flag: '🇲🇾' },
  { code: 'PH', name: 'Philippines', flag: '🇵🇭' },
  { code: 'ID', name: 'Indonesia', flag: '🇮🇩' },
  { code: 'VN', name: 'Vietnam', flag: '🇻🇳' },
  { code: 'AR', name: 'Argentina', flag: '🇦🇷' },
  { code: 'CL', name: 'Chile', flag: '🇨🇱' },
];

/** Derive ISO-2 country code from browser locale (e.g. en-IN → IN). */
function countryFromLocale(): string | null {
  try {
    const locale = (typeof navigator !== 'undefined' && navigator.language) || '';
    const parts = locale.split('-');
    const last = parts[parts.length - 1];
    return last.length === 2 ? last.toUpperCase() : null;
  } catch {
    return null;
  }
}

/** Read or auto-initialise the stored value. Writes the detected country on first visit. */
function initSelected(): string {
  try {
    if (typeof localStorage === 'undefined') return GLOBAL;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) return stored;
    const detected = countryFromLocale() ?? GLOBAL;
    localStorage.setItem(STORAGE_KEY, detected);
    return detected;
  } catch {
    return GLOBAL;
  }
}

function GlobeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export default function CountrySelector() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string>(initSelected);

  const isGlobal = selected === GLOBAL;
  const selectedCountry = isGlobal ? null : COUNTRIES.find((c) => c.code === selected) ?? null;

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return q
      ? COUNTRIES.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q))
      : COUNTRIES;
  }, [query]);

  const handleSelect = (code: string) => {
    localStorage.setItem(STORAGE_KEY, code);
    setSelected(code);
    setOpen(false);
    setQuery('');
  };

  const ariaLabel = isGlobal
    ? 'Ships from: Global (no filter)'
    : selectedCountry
      ? `Ships from: ${selectedCountry.name}`
      : 'Select shipping origin country';

  return (
    <Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(''); }}>
      <Trigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className={cn(
            'cursor-pointer flex size-9 items-center justify-center rounded-full p-1 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-opacity-50',
            open && 'bg-surface-hover',
          )}
        >
          {selectedCountry ? (
            <span className="flex items-center gap-0.5 text-xs font-medium leading-none">
              <span>{selectedCountry.flag}</span>
              <span>{selectedCountry.code}</span>
            </span>
          ) : (
            <GlobeIcon />
          )}
        </button>
      </Trigger>
      <Portal>
        <Content
          side="top"
          align="start"
          sideOffset={8}
          className="z-50 w-56 rounded-xl border border-border-light bg-surface-primary p-2 shadow-lg"
        >
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search country..."
            className="mb-2 w-full rounded-lg border border-border-light bg-surface-secondary px-2 py-1.5 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {!query && (
            <button
              type="button"
              onClick={() => handleSelect(GLOBAL)}
              className={cn(
                'mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-text-primary hover:bg-surface-hover',
                isGlobal && 'bg-brand-purple-subtle text-brand-purple',
              )}
            >
              <GlobeIcon />
              <span className="flex-1">Global</span>
              <span className="text-xs text-text-secondary">no filter</span>
            </button>
          )}
          <div className="max-h-52 overflow-y-auto">
            {filtered.map((c) => (
              <button
                key={c.code}
                type="button"
                onClick={() => handleSelect(c.code)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-text-primary hover:bg-surface-hover',
                  selected === c.code && 'bg-brand-purple-subtle text-brand-purple',
                )}
              >
                <span>{c.flag}</span>
                <span className="flex-1">{c.name}</span>
                <span className="text-xs text-text-secondary">{c.code}</span>
              </button>
            ))}
          </div>
        </Content>
      </Portal>
    </Root>
  );
}
