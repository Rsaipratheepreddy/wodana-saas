import {render,screen,within} from '@testing-library/react';
import {it,expect,vi,beforeEach} from 'vitest';
import {ProjectPipelineNavigation} from './project-pipeline-navigation';
const navigation=vi.hoisted(()=>({query:''}));
vi.mock('next/navigation',()=>({useSearchParams:()=>new URLSearchParams(navigation.query)}));
beforeEach(()=>{navigation.query='';});
it('exposes operational sections as links without a tools menu',()=>{
 render(<ProjectPipelineNavigation root="/workspace/projects/p" section="procurement" available={new Set(['overview','boq','material-planning','procurement','production','commercial','daily-progress','handover'])}/>);
 expect(screen.queryByRole('button',{name:/tools/i})).not.toBeInTheDocument();
 const main=within(screen.getByRole('navigation',{name:'Project sections'}));
 expect(main.getByRole('link',{name:'Supply'})).toHaveAttribute('aria-current','page');
 expect(main.getByRole('link',{name:'Work'})).toHaveAttribute('href','/workspace/projects/p/production');
 expect(screen.getByRole('link',{name:'Receipts'})).toHaveAttribute('href','/workspace/projects/p/procurement?view=deliveries');
 expect(main.queryByRole('link',{name:'Tasks'})).not.toBeInTheDocument();
});
it('keeps designs reachable beside the BOQ',()=>{
 render(<ProjectPipelineNavigation root="/workspace/projects/p" section="boq" available={new Set(['boq'])}/>);
 expect(screen.getByRole('link',{name:'Designs'})).toHaveAttribute('href','/workspace/projects/p/boq?scopeTab=designs');
});

it('keeps only six main sections and selects a deep-linked receipt',()=>{
 navigation.query='view=deliveries';
 render(<ProjectPipelineNavigation root="/workspace/projects/p" section="procurement" available={new Set(['overview','boq','material-planning','procurement','plan-teams','production','site-work','daily-progress','commercial','handover','snagging','documents'])}/>);
 expect(within(screen.getByRole('navigation',{name:'Project sections'})).getAllByRole('link')).toHaveLength(6);
 expect(screen.getByRole('link',{name:'Receipts'})).toHaveAttribute('aria-current','page');
 expect(screen.getByRole('link',{name:'Orders'})).not.toHaveAttribute('aria-current');
});
it('uses the first permitted destination and preserves the defect route',()=>{
 render(<ProjectPipelineNavigation root="/workspace/projects/p" section="snagging" available={new Set(['snagging'])}/>);
 expect(screen.getByRole('link',{name:'Quality & handover'})).toHaveAttribute('href','/workspace/projects/p/snagging');
 expect(screen.queryByRole('link',{name:'Completion checks'})).not.toBeInTheDocument();
});
it('keeps Factory selected inside Work while viewing dispatch',()=>{
 navigation.query='view=dispatch';
 render(<ProjectPipelineNavigation root="/workspace/projects/p" section="production" available={new Set(['plan-teams','production','site-work'])}/>);
 expect(screen.getByRole('link',{name:'Work'})).toHaveAttribute('aria-current','page');
 expect(screen.getByRole('link',{name:'Factory'})).toHaveAttribute('aria-current','page');
});
