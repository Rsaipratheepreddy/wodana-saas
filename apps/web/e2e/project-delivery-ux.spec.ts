import { expect, test } from "@playwright/test";

test('global tasks default to a clean Kanban with accessible scrolling and optional table',async({page},testInfo)=>{
 const rows=[['planned','Confirm measurements'],['in_progress','Build wardrobes'],['awaiting_inspection','Review installed wardrobe'],['blocked','Resolve site access'],['completed','Install bedroom unit']].map(([status,title],index)=>({id:`p:task:${index}`,recordId:String(index),projectId:'p',projectName:index%2?'Villa B':'Villa A',kind:'task',title,status,ownerId:'maker',ownerName:'Maya',dueDate:'2026-09-25',href:`/workspace/projects/p/production?record=${index}`}));
 await page.route('**/api/projects/work-queue?**',route=>route.fulfill({json:{rows,nextCursor:null,memberId:'maker'}}));
 await page.goto('/workspace/tasks');
 const board=page.getByRole('region',{name:'Project work Kanban'});await expect(board).toBeVisible();
 await expect(board.getByRole('link',{name:'Build wardrobes · Villa B'})).toHaveAttribute('href','/workspace/projects/p/production?record=1');
 await expect(page.getByRole('button',{name:'Kanban',exact:true})).toHaveAttribute('aria-pressed','true');
 for(const direction of ['ltr','rtl']){await page.evaluate(dir=>{document.documentElement.dir=dir;},direction);expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);}
 await page.evaluate(()=>{document.documentElement.dir='ltr';});
 await page.screenshot({path:testInfo.outputPath('global-tasks-kanban.png'),animations:'disabled'});
 await page.getByRole('button',{name:'Table',exact:true}).click();
 const grid=page.getByRole('table',{name:'Global project work items'});await expect(grid).toBeVisible();
 const scroll=grid.locator('..');expect(await scroll.evaluate(node=>getComputedStyle(node).scrollbarWidth)).toBe('none');
 if(await scroll.evaluate(node=>node.scrollWidth>node.clientWidth)){await scroll.focus();await page.keyboard.press('ArrowRight');await expect.poll(()=>scroll.evaluate(node=>node.scrollLeft)).toBeGreaterThan(0);}
});

test('sales tasks open in Kanban and keep follow-up editing',async({page},testInfo)=>{
 await page.goto('/workspace/crm/follow-ups?view=activity');
 await expect(page.getByRole('region',{name:'Sales tasks Kanban'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Kanban',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.screenshot({path:testInfo.outputPath('sales-tasks-kanban.png'),animations:'disabled'});
 await page.getByRole('button',{name:'Table',exact:true}).click();
 await expect(page.getByRole('table',{name:'Follow-ups'})).toBeVisible();
});

test('production lots expose independent QC and preserve a rejected review draft',async({page},testInfo)=>{
 const task={id:'factory-task',title:'Build wardrobes',package:'Joinery',area:'Bedroom',location:'factory',status:'in_progress',quantity:4,approved:2,unit:'nos',ownerId:'maker',assigneeIds:[],parentId:'',resourceId:'factory',start:'2026-09-22',end:'2026-09-23',predecessors:[],weight:1,priority:'normal',scopeIds:[],readiness:{scope:true,access:true,materials:true},factoryLots:[{id:'lot',title:'First pair',quantity:2,unit:'nos',createdBy:'maker',at:'2026-09-22',status:'pending_qc',reviews:[]}]};
 const fixture={id:'demo',workspaceId:'w',name:'Production lot acceptance',memberId:'reviewer',canManage:true,canReview:true,canReport:true,canBuy:true,members:[{id:'reviewer',name:'QC reviewer'},{id:'maker',name:'Maker'}],resources:[],bookings:[],data:{revision:1,phase:'active',tasks:[task],reports:[],materials:[],orders:[],documents:[],snags:[],handovers:[],comments:[],audit:[],processed:[],budget:0,forecast:0,financeClosed:false,financeEvidence:''}};
 let submitted:Record<string,unknown>|undefined;
 await page.route('**/api/projects/**',route=>{if(route.request().method()==='POST'){submitted=route.request().postDataJSON();return route.fulfill({status:409,json:{message:'This project changed. Refresh and review before saving.'}});}return route.fulfill({json:fixture});});
 await page.goto('/workspace/projects/demo/overview?view=summary');
 await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('menuitem',{name:'Refresh project'}).click();
 await expect(page.getByRole('heading',{name:'Production lot acceptance'})).toBeVisible();
 await page.evaluate(()=>history.pushState(null,'','?view=summary&record=factory-task'));
 const grid=page.getByRole('table',{name:'Production lots'});await expect(grid).toBeVisible();
 expect(await grid.locator('tbody td').first().evaluate(node=>{const c=getComputedStyle(node);return [c.borderLeftWidth,c.borderRightWidth,c.borderTopWidth,c.borderBottomWidth];})).toEqual(['1px','1px','1px','1px']);
 for(const direction of ['ltr','rtl']){await page.evaluate(dir=>{document.documentElement.dir=dir;},direction);expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);}
 await grid.getByRole('button',{name:'Pass QC',exact:true}).focus();await page.keyboard.press('Enter');
 const dialog=page.getByRole('dialog',{name:'Pass batch QC'});await expect(dialog).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('production-lot-qc.png'),animations:'disabled'});
 await dialog.getByRole('textbox',{name:/evidence|reason|note/i}).first().fill('Independent lot inspection');
 await dialog.getByRole('button',{name:/confirm|save/i}).last().click();
 await expect.poll(()=>submitted?.action).toBe('factory_lot_review');
 expect(submitted).toMatchObject({id:'factory-task',batchId:'lot',passed:true});
 await expect(dialog.getByRole('textbox',{name:/evidence|reason|note/i}).first()).toHaveValue('Independent lot inspection');
});

