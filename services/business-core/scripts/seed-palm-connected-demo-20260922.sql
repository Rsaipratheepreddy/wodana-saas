-- Additive Palm Living demonstration fixture. The two PNGs referenced here must
-- be installed in workspace-assets before this transaction is applied.
-- Concept renders and technical schematics are explicitly NOT construction evidence.
\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.demo_upsert(items jsonb, item jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT COALESCE((SELECT jsonb_agg(value ORDER BY ord) FROM jsonb_array_elements(COALESCE(items,'[]'::jsonb)) WITH ORDINALITY AS x(value,ord)
    WHERE value->>'id' <> item->>'id'),'[]'::jsonb) || jsonb_build_array(item)
$$;
CREATE FUNCTION pg_temp.demo_patch(items jsonb, target_id text, patch jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT COALESCE((SELECT jsonb_agg(CASE WHEN value->>'id'=target_id THEN value||patch ELSE value END ORDER BY ord)
    FROM jsonb_array_elements(COALESCE(items,'[]'::jsonb)) WITH ORDINALITY AS x(value,ord)),'[]'::jsonb)
$$;

DO $$
DECLARE
  w uuid := 'af041cf6-6bd5-4db1-932a-b145bda49d0c';
  c uuid := '77777777-7777-4777-8777-777777777703';
  p uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01';
  owner_user uuid := '5bd936d8-d0d1-4354-9637-4d78964fc719';
  owner_member uuid := 'f084de8a-dcb2-441c-a14d-8c8d84954280';
  site_member uuid := '320d3db3-1f6a-441f-8963-2727c102932a';
  d jsonb;
  row_revision integer;
  demo_batch_uuid uuid := '7ba00000-0000-4000-8000-000000000001';
  factory_task jsonb;
  scope_line jsonb;
  drawing jsonb;
  snapshot jsonb;
  batch jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM workspaces WHERE id=w AND slug='plm') THEN RAISE EXCEPTION 'Palm workspace changed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM delivery_projects WHERE id=p AND workspace_id=w AND case_id=c) THEN RAISE EXCEPTION 'Palm demo project changed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM workspace_memberships WHERE id=owner_member AND workspace_id=w AND status='active') THEN RAISE EXCEPTION 'Palm owner membership missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM crm_leads WHERE id='55555555-5555-4555-8555-555555555503' AND enquiry_id='44444444-4444-4444-8444-444444444403' AND party_id='22222222-2222-4222-8222-222222222203' AND workspace_id=w) THEN RAISE EXCEPTION 'Demo enquiry/lead link changed'; END IF;
  IF EXISTS (SELECT 1 FROM crm_opportunities WHERE id='66666666-6666-4666-8666-666666666603' AND lead_id IS NOT NULL AND lead_id<>'55555555-5555-4555-8555-555555555503') THEN RAISE EXCEPTION 'Demo opportunity belongs to another lead'; END IF;
  IF EXISTS (SELECT 1 FROM pre_project_brief_assets WHERE id='7e000000-0000-4000-8000-000000000005' AND sha256<>'7cf896d4fcb8d9ab16a77c3c66f2277bbf3f448fa53f4dff2306ef89a3959b5a') OR
     EXISTS (SELECT 1 FROM pre_project_brief_assets WHERE id='7e000000-0000-4000-8000-000000000006' AND sha256<>'9f57bbc6c40d9838042925c7c61bd05670a962505e6e38d34e16dbab0e6bd0b4') THEN
    RAISE EXCEPTION 'A demo concept asset ID already has different content';
  END IF;
  SELECT content,revision INTO d,row_revision FROM project_execution WHERE project_id=p AND workspace_id=w FOR UPDATE;
  IF d IS NULL OR d->'scope'->>'quoteId'<>'d2596719-0304-4624-bca0-5254cc1547c1' THEN RAISE EXCEPTION 'Released Palm scope changed'; END IF;
  -- Legacy demo data predated the conversion-integrity columns. Record only
  -- what can be derived now: no qualification form/answers were configured.
  -- This is an import link, NOT a claim that a client completed a form.
  -- The existing lead remains "connected". Its state constraint correctly
  -- forbids claiming it was qualified; provenance is stored only on the
  -- imported opportunity, with an empty/no-form evidence snapshot.
  UPDATE crm_opportunities SET lead_id='55555555-5555-4555-8555-555555555503',
    conversion_origin='legacy',conversion_request_hash='6ff1776d89fffb912dfa76c1adacd994193c69de7a639cc47d1df5f1ff017b70',
    qualification_evidence='{"version":1,"leadId":"55555555-5555-4555-8555-555555555503","serviceType":"turnkey_fitout","selection":"none","form":null,"answers":[],"requiredKeys":[],"evaluatedAt":"2026-09-22T09:20:00.000Z"}'::jsonb,
    qualification_evidence_hash='67e53426eab21ec8ac4ec1c39c77f6ca99ee498b0f259db96183d60c502797de',
    converted_at=created_at,version=version+1,updated_at=now()
  WHERE id='66666666-6666-4666-8666-666666666603' AND workspace_id=w AND lead_id IS NULL;

  -- Draft concept renders: useful visual references, never approved drawings or site photos.
  INSERT INTO pre_project_design_folders(id,workspace_id,case_id,name,description,created_by)
  VALUES('7c000000-0000-4000-8000-000000000004',w,c,'DEMO CONCEPT STUDIES · Not approved','Generated visual studies for presentation only; dimensions and final finishes require review.',owner_user)
  ON CONFLICT(id) DO NOTHING;
  INSERT INTO pre_project_brief_assets(id,workspace_id,case_id,original_name,mime_type,byte_size,object_key,preview_key,sha256,created_by)
  VALUES
   ('7e000000-0000-4000-8000-000000000005',w,c,'DEMO CONCEPT · Living room oak feature wall.png','image/png',2873669,
    'pre-projects/af041cf6-6bd5-4db1-932a-b145bda49d0c/77777777-7777-4777-8777-777777777703/7e000000-0000-4000-8000-000000000005/original',NULL,'7cf896d4fcb8d9ab16a77c3c66f2277bbf3f448fa53f4dff2306ef89a3959b5a',owner_user),
   ('7e000000-0000-4000-8000-000000000006',w,c,'DEMO CONCEPT · Primary suite dressing room.png','image/png',2753062,
    'pre-projects/af041cf6-6bd5-4db1-932a-b145bda49d0c/77777777-7777-4777-8777-777777777703/7e000000-0000-4000-8000-000000000006/original',NULL,'9f57bbc6c40d9838042925c7c61bd05670a962505e6e38d34e16dbab0e6bd0b4',owner_user)
  ON CONFLICT(id) DO NOTHING;
  INSERT INTO pre_project_designs(id,workspace_id,case_id,room_id,scope_entry_id,title,document_type,description,folder_id,created_by)
  VALUES
   ('7d000000-0000-4000-8000-000000000006',w,c,'7a000000-0000-4000-8000-000000000007','7b000000-0000-4000-8000-000000000008','DEMO CONCEPT · Living room oak feature wall','Concept / mood board','AI-generated concept visual for discussion only. Not a measured drawing, client approval, or construction record.','7c000000-0000-4000-8000-000000000004',owner_user),
   ('7d000000-0000-4000-8000-000000000007',w,c,'7a000000-0000-4000-8000-000000000008','7b000000-0000-4000-8000-000000000009','DEMO CONCEPT · Primary suite dressing room','Concept / mood board','AI-generated concept visual for discussion only. Not a measured drawing, client approval, or construction record.','7c000000-0000-4000-8000-000000000004',owner_user)
  ON CONFLICT(id) DO NOTHING;
  INSERT INTO pre_project_design_versions(id,workspace_id,case_id,design_id,number,asset_id,note,status,created_by)
  VALUES
   ('7f000000-0000-4000-8000-000000000005',w,c,'7d000000-0000-4000-8000-000000000006',1,'7e000000-0000-4000-8000-000000000005','Generated conceptual visual. Review against approved scope before any use.','draft',owner_user),
   ('7f000000-0000-4000-8000-000000000006',w,c,'7d000000-0000-4000-8000-000000000007',1,'7e000000-0000-4000-8000-000000000006','Generated conceptual visual. Review against approved scope before any use.','draft',owner_user)
  ON CONFLICT(id) DO NOTHING;

  d := jsonb_set(d,'{documents}',pg_temp.demo_upsert(d->'documents',jsonb_build_object(
   'id','75000000-0000-4000-8000-000000000003','title','DEMO SCHEMATIC · Living media wall coordination','kind','drawing','revision','C01','url','/palm-demo/drawings/living-media-wall-coordination.svg','note','Not to scale; concept coordination only. 6 mm shadow gap is design intent pending field verification.','status','draft','replaces','','published',false,'scopeLineIds',jsonb_build_array('8c6c57fd-3af9-4708-aa64-2e9be606821b'))));
  d := jsonb_set(d,'{documents}',pg_temp.demo_upsert(d->'documents',jsonb_build_object(
   'id','75000000-0000-4000-8000-000000000004','title','DEMO SCHEMATIC · Walk-in wardrobe coordination','kind','drawing','revision','C01','url','/palm-demo/drawings/walk-in-wardrobe-coordination.svg','note','Not to scale; concept coordination only. Verify all dimensions onsite.','status','draft','replaces','','published',false,'scopeLineIds',jsonb_build_array('f3355072-735e-4070-af77-514b11a0c5f9'))));
  d := jsonb_set(d,'{documents}',pg_temp.demo_upsert(d->'documents',jsonb_build_object(
   'id','75000000-0000-4000-8000-000000000005','title','DEMO SCHEMATIC · Guest bedroom storage coordination','kind','drawing','revision','C01','url','/palm-demo/drawings/guest-bedroom-storage-coordination.svg','note','Not to scale; concept coordination only. Verify all dimensions onsite.','status','draft','replaces','','published',false,'scopeLineIds',jsonb_build_array('123a3e75-8acc-4d48-bf32-330254059803'))));
  d := jsonb_set(d,'{documents}',pg_temp.demo_upsert(d->'documents',jsonb_build_object(
   'id','75000000-0000-4000-8000-000000000006','title','DEMO FLOW · Factory → QC → dispatch → site','kind','other','revision','C01','url','/palm-demo/drawings/factory-to-site-qa-flow.svg','note','Illustrative workflow diagram; not an operational record.','status','draft','replaces','','published',false,'scopeLineIds',jsonb_build_array('8c6c57fd-3af9-4708-aa64-2e9be606821b','f3355072-735e-4070-af77-514b11a0c5f9','123a3e75-8acc-4d48-bf32-330254059803'))));

  -- Preserve current approved progress; add explicit quality checkpoints and a site task.
  d := jsonb_set(d,'{tasks}',pg_temp.demo_patch(d->'tasks','72000000-0000-4000-8000-000000000001',jsonb_build_object('inspections',jsonb_build_array(jsonb_build_object('id','7ba10000-0000-4000-8000-000000000001','by',owner_member,'at','2026-09-18T15:00:00+04:00','passed',true,'quantity',48,'unit','m²','evidence','DEMO QC RECORD · Veneer direction, panel alignment and edge finish checked; see linked factory progress.')))));
  d := jsonb_set(d,'{tasks}',pg_temp.demo_patch(d->'tasks','72000000-0000-4000-8000-000000000002',jsonb_build_object('inspections',jsonb_build_array(jsonb_build_object('id','7ba10000-0000-4000-8000-000000000002','by',owner_member,'at','2026-09-20T16:00:00+04:00','passed',true,'quantity',20,'unit','m²','evidence','DEMO QC RECORD · 20 of 32 m² accepted for in-process fabrication; final QC pending.')))));
  d := jsonb_set(d,'{tasks}',pg_temp.demo_patch(d->'tasks','72000000-0000-4000-8000-000000000003',jsonb_build_object('inspections',jsonb_build_array(jsonb_build_object('id','7ba10000-0000-4000-8000-000000000003','by',site_member,'at','2026-09-19T16:00:00+04:00','passed',true,'quantity',16,'unit','m²','evidence','DEMO QC RECORD · Door alignment, drawers and finish protection checked; see linked site photo.')))));
  d := jsonb_set(d,'{tasks}',pg_temp.demo_upsert(d->'tasks',jsonb_build_object(
   'id','72000000-0000-4000-8000-000000000005','parentId','','packageId','74000000-0000-4000-8000-000000000001','package','Living room wall panelling','title','Site · Install living room veneer wall panels','description','Receive inspected panels, protect finishes, set out, fix panels and coordinate concealed lighting; demo progress only.','area','Living room','location','site','ownerId',site_member,'assigneeIds',jsonb_build_array(site_member),'resourceId','73100000-0000-4000-8000-000000000002','start','2026-09-21','end','2026-09-27','baselineStart','2026-09-21','baselineEnd','2026-09-27','predecessors',jsonb_build_array('72000000-0000-4000-8000-000000000001'),'quantity',48,'unit','m²','weight',1,'approved',12,'status','in_progress','priority','high','inspectionRequired',true,'scopeIds',jsonb_build_array('8c6c57fd-3af9-4708-aa64-2e9be606821b'),'drawingId','75000000-0000-4000-8000-000000000001','readiness',jsonb_build_object('scope',true,'access',true,'materials',true),'blocker','')));
  d := jsonb_set(d,'{reports}',pg_temp.demo_upsert(d->'reports',jsonb_build_object(
   'id','71000000-0000-4000-8000-000000000004','date','2026-09-21','shift','Day shift · 08:00–17:00','location','site','authorId',site_member,'author','Palm Living Demo Operations','status','approved','entries',jsonb_build_array(jsonb_build_object('taskId','72000000-0000-4000-8000-000000000005','quantity',12)),'hours',8,'people',4,'materials','Demo: pre-inspected veneer panels, protected fixings and LED channel materials.','issues','Concealed LED final energisation remains pending.','tomorrow','Continue panels; inspect shadow gaps and test lighting after electrical clearance.','evidence','DEMO SITE UPDATE · First 12 of 48 m² installed; no new image is represented as site evidence.','note','Illustrative progress entry linked to released BOQ and factory dispatch.','summary','DEMO SITE UPDATE · Living wall installation started (12/48 m²)','weather','Indoor work','safety','Work area protected; no incident reported in this sample entry.','safetyStatus','none','scheduleImpact','none','workforce',jsonb_build_array(jsonb_build_object('trade','Joinery installers','people',4,'hours',8)),'reviewedBy',owner_member,'reviewedAt','2026-09-21T16:15:00+04:00')));
  d := jsonb_set(d,'{snags}',pg_temp.demo_patch(d->'snags','536a6010-c7fb-4cd0-8b4a-a87b695c7255',jsonb_build_object('taskId','72000000-0000-4000-8000-000000000004','ownerId',site_member,'dueDate','2026-09-25','evidence','DEMO OPEN ISSUE · Top drawer front needs final alignment after installation.','status','open')));
  d := jsonb_set(d,'{snags}',pg_temp.demo_upsert(d->'snags',jsonb_build_object('id','7ba20000-0000-4000-8000-000000000001','title','Living wall LED channel cover alignment','taskId','72000000-0000-4000-8000-000000000005','area','Living room','ownerId',site_member,'severity','minor','dueDate','2026-09-24','status','open','evidence','DEMO OPEN ISSUE · Check the cover alignment at the next site inspection.','resolution','')));
  d := jsonb_set(d,'{designBaseline}',jsonb_set(COALESCE(d->'designBaseline','{}'::jsonb),'{conceptStudies}',jsonb_build_array(jsonb_build_object('designId','7d000000-0000-4000-8000-000000000006','assetId','7e000000-0000-4000-8000-000000000005','status','draft','label','AI-generated concept; not approved'),jsonb_build_object('designId','7d000000-0000-4000-8000-000000000007','assetId','7e000000-0000-4000-8000-000000000006','status','draft','label','AI-generated concept; not approved')),true));
  d := jsonb_set(d,'{revision}',to_jsonb(GREATEST(COALESCE((d->>'revision')::integer,0),row_revision)+1));
  UPDATE project_execution SET content=d,revision=(d->>'revision')::integer,updated_at=now() WHERE project_id=p AND workspace_id=w;

  -- Shared factory board. The live migration creates these two tables; missing
  -- tables are a hard failure so we never silently claim a batch was seeded.
  IF to_regclass('public.project_factory_batches') IS NULL OR to_regclass('public.project_factory_allocations') IS NULL THEN
    RAISE EXCEPTION 'Apply project factory migration 0113 before seed';
  END IF;
  SELECT value INTO factory_task FROM jsonb_array_elements(d->'tasks') value WHERE value->>'id'='72000000-0000-4000-8000-000000000002';
  SELECT value INTO scope_line FROM jsonb_array_elements(d->'scope'->'lines') value WHERE value->>'id'='f3355072-735e-4070-af77-514b11a0c5f9';
  SELECT value INTO drawing FROM jsonb_array_elements(d->'documents') value WHERE value->>'id'=factory_task->>'drawingId';
  IF factory_task IS NULL OR scope_line IS NULL OR drawing IS NULL OR factory_task->>'location'<>'factory' OR factory_task->>'resourceId'<>'73100000-0000-4000-8000-000000000001' THEN
    RAISE EXCEPTION 'Factory task, BOQ line, or approved drawing is missing or changed';
  END IF;
  snapshot := jsonb_build_object('taskId',factory_task->>'id','title',factory_task->>'title','area',factory_task->>'area','packageId',factory_task->>'packageId','quantity',factory_task->'quantity','unit',factory_task->>'unit','resourceId',factory_task->>'resourceId','ownerId',factory_task->>'ownerId','start',factory_task->>'start','end',factory_task->>'end','drawingId',factory_task->>'drawingId','scopeIds',factory_task->'scopeIds','scope',jsonb_build_array(scope_line),'drawing',drawing);
  batch := jsonb_build_object('id',demo_batch_uuid,'name','DEMO BATCH · Primary suite walk-in wardrobe','operation','Carcass assembly and veneer finish','compatibility','One Palm project task; linked to approved BOQ and original production drawing.','resourceId','73100000-0000-4000-8000-000000000001','resourceName','Palm Living Joinery Factory','ownerId',owner_member,'ownerName','Palm Living Demo','start',factory_task->>'start','end',factory_task->>'end','createdBy',owner_member,'createdAt','2026-09-18T08:00:00+04:00');
  INSERT INTO project_factory_batches(id,workspace_id,resource_id,owner_id,content) VALUES(demo_batch_uuid,w,'73100000-0000-4000-8000-000000000001',owner_member,batch)
  ON CONFLICT(id) DO UPDATE SET content=EXCLUDED.content;
  INSERT INTO project_factory_allocations(workspace_id,batch_id,project_id,task_id,snapshot,active)
  VALUES(w,demo_batch_uuid,p,factory_task->>'id',jsonb_build_object('projectId',p,'projectName','DEMO FLOW · Palm Villa — Design to Delivery','revision',(d->>'revision')::integer,'snapshot',snapshot),true)
  ON CONFLICT(workspace_id,batch_id,project_id,task_id) DO UPDATE SET snapshot=EXCLUDED.snapshot,active=true;

  -- Internal-only sample conversation. No WhatsApp/QuickBooks provider IDs,
  -- outbound deliveries, or fabricated external acknowledgements are created.
  INSERT INTO crm_conversations(id,workspace_id,party_id,channel,subject,status,owner_membership_id,last_message_at)
  VALUES('7ba30000-0000-4000-8000-000000000001',w,'22222222-2222-4222-8222-222222222203','internal','DEMO INTERNAL NOTES · Palm Villa delivery','open',owner_member,'2026-09-22T10:30:00+04:00')
  ON CONFLICT(id) DO UPDATE SET subject=EXCLUDED.subject,last_message_at=EXCLUDED.last_message_at;
  INSERT INTO crm_messages(id,workspace_id,conversation_id,direction,status,sender_type,sender_id,body_text,metadata,authorship,created_at,sent_at)
  VALUES
   ('7ba30000-0000-4000-8000-000000000011',w,'7ba30000-0000-4000-8000-000000000001','internal','sent','system',NULL,'DEMO INTERNAL NOTE · Lead brief confirmed: living wall, primary wardrobe and guest storage are linked to the released quotation and project.',jsonb_build_object('demo',true,'caseId',c,'projectId',p,'source','seed'), 'automation','2026-09-21T10:15:00+04:00','2026-09-21T10:15:00+04:00'),
   ('7ba30000-0000-4000-8000-000000000012',w,'7ba30000-0000-4000-8000-000000000001','internal','sent','system',NULL,'DEMO INTERNAL NOTE · Factory batch is in progress; 20/32 m² of the primary wardrobe passed the sample in-process QC checkpoint. Final inspection and dispatch remain open.',jsonb_build_object('demo',true,'caseId',c,'projectId',p,'source','seed'), 'automation','2026-09-22T09:00:00+04:00','2026-09-22T09:00:00+04:00'),
   ('7ba30000-0000-4000-8000-000000000013',w,'7ba30000-0000-4000-8000-000000000001','internal','sent','system',NULL,'DEMO INTERNAL NOTE · Site installation and two open QC items are visible in the project. No external message has been sent from this demo conversation.',jsonb_build_object('demo',true,'caseId',c,'projectId',p,'source','seed'), 'automation','2026-09-22T10:30:00+04:00','2026-09-22T10:30:00+04:00')
  ON CONFLICT(id) DO NOTHING;
