import { describe, expect, it } from "vitest";
import { applyExecution, emptyProject, type ExecutionActor } from "./execution.domain";
import {
  addHandoverOutstandingItem,
  assertHandoverPacketCurrent,
  createAutomaticHandover,
  decideHandoverFromPortal,
  refreshHandoverPacket,
} from "./project-handover";
import type { ProjectData, Task } from "./execution.types";

const now = "2026-09-16T09:00:00.000Z";

function completedTask(): Task {
  return {
    id: "site-task",
    parentId: "",
    packageId: "package-bedroom",
    package: "Master bedroom",
    title: "Install master-bedroom joinery",
    description: "",
    area: "Master bedroom",
    location: "site",
    ownerId: "site-owner",
    assigneeIds: [],
    resourceId: "",
    start: "2026-09-01",
    end: "2026-09-10",
    baselineStart: "2026-09-01",
    baselineEnd: "2026-09-10",
    predecessors: [],
    quantity: 1,
    unit: "room",
    weight: 1,
    approved: 1,
    status: "completed",
    priority: "normal",
    inspectionRequired: true,
    scopeIds: ["scope-bedroom"],
    drawingId: "as-built-bedroom",
    readiness: { scope: true, access: true, materials: true },
    blocker: "",
  };
}

function project(): ProjectData {
  const data = emptyProject();
  data.phase = "active";
  data.scope = {
    quoteId: "quote",
    quoteNumber: 1,
    currency: "AED",
    value: 100,
    lines: [
      {
        id: "scope-bedroom",
        title: "Master bedroom joinery",
        room: "Master bedroom",
        material: "",
        quantity: 1,
        unit: "room",
      },
    ],
  };
  data.workPackages = [{
    id: "package-bedroom",
    scopeLineIds: ["scope-bedroom"],
    title: "Master bedroom joinery",
    area: "Master bedroom",
    deliveryRoute: "mixed",
    status: "completed",
    ownerId: "site-owner",
    plannedStart: "2026-09-01",
    plannedEnd: "2026-09-10",
    blocker: "",
    createdAt: now,
    updatedAt: now,
  }];
  data.tasks = [completedTask()];
  data.documents = [{
    id: "as-built-bedroom",
    title: "Master bedroom as-built",
    kind: "as_built",
    revision: "R01",
    url: "https://files.example/as-built-bedroom.pdf",
    note: "",
    status: "approved",
    replaces: "",
    published: true,
    scopeLineIds: ["scope-bedroom"],
  }];
  return data;
}

function prepared(data: ProjectData) {
  const handover = createAutomaticHandover(data, {
    id: "handover-bedroom",
    sourcePackageId: "package-bedroom",
    warrantyUntil: "2027-09-16",
    clientReviewDueDate: "2026-09-18",
  });
  data.handovers.push(handover);
  refreshHandoverPacket(data, handover, "project-manager", now);
  handover.clientApproverId = "client-approver";
  handover.status = "ready";
  handover.published = true;
  return handover;
}