test('factory batch creation submits selected project revisions',async({page},testInfo)=>{
 const candidate={key:'project:task',projectId:'project',projectName:'Villa',revision:7,snapshot:{taskId:'task',title:'Build wardrobes',quantity:4,unit:'wardrobe',resourceId:'factory'}};
 const fixture={canManage:true,batches:[],candidates:[candidate],resources:[{id:'factory',name:'Workshop'}],members:[{id:'foreman',name:'Maya'}]};
 let command:Record<string,unknown>|undefined;
 await page.route('**/api/factory-batches?**',route=>{if(route.request().method()==='POST'){command=route.request().postDataJSON();return route.fulfill({json:{id:'batch'}});}return route.fulfill({json:fixture});});
 await page.goto('/workspace/projects/factory?view=batches');await page.getByRole('button',{name:'Create batch',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Create factory batch'});
 await dialog.getByRole('textbox',{name:'Batch name'}).fill('Wardrobe assembly');await dialog.getByRole('textbox',{name:'Common operation'}).fill('Assembly');
 await dialog.getByRole('button',{name:/Workshop/}).click();await page.getByRole('option',{name:'Workshop',exact:true}).click();
 await dialog.getByRole('button',{name:/Responsible foreman/}).click();await page.getByRole('option',{name:'Maya',exact:true}).click();
 await dialog.getByRole('combobox',{name:'Add Factory tasks'}).fill('Villa');await page.getByRole('option',{name:'Villa · Build wardrobes · 4 wardrobe',exact:true}).click();
 await dialog.getByRole('textbox',{name:'Specification / compatibility evidence'}).fill('Approved oak specification');
 await page.screenshot({path:testInfo.outputPath('factory-batch-create.png'),animations:'disabled'});
 await dialog.getByRole('button',{name:'Create batch',exact:true}).click();await expect(dialog).toHaveCount(0);
 expect(command).toMatchObject({action:'create',resourceId:'factory',ownerId:'foreman',tasks:[{projectId:'project',taskId:'task',revision:7}]});
});

test('shared factory batches preserve project attribution and cancellation drafts',async({page},testInfo)=>{
 const snapshot={taskId:'wardrobes',title:'Build wardrobes',area:'Bedroom',quantity:6,unit:'wardrobe',resourceId:'factory',ownerId:'foreman',start:'2026-09-22',end:'2026-09-24',scopeIds:['boq'],scope:[],drawingId:''};
 const allocation={projectId:'project-a',projectName:'Villa A',revision:3,snapshot,approved:4,dispatched:3,received:2,rejected:1,returned:0,qc:'pending',status:'in_progress',changed:false,booked:true};
 const batch={id:'batch',version:1,name:'Ten wardrobes',operation:'Assembly',compatibility:'Approved oak construction',resourceId:'factory',resourceName:'Workshop',ownerId:'foreman',ownerName:'Maya',start:'2026-09-22',end:'2026-09-24',state:'rework',allocations:[allocation,{...allocation,projectId:'project-b',projectName:'Villa B',snapshot:{...snapshot,quantity:4},approved:0,dispatched:0,received:0,rejected:0}]};
 const fixture={canManage:true,batches:[batch],candidates:[],resources:[],members:[]};
 const attempts:Record<string,unknown>[]=[];
 await page.route('**/api/factory-batches?**',route=>{
  if(route.request().method()==='POST'){attempts.push(route.request().postDataJSON());return route.fulfill({status:409,json:{message:'Work has already started.'}});}
  return route.fulfill({json:fixture});
 });
 await page.goto('/workspace/projects/factory?view=batches');
 const grid=page.getByRole('table',{name:'Shared factory batches',exact:true});await expect(grid).toBeVisible();
 for(const direction of ['ltr','rtl']){await page.evaluate(dir=>{document.documentElement.dir=dir;},direction);expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);}
 await page.getByRole('button',{name:'Open batch',exact:true}).focus();await page.keyboard.press('Enter');
 const detail=page.getByRole('table',{name:'Factory batch allocations',exact:true});await expect(detail).toBeVisible();
 await expect(detail.getByText('Villa A · Bedroom',{exact:true})).toBeVisible();await expect(detail.getByText('Villa B · Bedroom',{exact:true})).toBeVisible();
 expect(await detail.locator('tbody td').first().evaluate(node=>{const c=getComputedStyle(node);return [c.borderLeftWidth,c.borderRightWidth,c.borderTopWidth,c.borderBottomWidth];})).toEqual(['1px','1px','1px','1px']);
 await expect(detail.getByRole('link',{name:'Open task'}).first()).toHaveAttribute('href','/workspace/projects/project-a/production?record=wardrobes');
 await page.screenshot({path:testInfo.outputPath('shared-factory-batch.png'),animations:'disabled'});
 await page.getByRole('button',{name:'Cancel batch',exact:true}).click();await page.getByRole('textbox',{name:'Cancellation reason'}).fill('Regroup planned work');
 await page.getByRole('button',{name:'Confirm cancellation'}).click();await expect(page.getByRole('dialog',{name:'Ten wardrobes',exact:true}).getByRole('alert')).toHaveText('Work has already started.');
 await expect(page.getByRole('textbox',{name:'Cancellation reason'})).toHaveValue('Regroup planned work');
 await page.getByRole('button',{name:'Confirm cancellation'}).click();await expect.poll(()=>attempts.length).toBe(2);expect(attempts[0].requestId).toBe(attempts[1].requestId);
});

test('project factory batches show only the scoped allocation',async({page})=>{
 await page.route('**/api/factory-batches?**',route=>{
  expect(new URL(route.request().url()).searchParams.get('projectId')).toBe('demo');
  return route.fulfill({json:{canManage:false,batches:[],candidates:[],resources:[],members:[]}});
 });
 await page.goto('/workspace/projects/demo/production?view=batches');
 await expect(page.getByText('No factory batches',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Create batch',exact:true})).toHaveCount(0);
});

test('factory capacity grid opens explicit pooled booking units',async({page},testInfo)=>{
 const task={id:'factory-task',parentId:'',title:'Build wardrobes',package:'Wardrobes',area:'Bedroom',location:'factory',ownerId:'pm',assigneeIds:[],resourceId:'factory',start:'2026-09-22',end:'2026-09-23',quantity:10,unit:'wardrobe',weight:1,approved:0,status:'planned',priority:'normal',predecessors:[],scopeIds:[],readiness:{scope:true,access:true,materials:true}};
 const fixture={workspaceId:'demo-workspace',id:'demo',caseId:'demo-case',name:'Capacity preview',today:'2026-09-22',customer:'Preview client',memberId:'pm',canManage:true,canReview:true,canReport:false,canBuy:false,commercialReady:false,members:[],resources:[{id:'factory',name:'Workshop',kind:'factory',capacityMode:'pooled',capacity:10,active:true}],bookings:[],pulse:{health:'watch',counts:{packages:0,readyPackages:0,activePackages:0,blockedPackages:0,overdueTasks:0,awaitingInspection:0},nextActions:[]},data:{revision:1,phase:'active',tasks:[task],reports:[],materials:[],orders:[],documents:[],snags:[],handovers:[],comments:[],audit:[],processed:[],budget:0,forecast:0,financeClosed:false,financeEvidence:''}};
 await page.route('**/api/projects/**',route=>route.fulfill({json:fixture}));
 await page.route('**/api/project-capacity?**',route=>route.fulfill({json:{range:{from:'2026-09-22',to:'2026-09-22'},resources:[{id:'factory',name:'Workshop',kind:'factory',timezone:'Asia/Kolkata'}],availability:[{resourceId:'factory',segments:[{date:'2026-09-22',startTime:'09:00',endTime:'17:00',capacity:10,confirmed:7,tentative:2,remaining:3,overCapacity:false}]}]}}));
 await page.goto('/workspace/projects/demo/production?view=capacity');
 const grid=page.getByRole('table',{name:'Factory capacity shifts'});await expect(grid).toBeVisible();
 expect(await grid.locator('tbody td').first().evaluate(node=>{const c=getComputedStyle(node);return [c.borderLeftWidth,c.borderRightWidth,c.borderTopWidth,c.borderBottomWidth];})).toEqual(['1px','1px','1px','1px']);
 for(const direction of ['ltr','rtl']){await page.evaluate(dir=>{document.documentElement.dir=dir;},direction);expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);}
 await page.screenshot({path:testInfo.outputPath('factory-capacity.png'),animations:'disabled'});
 await page.goto('/workspace/projects/demo/overview?view=summary');
 await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('menuitem',{name:'Refresh project'}).click();
 await expect(page.getByRole('heading',{name:'Capacity preview'})).toBeVisible();
 await page.evaluate(()=>history.pushState(null,'','?view=summary&record=factory-task'));
 await page.getByRole('button',{name:'Confirm booking',exact:true}).focus();await page.keyboard.press('Enter');
 await expect(page.getByRole('dialog',{name:'Confirm booking · 2026-09-22 → 2026-09-23'})).toBeVisible();
 await expect(page.getByRole('textbox',{name:'Capacity units'})).toHaveValue('1');
});

test('installation batch QC has bounded quantities and evidence upload',async({page},testInfo)=>{
 const task={id:'t',parentId:'',title:'Install chairs',package:'Chairs',area:'Bedroom',location:'site',ownerId:'installer',assigneeIds:[],resourceId:'',quantity:10,unit:'chair',weight:1,approved:2,status:'in_progress',priority:'normal',predecessors:[],scopeIds:[],readiness:{scope:true,access:true,materials:true},installationBatches:[{id:'batch',title:'First two',quantity:2,unit:'chair',createdBy:'installer',status:'pending_qc',reviews:[]}]};
 const fixture={workspaceId:'demo-workspace',id:'demo',caseId:'demo-case',name:'Batch preview',customer:'Preview client',memberId:'qc',canManage:true,canReview:true,canReport:false,canBuy:false,commercialReady:false,members:[],resources:[],bookings:[],pulse:{health:'watch',counts:{packages:0,readyPackages:0,activePackages:0,blockedPackages:0,overdueTasks:0,awaitingInspection:0},nextActions:[]},data:{revision:1,phase:'active',tasks:[task],reports:[],materials:[],orders:[],documents:[],snags:[],handovers:[],comments:[],audit:[],processed:[],budget:0,forecast:0,financeClosed:false,financeEvidence:''}};
 await page.route('**/api/projects/**',route=>route.request().method()==='GET'?route.fulfill({json:fixture}):route.fulfill({status:409,json:{message:'Preview conflict'}}));
 await page.goto('/workspace/projects/demo/overview?view=summary');
 await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('menuitem',{name:'Refresh project'}).click();
 await expect(page.getByRole('heading',{name:'Batch preview'})).toBeVisible();
 await page.evaluate(()=>history.pushState(null,'','?view=summary&record=t'));
 const table=page.getByRole('table',{name:'Installation batches',exact:true});await expect(table).toBeVisible();
 await expect(page.getByRole('button',{name:'Create batch',exact:true})).toHaveCount(0);
 for(const direction of ['ltr','rtl']){await page.evaluate(dir=>{document.documentElement.dir=dir;},direction);expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);}
 await page.getByRole('button',{name:'Pass QC',exact:true}).focus();await page.keyboard.press('Enter');
 await expect(page.getByRole('dialog',{name:'Pass batch QC',exact:true})).toBeVisible();
 await expect(page.getByLabel('Upload image or PDF',{exact:true})).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('batch-qc.png'),animations:'disabled'});
});

