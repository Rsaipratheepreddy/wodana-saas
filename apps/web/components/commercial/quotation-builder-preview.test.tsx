import {render,screen,fireEvent} from '@testing-library/react';
import {describe,it,expect} from 'vitest';
import type {Quote} from '@/lib/commercial/types';
import {builderPresentation} from '@/lib/commercial/quotation-builder-document';
import {QuotationBuilderPreview} from './quotation-builder-preview';
const base={id:'q1',number:1,kind:'quotation',status:'draft',title:'Test',currency:'AED',validUntil:'2099-01-01',discount:0,taxRate:0,terms:'Payment due in 30 days.',exclusions:'',createdAt:'2026-09-20',requestIds:[],total:0,lines:[],paymentTerms:[]} as Quote;
const quote={...base,presentation:builderPresentation(base,'Studio','Client')};
describe('quotation preview navigation',()=>{
 it('renders every enabled page for PDF export',()=>{render(<QuotationBuilderPreview quote={{...quote,presentation:{...quote.presentation,hiddenPages:['acceptance']}}} customerName="Client" allPages/>);expect(screen.getAllByRole('article')).toHaveLength(5);expect(screen.queryByRole('article',{name:'Acceptance preview'})).not.toBeInTheDocument();expect(screen.queryByRole('navigation')).not.toBeInTheDocument();});
 it('omits hidden pages and handles all pages hidden',()=>{render(<QuotationBuilderPreview quote={{...quote,presentation:{...quote.presentation,hiddenPages:quote.presentation.pageOrder}}} customerName="Client"/>);expect(screen.getByRole('status')).toHaveTextContent('All pages are hidden');expect(screen.queryByRole('article')).not.toBeInTheDocument();});
 it('opens the current page and navigates between document pages',()=>{render(<QuotationBuilderPreview quote={quote} customerName="Client" initialPageId="terms"/>);expect(screen.getByRole('article',{name:'Page 4 preview'})).toBeInTheDocument();expect(screen.queryByRole('article',{name:'Page 1 preview'})).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:/Preview page/}));fireEvent.click(screen.getAllByRole('option')[0]);expect(screen.getByRole('article',{name:'Page 1 preview'})).toBeInTheDocument();expect(screen.getByRole('button',{name:'← Previous'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'Next →'}));expect(screen.getByRole('article',{name:'Page 2 preview'})).toBeInTheDocument();});
 it('maps the scope grid to its generated document page',()=>{render(<QuotationBuilderPreview quote={quote} customerName="Client" initialPageId="scope"/>);expect(screen.getByRole('article',{name:'Scope & Items preview'})).toHaveTextContent('TOTAL AMOUNT:');});
});

it('previews a legacy quotation without mutating its saved content',()=>{const legacy=structuredClone(base);const before=JSON.stringify(legacy);render(<QuotationBuilderPreview quote={legacy} customerName="Client"/>);expect(screen.getByRole('article',{name:'Page 1 preview'})).toBeVisible();expect(JSON.stringify(legacy)).toBe(before);});