describe("automatic area acceptance packs", () => {
  it("uses accepted factory output for installation without duplicating its raw-material purchase", () => {
    const data = project();
    data.scope!.lines[0].material = "Oak veneer";
    const factory = { ...completedTask(), id: "factory-task", title: "Make master-bedroom joinery",
      location: "factory" as const, ownerId: "factory-owner", predecessors: [] };
    data.tasks[0].predecessors = [factory.id];
    data.tasks.unshift(factory);
    data.materials = [{
      id: "oak", title: "Oak veneer", specification: "Approved finish", catalogId: "", catalogVersion: 0,
      unit: "room", required: 1, supply: "company", taskId: factory.id,
      scopeLineId: "scope-bedroom", needBy: "2026-09-01",
      movements: [{ id: "receipt", kind: "receive", quantity: 1, reference: "Inspected GRN", at: now }],
    }];
    data.dispatches = [{
      id: "delivery", title: "Joinery to site", taskId: factory.id, receivingTaskId: "site-task",
      destination: "Master bedroom", quantity: 1, unit: "room", dueDate: "2026-09-10",
      carrier: "Crew", reference: "DN-1", status: "received", preparedBy: "factory-owner",
      accepted: 1, rejected: 0, receiptEvidence: "Signed site receipt", receivedBy: "site-owner",
    }];
    expect(() => prepared(data)).not.toThrow();
    data.dispatches[0].accepted = 0;
    expect(() => assertHandoverPacketCurrent(data, data.handovers[0])).toThrow(/material planning and procurement evidence/);
  });
  it("hands over distinct inspected batches from one unfinished task without duplicate acceptance",()=>{
    const data=project(),task=data.tasks[0];task.quantity=10;task.approved=4;task.status='in_progress';
    data.reports=[{id:'progress',date:'2026-09-16',shift:'Day',location:'site',authorId:'site-owner',author:'Installer',status:'approved',entries:[{taskId:task.id,quantity:4}],hours:2,people:1,materials:'',issues:'',tomorrow:'',evidence:'Site photos',note:''}];
    const planner:ExecutionActor={id:'pm',name:'Planner',manage:true,review:true,report:true,buy:true,memberIds:['pm','qc','site-owner'],resourceIds:[],released:true,now};
    const qc={...planner,id:'qc'};
    applyExecution(data,'installation_batch',{id:task.id,title:'First two',quantity:2},planner);
    applyExecution(data,'installation_batch',{id:task.id,title:'Next two',quantity:2},planner);
    const [first,second]=task.installationBatches!;
    expect(()=>applyExecution(data,'installation_batch',{id:task.id,title:'Excess',quantity:1},planner)).toThrow('approved installed output');
    expect(()=>applyExecution(data,'installation_batch_review',{id:task.id,batchId:first.id,passed:true,note:'QC'},planner)).toThrow('Another reviewer');
    applyExecution(data,'installation_batch_review',{id:task.id,batchId:first.id,passed:true,note:'QC passed'},qc);
    applyExecution(data,'installation_batch_review',{id:task.id,batchId:second.id,passed:false,note:'Adjust hinges'},qc);
    const create=(id:string,batchId:string)=>applyExecution(data,'handover',{handover:{id,sourcePackageId:'package-bedroom',installationBatchIds:[batchId]}},planner);
    expect(()=>create('bad',second.id)).toThrow('passed installation');
    create('first',first.id);applyExecution(data,'handover_status',{id:'first',status:'ready',confirmed:true},planner);
    expect(data.handovers[0].packet?.tasks[0].quantity).toBe(2);expect(data.phase).toBe('active');
    applyExecution(data,'handover_status',{id:'first',status:'accepted',signedRecord:true,acceptedBy:'Client',note:'Signed first two'},planner);
    create('duplicate',first.id);expect(()=>applyExecution(data,'handover_status',{id:'duplicate',status:'ready',confirmed:true},planner)).toThrow('already included');
    applyExecution(data,'installation_batch_review',{id:task.id,batchId:second.id,passed:true,note:'Correction verified'},qc);
    expect(second.reviews).toHaveLength(2);
    create('second',second.id);applyExecution(data,'handover_status',{id:'second',status:'ready',confirmed:true,clientApproverId:'client'},planner);
    decideHandoverFromPortal(data,{handoverId:'second',grantId:'client',grantName:'Client',decision:'accept',note:'',challengeId:'batch-two',now});
    expect(data.handovers.find(h=>h.id==='second')?.status).toBe('accepted');expect(task.status).toBe('in_progress');expect(task.approved).toBe(4);
    data.handovers=data.handovers.filter(h=>h.id!=='duplicate');
    expect(()=>applyExecution(data,'commercial',{budget:100,forecast:100,financeClosed:true,note:'Final account',financeEvidence:'Reconciled'},planner)).toThrow('remaining work');
    applyExecution(data,'report_submit',{report:{...data.reports[0],id:'correction',supersedes:'progress',entries:[{taskId:task.id,quantity:1}]}},{...planner,id:'site-owner'});
    expect(()=>applyExecution(data,'approve_report',{id:'correction'},qc)).toThrow('reducing installed output');
    expect(data.reports.find(r=>r.id==='correction')?.status).toBe('submitted');
    expect(()=>applyExecution(data,'installation_batch_cancel',{id:task.id,batchId:first.id,note:'Undo'},planner)).toThrow('current batch');
    expect(()=>applyExecution(data,'inspect',{id:task.id,passed:true,note:'Whole task'},qc)).toThrow('individually');
  });
  it("rejects stale units in authenticated portal acceptance",()=>{
    const data=project(),handover=prepared(data);data.tasks[0].unit='set';
    expect(()=>decideHandoverFromPortal(data,{handoverId:handover.id,grantId:'client-approver',grantName:'Client',decision:'accept',note:'',challengeId:'challenge',now})).toThrow('quantity, unit');
    expect(handover.status).toBe('ready');
  });
  it("reserves ready/accepted task scope across overlapping packs without mutating a failed candidate",()=>{
    const data=project(),first=prepared(data);
    const other=createAutomaticHandover(data,{id:'other',area:first.area});data.handovers.push(other);
    const before=JSON.stringify(other);
    expect(()=>refreshHandoverPacket(data,other,'pm',now)).toThrow('already included');
    expect(JSON.stringify(other)).toBe(before);
    first.status='accepted';expect(()=>refreshHandoverPacket(data,other,'pm',now)).toThrow('already included');
    first.status='returned';expect(()=>refreshHandoverPacket(data,other,'pm',now)).not.toThrow();
  });
  it("validates quantities and preserves the exact reviewed pack for signed acceptance",()=>{
    const data=project(),handover=prepared(data),packet=handover.packet;
    const actor:ExecutionActor={id:'pm',name:'Planner',manage:true,review:true,buy:true,report:true,memberIds:[],resourceIds:[],released:true,now};
    data.tasks[0].quantity=2;
    expect(()=>applyExecution(data,'handover_status',{id:handover.id,status:'accepted',signedRecord:true,acceptedBy:'Client',note:'Signed document'},actor)).toThrow('quantity, unit');
    expect(handover.packet).toBe(packet);expect(handover.status).toBe('ready');
    data.tasks[0].quantity=1;
    applyExecution(data,'handover_status',{id:handover.id,status:'accepted',signedRecord:true,acceptedBy:'Client',note:'Signed document'},actor);
    expect(handover.packet).toBe(packet);expect(handover.packets).toHaveLength(1);expect(handover.status).toBe('accepted');
  });
  it("derives the exact package tasks and approved scoped documents without manual IDs", () => {
    const data = project();
    const handover = prepared(data);
    expect(handover.source).toBe("work_package");
    expect(handover.area).toBe("Master bedroom");
    expect(handover.taskIds).toEqual(["site-task"]);
    expect(handover.documentIds).toEqual(["as-built-bedroom"]);
    expect(handover.packet).toMatchObject({
      version: 1,
      sourcePackageId: "package-bedroom",
      scopeLineIds: ["scope-bedroom"],
      tasks: [expect.objectContaining({ id: "site-task" })],
      documents: [expect.objectContaining({ id: "as-built-bedroom", revision: "R01" })],
    });
  });

  it("does not let an unrelated room snag block an area pack, but blocks an affected defect", () => {
    const data = project();
    const handover = prepared(data);
    data.snags.push({
      id: "other-room",
      title: "Guest-room adjustment",
      taskId: "other-task",
      area: "Guest room",
      ownerId: "site-owner",
      severity: "major",
      dueDate: "2026-09-17",
      status: "open",
      evidence: "photo",
      resolution: "",
    });
    expect(() => assertHandoverPacketCurrent(data, handover)).not.toThrow();
    data.snags.push({
      id: "bedroom-defect",
      title: "Door alignment",
      taskId: "site-task",
      area: "Master bedroom",
      ownerId: "site-owner",
      severity: "minor",
      dueDate: "2026-09-17",
      status: "open",
      evidence: "photo",
      resolution: "",
    });
    expect(() => assertHandoverPacketCurrent(data, handover)).toThrow(/affected open defects/);
  });

  it("requires a fresh packet when a frozen closeout document revision changes", () => {
    const data = project();
    const handover = prepared(data);
    data.documents[0].revision = "R02";
    expect(() => assertHandoverPacketCurrent(data, handover)).toThrow(/document changed/);
  });

  it("records a client-verified return or acceptance and never accepts unresolved blocking commitments", () => {
    const data = project();
    const handover = prepared(data);
    addHandoverOutstandingItem(handover, {
      id: "training",
      title: "Client training",
      kind: "training",
      blocking: true,
      ownerId: "site-owner",
      dueDate: "2026-09-17",
      status: "open",
      evidence: "",
      resolution: "",
    });
    expect(() => decideHandoverFromPortal(data, {
      handoverId: handover.id,
      grantId: "client-approver",
      grantName: "Katy",
      decision: "accept",
      note: "",
      challengeId: "challenge-1",
      now,
    })).toThrow(/blocking handover items/);
    const returned = decideHandoverFromPortal(data, {
      handoverId: handover.id,
      grantId: "client-approver",
      grantName: "Katy",
      decision: "changes",
      note: "Please correct the door alignment.",
      challengeId: "challenge-2",
      now,
    });
    expect(returned.handover).toMatchObject({
      status: "returned",
      returnedBy: "Katy",
      published: false,
    });
  });

  it("records the assigned portal approver once and rejects a different client identity", () => {
    const data = project();
    const handover = prepared(data);
    expect(() => decideHandoverFromPortal(data, {
      handoverId: handover.id,
      grantId: "another-client",
      grantName: "Other client",
      decision: "accept",
      note: "",
      challengeId: "challenge-3",
      now,
    })).toThrow(/not assigned/);
    const accepted = decideHandoverFromPortal(data, {
      handoverId: handover.id,
      grantId: "client-approver",
      grantName: "Katy",
      decision: "accept",
      note: "",
      challengeId: "challenge-4",
      now,
    });
    expect(accepted.handover).toMatchObject({
      status: "accepted",
      acceptedBy: "Katy",
      decisionSource: "client_portal",
    });
    expect(decideHandoverFromPortal(data, {
      handoverId: handover.id,
      grantId: "client-approver",
      grantName: "Katy",
      decision: "accept",
      note: "",
      challengeId: "challenge-4",
      now,
    }).replayed).toBe(true);
  });
});
