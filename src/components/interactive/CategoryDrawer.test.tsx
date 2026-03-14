import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import CategoryDrawer from './CategoryDrawer';
import { $isCategoryDrawerOpen, $activeCategory } from '@/stores/ui';

// Mock the i18n module
vi.mock('@/i18n', () => ({
  t: (key: string) => {
    const map: Record<string, string> = { menu: 'Menu', close: 'Close' };
    return map[key] ?? key;
  },
}));

const CATEGORIES = [
  { id: 'cat-1', name: 'Poke Bowls' },
  { id: 'cat-2', name: 'Sides' },
  { id: 'cat-3', name: 'Drinks' },
];

describe('CategoryDrawer', () => {
  beforeEach(() => {
    cleanup();
    $isCategoryDrawerOpen.set(false);
    $activeCategory.set('');
  });

  it('renders an empty wrapper div when closed', () => {
    const { container } = render(<CategoryDrawer categories={CATEGORIES} lang="en" />);
    // When closed, the component returns a single empty <div />
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('[data-category-drawer]')).toBeNull();
  });

  it('renders categories when open', () => {
    $isCategoryDrawerOpen.set(true);
    const { getAllByText } = render(<CategoryDrawer categories={CATEGORIES} lang="en" />);

    // Each category appears twice (mobile + desktop)
    expect(getAllByText('Poke Bowls').length).toBeGreaterThanOrEqual(1);
    expect(getAllByText('Sides').length).toBeGreaterThanOrEqual(1);
    expect(getAllByText('Drinks').length).toBeGreaterThanOrEqual(1);
  });

  it('sets $activeCategory when a category is selected', () => {
    $isCategoryDrawerOpen.set(true);
    const { getAllByText } = render(<CategoryDrawer categories={CATEGORIES} lang="en" />);

    // Click the first "Sides" button (could be mobile or desktop)
    fireEvent.click(getAllByText('Sides')[0]);

    expect($activeCategory.get()).toBe('cat-2');
  });

  it('closes the drawer on category selection', () => {
    $isCategoryDrawerOpen.set(true);
    const { getAllByText } = render(<CategoryDrawer categories={CATEGORIES} lang="en" />);

    fireEvent.click(getAllByText('Poke Bowls')[0]);

    expect($isCategoryDrawerOpen.get()).toBe(false);
  });

  it('scrolls to the category section on selection', () => {
    $isCategoryDrawerOpen.set(true);

    // Create a mock element to be the scroll target
    const mockElement = document.createElement('div');
    mockElement.id = 'collection-cat-3';
    mockElement.scrollIntoView = vi.fn();
    document.body.appendChild(mockElement);

    const { getAllByText } = render(<CategoryDrawer categories={CATEGORIES} lang="en" />);

    fireEvent.click(getAllByText('Drinks')[0]);

    expect(mockElement.scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'start',
    });

    document.body.removeChild(mockElement);
  });

  it('closes on Escape key', () => {
    $isCategoryDrawerOpen.set(true);
    render(<CategoryDrawer categories={CATEGORIES} lang="en" />);

    expect($isCategoryDrawerOpen.get()).toBe(true);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect($isCategoryDrawerOpen.get()).toBe(false);
  });
});
