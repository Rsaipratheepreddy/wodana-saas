import {render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {expect,it,vi} from 'vitest';
import {DesignSystemProvider} from '@/design-system';
import {CatalogImportDialog} from './catalog-import-dialog';
import type {ImportPlan} from '@/lib/workspace/catalog-import';

it('reviews and validates pasted records before a single confirmed import',async()=>{
 const user=userEvent.setup(),onValidate=vi.fn(async()=>({preview:true})),onImport=vi.fn(async(plan:ImportPlan)=>({created:plan.records.length,reused:0,items:plan.records})),onImported=vi.fn();
 render(<DesignSystemProvider><CatalogImportDialog catalogId="catalog" items={[]} initialKind="room" groupId="" onClose={vi.fn()} onValidate={onValidate} onImport={onImport} onImported={onImported}/></DesignSystemProvider>);
 await user.click(screen.getByText('Or paste from Excel'));
 await user.type(screen.getByLabelText('Paste a table with column headings'),'Name\tNotes\nStudy\tTenant room');
 await user.click(screen.getByRole('button',{name:'Use pasted table'}));
 expect(onValidate).not.toHaveBeenCalled();expect(onImport).not.toHaveBeenCalled();
 await user.click(screen.getByRole('button',{name:'Review import'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Import 1 records'})).toBeEnabled());
 expect(onValidate).toHaveBeenCalledTimes(1);expect(onImport).not.toHaveBeenCalled();
 await user.click(screen.getByRole('button',{name:'Import 1 records'}));
 await waitFor(()=>expect(onImported).toHaveBeenCalled());
 expect(onImport).toHaveBeenCalledTimes(1);
 expect(onImport.mock.calls[0][0].records[0]).toMatchObject({kind:'room',name:'Study',description:'Tenant room'});
});

it('keeps unresolved measurements in review and prevents saving the batch',async()=>{
 const user=userEvent.setup(),onValidate=vi.fn(),onImport=vi.fn();
 render(<DesignSystemProvider><CatalogImportDialog catalogId="catalog" items={[]} initialKind="material" groupId="" onClose={vi.fn()} onValidate={onValidate} onImport={onImport} onImported={vi.fn()}/></DesignSystemProvider>);
 await user.click(screen.getByText('Or paste from Excel'));
 await user.type(screen.getByLabelText('Paste a table with column headings'),'Name\tUnit\nBoard\tUnknown unit');
 await user.click(screen.getByRole('button',{name:'Use pasted table'}));
 await user.click(screen.getByRole('button',{name:'Review import'}));
 expect(screen.getByRole('alert')).toHaveTextContent('Unknown unit');
 expect(screen.getByRole('button',{name:'Import 1 records'})).toBeDisabled();
 expect(onValidate).not.toHaveBeenCalled();expect(onImport).not.toHaveBeenCalled();
});
