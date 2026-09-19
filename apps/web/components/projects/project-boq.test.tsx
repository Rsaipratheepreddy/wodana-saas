import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ProjectState } from '@/lib/projects/execution';
import { ProjectBoq } from './project-boq';

describe('project BOQ', () => {
  it('shows the released quantities and links to their source quotation', () => {
    const state = { caseId: 'case-1', data: {
      scope: { quoteId: 'quote-2', quoteNumber: 2, currency: 'AED', value: 2000, lines: [{ id: 'line-1', title: 'Wardrobe', room: 'Bedroom', material: 'Oak finish', dimensions: { length: 2400, height: 2600, depth: 600, unit: 'mm' }, quantity: 3, unit: 'nos', lineTotal: 2000 }] },
      workPackages: [{ id: 'package-1', scopeLineIds: ['line-1'], status: 'in_progress' }],
      tasks: [{ id: 'task-1', packageId: 'package-1', scopeIds: ['line-1'], status: 'completed' }, { id: 'task-2', packageId: 'package-1', scopeIds: ['line-1'], status: 'in_progress' }],
    } } as ProjectState;
    render(<ProjectBoq state={state}/>);
    const table = screen.getByRole('table', { name: 'Project BOQ' });
    expect(within(table).getByText('Wardrobe')).toBeVisible();
    expect(within(table).getByText('Oak finish')).toBeVisible();
    expect(within(table).getByText('L 2400 × H 2600 × D 600 mm')).toBeVisible();
    expect(within(table).getByText('3 nos')).toBeVisible();
    expect(within(table).getByText('1 of 2 tasks')).toBeVisible();
    expect(within(table).getByText('AED 2,000.00')).toBeVisible();
    expect(screen.getByRole('link', { name: 'View source quotation' })).toHaveAttribute('href', '/workspace/pre-projects/cases/case-1/quotations?quote=quote-2');
  });
  it('explains when scope is available without showing invented items', () => {
    render(<ProjectBoq state={{ caseId: 'case-1', data: { scope: null } } as ProjectState}/>);
    expect(screen.getByText('No released BOQ yet')).toBeVisible();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View quotations' })).toHaveAttribute('href', '/workspace/pre-projects/cases/case-1/quotations');
  });
});
