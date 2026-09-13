import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ProjectState } from '@/lib/projects/execution';
import { ProjectBoq } from './project-boq';

describe('project BOQ', () => {
  it('shows the released quantities and links to their source quotation', () => {
    const state = { caseId: 'case-1', data: { scope: { quoteId: 'quote-2', quoteNumber: 2, currency: 'AED', value: 2000, lines: [{ id: 'line-1', title: 'Wardrobe', room: 'Bedroom', material: 'Oak finish', quantity: 3, unit: 'nos' }] } } } as ProjectState;
    render(<ProjectBoq state={state}/>);
    const table = screen.getByRole('table', { name: 'Project BOQ' });
    expect(within(table).getByText('Wardrobe')).toBeVisible();
    expect(within(table).getByText('Oak finish')).toBeVisible();
    expect(within(table).getByText('3')).toBeVisible();
    expect(screen.getByRole('link', { name: 'View source quotation' })).toHaveAttribute('href', '/workspace/pre-projects/cases/case-1/quotations?quote=quote-2');
  });
  it('explains when scope is available without showing invented items', () => {
    render(<ProjectBoq state={{ caseId: 'case-1', data: { scope: null } } as ProjectState}/>);
    expect(screen.getByText('No released BOQ yet')).toBeVisible();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View quotations' })).toHaveAttribute('href', '/workspace/pre-projects/cases/case-1/quotations');
  });
});
