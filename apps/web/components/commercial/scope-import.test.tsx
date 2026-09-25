import {render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {it,expect,vi,afterEach} from 'vitest';
import {DesignSystemProvider} from '@/design-system';
import {ScopeImport} from './scope-import';
import * as content from '@/lib/pre-project/content';
import type {Quote} from '@/lib/commercial/types';
afterEach(()=>vi.restoreAllMocks());
it('imports only explicitly selected included requirements',async()=>{
 vi.spyOn(content,'caseRequest').mockResolvedValue({entries:[{id:'a',kind:'requirement',scopeStatus:'included',title:'Cabinets',version:1},{id:'b',kind:'requirement',scopeStatus:'included',title:'Wardrobe',version:1},{id:'c',kind:'requirement',scopeStatus:'excluded',title:'Excluded',version:1}]});
 const run=vi.fn().mockResolvedValue(true),close=vi.fn();
 render(<DesignSystemProvider><ScopeImport workspaceId="w" caseId="c" quote={{lines:[]} as unknown as Quote} open onClose={close} busy={false} run={run}/></DesignSystemProvider>);
 expect(screen.getByRole('button',{name:'Import selected requirements'})).toBeDisabled();
 await waitFor(()=>expect(screen.getByRole('checkbox',{name:'Include Cabinets'})).toBeVisible());
 expect(screen.queryByRole('checkbox',{name:'Include Excluded'})).not.toBeInTheDocument();
 const user=userEvent.setup();await user.click(screen.getByRole('checkbox',{name:'Include Cabinets'}));
 await user.click(screen.getByRole('button',{name:'Import selected requirements (1)'}));
 expect(run).toHaveBeenCalledWith('import_scope',{refreshExisting:false,entryIds:['a']});expect(close).toHaveBeenCalledOnce();
});
