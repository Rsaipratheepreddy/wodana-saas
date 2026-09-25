import { render, screen, within, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ProjectState } from '@/lib/projects/execution';
import { ProjectBoq } from './project-boq';

const navigation = vi.hoisted(() => ({ query: "" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(navigation.query) }));
beforeEach(() => { navigation.query = ""; });

describe('project BOQ', () => {
  it('shows the released quantities and links to their source quotation', () => {
    const state = { caseId: 'case-1', data: {
      scope: { quoteId: 'quote-2', quoteNumber: 2, currency: 'AED', value: 2000, lines: [{ id: 'line-1', title: 'Wardrobe', room: 'Bedroom', material: 'Oak finish', dimensions: { length: 2400, height: 2600, depth: 600, unit: 'mm' }, quantity: 3, unit: 'nos', lineTotal: 2000 }] },
      workPackages: [{ id: 'package-1', scopeLineIds: ['line-1'], status: 'in_progress' }],
      tasks: [{ id: 'task-1', packageId: 'package-1', scopeIds: ['line-1'], status: 'completed' }, { id: 'task-2', packageId: 'package-1', scopeIds: ['line-1'], status: 'in_progress' }],
    } } as ProjectState;
    render(<ProjectBoq state={state} onEditWork={() => {}}/>);
    const table = screen.getByRole('table', { name: 'Project BOQ' });
    expect(within(table).getByText('Wardrobe')).toBeVisible();
    expect(within(table).getByText('Oak finish')).toBeVisible();
    expect(within(table).getByText('L 2400 × H 2600 × D 600 mm')).toBeVisible();
    expect(within(table).getByText('3')).toBeVisible();
    expect(within(table).getByText('AED 2,000.00')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Source quotation' })).toHaveAttribute('href', '/workspace/pre-projects/cases/case-1/quotations?quote=quote-2');
  });
  it('explains when scope is available without showing invented items', () => {
    render(<ProjectBoq state={{ caseId: 'case-1', data: { scope: null } } as ProjectState} onEditWork={() => {}}/>);
    expect(screen.getByText('No released BOQ yet')).toBeVisible();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Source quotation' })).toHaveAttribute('href', '/workspace/pre-projects/cases/case-1/quotations');
  });
  it('filters released scope by room and clears the filter', async () => {
    const state = { id: 'p', caseId: 'c', data: { scope: { quoteId: 'q', currency: 'AED', value: 100, lines: [
      { id: 'a', title: 'Wardrobe', room: 'Bedroom', quantity: 1, unit: 'nos' },
      { id: 'b', title: 'Cabinet', room: 'Kitchen', quantity: 1, unit: 'nos' },
    ] } } } as ProjectState;
    render(<ProjectBoq state={state} onEditWork={() => {}}/>);
    fireEvent.click(screen.getByRole('button',{name:/Filter by room or area/}));
    fireEvent.click(await screen.findByRole('option',{name:'Kitchen'}));
    expect(screen.queryByRole('button',{name:'Wardrobe'})).not.toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Cabinet'})).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByRole('button',{name:'Wardrobe'})).toBeVisible();
  });
  it('opens the exact item plan without redirecting to a generic task list', () => {
    const state = { id:'p',caseId:'c',canManage:true,data:{scope:{quoteId:'q',currency:'AED',value:1,lines:[{id:'line',title:'Cabinet',quantity:1,unit:'nos'}]},workPackages:[{id:'w',scopeLineIds:['line'],status:'planning'}]}} as ProjectState;
    const open=vi.fn();
    render(<ProjectBoq state={state} onEditWork={open}/>);
    fireEvent.click(screen.getByRole('button',{name:'Plan item'}));
    expect(open).toHaveBeenCalledWith(state.data.workPackages![0]);
    expect(screen.queryByText(/Released from the accepted quotation/)).not.toBeInTheDocument();
    expect(screen.queryByText('Quoted dimensions')).not.toBeInTheDocument();
    expect(screen.queryByRole('table',{name:'Scope work planning'})).not.toBeInTheDocument();
  });
});
