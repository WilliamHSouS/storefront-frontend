import { useState, useRef, useCallback } from 'preact/hooks';
import { t } from '@/i18n';
import type { FormAction } from '../CheckoutPage';
import type { CheckoutFormState, TimeSlot } from '@/types/checkout';

interface SchedulingPickerProps {
  lang: 'nl' | 'en' | 'de';
  form: CheckoutFormState;
  dispatch: (action: FormAction) => void;
  timeSlots: TimeSlot[];
  onDateChange: (date: string) => void;
  onSlotSelect: (slotId: string) => void;
  isPickup: boolean;
  loading: boolean;
}

function buildDateStrip(): string[] {
  const dates: string[] = [];
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    // Format as YYYY-MM-DD
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    dates.push(`${yyyy}-${mm}-${dd}`);
  }
  return dates;
}

function formatDateLabel(dateStr: string, index: number, lang: 'nl' | 'en' | 'de'): string {
  if (index === 0) return t('today', lang);
  if (index === 1) return t('tomorrow', lang);
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(lang === 'nl' ? 'nl-NL' : lang === 'de' ? 'de-DE' : 'en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

export default function SchedulingPicker({
  lang,
  form,
  dispatch,
  timeSlots,
  onDateChange,
  onSlotSelect,
  isPickup,
  loading,
}: SchedulingPickerProps) {
  const [showAll, setShowAll] = useState(false);
  const dates = buildDateStrip();
  const [scrollOffset, setScrollOffset] = useState(0);
  const listboxRef = useRef<HTMLDivElement>(null);

  // How many dates to show at once in the strip
  const visibleCount = 5;
  const maxOffset = Math.max(0, dates.length - visibleCount);
  const visibleDates = dates.slice(scrollOffset, scrollOffset + visibleCount);

  const selectedDate = form.scheduledDate ?? dates[0];

  const handleDateSelect = useCallback(
    (dateStr: string) => {
      dispatch({ type: 'SET_FIELD', field: 'scheduledDate', value: dateStr });
      onDateChange(dateStr);
    },
    [dispatch, onDateChange],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const currentIndex = dates.indexOf(selectedDate);
      if (e.key === 'ArrowRight' && currentIndex < dates.length - 1) {
        e.preventDefault();
        const next = dates[currentIndex + 1];
        handleDateSelect(next);
        // Ensure visible
        if (currentIndex + 1 >= scrollOffset + visibleCount) {
          setScrollOffset(Math.min(currentIndex + 1 - visibleCount + 1, maxOffset));
        }
      } else if (e.key === 'ArrowLeft' && currentIndex > 0) {
        e.preventDefault();
        const prev = dates[currentIndex - 1];
        handleDateSelect(prev);
        if (currentIndex - 1 < scrollOffset) {
          setScrollOffset(currentIndex - 1);
        }
      }
    },
    [dates, selectedDate, handleDateSelect, scrollOffset, maxOffset],
  );

  const slotsToShow = showAll ? timeSlots : timeSlots.filter((s) => s.available);

  return (
    <section>
      <h3 class="text-base font-semibold mb-4">{t('scheduling', lang)}</h3>

      {/* ASAP / Schedule toggle */}
      <fieldset>
        <div role="radiogroup" class="flex gap-2 mb-4">
          {(['asap', 'scheduled'] as const).map((mode) => {
            const selected = form.schedulingMode === mode;
            return (
              <label
                key={mode}
                class={`flex-1 flex items-center justify-center min-h-[48px] px-4 rounded-md cursor-pointer text-sm font-medium transition-colors select-none ${
                  selected ? 'bg-primary text-primary-foreground' : 'bg-card border border-input'
                }`}
              >
                <input
                  type="radio"
                  name="schedulingMode"
                  value={mode}
                  checked={selected}
                  class="sr-only"
                  onChange={() => dispatch({ type: 'SET_SCHEDULING', mode })}
                />
                {mode === 'asap' ? t('asap', lang) : t('schedule', lang)}
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* Date strip + time slots (only when scheduled) */}
      {form.schedulingMode === 'scheduled' && (
        <>
          {/* Date strip */}
          <div class="flex items-center gap-1 mb-4 overflow-hidden">
            <button
              type="button"
              class="p-2 rounded-full hover:bg-muted flex-shrink-0"
              aria-label="Previous dates"
              disabled={scrollOffset === 0}
              onClick={() => setScrollOffset(Math.max(0, scrollOffset - 1))}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M10 12L6 8L10 4"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>

            <div
              ref={listboxRef}
              role="listbox"
              aria-label={t('scheduling', lang)}
              class="flex gap-2 flex-1 min-w-0 overflow-hidden"
              onKeyDown={handleKeyDown}
              tabIndex={0}
            >
              {visibleDates.map((dateStr) => {
                const globalIndex = dates.indexOf(dateStr);
                const selected = selectedDate === dateStr;
                return (
                  <div
                    key={dateStr}
                    role="option"
                    aria-selected={selected}
                    tabIndex={selected ? 0 : -1}
                    class={`px-3 py-2 rounded-lg text-sm text-center cursor-pointer transition-colors select-none whitespace-nowrap flex-shrink-0 ${
                      selected
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-card border border-input'
                    }`}
                    onClick={() => handleDateSelect(dateStr)}
                    onKeyDown={handleKeyDown}
                  >
                    {formatDateLabel(dateStr, globalIndex, lang)}
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              class="p-2 rounded-full hover:bg-muted flex-shrink-0"
              aria-label="Next dates"
              disabled={scrollOffset >= maxOffset}
              onClick={() => setScrollOffset(Math.min(maxOffset, scrollOffset + 1))}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M6 4L10 8L6 12"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
          </div>

          {/* Time slots (pickup only) */}
          {isPickup && (
            <div class="relative">
              {loading && (
                <div class="absolute inset-0 flex items-center justify-center bg-background/50 rounded-lg z-10">
                  <div class="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
              )}

              <div role="radiogroup" aria-label={t('selectTime', lang)} class="flex flex-col gap-2">
                {slotsToShow.map((slot) => {
                  const selected = form.selectedSlotId === slot.id;
                  const disabled = !slot.available;
                  return (
                    <label
                      key={slot.id}
                      aria-disabled={disabled ? 'true' : undefined}
                      class={`px-4 py-3 rounded-lg border text-sm cursor-pointer transition-colors select-none ${
                        disabled
                          ? 'opacity-50 cursor-not-allowed border-input'
                          : selected
                            ? 'border-primary bg-primary/5'
                            : 'border-input'
                      }`}
                    >
                      <input
                        type="radio"
                        name="timeSlot"
                        value={slot.id}
                        checked={selected}
                        disabled={disabled}
                        class="sr-only"
                        onChange={() => {
                          if (!disabled) {
                            dispatch({
                              type: 'SET_FIELD',
                              field: 'selectedSlotId',
                              value: slot.id,
                            });
                            onSlotSelect(slot.id);
                          }
                        }}
                      />
                      <span>
                        {slot.start_time}–{slot.end_time}
                      </span>
                      {disabled && (
                        <span class="ml-2 text-muted-foreground">({t('slotFull', lang)})</span>
                      )}
                    </label>
                  );
                })}
              </div>

              {/* Show all times toggle */}
              {timeSlots.some((s) => !s.available) && (
                <button
                  type="button"
                  class="mt-2 text-sm text-primary underline"
                  onClick={() => setShowAll(!showAll)}
                >
                  {showAll ? t('selectTime', lang) : t('showAllTimes', lang)}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