test('reviewed handover scope stays visible before signed acceptance',async({page},testInfo)=>{
 const handover={id:'h',title:'Bedroom delivery',area:'Bedroom',status:'ready',taskIds:['t'],documentIds:['doc'],acceptedBy:'',acceptedAt:'',published:false,evidence:'',outstanding:'',warrantyUntil:'2027-09-22',packet:{id:'pack',version:1,tasks:[{id:'t',title:'Install chairs',area:'Bedroom',location:'site',quantity:4,unit:'chair'}],documents:[{id:'doc',title:'Care guide',revision:'R1',kind:'manual'}]}};
 const fixture={workspaceId:'demo-workspace',id:'demo',caseId:'demo-case',name:'Handover preview',customer:'Preview client',memberId:'pm',canManage:true,canReview:true,canReport:false,canBuy:true,commercialReady:false,members:[],resources:[],bookings:[],pulse:{health:'watch',counts:{packages:0,readyPackages:0,activePackages:0,blockedPackages:0,overdueTasks:0,awaitingInspection:0},nextActions:[]},data:{revision:1,phase:'active',tasks:[],reports:[],materials:[],orders:[],documents:[],snags:[],handovers:[handover],comments:[],audit:[],processed:[],budget:0,forecast:0,financeClosed:false,financeEvidence:''}};
 await page.route('**/api/projects/**',route=>route.request().method()==='GET'?route.fulfill({json:fixture}):route.fulfill({status:409,json:{message:'Preview conflict'}}));
 await page.goto('/workspace/projects/demo/overview?view=summary');
 await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('menuitem',{name:'Refresh project'}).click();
 await expect(page.getByRole('heading',{name:'Handover preview'})).toBeVisible();
 await page.evaluate(()=>history.pushState(null,'','?view=summary&record=h'));
 const table=page.getByRole('table',{name:'Handover scope',exact:true});await expect(table).toBeVisible();
 await expect(page.getByText('Reviewed pack · Version 1',{exact:true})).toBeVisible();
 expect(await table.locator('tbody td').first().evaluate(node=>{const c=getComputedStyle(node);return [c.borderLeftWidth,c.borderRightWidth,c.borderTopWidth,c.borderBottomWidth];})).toEqual(['1px','1px','1px','1px']);
 for(const direction of ['ltr','rtl']){await page.evaluate(dir=>{document.documentElement.dir=dir;},direction);expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);}
 await page.screenshot({path:testInfo.outputPath('handover-scope.png'),animations:'disabled'});
 await page.getByRole('button',{name:'Record signed acceptance',exact:true}).focus();await page.keyboard.press('Enter');
 await expect(page.getByRole('dialog',{name:'Record client handover acceptance',exact:true})).toBeVisible();
  await expect(page.getByRole('textbox',{name:'Signed acceptance reference / evidence',exact:true})).toBeVisible();
  const evidence=page.getByRole('textbox',{name:'Signed acceptance reference / evidence',exact:true});
  await evidence.fill('Signed handover at site');
  await page.route('**/api/project-files/**',route=>route.fulfill({json:{file:{id:'proof'},data:{...fixture.data,revision:2,files:[{id:'proof',recordId:'h',name:'signed.pdf',mimeType:'application/pdf',bytes:10,sha256:'test',by:'pm',at:'2026-09-22'}]}}}));
  await page.getByLabel('Upload image or PDF',{exact:true}).setInputFiles({name:'signed.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-synthetic-test')});
  await expect(page.getByRole('checkbox',{name:'signed.pdf',exact:true})).toBeChecked();
  await expect(evidence).toHaveValue('Signed handover at site');
  await page.screenshot({path:testInfo.outputPath('handover-upload.png'),animations:'disabled'});
});

