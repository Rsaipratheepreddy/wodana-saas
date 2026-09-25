import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { ScopeEditor } from '@/components/pre-project/scope-entry-editor';
import { DefinitionPage } from '@/components/pre-project/definition-page';
import { MeasurementCreateForm } from '@/components/pre-project/measurement-create-form';
import { blankEntry, briefFields, deriveDiscoveryCoverage, type CaseContent } from '@/lib/pre-project/content';
import type { DefinitionPageData } from '@/lib/pre-project/definition';

// Isolated visual fixture. No workspace credentials or live project IDs.
const initial: DefinitionPageData = {
 workspaceId:'visual-qc',caseId:'visual-qc',
 definition:{caseStatus:'active',draft:{sourceHash:'fixture',readyToPublish:true,issues:[]},
  current:{id:'fixture',number:1,status:'awaiting_confirmation',current:true,message:'',publishedAt:'2026-09-22T09:00:00Z',publishedBy:'Test reviewer',decision:null,
   snapshot:{definition:{brief:{},rooms:[],items:[{id:'item',title:'Kitchen storage',roomName:'Kitchen',scopeStatus:'included',quantity:1,unit:'nos',specification:{refinedRequirement:'Soft-close drawers and adjustable shelves.'}}]}}},
  history:[],confirmed:false,nextAction:null,canPublish:false,canRecordClientDecision:true},
 readiness:{ready:false,summary:{includedItemCount:1,readyItemCount:0,blockerCount:1,warningCount:0},blockers:[{code:'confirmation',label:'Client confirmation',detail:'Client confirmation is still pending.'}]},
};
const meta={title:'Planning/Requirements review',component:DefinitionPage,parameters:{layout:'padded'},args:{initial}} satisfies Meta<typeof DefinitionPage>;
export default meta;
type Story=StoryObj<typeof meta>;
export const PendingConfirmation:Story={};
export const ReadOnly:Story={args:{initial:{...initial,definition:{...initial.definition,canRecordClientDecision:false}}}};

const measurementData:CaseContent={workspaceId:'visual-qc',caseId:'visual-qc',canEdit:true,caseStatus:'active',rooms:[],entries:[],fromCrm:false,crmContext:{description:null,opportunityAmount:null,currencyCode:'AED'},coverage:deriveDiscoveryCoverage([],[]),brief:{...(Object.fromEntries(Object.keys(briefFields).map(key=>[key,''])) as Record<keyof typeof briefFields,string>),currencyCode:'AED',budgetAmount:'',version:0}};
export const MeasurementForm:Story={render:()=> <MeasurementCreateForm data={measurementData} entries={[{...blankEntry(),id:'fixture',title:'Kitchen wall',version:1}]} initialRoom="all" onClose={()=>{}} onCreateRequirement={()=>{}} onSaved={()=>{}}/>};

export const RequirementSheet:Story={render:()=> <ScopeEditor data={measurementData} entry={{...blankEntry(),title:'Kitchen storage',note:'Add the client’s requirements, references and measurements here.'}} onClose={()=>{}} onSave={async value=>({...value,version:value.version+1})} onArchive={async()=>{}} onSpecifications={()=>{}}/>};
