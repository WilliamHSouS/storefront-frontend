import { useStore } from '@nanostores/preact';
import { useEffect, useRef } from 'preact/hooks';
import { $isCategoryDrawerOpen, $activeCategory } from '@/stores/ui';
import { t } from '@/i18n/client';

interface Category {
  id: string | number;
  name: string;
}

interface Props {
  categories: Category[];
  lang: string;
}

export default function CategoryDrawer({ categories, lang }: Props) {
  const isOpen = useStore($isCategoryDrawerOpen);
  const activeCategory = useStore($activeCategory);
  const panelRef = useRef<HTMLDivElement>(null);

  // Listen for trigger button click
  useEffect(() => {
    const handler = () => $isCategoryDrawerOpen.set(!$isCategoryDrawerOpen.get());
    window.addEventListener('toggle-category-drawer', handler);
    return () => window.removeEventListener('toggle-category-drawer', handler);
  }, []);

  // Lock body scroll on mobile when open
  useEffect(() => {
    if (!isOpen) return;
    const mq = window.matchMedia('(max-width: 767px)');
    if (mq.matches) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [isOpen]);

  // Close on click outside (desktop popover)
  // Deferred registration avoids catching the opening click event
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      const panel = panelRef.current;
      if (!panel) return;
      const trigger = document.querySelector('[data-category-drawer-trigger]');
      if (!panel.contains(e.target as Node) && !trigger?.contains(e.target as Node)) {
        $isCategoryDrawerOpen.set(false);
      }
    };
    const id = setTimeout(() => document.addEventListener('click', handler), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('click', handler);
    };
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') $isCategoryDrawerOpen.set(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen]);

  const handleSelect = (categoryId: string) => {
    $activeCategory.set(categoryId);
    $isCategoryDrawerOpen.set(false);
    const section = document.getElementById(`collection-${categoryId}`);
    if (section) {
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  if (!isOpen) return <div />;

  return (
    <>
      {/* Mobile: full-screen overlay */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('menu', lang)}
        class="fixed inset-0 z-50 flex flex-col bg-background md:hidden"
      >
        <div class="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 class="font-heading text-lg font-semibold text-foreground">{t('menu', lang)}</h2>
          <button
            type="button"
            onClick={() => $isCategoryDrawerOpen.set(false)}
            class="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground hover:bg-muted"
            aria-label={t('close', lang)}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
        <nav data-category-drawer class="flex-1 overflow-y-auto px-4 py-4">
          <ul class="space-y-1">
            {categories.map((cat) => (
              <li key={cat.id}>
                <button
                  type="button"
                  onClick={() => handleSelect(String(cat.id))}
                  class={`w-full rounded-lg px-4 py-3 text-left text-base font-medium transition-colors ${
                    activeCategory === String(cat.id)
                      ? 'bg-primary text-primary-foreground'
                      : 'text-foreground hover:bg-muted'
                  }`}
                >
                  {cat.name}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      {/* Desktop: dropdown popover */}
      <div
        ref={panelRef}
        class="absolute left-0 top-full z-50 mt-2 hidden w-56 rounded-xl border border-border bg-card p-2 shadow-lg md:block"
      >
        <nav data-category-drawer>
          <ul class="space-y-0.5">
            {categories.map((cat) => (
              <li key={cat.id}>
                <button
                  type="button"
                  onClick={() => handleSelect(String(cat.id))}
                  class={`w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
                    activeCategory === String(cat.id)
                      ? 'bg-primary text-primary-foreground'
                      : 'text-card-foreground hover:bg-muted'
                  }`}
                >
                  {cat.name}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </>
  );
}