test('site material usage basis grid and planning dialog',async({page},testInfo)=>{
 const task={id:'site',parentId:'',package:'Chairs',title:'Install chairs',description:'',area:'Room',location:'site',ownerId:'pm',assigneeIds:[],resourceId:'',start:'2026-09-22',end:'2026-09-23',baselineStart:'2026-09-22',baselineEnd:'2026-09-23',predecessors:[],quantity:10,unit:'chair',weight:1,approved:0,status:'planned',priority:'normal',inspectionRequired:false,scopeIds:[],drawingId:'',readiness:{scope:true,access:true,materials:true},blocker:''};
 const material={id:'m',title:'Brackets',specification:'Steel',required:40,unit:'piece',supply:'company',taskId:'site',movements:[],outputBasis:{perUnit:4,outputUnit:'chair',by:'pm',at:'2026-09-22',evidence:'Specification'}};
 const fixture={workspaceId:'demo-workspace',id:'demo',caseId:'demo-case',name:'Installation preview',customer:'Preview client',memberId:'pm',canManage:true,canReview:true,canReport:false,canBuy:true,commercialReady:false,members:[{id:'pm',name:'Planner'}],resources:[],bookings:[],pulse:{health:'watch',counts:{packages:0,readyPackages:0,activePackages:0,blockedPackages:0,overdueTasks:0,awaitingInspection:0},nextActions:[]},data:{revision:1,phase:'planning',tasks:[task],reports:[],materials:[material],orders:[],documents:[],snags:[],handovers:[],comments:[],audit:[],processed:[],budget:0,forecast:0,financeClosed:false,financeEvidence:''}};
 await page.route('**/api/projects/**',route=>route.request().method()==='GET'?route.fulfill({json:fixture}):route.fulfill({status:409,json:{message:'Preview conflict'}}));
 await page.goto('/workspace/projects/demo/overview?view=summary');
 await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('menuitem',{name:'Refresh project'}).click();
 await expect(page.getByRole('heading',{name:'Installation preview'})).toBeVisible();
 await page.evaluate(()=>history.pushState(null,'','?view=summary&record=site'));
 await page.getByRole('radio',{name:'Materials',exact:true}).click();
 const grid=page.getByRole('table',{name:'Task materials',exact:true});
 await expect(grid).toBeVisible();await expect(page.getByText('0 chair backed by issued materials · 0 approved',{exact:true})).toBeVisible();
 await expect(grid.getByText('4 piece / chair',{exact:true})).toBeVisible();
 for(const direction of ['ltr','rtl']){await page.evaluate(dir=>{document.documentElement.dir=dir;},direction);expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);}
 await page.getByRole('button',{name:'Edit usage basis',exact:true}).focus();await page.keyboard.press('Enter');
 await expect(page.getByRole('dialog',{name:'Material usage basis',exact:true})).toBeVisible();
 await expect(page.getByRole('textbox',{name:'Planning evidence / specification',exact:true})).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('usage-basis.png'),animations:'disabled'});
});

test('pending receipt inspection grid and keyboard action',async({page},testInfo)=>{
 const order={id:'po',number:'PO-001',title:'Boards',vendor:'Supplier',kind:'material',materialId:'m',taskId:'',quantity:5,unit:'sheet',unitCost:10,currency:'INR',promisedDate:'2026-09-25',status:'acknowledged',acknowledgement:'Confirmed',receipts:[{id:'receipt',accepted:0,rejected:0,pending:5,receivedBy:'buyer',at:'2026-09-22',evidence:'DN1'}]};
 const fixture={workspaceId:'demo-workspace',id:'demo',caseId:'demo-case',name:'Inspection preview',customer:'Preview client',memberId:'reviewer',canManage:true,canReview:true,canReport:false,canBuy:true,commercialReady:false,members:[],resources:[],bookings:[],pulse:{health:'watch',counts:{packages:0,readyPackages:0,activePackages:0,blockedPackages:0,overdueTasks:0,awaitingInspection:0},nextActions:[]},data:{revision:1,phase:'planning',tasks:[],reports:[],materials:[{id:'m',title:'Boards',specification:'Oak',required:5,unit:'sheet',supply:'company',taskId:'',movements:[]}],orders:[order],documents:[],snags:[],handovers:[],comments:[],audit:[],processed:[],budget:0,forecast:0,financeClosed:false,financeEvidence:''}};
 await page.route('**/api/projects/**',route=>route.request().method()==='GET'?route.fulfill({json:fixture}):route.fulfill({status:409,json:{message:'Receipt changed. Refresh before reviewing.'}}));
 await page.goto('/workspace/projects/demo/overview?view=summary');
 await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('menuitem',{name:'Refresh project'}).click();
 await expect(page.getByRole('heading',{name:'Inspection preview'})).toBeVisible();
 await page.evaluate(()=>history.pushState(null,'','?view=summary&record=po'));
 await page.getByRole('radio',{name:'Receipts & tracking',exact:true}).click();
 const table=page.getByRole('table').filter({has:page.getByRole('columnheader',{name:'Pending QC',exact:true})});
 await expect(table).toBeVisible();
 expect(await table.locator('tbody td').first().evaluate(node=>{const c=getComputedStyle(node);return [c.borderLeftWidth,c.borderRightWidth,c.borderTopWidth,c.borderBottomWidth];})).toEqual(['1px','1px','1px','1px']);
 for(const direction of ['ltr','rtl']){await page.evaluate(dir=>{document.documentElement.dir=dir;},direction);expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);}
 await page.evaluate(()=>{document.documentElement.dir='ltr';});
 await page.screenshot({path:testInfo.outputPath('pending-receipt.png'),animations:'disabled'});
 await page.getByRole('button',{name:'Inspect',exact:true}).focus();await page.keyboard.press('Enter');
 const dialog=page.getByRole('dialog',{name:'Inspect delivery',exact:true});
 await expect(dialog).toBeVisible();
 await expect(dialog.getByRole('textbox',{name:'Inspection evidence / findings',exact:true})).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('inspect-dialog.png'),animations:'disabled'});
});

