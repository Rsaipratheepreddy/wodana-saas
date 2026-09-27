import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CalendarTimeGrid } from './calendar-time-grid';

describe('CalendarTimeGrid', () => {
  it('uses a compact card for a thirty-minute event without losing its accessible details', () => {
    const start = new Date(2026, 8, 21, 10, 30);
    render(<CalendarTimeGrid
      days={[new Date(2026, 8, 21)]}
      events={[{ id: 'task-1', title: 'Review production schedule', start, end: new Date(2026, 8, 21, 11), provider: 'crm' }]}
      onSelect={vi.fn()}
      onSchedule={vi.fn()}
    />);
    const event = screen.getByRole('button', { name: /CRM Review production schedule/ });
    expect(event).toHaveAttribute('data-compact', 'true');
    expect(event).toHaveTextContent('Review production schedule');
    expect(event).toHaveAttribute('title', expect.stringContaining('Review production schedule'));
  });
  it('folds concurrent events past the week lanes into a "+N" chip that lists the whole cluster', async () => {
    const onSelect = vi.fn();
    const events = [
      { id: 'visit', title: 'Site visit – Palm Jumeirah', start: new Date(2026, 8, 21, 10, 30), end: new Date(2026, 8, 21, 11, 30), provider: 'crm' as const },
      ...Array.from({ length: 4 }, (_, index) => ({ id: `follow-${index}`, title: `Follow up ${index}`, start: new Date(2026, 8, 21, 11), provider: 'crm' as const })),
    ];
    render(<CalendarTimeGrid days={Array.from({ length: 7 }, (_, index) => new Date(2026, 8, 20 + index))} events={events} onSelect={onSelect} onSchedule={vi.fn()} />);
    expect(screen.getByRole('button', { name: /CRM Site visit – Palm Jumeirah/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /CRM Follow up 0/ })).toBeNull();
    const chip = screen.getByRole('button', { name: /Show 4 more events from/ });
    expect(chip).toHaveTextContent('+4');
    await userEvent.click(chip);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByRole('button', { name: /CRM / })).toHaveLength(5);
    await userEvent.click(within(dialog).getByRole('button', { name: /CRM Follow up 2/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'follow-2' }));
  });
});
