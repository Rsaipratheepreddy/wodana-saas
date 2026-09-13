import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  day,
  get,
  ids,
  num,
  obj,
  str,
  choice,
  type ExecutionActor,
} from "./execution.domain";
import type { ProjectData } from "./execution.types";
import type {
  Dispatch,
  Commissioning,
  TechnicalQuery,
  Transmittal,
  Retention,
  SupplierReturn,
} from "./execution-controls.types";

export function applyControls(
  d: ProjectData,
  action: string,
  b: Record<string, unknown>,
  a: ExecutionActor,
): string | undefined {
  const supported = [
    "dispatch",
    "dispatch_status",
    "commissioning",
    "commissioning_status",
    "technical_query",
    "technical_query_status",
    "transmittal",
    "transmittal_status",
    "retention",
    "retention_status",
    "supplier_return",
    "supplier_return_status",
    "follow",
  ];
  if (!supported.includes(action)) return;
  const manage = () => {
    if (!a.manage)
      throw new ForbiddenException("A project planner must make this change.");
  };
  const review = () => {
    if (!a.review)
      throw new ForbiddenException(
        "A designated reviewer must make this decision.",
      );
  };
  const buy = () => {
    if (!a.buy)
      throw new ForbiddenException("Procurement permission is required.");
  };
  const released = () => {
    if (!a.released)
      throw new ConflictException(
        "Release the approved project scope before execution.",
      );
  };
  const person = (v: unknown) => {
    const id = str(v, 80, true);
    if (!a.memberIds.includes(id))
      throw new BadRequestException("Choose an active workspace member.");
    return id;
  };
  const stage = (current: string, expected: string) => {
    if (current !== expected)
      throw new ConflictException(
        `This record must be ${expected} before this action.`,
      );
  };
  const independent = (author: string) => {
    review();
    if (author === a.id)
      throw new ForbiddenException("Another reviewer must verify this record.");
  };
  const note = str(b.note, 3000);
  let id = str(b.id, 80) || randomUUID();
  if (action === "follow") {
    const recordId = str(b.id, 80, true);
    get(
      [
        ...d.tasks,
        ...d.orders,
        ...d.documents,
        ...d.reports,
        ...d.snags,
        ...d.handovers,
        ...(d.technicalQueries ?? []),
        ...(d.dispatches??[]),...(d.commissioning??[]),...(d.transmittals??[]),...(d.retentions??[]),...(d.supplierReturns??[]),
      ],
      recordId,
    );
    d.followers = (d.followers ?? []).filter(
      (f) => f.recordId !== recordId || f.memberId !== a.id,
    );
    if (b.following !== false) d.followers.push({ recordId, memberId: a.id });
    return recordId;
  }
  if (action === "dispatch") {
    manage();
    released();
    const v = obj(b.record);
    id = str(v.id, 80) || id;
    d.dispatches ??= [];
    const old = d.dispatches.find((r) => r.id === id);
    if (old) stage(old.status, "draft");
    const task = get(d.tasks, v.taskId);
    if (
      task.location !== "factory" ||
      d.tasks.some((t) => t.parentId === task.id)
    )
      throw new ConflictException("Choose a measured factory operation.");
    const value: Dispatch = {
      id,
      title: str(v.title, 240, true),
      taskId: task.id,
      destination: str(v.destination, 240, true),
      quantity: num(v.quantity),
      unit: task.unit,
      dueDate: day(v.dueDate, true),
      carrier: str(v.carrier, 200),
      reference: str(v.reference, 500),
      status: "draft",
      preparedBy: a.id,
      accepted: 0,
      rejected: 0,
      receiptEvidence: "",
    };
    if (!value.quantity)
      throw new BadRequestException("Enter the dispatch quantity.");
    if (old) Object.assign(old, value);
    else d.dispatches.push(value);
  } else if (action === "dispatch_status") {
    const r = get(d.dispatches ?? [], id),
      status = choice(b.status, [
        "ready",
        "dispatched",
        "received",
        "cancelled",
      ]);
    released();
    if (status === "ready") {
      review();
      stage(r.status, "draft");
      const t = get(d.tasks, r.taskId);
      const allocated = (d.dispatches ?? [])
        .filter(
          (x) =>
            x.id !== id &&
            ["ready", "dispatched", "received"].includes(x.status) &&
            x.taskId === r.taskId,
        )
        .reduce((s, x) => s + x.quantity - x.rejected, 0);
      if (["blocked","on_hold","cancelled"].includes(t.status) || allocated + r.quantity > t.approved)
        throw new ConflictException(
          "Inspect the factory work and dispatch only its remaining approved output.",
        );
    }
    if(status==="ready"&&get(d.tasks,r.taskId).status!=="completed")str(b.note,3000,true);
    if (status === "dispatched") {
      manage();
      stage(r.status, "ready");
      r.reference = str(b.reference, 500, true);
      r.carrier = str(b.carrier, 200, true);
      r.dispatchedAt = a.now;
    }
    if (status === "received") {
      independent(r.preparedBy);
      stage(r.status, "dispatched");
      r.accepted = num(b.accepted);
      r.rejected = num(b.rejected);
      if (Math.abs(r.accepted + r.rejected - r.quantity) > 0.0001)
        throw new ConflictException(
          "Account for the full delivery as accepted or rejected.",
        );
      r.receiptEvidence = str(b.evidence, 3000, true);
      r.receivedBy = a.id;
      if (r.rejected) {
        d.snags.push({
          id: randomUUID(),
          title: `Rejected dispatch: ${r.title}`,
          taskId: r.taskId,
          area: get(d.tasks, r.taskId).area,
          ownerId: get(d.tasks, r.taskId).ownerId,
          severity: "major",
          dueDate: a.today ?? a.now.slice(0, 10),
          status: "open",
          evidence: r.receiptEvidence,
          resolution: "",
        });
      }
    }
    if (status === "cancelled") {
      manage();
      if (!["draft", "ready"].includes(r.status))
        throw new ConflictException(
          "A dispatched delivery needs a receipt and rejection record.",
        );
      str(b.note, 3000, true);
    }
    r.status = status;
  } else if (action === "commissioning") {
    if (!a.report && !a.manage)
      throw new ForbiddenException("Reporting permission is required.");
    released();
    const v = obj(b.record);
    id = str(v.id, 80) || id;
    d.commissioning ??= [];
    const old = d.commissioning.find((r) => r.id === id);
    if (old && !["draft", "returned"].includes(old.status))
      throw new ConflictException("Returned or draft checks can be edited.");
    if (old && old.authorId !== a.id && !a.manage)
      throw new ForbiddenException("Edit your own commissioning check.");
    const t = get(d.tasks, v.taskId);
    if (
      t.location !== "site" ||
      (!a.manage && t.ownerId !== a.id && !t.assigneeIds.includes(a.id))
    )
      throw new ForbiddenException("Choose assigned site work.");
    if (!Array.isArray(v.readings) || v.readings.length > 100)
      throw new BadRequestException("Add measured test readings.");
    const readings = v.readings.map((x) => {
      const q = obj(x);
      const signed = (n: unknown) => {
        if (typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > 1e9)
          throw new BadRequestException("Enter a valid reading.");
        return n;
      };
      const r = {
        name: str(q.name, 200, true),
        value: signed(q.value),
        unit: str(q.unit, 40, true),
        min: signed(q.min),
        max: signed(q.max),
      };
      if (r.min > r.max)
        throw new BadRequestException(
          "The lower limit must not exceed the upper limit.",
        );
      return r;
    });
    const value: Commissioning = {
      id,
      title: str(v.title, 240, true),
      taskId: t.id,
      area: t.area,
      system: str(v.system, 200, true),
      ownerId: person(v.ownerId ?? a.id),
      dueDate: day(v.dueDate, true),
      readings,
      status: "draft",
      evidence: str(v.evidence, 3000),
      note: "",
      authorId: old?.authorId ?? a.id,
    };
    if(old?.status==="returned"){old.revisions??=[];old.revisions.push({readings:structuredClone(old.readings),evidence:old.evidence,note:old.note,reviewedBy:old.reviewedBy,at:a.now});}
    if (old) Object.assign(old, value);
    else d.commissioning.push(value);
  } else if (action === "commissioning_status") {
    const r = get(d.commissioning ?? [], id),
      status = choice(b.status, ["submitted", "passed", "returned"]);
    if (status === "submitted") {
      if (r.authorId !== a.id && !a.manage)
        throw new ForbiddenException("Submit your own check.");
      stage(r.status, "draft");
      if (!r.readings.length || !r.evidence)
        throw new ConflictException(
          "Add readings and test evidence before submission.",
        );
      const t = get(d.tasks, r.taskId);
      if (!["completed", "awaiting_inspection"].includes(t.status))
        throw new ConflictException(
          "Complete the installation before commissioning.",
        );
    } else {
      independent(r.authorId);
      stage(r.status, "submitted");
      if (
        status === "passed" &&
        r.readings.some((v) => v.value < v.min || v.value > v.max)
      )
        throw new ConflictException(
          "Out-of-range readings must be corrected and retested.",
        );
      r.reviewedBy = a.id;
      r.note = str(b.note, 3000, true);
    }
    r.status = status;
  } else if (action === "technical_query") {
    if (!a.report && !a.manage)
      throw new ForbiddenException("Project reporting permission is required.");
    const v = obj(b.record);
    id = str(v.id, 80) || id;
    d.technicalQueries ??= [];
    if (d.technicalQueries.some((r) => r.id === id))
      throw new ConflictException("Respond to the existing technical query.");
    const taskIds = ids(v.taskIds);
    taskIds.forEach((t) => {
      const task = get(d.tasks, t);
      if (
        !a.manage &&
        task.ownerId !== a.id &&
        !task.assigneeIds.includes(a.id)
      )
        throw new ForbiddenException("Link only assigned work.");
    });
    const r: TechnicalQuery = {
      id,
      title: str(v.title, 240, true),
      taskIds,
      ownerId: person(v.ownerId),
      dueDate: day(v.dueDate, true),
      question: str(v.question, 4000, true),
      response: "",
      documentIds: [],
      status: "open",
      authorId: a.id,
    };
    d.technicalQueries.push(r);
    taskIds.forEach((id) => {
      const t = get(d.tasks, id);
      if (!["completed", "cancelled"].includes(t.status)) {
        t.status = "blocked";
        t.blocker = `Technical query: ${r.title}`;
      }
    });
  } else if (action === "technical_query_status") {
    const r = get(d.technicalQueries ?? [], id),
      status = choice(b.status, ["answered", "closed"]);
    if (status === "answered") {
      if (r.ownerId !== a.id && !a.manage)
        throw new ForbiddenException("The query owner must respond.");
      stage(r.status, "open");
      r.response = str(b.response, 4000, true);
      r.documentIds = ids(b.documentIds);
      r.documentIds.forEach((id) => {
        if (get(d.documents, id).status !== "approved")
          throw new ConflictException(
            "Reference the approved document revision.",
          );
      });
      r.answeredBy = a.id;
    } else {
      independent(r.answeredBy ?? r.authorId);
      stage(r.status, "answered");
      str(b.note, 3000, true);
    }
    r.status = status; // Readiness and any affected scope change are reviewed explicitly on the task.
  } else if (action === "transmittal") {
    manage();
    const v = obj(b.record);
    id = str(v.id, 80) || id;
    d.transmittals ??= [];
    const old = d.transmittals.find((r) => r.id === id);
    if (old) stage(old.status, "draft");
    const docIds = ids(v.documentIds);
    if (!docIds.length)
      throw new BadRequestException("Choose documents to transmit.");
    const documents = docIds.map((id) => {
      const doc = get(d.documents, id);
      return { id, title: doc.title, revision: doc.revision };
    });
    const r: Transmittal = {
      id,
      number:
        old?.number ??
        `TR-${String(d.transmittals.length + 1).padStart(4, "0")}`,
      title: str(v.title, 240, true),
      recipient: str(v.recipient, 240, true),
      dueDate: day(v.dueDate, true),
      documents,
      status: "draft",
      purpose: str(v.purpose, 1000, true),
      evidence: "",
    };
    if (old) Object.assign(old, r);
    else d.transmittals.push(r);
  } else if (action === "transmittal_status") {
    manage();
    const r = get(d.transmittals ?? [], id),
      status = choice(b.status, ["issued", "acknowledged", "void"]);
    if (status === "issued") {
      stage(r.status, "draft");
      r.documents.forEach((v) => {
        const doc = get(d.documents, v.id);
        if (doc.status !== "approved" || doc.revision !== v.revision)
          throw new ConflictException("Issue only current approved revisions.");
      });
      r.issuedBy = a.id;
      r.issuedAt = a.now;
      r.evidence = str(b.evidence, 3000, true);
    }
    if (status === "acknowledged") {
      stage(r.status, "issued");
      r.evidence = str(b.evidence, 3000, true);
      r.acknowledgedAt = a.now;
    }
    if (status === "void") {
      if (r.status === "acknowledged")
        throw new ConflictException(
          "An acknowledged transmittal is fixed. Issue a new revision.",
        );
      str(b.note, 3000, true);
    }
    r.status = status;
  } else if (action === "retention") {
    review();
    const v = obj(b.record);
    id = str(v.id, 80) || id;
    d.retentions ??= [];
    const old = d.retentions.find((r) => r.id === id);
    if (old) stage(old.status, "held");
    if (d.financeClosed)
      throw new ConflictException(
        "Reopen the final account before changing retention.",
      );
    const amount = num(v.amount);
    if (!amount) throw new BadRequestException("Enter retention amount.");
    const total =
      (d.retentions ?? [])
        .filter((r) => r.id !== id)
        .reduce((s, r) => s + r.amount, 0) + amount;
    const contract =
      (d.scope?.value ?? 0) +
      (d.variations ?? []).reduce((s, v) => s + v.value, 0);
    if (total > contract)
      throw new ConflictException(
        "Retention cannot exceed the approved contract value.",
      );
    const handoverId = str(v.handoverId, 80);
    if (handoverId) get(d.handovers, handoverId);
    const r: Retention = {
      id,
      title: str(v.title, 240, true),
      amount,
      dueDate: day(v.dueDate, true),
      condition: str(v.condition, 3000, true),
      handoverId,
      status: "held",
      reference: "",
      evidence: "",
    };
    if (old) Object.assign(old, r);
    else d.retentions.push(r);
  } else if (action === "retention_status") {
    review();
    const r = get(d.retentions ?? [], id),
      status = choice(b.status, ["released", "verified"]);
    if (status === "released") {
      stage(r.status, "held");
      if (r.dueDate > (a.today ?? a.now.slice(0, 10)))
        throw new ConflictException("Retention is not yet due.");
      if (r.handoverId && get(d.handovers, r.handoverId).status !== "accepted")
        throw new ConflictException("Accept the linked handover first.");
      if (
        d.snags.some(
          (s) =>
            s.status !== "closed" &&
            (!r.handoverId || s.handoverId === r.handoverId),
        )
      )
        throw new ConflictException(
          "Resolve the relevant outstanding defects.",
        );
      r.evidence = str(b.evidence, 3000, true);
    } else {
      stage(r.status, "released");
      r.reference = str(b.reference, 500, true);
      r.evidence = str(b.evidence, 3000, true);
      r.verifiedBy = a.id;
    }
    r.status = status;
  } else if (action === "supplier_return") {
    buy();
    const v = obj(b.record);
    id = str(v.id, 80) || id;
    d.supplierReturns ??= [];
    const old = d.supplierReturns.find((r) => r.id === id);
    if (old) stage(old.status, "draft");
    const order = get(d.orders, v.orderId);
    if (!order.materialId)
      throw new ConflictException("Choose a received material order.");
    const quantity = num(v.quantity);
    if (!quantity)
      throw new BadRequestException("Enter the returned quantity.");
    const r: SupplierReturn = {
      id,
      orderId: order.id,
      materialId: order.materialId,
      quantity,
      reason: str(v.reason, 3000, true),
      status: "draft",
      reference: "",
      creditAmount: num(v.creditAmount),
      evidence: "",
      authorId: a.id,
    };
    if (r.creditAmount > quantity * order.unitCost + 0.01)
      throw new ConflictException("Expected credit exceeds the return value.");
    if (old) Object.assign(old, r);
    else d.supplierReturns.push(r);
  } else if (action === "supplier_return_status") {
    const r = get(d.supplierReturns ?? [], id),
      status = choice(b.status, ["approved", "dispatched", "credited"]);
    const m = get(d.materials, r.materialId),
      o = get(d.orders, r.orderId);
    if (status === "approved") {
      independent(r.authorId);
      stage(r.status, "draft");
      const previously = (d.supplierReturns ?? [])
        .filter(
          (x) =>
            x.orderId === r.orderId && x.id !== r.id && x.status !== "draft",
        )
        .reduce((s, x) => s + x.quantity, 0);
      if (
        previously + r.quantity >
        o.receipts.reduce((s, x) => s + x.accepted, 0)
      )
        throw new ConflictException(
          "Return only the accepted quantity from this order.",
        );
      const available =
        m.movements.reduce(
          (s, x) =>
            s +
            (["receive", "return"].includes(x.kind) ? x.quantity : -x.quantity),
          0,
        ) - (m.reservations ?? []).reduce((s, x) => s + x.quantity, 0);
      const pending = (d.supplierReturns ?? [])
        .filter(
          (x) =>
            x.materialId === m.id && x.id !== id && x.status === "approved",
        )
        .reduce((s, x) => s + x.quantity, 0);
      if (available - pending < r.quantity)
        throw new ConflictException(
          "Release reservations and ensure sufficient stock for this return.",
        );
      r.approvedBy = a.id;
    }
    if (status === "dispatched") {
      buy();
      stage(r.status, "approved");
      const available =
        m.movements.reduce(
          (s, x) =>
            s +
            (["receive", "return"].includes(x.kind) ? x.quantity : -x.quantity),
          0,
        ) - (m.reservations ?? []).reduce((s, x) => s + x.quantity, 0);
      if (available < r.quantity)
        throw new ConflictException(
          "Not enough unreserved stock remains for this return.",
        );
      r.reference = str(b.reference, 500, true);
      r.evidence = str(b.evidence, 3000, true);
      m.movements.push({
        id: randomUUID(),
        kind: "supplier_return",
        quantity: r.quantity,
        reference: r.reference,
        at: a.now,
      });
    }
    if (status === "credited") {
      review();
      stage(r.status, "dispatched");
      r.reference = str(b.reference, 500, true);
      r.evidence = str(b.evidence, 3000, true);
      const amount = num(b.creditAmount);
      if (Math.abs(amount - r.creditAmount) > 0.01)
        throw new ConflictException(
          "The accounting credit must match the agreed return amount.",
        );
    }
    r.status = status;
  }
  return id;
}

export function assertCloseout(d: ProjectData, taskIds?: string[]) {
  const includes = (id: string) => !taskIds || taskIds.includes(id);
  if (
    d.dispatches?.some(
      (r) =>
        includes(r.taskId) && !["received", "cancelled"].includes(r.status),
    )
  )
    throw new ConflictException(
      "Receive or cancel outstanding dispatches before handover.",
    );
  if (d.commissioning?.some((r) => includes(r.taskId) && r.status !== "passed"))
    throw new ConflictException(
      "Pass the commissioning checks before handover.",
    );
  if (
    d.technicalQueries?.some(
      (r) => r.status !== "closed" && (!taskIds || r.taskIds.some(includes)),
    )
  )
    throw new ConflictException(
      "Close the affected technical queries before handover.",
    );
}
