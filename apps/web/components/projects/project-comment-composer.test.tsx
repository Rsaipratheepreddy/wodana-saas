import {useState} from 'react';
import {render,screen,fireEvent} from '@testing-library/react';
import {it,expect,vi} from 'vitest';
import {ProjectCommentComposer} from './project-comment-composer';
it('selects an @mention with the keyboard and removes its recipient when deleted',()=>{
 const submit=vi.fn();
 function Example(){const [text,setText]=useState(''),[ids,setIds]=useState<string[]>([]);return <ProjectCommentComposer value={text} mentions={ids} members={[{id:'m',name:'Maya Nair'}]} busy={false} onChange={(value,mentions)=>{setText(value);setIds(mentions);}} onSubmit={()=>submit(text,ids)}/>;}
 render(<Example/>);
 const input=screen.getByLabelText('Comment');
 fireEvent.change(input,{target:{value:'Please review @Ma',selectionStart:17}});
 expect(screen.getByRole('option',{name:'MN Maya Nair'})).toBeInTheDocument();
 fireEvent.keyDown(input,{key:'Enter'});
 expect(input).toHaveValue('Please review @Maya Nair ');
 fireEvent.click(screen.getByRole('button',{name:'Add comment'}));
 expect(submit).toHaveBeenLastCalledWith('Please review @Maya Nair ',['m']);
 fireEvent.change(input,{target:{value:'Please review',selectionStart:13}});
 fireEvent.click(screen.getByRole('button',{name:'Add comment'}));
 expect(submit).toHaveBeenLastCalledWith('Please review',[]);
});
