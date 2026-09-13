import {useState} from 'react';
import {render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {expect,it,vi} from 'vitest';
import {blankCatalogRecord,type CatalogRecord} from '@/lib/workspace/catalog';
import {CatalogEditor} from './catalog-editor';

it('lets a tenant enter a specification name and value without losing focus or source fields',async()=>{
 const user=userEvent.setup(),saved=vi.fn();
 const original={...blankCatalogRecord('room'),name:'Balcony',code:'BALCONY',attributes:[{name:'room_id',value:'RM015'},{name:'min_sqft',value:'40'}]};
 function Editor(){const [draft,setDraft]=useState<CatalogRecord>(original);return <><CatalogEditor draft={draft} setDraft={setDraft} items={[draft]} saving={false} onSubmit={event=>{event.preventDefault();saved(draft);}}/><button form="catalog-editor" type="submit">Save test record</button></>;}
 render(<Editor/>);
 await user.clear(screen.getByLabelText('Minimum area (sq.ft)'));
 await user.type(screen.getByLabelText('Minimum area (sq.ft)'),'45');
 await user.click(screen.getByRole('button',{name:'Add specification'}));
 await user.type(screen.getByLabelText('Specification name',{exact:true}),'Floor finish');
 expect(screen.getByLabelText('Specification name',{exact:true})).toHaveValue('Floor finish');
 await user.type(screen.getByLabelText('Value',{exact:true}),'Anti-skid tile');
 await user.click(screen.getByRole('button',{name:'Save test record'}));
 expect(saved).toHaveBeenCalledOnce();
 expect(saved.mock.calls[0][0].attributes).toEqual([{name:'room_id',value:'RM015'},{name:'min_sqft',value:'45'},{name:'Floor finish',value:'Anti-skid tile'}]);
});
