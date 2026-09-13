import {useState} from 'react';
import {render,screen,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {expect,it,vi} from 'vitest';
import {blankCatalogRecord,type CatalogRecord} from '@/lib/workspace/catalog';
import {catalogHierarchy,isMaterialEntry} from '@/lib/workspace/catalog-hierarchy';
import {CatalogEntryEditor} from './catalog-entry-editor';

const row=(kind:CatalogRecord['kind'],id:string,name:string,links:CatalogRecord['links']=[]):CatalogRecord=>({...blankCatalogRecord(kind),id,name,code:id.toUpperCase(),catalogId:'catalog',version:1,links});
function fixture(){
 const room=row('room','room','Cafe');
 const item={...row('work','item','Round tables · Cafe',[{relation:'room',targetId:'room'},{relation:'construction',targetId:'template'}]),attributes:[{name:'element_name',value:'Round tables'},{name:'room_name',value:'Cafe'},{name:'typical_qty',value:'6'},{name:'Source row',value:'212'}]};
 const variant=row('variant','variant','Standard',[{relation:'work',targetId:'item'}]);
 const unit=row('unit','unit','Sheet');
 const requirement={...row('material','requirement','HDHMR 18mm · Board'),attributes:[{name:'Required specification',value:'HDHMR 18mm'},{name:'Import role',value:'Component requirement; exact product not selected'}]};
 const material={...row('sku','product','Greenply HDHMR 18mm',[{relation:'unit',targetId:'unit'}]),attributes:[{name:'thickness_mm',value:'18'},{name:'price_per_sheet_inr',value:'1800'},{name:'Source row',value:'42'}]};
 const component={...row('construction','component','Top · BOM1446',[{relation:'work',targetId:'item'},{relation:'parent',targetId:'template'},{relation:'unit',targetId:'unit'},{relation:'material',targetId:'requirement'}]),configuration:{recordRole:'component',componentType:'Top',selectionSource:'HDHMR 18mm'},attributes:[{name:'quantity',value:'2'},{name:'Source row',value:'1447'}]};
 return {room,item,variant,unit,requirement,material,component,all:[room,item,variant,unit,requirement,material,component]};
}
function setup(original:CatalogRecord,items:CatalogRecord[]){
 const saved=vi.fn(),related=vi.fn();
 function Editor(){const [draft,setDraft]=useState(original);return <><CatalogEntryEditor draft={draft} setDraft={setDraft} items={items} saving={false} onRelated={related} onPrice={vi.fn()} onSubmit={e=>{e.preventDefault();saved(draft)}}/><button form="catalog-editor" type="submit">Save test</button></>}
 render(<Editor/>);return {saved,related,user:userEvent.setup()};
}
it('edits the item identity without altering its composition or imported provenance',async()=>{
 const data=fixture(),{user,saved,related}=setup(data.item,data.all);
 expect(screen.getByRole('textbox',{name:'Item name'})).toHaveValue('Round tables');
 expect(screen.queryByText('Suggested materials')).not.toBeInTheDocument();
 await user.click(screen.getByRole('button',{name:'1 shared material'}));expect(related).toHaveBeenCalledWith(data.item,'components');
 await user.clear(screen.getByRole('spinbutton',{name:'Typical quantity'}));await user.type(screen.getByRole('spinbutton',{name:'Typical quantity'}),'8');
 await user.click(screen.getByRole('button',{name:'Save test'}));
 expect(saved.mock.calls[0][0].links).toEqual(data.item.links);
 expect(saved.mock.calls[0][0].attributes).toContainEqual({name:'Source row',value:'212'});
 expect(saved.mock.calls[0][0].attributes).toContainEqual({name:'typical_qty',value:'8'});
});
it('selects an exact product and links it to the component without losing quantity, scope or requirement',async()=>{
 const data=fixture(),{user,saved}=setup(data.component,data.all);
 const select=screen.getByRole('combobox',{name:'Selected material / product'});
 await user.type(select,'Greenply');await user.click(await screen.findByRole('option',{name:'Greenply HDHMR 18mm · PRODUCT'}));
 await user.click(screen.getByRole('button',{name:'Save test'}));
 const result:CatalogRecord=saved.mock.calls[0][0];
 expect(result.links).toEqual([...data.component.links,{relation:'sku',targetId:'product'}]);
 expect(result.attributes).toEqual(data.component.attributes);
 const graph=catalogHierarchy(data.all.map(r=>r.id===result.id?result:r));
 expect(graph.usage('product')[0]).toMatchObject({item:{id:'item'},rooms:[{id:'room'}]});
 expect(graph.materials('item','variant').map(r=>r.id)).toEqual(['component']);
});
it('shows product specifications separately and traces its usage back to the item',async()=>{
 const data=fixture();data.component.links.push({relation:'sku',targetId:'product'});
 const {user,saved,related}=setup(data.material,data.all);
 expect(screen.getByRole('textbox',{name:'Material name'})).toHaveValue(data.material.name);
 expect(screen.queryByRole('textbox',{name:'Thickness mm'})).not.toBeInTheDocument();
 await user.click(screen.getByRole('tab',{name:'Specifications'}));
 const thickness=screen.getByRole('textbox',{name:'Thickness mm'});await user.clear(thickness);await user.type(thickness,'19');
 await user.click(screen.getByRole('tab',{name:'Used in'}));
 await user.click(within(screen.getByRole('tabpanel')).getByRole('button',{name:/Round tables/}));expect(related).toHaveBeenCalledWith(data.item,'components');
 await user.click(screen.getByRole('button',{name:'Save test'}));
 expect(saved.mock.calls[0][0].attributes).toContainEqual({name:'Source row',value:'42'});
 expect(saved.mock.calls[0][0].attributes).toContainEqual({name:'price_per_sheet_inr',value:'1800'});
 expect(saved.mock.calls[0][0].links).toEqual(data.material.links);
});
it('keeps base and variant-specific rows distinct and includes material references in the single Materials view',()=>{
 const data=fixture();const extra={...data.component,id:'extra',links:[...data.component.links,{relation:'variant',targetId:'variant'}]};
 const graph=catalogHierarchy([...data.all,extra]);
 expect(graph.materials('item').map(r=>r.id)).toEqual(['component']);
 expect(graph.materials('item','variant').map(r=>r.id)).toEqual(['component','extra']);
 expect(isMaterialEntry(row('material','MM001','Plywood MR'))).toBe(true);
 expect(isMaterialEntry(data.requirement)).toBe(false);
});
