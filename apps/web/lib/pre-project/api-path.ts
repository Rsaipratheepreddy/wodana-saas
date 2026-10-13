const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function allowedCasePath(path:string[],method:string) {
  if(!path.length)return method==='GET'||method==='POST';
  if(path.length===1)return (method==='GET'&&(['candidates','start-options'].includes(path[0])||UUID.test(path[0])))||(method==='POST'&&path[0]==='from-lead');
  if(!UUID.test(path[0]))return false;
  // The order of 13 Oct 2026 (PLM-140–144, PLM-151): the design team, the kick-off, the render sign-off, the samples and a stage's due date.
  if(path[1]==='design-journey'&&((method==='PUT'&&path.length===3&&path[2]==='team')||(method==='POST'&&((path.length===4&&((path[2]==='kickoff'&&['schedule','complete'].includes(path[3]))
    ||(path[2]==='renders'&&path[3]==='sign-off')||(path[2]==='samples'&&['collected','approve'].includes(path[3]))))||(path.length===5&&path[2]==='stages'&&['concepts','renders'].includes(path[3])&&path[4]==='deadline')))))return true;
  if(path[1]==='design-journey')return (path.length===2&&method==='GET')
    ||(method==='GET'&&path.length===4&&path[2]==='material-selection'&&path[3]==='slots')
    ||(method==='PUT'&&path.length===4&&path[2]==='site-visit'&&path[3]==='answers')
    ||(method==='POST'&&((path.length===3&&['start','sign-off','estimate'].includes(path[2]))
      ||(path.length===5&&path[2]==='stages'&&['space_planning','concepts','material_selection','renders'].includes(path[3])&&['skip','assign'].includes(path[4]))
      ||(path.length===4&&((path[2]==='inspiration'&&path[3]==='close')||(path[2]==='site-visit'&&['schedule','complete'].includes(path[3]))||(path[2]==='material-selection'&&['schedule','confirm','not-required'].includes(path[3]))))));
  // Plan §6.7a: concept presentations and the materials and decisions ledger.
  if(path[1]==='design-presentations')return (path.length===2&&['GET','POST'].includes(method))||(method==='POST'&&path.length===4&&UUID.test(path[2])&&['present','withdraw','decision'].includes(path[3]));
  if(path[1]==='design-ledger')return (method==='GET'&&(path.length===2||(path.length===3&&path[2]==='catalog')))||(method==='POST'&&((path.length===3&&['entries','approve-changes'].includes(path[2]))
    ||(path.length===5&&path[2]==='entries'&&UUID.test(path[3])&&['versions','archive'].includes(path[4]))
    ||(path.length===7&&path[2]==='entries'&&UUID.test(path[3])&&path[4]==='versions'&&UUID.test(path[5])&&path[6]==='decision')));
  // PLM-146/148/156/157: the finishes schedule (placement, snapshots, send to QS, the client's signatures, the factory share) and its files.
  if(path[1]==='finishes')return (path.length===2&&method==='GET')
    ||(method==='POST'&&((path.length===3&&['send-to-qs','share'].includes(path[2]))
      ||(path.length===4&&path[2]==='assets'&&UUID.test(path[3]))
      ||(path.length===5&&path[2]==='entries'&&UUID.test(path[3])&&['details','snapshots','signatures'].includes(path[4]))
      ||(path.length===5&&path[2]==='snapshots'&&UUID.test(path[3])&&path[4]==='archive')));
  // Plan §6.20: change requests (raise, assess, send for approval, decide, send to sign, withdraw).
  if(path[1]==='change-requests')return (path.length===2&&['GET','POST'].includes(method))||(path.length===3&&UUID.test(path[2])&&method==='PUT')
    ||(path.length===4&&UUID.test(path[2])&&method==='POST'&&['submit','decide','send','withdraw'].includes(path[3]));
  // PLM-147: value engineering on the job's estimate (start, the savings, the meeting, the client's decision, stop).
  if(path[1]==='value-engineering')return (path.length===2&&method==='GET')||(method==='POST'&&((path.length===3&&path[2]==='start')||(path.length===4&&UUID.test(path[2])&&['options','meeting','keep-price','withdraw'].includes(path[3]))));
  // PLM-046: the job's recurring client update call.
  if(path[1]==='client-calls')return path.length===2&&['GET','PUT'].includes(method);
  if(path[1]==='site')return (path.length===2&&method==='GET')||(path.length===3&&['visits','measurements','observations'].includes(path[2])&&method==='PUT')||(path.length===4&&UUID.test(path[2])&&((path[3]==='history'&&method==='GET')||(path[3]==='review'&&method==='POST')));
  if(path.length===2)return (method==='GET'&&['requirement-notes','brief','catalog-options','designs','readiness','definition-baselines'].includes(path[1]))||(method==='PUT'&&['requirement-notes','brief','rooms','entries','designs','design-folders'].includes(path[1]))||(method==='POST'&&['definition-baselines','lifecycle'].includes(path[1]))||(method==='PATCH'&&path[1]==='profile');
  if(path.length===3&&path[1]==='moodboard'&&path[2]==='layout')return method==='PUT';
  if(path.length===3)return (path[1]==='designs'&&path[2]==='upload'&&method==='POST')||(path[1]==='specifications'&&UUID.test(path[2])&&['GET','PUT'].includes(method))||(path[1]==='assets'&&UUID.test(path[2])&&['GET','POST'].includes(method))||(path[1]==='entries'&&((method==='POST'&&path[2]==='bulk')||(method==='PATCH'&&UUID.test(path[2]))));
  if(path.length===4&&path[1]==='assets'&&UUID.test(path[2])&&path[3]==='markup')return ['GET','POST'].includes(method);
  if(path.length===4&&path[1]==='definition-baselines'&&UUID.test(path[2])&&path[3]==='decisions')return method==='POST';
  if(path.length===6&&path[1]==='designs'&&UUID.test(path[2])&&path[3]==='threads'&&UUID.test(path[4])&&['replies','status','audience'].includes(path[5]))return method==='POST';
  return path.length===4&&path[1]==='designs'&&UUID.test(path[2])&&['versions','activity','threads'].includes(path[3])&&method==='POST';
}
