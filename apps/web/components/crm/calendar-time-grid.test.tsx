import { render, screen } from '@testing-library/react';
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
});
