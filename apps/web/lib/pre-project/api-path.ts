const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function allowedCasePath(path:string[],method:string) {
  if(!path.length)return method==='GET'||method==='POST';
  if(path.length===1)return (method==='GET'&&(['candidates','start-options'].includes(path[0])||UUID.test(path[0])))||(method==='POST'&&path[0]==='from-lead');
  if(!UUID.test(path[0]))return false;
  if(path[1]==='site')return (path.length===2&&method==='GET')||(path.length===3&&['visits','measurements','observations'].includes(path[2])&&method==='PUT')||(path.length===4&&UUID.test(path[2])&&((path[3]==='history'&&method==='GET')||(path[3]==='review'&&method==='POST')));
  if(path.length===2)return (method==='GET'&&['requirement-notes','brief','catalog-options','designs'].includes(path[1]))||(method==='PUT'&&['requirement-notes','brief','rooms','entries','designs','design-folders'].includes(path[1]));
  if(path.length===3)return (path[1]==='designs'&&path[2]==='upload'&&method==='POST')||(path[1]==='specifications'&&UUID.test(path[2])&&['GET','PUT'].includes(method))||(path[1]==='assets'&&UUID.test(path[2])&&['GET','POST'].includes(method))||(path[1]==='entries'&&((method==='POST'&&path[2]==='bulk')||(method==='PATCH'&&UUID.test(path[2]))));
  if(path.length===4&&path[1]==='assets'&&UUID.test(path[2])&&path[3]==='markup')return ['GET','POST'].includes(method);
  if(path.length===6&&path[1]==='designs'&&UUID.test(path[2])&&path[3]==='threads'&&UUID.test(path[4])&&['replies','status'].includes(path[5]))return method==='POST';
  return path.length===4&&path[1]==='designs'&&UUID.test(path[2])&&['versions','activity','threads'].includes(path[3])&&method==='POST';
}