END $$;

-- Evidence of all links in the transaction; a failed assertion rolls back all rows.
DO $$ BEGIN
 IF (SELECT count(*) FROM pre_project_design_versions WHERE case_id='77777777-7777-4777-8777-777777777703' AND id IN ('7f000000-0000-4000-8000-000000000005','7f000000-0000-4000-8000-000000000006')) <> 2 THEN RAISE EXCEPTION 'Concept versions missing'; END IF;
 IF NOT EXISTS (SELECT 1 FROM crm_enquiries e JOIN crm_leads l ON l.enquiry_id=e.id AND l.workspace_id=e.workspace_id JOIN crm_opportunities o ON o.lead_id=l.id AND o.workspace_id=l.workspace_id JOIN pre_project_cases c ON c.opportunity_id=o.id AND c.workspace_id=o.workspace_id JOIN delivery_projects p ON p.case_id=c.id AND p.workspace_id=c.workspace_id WHERE p.id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01' AND e.id='44444444-4444-4444-8444-444444444403') THEN RAISE EXCEPTION 'Sales-to-project relationship incomplete'; END IF;
 IF (SELECT count(*) FROM project_factory_allocations WHERE project_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01' AND batch_id='7ba00000-0000-4000-8000-000000000001') <> 1 THEN RAISE EXCEPTION 'Factory allocation missing'; END IF;
 IF (SELECT count(*) FROM crm_messages WHERE conversation_id='7ba30000-0000-4000-8000-000000000001') <> 3 THEN RAISE EXCEPTION 'Internal demo messages missing'; END IF;
 IF (SELECT count(*) FROM project_execution p CROSS JOIN LATERAL jsonb_array_elements(p.content->'documents') d WHERE p.project_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01' AND d->>'id' IN ('75000000-0000-4000-8000-000000000003','75000000-0000-4000-8000-000000000004','75000000-0000-4000-8000-000000000005','75000000-0000-4000-8000-000000000006')) <> 4 THEN RAISE EXCEPTION 'Technical documents missing'; END IF;
 IF (SELECT count(*) FROM project_execution p CROSS JOIN LATERAL jsonb_array_elements(p.content->'tasks') t WHERE p.project_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01' AND t->>'id'='72000000-0000-4000-8000-000000000005') <> 1 THEN RAISE EXCEPTION 'Site task missing'; END IF;
 IF (SELECT count(*) FROM project_execution p CROSS JOIN LATERAL jsonb_array_elements(p.content->'reports') r WHERE p.project_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01' AND r->>'id'='71000000-0000-4000-8000-000000000004') <> 1 THEN RAISE EXCEPTION 'Daily report missing'; END IF;
 IF EXISTS (SELECT 1 FROM project_execution p CROSS JOIN LATERAL jsonb_array_elements(p.content->'snags') s WHERE p.project_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p.content->'tasks') t WHERE t->>'id'=s->>'taskId')) THEN RAISE EXCEPTION 'An issue references a missing task'; END IF;
END $$;
COMMIT;