// Read-only synthetic fixture; never activate or mutate a project for UX checks.
test("project navigation, table controls and mobile empty state", async ({ page }) => {
  await page.goto("/workspace/projects/demo/overview");
  await expect(page.getByRole("table", { name: "Project items", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Project sections" }).getByRole("link")).toHaveCount(6);
  const columns = page.getByRole("button", { name: "Manage columns" });
  await columns.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Visible columns" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(columns).toBeFocused();
  for (const direction of ["ltr", "rtl"]) {
    await page.evaluate(dir => { document.documentElement.dir = dir; }, direction);
    await expect(page.getByText("No approved items yet", { exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  }
});

test("receipt deep links select the Supply section and Receipts sub-tab", async ({ page }) => {
  await page.goto("/workspace/projects/demo/procurement?view=deliveries");
  await expect(page.getByRole("link", { name: "Supply", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("navigation", { name: "Section views" }).getByRole("link", { name: "Receipts", exact: true })).toHaveAttribute("aria-current", "page");
});

// Browser-only state: all project API traffic is intercepted; no customer data is changed.
test('item quantity editor preserves drafts and reconciles split deliveries', async ({page}, testInfo) => {
  const fixture = {
    workspaceId:'demo-workspace',id:'demo',caseId:'demo-case',name:'Quantity planning preview',customer:'Preview client',memberId:'pm',
    canManage:true,canReview:false,canReport:false,canBuy:false,commercialReady:false,members:[{id:'pm',name:'Maya'}],resources:[],bookings:[],
    pulse:{health:'watch',counts:{packages:1,readyPackages:0,activePackages:0,blockedPackages:0,overdueTasks:0,awaitingInspection:0},nextActions:[]},
    data:{revision:1,phase:'planning',scope:{quoteId:'quote',quoteNumber:1,currency:'INR',value:1000,lines:[{id:'line',title:'Wardrobes',quantity:10,unit:'nos',room:'Bedroom',material:'Oak'}]},
      workPackages:[{id:'item',title:'Wardrobes',scopeLineIds:['line'],area:'Bedroom',status:'planning',deliveryRoute:'mixed',ownerId:'',plannedStart:'',plannedEnd:'',blocker:'',createdAt:'2026-09-22',updatedAt:'2026-09-22'}],
      tasks:[],reports:[],materials:[],orders:[],documents:[],snags:[],handovers:[],comments:[],audit:[],processed:[],budget:0,forecast:0,financeClosed:false,financeEvidence:''},
  };
  await page.route('**/api/projects/**',route=>route.request().method()==='GET'?route.fulfill({json:fixture}):route.fulfill({status:409,json:{message:'Preview save conflict. Your draft is preserved.'}}));
  await page.goto('/workspace/projects/demo/overview?view=summary');
  await page.getByRole('button',{name:'More',exact:true}).click();
  await page.getByRole('menuitem',{name:'Refresh project'}).click();
  await expect(page.getByRole('heading',{name:'Quantity planning preview'})).toBeVisible();
  await page.getByRole('navigation',{name:'Section views'}).getByRole('link',{name:'Items',exact:true}).click();
  await page.getByRole('button',{name:'Actions for Wardrobes',exact:true}).focus();await page.keyboard.press('Enter');
  await page.getByRole('menuitem',{name:'Materials & procurement',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Source materials',exact:true})).toBeVisible();
  await page.getByRole('dialog',{name:'Wardrobes',exact:true}).getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'Actions for Wardrobes',exact:true}).click();
  await page.getByRole('menuitem',{name:'Quality & rework',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Quality check',exact:true})).toBeVisible();
  await page.getByRole('dialog',{name:'Wardrobes',exact:true}).getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'Wardrobes',exact:true}).click();
  await page.getByRole('button',{name:'Delivery quantities',exact:true}).click();
  await page.getByRole('button',{name:'Add delivery',exact:true}).click();
  await page.getByRole('textbox',{name:'Delivery name',exact:true}).fill('First six');
  await page.getByRole('textbox',{name:'Delivery quantity',exact:true}).fill('6');
  await page.getByRole('textbox',{name:'Allocate Wardrobes (nos)',exact:true}).fill('6');
  const apply=page.getByRole('button',{name:'Apply delivery',exact:true});
  await apply.focus();await page.keyboard.press('Enter');
  await expect(page.getByText('Wardrobes: 6 / 10 nos allocated · 4 remaining')).toBeVisible();
  await page.getByRole('button',{name:'Confirm quantities',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Delivery quantities · Wardrobes'}).getByRole('alert')).toContainText('remaining 4 nos');
  await page.getByRole('button',{name:'Add delivery',exact:true}).click();
  await page.getByRole('button',{name:'Apply delivery',exact:true}).click();
  await expect(page.getByText('Wardrobes: 10 / 10 nos allocated · 0 remaining')).toBeVisible();
  for(const direction of ['ltr','rtl']) {
    await page.evaluate(dir=>{document.documentElement.dir=dir;},direction);
    await expect(page.getByRole('button',{name:'Confirm quantities',exact:true})).toBeInViewport();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  }
  await page.screenshot({path:testInfo.outputPath('quantity-editor.png'),animations:'disabled'});
  await page.getByRole('button',{name:'Save quantities draft',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Delivery quantities · Wardrobes'}).getByRole('alert')).toContainText('Preview save conflict');
  await page.getByRole('button',{name:'Back to item',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Discard unsaved quantities?'})).toBeVisible();
  await page.getByRole('button',{name:'Keep editing'}).click();
  await expect(page.getByText('Wardrobes: 10 / 10 nos allocated · 0 remaining')).toBeVisible();
});

test('RFA queue uses complete grid lines and connects review to approval',async({page},testInfo)=>{
  const scope={id:'scope',title:'Wardrobe',quantity:1,unit:'nos',room:'Bedroom',material:'Oak'};
  const approvalDocument={id:'doc',title:'Wardrobe drawing',kind:'drawing',revision:'R1',url:'https://example.com/drawing.pdf',note:'',status:'review',replaces:'',published:false,scopeLineIds:['scope']};
  const request={id:'rfa',version:2,documentId:'doc',status:'submitted',reviewerId:'reviewer',dueDate:'2026-10-01',instructions:'Check dimensions',createdBy:'pm',createdAt:'2026-09-22',submittedBy:'pm',submittedAt:'2026-09-22',snapshot:{document:{...approvalDocument,status:'draft'},scope:[scope]},history:[]};
  const fixture={workspaceId:'demo-workspace',id:'demo',caseId:'demo-case',name:'Approval preview',customer:'Preview client',memberId:'reviewer',canManage:false,canReview:true,canReport:false,canBuy:false,commercialReady:false,members:[{id:'pm',name:'Planner'},{id:'reviewer',name:'Maya',canReview:true}],resources:[],bookings:[],pulse:{health:'watch',counts:{packages:0,readyPackages:0,activePackages:0,blockedPackages:0,overdueTasks:0,awaitingInspection:0},nextActions:[]},data:{revision:1,phase:'planning',scope:{quoteId:'q',quoteNumber:1,currency:'INR',value:100,lines:[scope]},tasks:[],reports:[],materials:[],orders:[],documents:[approvalDocument],rfas:[request],snags:[],handovers:[],comments:[],audit:[],processed:[],budget:0,forecast:0,financeClosed:false,financeEvidence:''}};
  const commands:string[]=[];
  await page.route('**/api/projects/**',async route=>{
    if(route.request().method()==='GET'){await route.fulfill({json:fixture});return;}
    const input=route.request().postDataJSON();commands.push(input.action);
    expect(input.id).toBe('rfa');expect(input.version).toBe(request.version);
    if(input.action==='rfa_review')request.status='in_review';
    else if(input.action==='rfa_decide'){expect(input.decision).toBe('approved');request.status='approved';approvalDocument.status='approved';}
    else throw new Error('Unexpected preview command');
    request.version++;fixture.data.revision++;await route.fulfill({json:{data:fixture.data}});
  });
  await page.goto('/workspace/projects/demo/overview?view=summary');await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('menuitem',{name:'Refresh project'}).click();
  await expect(page.getByRole('heading',{name:'Approval preview'})).toBeVisible();
  await page.getByRole('navigation',{name:'Section views'}).getByRole('link',{name:'Approvals',exact:true}).click();
  const table=page.getByRole('table',{name:'Project approvals',exact:true});await expect(table).toBeVisible();
  const borders=await table.evaluate(node=>{
    const cell=node.querySelector('tbody td')!;const frame=node.parentElement!;const cs=getComputedStyle(cell),fs=getComputedStyle(frame);
    return {cellDivider:parseFloat(cs.borderInlineEndWidth)+parseFloat(getComputedStyle(cell.nextElementSibling!).borderInlineStartWidth),frameLeft:fs.borderLeftWidth,frameRight:fs.borderRightWidth,frameTop:fs.borderTopWidth,frameBottom:fs.borderBottomWidth};
  });
  expect(borders).toEqual({cellDivider:1,frameLeft:'1px',frameRight:'1px',frameTop:'1px',frameBottom:'1px'});
  await page.getByRole('button',{name:'Review RFA',exact:true}).click();
  await page.getByRole('button',{name:'Start review'}).focus();await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByText('In review',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Review RFA',exact:true}).click();
  const modal=page.getByRole('dialog',{name:'RFA · Wardrobe drawing'});
  for(const direction of ['ltr','rtl']){await page.evaluate(dir=>{document.documentElement.dir=dir;},direction);await expect(modal.getByRole('button',{name:'Approve',exact:true})).toBeInViewport();expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);}
  await page.screenshot({path:testInfo.outputPath('rfa-review.png'),animations:'disabled'});
  await modal.getByRole('button',{name:'Approve',exact:true}).click();await expect(modal).toHaveCount(0);
  expect(commands).toEqual(['rfa_review','rfa_decide']);
  await page.getByRole('button',{name:/Table view/}).click();await page.getByRole('option',{name:'All requests'}).click();await expect(page.getByText('Approved',{exact:true})).toBeVisible();
});

test('global approvals refresh from canonical requests and keep full grid boundaries',async({page},testInfo)=>{
 const row={id:'demo:rfa',requestId:'rfa',projectId:'demo',projectName:'Villa',title:'Wardrobe drawing',revision:'R1',status:'submitted',ownerId:'reviewer',ownerName:'Maya',dueDate:'2026-10-01',href:'/workspace/projects/demo/overview?view=approvals&record=rfa'};
 let approved=false;
 await page.route('**/api/projects/approvals?**',route=>{const query=new URL(route.request().url()).searchParams;return route.fulfill({json:{memberId:'reviewer',canReview:true,nextCursor:null,rows:query.get('q')==='nothing'||(approved&&query.get('view')!=='all')?[]:[{...row,status:approved?'approved':'submitted'}]}});});
 await page.goto('/workspace/tasks');
 const table=page.getByRole('table',{name:'Global project approvals',exact:true});
 await expect(page.getByRole('link',{name:'Review RFA',exact:true})).toHaveAttribute('href',row.href);
 if(testInfo.project.name==='mobile')await page.getByRole('button',{name:'Open navigation'}).click();
 await expect(page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Tasks',exact:true})).toHaveAttribute('aria-current','page');
 if(testInfo.project.name==='mobile')await page.getByRole('button',{name:'Close navigation'}).click();
 await expect(page.getByRole('link',{name:'Sales tasks',exact:true})).toBeVisible();
 const borders=await table.evaluate(node=>{const frame=getComputedStyle(node.parentElement!),cell=getComputedStyle(node.querySelector('tbody td')!);return [frame.borderLeftWidth,frame.borderRightWidth,frame.borderTopWidth,frame.borderBottomWidth,cell.borderInlineEndWidth];});
 expect(borders).toEqual(['1px','1px','1px','1px','1px']);
 for(const direction of ['ltr','rtl']){await page.evaluate(dir=>{document.documentElement.dir=dir;},direction);expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);}
 await page.screenshot({path:testInfo.outputPath('global-approvals.png'),animations:'disabled'});
 approved=true;await page.getByRole('button',{name:'Refresh',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.getByText('No matching approvals',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:/Table view/}).click();await page.getByRole('option',{name:'All current requests'}).click();await expect(page.getByText('Approved',{exact:true})).toBeVisible();
 await page.getByRole('searchbox',{name:'Search projects and approvals'}).fill('nothing');await expect(page.getByText('No matching approvals',{exact:true})).toBeVisible();
});

test('frozen RFQ inspector retains scope with compact bordered tables',async({page},testInfo)=>{
 const order={id:'rfq',number:'RFQ-001',title:'Boards',vendor:'Supplier',kind:'material',materialId:'m',taskId:'',quantity:5,unit:'sheet',unitCost:0,currency:'INR',promisedDate:'2026-09-25',status:'enquiry',acknowledgement:'',receipts:[],vendorUpdates:[],rfqSnapshot:{title:'Boards',specification:'Original oak specification',workTitle:'',quantity:5,unit:'sheet'}};
 const fixture={workspaceId:'demo-workspace',id:'demo',caseId:'demo-case',name:'Supplier scope preview',customer:'Preview client',memberId:'buyer',canManage:true,canReview:true,canReport:false,canBuy:true,commercialReady:false,members:[],resources:[],bookings:[],pulse:{health:'watch',counts:{packages:0,readyPackages:0,activePackages:0,blockedPackages:0,overdueTasks:0,awaitingInspection:0},nextActions:[]},data:{revision:1,phase:'planning',tasks:[],reports:[],materials:[{id:'m',title:'Boards',specification:'Changed pine',required:5,unit:'sheet',supply:'company',taskId:'',movements:[]}],orders:[order],documents:[],snags:[],handovers:[],comments:[],audit:[],processed:[],budget:0,forecast:0,financeClosed:false,financeEvidence:''}};
 await page.route('**/api/projects/**',route=>route.fulfill({json:fixture}));
 await page.goto('/workspace/projects/demo/overview?view=summary');
 await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('menuitem',{name:'Refresh project'}).click();
 await expect(page.getByRole('heading',{name:'Supplier scope preview'})).toBeVisible();
 await page.evaluate(()=>history.pushState(null,'','?view=summary&record=rfq'));
 await expect(page.getByText('Original oak specification',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Edit request',exact:true})).toHaveCount(0);
 const table=page.getByRole('table').filter({has:page.getByRole('columnheader',{name:'Material / item',exact:true})});
 expect(await table.locator('tbody td').first().evaluate(node=>{const c=getComputedStyle(node);return [c.borderLeftWidth,c.borderRightWidth,c.borderTopWidth,c.borderBottomWidth];})).toEqual(['1px','1px','1px','1px']);
 for(const direction of ['ltr','rtl']){await page.evaluate(dir=>{document.documentElement.dir=dir;},direction);expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);}
 await page.getByRole('radio',{name:'Offers',exact:true}).focus();await page.keyboard.press('Space');
 await expect(page.getByRole('button',{name:'Record offer',exact:true})).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('frozen-rfq.png'),animations:'disabled'});
});

test('selected supplier offer history remains inspectable on draft orders',async({page},testInfo)=>{
 const order={id:'rfq',number:'RFQ-001',title:'Boards',vendor:'Supplier',kind:'material',materialId:'m',taskId:'',quantity:5,unit:'sheet',unitCost:0,currency:'INR',promisedDate:'2026-09-25',status:'draft',sourceEnquiry:'RFQ-001',selectedOffer:{offerId:'q2',selectedBy:'buyer',selectedAt:'2026-09-22',quantity:3,quotedQuantity:5,unitCost:12,promisedDate:'2026-09-25',evidence:'Q2',reason:'Split supply'},acknowledgement:'',receipts:[],vendorUpdates:[{id:'q1',at:'2026-09-20',kind:'quotation',quantity:5,unitCost:10,date:'2026-09-25',evidence:'Q1',note:''},{id:'q2',at:'2026-09-21',kind:'quotation',quantity:5,unitCost:12,date:'2026-09-25',evidence:'Q2',note:''}],rfqSnapshot:{title:'Boards',specification:'Original oak specification',workTitle:'',quantity:5,unit:'sheet'}};
 const fixture={workspaceId:'demo-workspace',id:'demo',caseId:'demo-case',name:'Supplier scope preview',customer:'Preview client',memberId:'buyer',canManage:true,canReview:true,canReport:false,canBuy:true,commercialReady:false,members:[],resources:[],bookings:[],pulse:{health:'watch',counts:{packages:0,readyPackages:0,activePackages:0,blockedPackages:0,overdueTasks:0,awaitingInspection:0},nextActions:[]},data:{revision:1,phase:'planning',tasks:[],reports:[],materials:[{id:'m',title:'Boards',specification:'Changed pine',required:5,unit:'sheet',supply:'company',taskId:'',movements:[]}],orders:[order],documents:[],snags:[],handovers:[],comments:[],audit:[],processed:[],budget:0,forecast:0,financeClosed:false,financeEvidence:''}};
 await page.route('**/api/projects/**',route=>route.fulfill({json:fixture}));
 await page.goto('/workspace/projects/demo/overview?view=summary');
 await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('menuitem',{name:'Refresh project'}).click();
 await expect(page.getByRole('heading',{name:'Supplier scope preview'})).toBeVisible();
 await page.evaluate(()=>history.pushState(null,'','?view=summary&record=rfq'));
 await expect(page.getByText('Original oak specification',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Edit request',exact:true})).toHaveCount(0);
 const table=page.getByRole('table').filter({has:page.getByRole('columnheader',{name:'Material / item',exact:true})});
 expect(await table.locator('tbody td').first().evaluate(node=>{const c=getComputedStyle(node);return [c.borderLeftWidth,c.borderRightWidth,c.borderTopWidth,c.borderBottomWidth];})).toEqual(['1px','1px','1px','1px']);
 for(const direction of ['ltr','rtl']){await page.evaluate(dir=>{document.documentElement.dir=dir;},direction);expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);}
 await page.getByRole('radio',{name:'Offers',exact:true}).focus();await page.keyboard.press('Space');
 await expect(page.getByText('Selected',{exact:true})).toBeVisible();
 await expect(page.getByText('Superseded',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Select quote',exact:true})).toHaveCount(0);
 await page.screenshot({path:testInfo.outputPath('selected-offer.png'),animations:'disabled'});
});

test('replacement RFQ inspector connects old scope and fresh request',async({page},testInfo)=>{
 const order={id:'rfq',number:'RFQ-001',title:'Boards',vendor:'Supplier',kind:'material',materialId:'m',taskId:'',quantity:5,unit:'sheet',unitCost:0,currency:'INR',promisedDate:'2026-09-25',status:'enquiry',vendorId:'supplier',replacesRequestId:'old',replacementReason:'Updated specification',acknowledgement:'',receipts:[],vendorUpdates:[],rfqSnapshot:{title:'Boards',specification:'Original oak specification',workTitle:'',quantity:5,unit:'sheet'}};
 const fixture={workspaceId:'demo-workspace',id:'demo',caseId:'demo-case',name:'Supplier scope preview',customer:'Preview client',memberId:'buyer',canManage:true,canReview:true,canReport:false,canBuy:true,commercialReady:false,members:[],resources:[],bookings:[],pulse:{health:'watch',counts:{packages:0,readyPackages:0,activePackages:0,blockedPackages:0,overdueTasks:0,awaitingInspection:0},nextActions:[]},data:{revision:1,phase:'planning',tasks:[],reports:[],materials:[{id:'m',title:'Boards',specification:'Changed pine',required:5,unit:'sheet',supply:'company',taskId:'',movements:[]}],orders:[order,{...order,id:'old',number:'RFQ-000',status:'cancelled',replacesRequestId:undefined,replacedByRequestId:'rfq',rfqSnapshot:{...order.rfqSnapshot,specification:'Previous oak specification'}}],documents:[],snags:[],handovers:[],comments:[],audit:[],processed:[],budget:0,forecast:0,financeClosed:false,financeEvidence:''}};
 await page.route('**/api/projects/**',route=>route.fulfill({json:fixture}));
 await page.goto('/workspace/projects/demo/overview?view=summary');
 await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('menuitem',{name:'Refresh project'}).click();
 await expect(page.getByRole('heading',{name:'Supplier scope preview'})).toBeVisible();
 await page.evaluate(()=>history.pushState(null,'','?view=summary&record=rfq'));
 await expect(page.getByText('Original oak specification',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Edit request',exact:true})).toHaveCount(0);
 const table=page.getByRole('table').filter({has:page.getByRole('columnheader',{name:'Material / item',exact:true})});
 expect(await table.locator('tbody td').first().evaluate(node=>{const c=getComputedStyle(node);return [c.borderLeftWidth,c.borderRightWidth,c.borderTopWidth,c.borderBottomWidth];})).toEqual(['1px','1px','1px','1px']);
 for(const direction of ['ltr','rtl']){await page.evaluate(dir=>{document.documentElement.dir=dir;},direction);expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);}
 await page.getByRole('button',{name:'RFQ-000',exact:true}).focus();await page.keyboard.press('Enter');
 await expect(page.getByText('Previous oak specification',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Replace request',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'RFQ-001',exact:true}).click();
 await expect(page.getByText('Original oak specification',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Replace request',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Replace supplier request',exact:true})).toBeVisible();
 await expect(page.getByRole('textbox',{name:'Replacement reason',exact:true})).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('replacement-rfq.png'),animations:'disabled'});
});


test('order amendment review shows cost impact and independent approval',async({page},testInfo)=>{
 const order={id:'rfq',number:'RFQ-001',title:'Boards',vendor:'Supplier',kind:'material',materialId:'m',taskId:'',quantity:5,unit:'sheet',unitCost:0,currency:'INR',promisedDate:'2026-09-25',status:'approved',amendments:[{id:'amend',status:'submitted',createdBy:'buyer',reviewerId:'reviewer',dueDate:'2026-09-24',createdAt:'2026-09-22',reason:'Supplier price revision',evidence:'Q2',before:{quantity:5,unitCost:10,promisedDate:'2026-09-25',currency:'INR'},after:{unitCost:12,promisedDate:'2026-09-28'}}],acknowledgement:'',receipts:[],vendorUpdates:[],rfqSnapshot:{title:'Boards',specification:'Original oak specification',workTitle:'',quantity:5,unit:'sheet'}};
 const fixture={workspaceId:'demo-workspace',id:'demo',caseId:'demo-case',name:'Supplier scope preview',customer:'Preview client',memberId:'reviewer',canManage:true,canReview:true,canReport:false,canBuy:true,commercialReady:false,members:[],resources:[],bookings:[],pulse:{health:'watch',counts:{packages:0,readyPackages:0,activePackages:0,blockedPackages:0,overdueTasks:0,awaitingInspection:0},nextActions:[]},data:{revision:1,phase:'planning',tasks:[],reports:[],materials:[{id:'m',title:'Boards',specification:'Changed pine',required:5,unit:'sheet',supply:'company',taskId:'',movements:[]}],orders:[order],documents:[],snags:[],handovers:[],comments:[],audit:[],processed:[],budget:0,forecast:0,financeClosed:false,financeEvidence:''}};
 await page.route('**/api/projects/**',route=>route.fulfill({json:fixture}));
 await page.goto('/workspace/projects/demo/overview?view=summary');
 await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('menuitem',{name:'Refresh project'}).click();
 await expect(page.getByRole('heading',{name:'Supplier scope preview'})).toBeVisible();
 await page.evaluate(()=>history.pushState(null,'','?view=summary&record=rfq'));
 await expect(page.getByText('Original oak specification',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Edit request',exact:true})).toHaveCount(0);
 const table=page.getByRole('table').filter({has:page.getByRole('columnheader',{name:'Material / item',exact:true})});
 expect(await table.locator('tbody td').first().evaluate(node=>{const c=getComputedStyle(node);return [c.borderLeftWidth,c.borderRightWidth,c.borderTopWidth,c.borderBottomWidth];})).toEqual(['1px','1px','1px','1px']);
 for(const direction of ['ltr','rtl']){await page.evaluate(dir=>{document.documentElement.dir=dir;},direction);expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);}
 await page.evaluate(()=>history.pushState(null,'','?view=summary&record=rfq&amendment=amend'));
 await expect(page.getByRole('button',{name:'All amendments',exact:true})).toBeVisible();
 await expect(page.getByRole('table',{name:'Order amendment history'})).toBeVisible();
 await expect(page.getByRole('cell',{name:'Supplier price revision Q2',exact:true})).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('amendment-table.png'),animations:'disabled'});
 await page.getByRole('button',{name:'Approve amendment',exact:true}).focus();await page.keyboard.press('Enter');
 await expect(page.getByRole('dialog',{name:'Approve amendment',exact:true})).toBeVisible();
 await expect(page.getByRole('textbox',{name:'Decision reason',exact:true})).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('order-amendment.png'),animations:'disabled'});
 await page.getByRole('dialog',{name:'Approve amendment',exact:true}).getByRole('button',{name:'Cancel',exact:true}).click();
 await page.getByRole('button',{name:'Reassign reviewer',exact:true}).focus();await page.keyboard.press('Enter');
 await expect(page.getByRole('dialog',{name:'Reassign amendment review',exact:true})).toBeVisible();
 await expect(page.getByRole('textbox',{name:'Reassignment reason',exact:true})).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('reassign-reviewer.png'),animations:'disabled'});
});

test('global amendments show assigned review links',async({page})=>{
 const row={kind:'order_amendment',id:'demo:amendment:amend',requestId:'amendment:amend',projectId:'demo',projectName:'Villa',title:'PO-1 · Boards',revision:'Amendment',status:'submitted',ownerId:'reviewer',ownerName:'Maya',dueDate:'2026-09-24',href:'/workspace/projects/demo/procurement?record=rfq&amendment=amend'};
 await page.route('**/api/projects/approvals?**',route=>route.fulfill({json:{memberId:'reviewer',canReview:true,nextCursor:null,rows:[row]}}));
 await page.goto('/workspace/tasks');
 await expect(page.getByRole('link',{name:'Review amendment',exact:true})).toHaveAttribute('href',row.href);
 await expect(page.getByRole('cell',{name:'Order amendment',exact:true})).toBeVisible();
 for(const direction of ['ltr','rtl']){await page.evaluate(dir=>{document.documentElement.dir=dir;},direction);expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);}
});
