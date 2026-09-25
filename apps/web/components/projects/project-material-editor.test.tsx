import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {describe,it,expect,vi} from 'vitest';
import {parseDate} from '@internationalized/date';
import {ProjectMaterialEditor} from './project-material-editor';
import type {ProjectState} from '@/lib/projects/execution';
vi.mock('@/design-system',()=>({
 Button:({children,onPress,isDisabled,isLoading,...props}:any)=><button {...props} disabled={isDisabled||isLoading} onClick={onPress}>{children}</button>,
 ControlledModalDialog:({children,footer}:any)=><div>{children}{footer}</div>,
 SelectField:({label,items,selectedKey,onSelectionChange}:any)=><label>{label}<select value={selectedKey??''} onChange={e=>onSelectionChange(e.target.value)}><option value=""/>{items.map((i:any)=><option key={i.id} value={i.id}>{i.label}</option>)}</select></label>,
 TextInput:({label,value,onChange,isReadOnly}:any)=><label>{label}<input readOnly={isReadOnly} value={value} onChange={e=>onChange(e.target.value)}/></label>,
 TextAreaField:({label,value,onChange}:any)=><label>{label}<textarea value={value} onChange={e=>onChange(e.target.value)}/></label>,
 NumericInput:({label,value,onChange}:any)=><label>{label}<input type="number" value={Number.isNaN(value)?'':value} onChange={e=>onChange(Number(e.target.value))}/></label>,
 DateField:({label,value,onChange}:any)=><label>{label}<input value={value?.toString()??''} onChange={e=>onChange(parseDate(e.target.value))}/></label>,
}));
const state={data:{scope:{lines:[{id:'wardrobe',title:'Wardrobe',room:'Bedroom',quantity:2,unit:'nos',material:'Oak finish'}]},tasks:[{id:'factory',scopeIds:['wardrobe'],title:'Build wardrobe',location:'factory',status:'planned',start:'2026-09-25'},{id:'other',scopeIds:['kitchen'],title:'Kitchen task',status:'planned'}]}} as unknown as ProjectState;
function choose(mode:string){fireEvent.change(screen.getByLabelText('Approved BOQ item'),{target:{value:'wardrobe'}});fireEvent.change(screen.getByLabelText('What do you need to source?'),{target:{value:mode}});}
describe('BOQ requirements',()=>{
 it('copies finished-item quantity and only offers related tasks',()=>{render(<ProjectMaterialEditor state={state} onClose={vi.fn()} onSaved={vi.fn()} run={vi.fn()}/>);expect(screen.queryByLabelText('Required quantity')).not.toBeInTheDocument();choose('finished');expect(screen.getByLabelText('Required quantity')).toHaveValue(2);expect(screen.getByLabelText('Unit')).toHaveValue('nos');expect(screen.getByLabelText('Item')).toHaveValue('Wardrobe');expect(screen.queryByRole('option',{name:/Kitchen task/})).not.toBeInTheDocument();});
 it('saves component quantities independently while retaining their BOQ link',async()=>{const run=vi.fn().mockResolvedValue(true);render(<ProjectMaterialEditor state={state} onClose={vi.fn()} onSaved={vi.fn()} run={run}/>);choose('component');expect(screen.getByLabelText('Required quantity')).toHaveValue(null);fireEvent.change(screen.getByLabelText('Material'),{target:{value:'Oak boards'}});fireEvent.change(screen.getByLabelText('Required quantity'),{target:{value:'12'}});fireEvent.change(screen.getByLabelText('Unit'),{target:{value:'sheet'}});fireEvent.click(screen.getByRole('button',{name:'Add requirement'}));await waitFor(()=>expect(run).toHaveBeenCalledWith('material',{material:expect.objectContaining({scopeLineId:'wardrobe',title:'Oak boards',required:12,unit:'sheet',taskId:'factory'})}));});
});
