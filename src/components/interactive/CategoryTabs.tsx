import { useStore } from '@nanostores/preact';
import { useEffect, useRef, useCallback } from 'preact/hooks';
import { $activeCategory } from '@/stores/ui';

interface Category {
  id: string | number;
  name: string;
}

interface Props {
  categories: Category[];
}

export default function CategoryTabs({ categories }: Props) {
  const activeCategory = useStore($activeCategory);
  const scrollRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const indicatorRef = useRef<HTMLDivElement>(null);
  const isUserClick = useRef(false);

  // Update sliding pill indicator position
  const updateIndicator = useCallback((categoryId: string) => {
    const tab = tabRefs.current.get(categoryId);
    const indicator = indicatorRef.current;
    const container = scrollRef.current;
    if (!tab || !indicator || !container) return;

    const containerRect = container.getBoundingClientRect();
    const tabRect = tab.getBoundingClientRect();
    indicator.style.width = `${tabRect.width}px`;
    indicator.style.transform = `translateX(${tabRect.left - containerRect.left + container.scrollLeft}px)`;
  }, []);

  // Scroll-based active category tracking via IntersectionObserver
  useEffect(() => {
    const sections = categories
      .map((c) => document.getElementById(`collection-${c.id}`))
      .filter(Boolean) as HTMLElement[];

    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (isUserClick.current) return;
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = entry.target.getAttribute('data-category-id');
            if (id) $activeCategory.set(id);
          }
        }
      },
      { rootMargin: '-112px 0px -60% 0px', threshold: 0 },
    );

    for (const section of sections) observer.observe(section);
    return () => observer.disconnect();
  }, [categories]);

  // Update indicator when active category changes
  useEffect(() => {
    if (activeCategory) {
      updateIndicator(activeCategory);
      // Scroll tab into view
      const tab = tabRefs.current.get(activeCategory);
      tab?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [activeCategory, updateIndicator]);

  // Set initial active category
  useEffect(() => {
    if (!activeCategory && categories.length > 0) {
      $activeCategory.set(String(categories[0].id));
    }
  }, [categories, activeCategory]);

  const handleTabClick = (categoryId: string) => {
    isUserClick.current = true;
    $activeCategory.set(categoryId);

    const section = document.getElementById(`collection-${categoryId}`);
    if (section) {
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // Re-enable scroll tracking after smooth scroll completes
      setTimeout(() => {
        isUserClick.current = false;
      }, 800);
    } else {
      isUserClick.current = false;
    }
  };

  const handleKeyDown = (e: KeyboardEvent, index: number) => {
    let nextIndex;
    if (e.key === 'ArrowRight') nextIndex = Math.min(index + 1, categories.length - 1);
    else if (e.key === 'ArrowLeft') nextIndex = Math.max(index - 1, 0);
    else return;

    e.preventDefault();
    const nextCat = categories[nextIndex];
    const tab = tabRefs.current.get(String(nextCat.id));
    tab?.focus();
    handleTabClick(String(nextCat.id));
  };

  return (
    <div
      ref={scrollRef}
      role="tablist"
      aria-label="Menu"
      class="relative flex flex-1 gap-2 overflow-x-auto scrollbar-none"
    >
      {/* Sliding indicator */}
      <div
        ref={indicatorRef}
        class="absolute top-0 h-10 rounded-[14px] bg-primary z-0 transition-all duration-200"
        aria-hidden="true"
      />

      {categories.map((cat, i) => (
        <button
          key={cat.id}
          ref={(el) => {
            if (el) tabRefs.current.set(String(cat.id), el);
          }}
          role="tab"
          type="button"
          aria-selected={activeCategory === String(cat.id)}
          tabIndex={activeCategory === String(cat.id) ? 0 : -1}
          onClick={() => handleTabClick(String(cat.id))}
          onKeyDown={(e) => handleKeyDown(e, i)}
          class={`relative z-10 shrink-0 whitespace-nowrap rounded-[14px] px-4 h-10 text-sm font-medium transition-colors duration-300 ${
            activeCategory === String(cat.id)
              ? 'text-primary-foreground'
              : 'text-foreground hover:bg-foreground/5'
          }`}
        >
          {cat.name}
        </button>
      ))}
    </div>
  );
}
