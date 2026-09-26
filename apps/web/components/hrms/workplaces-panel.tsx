"use client";
import { useState } from "react";
import type {
  HrmsBootstrap,
  HrmsPerson,
  ProjectAssignment,
  WorkContext,
  WorkLocation,
} from "@wodana/contracts";
import {
  Button,
  Checkbox,
  DataTable,
  SelectField,
  TextArea,
  TextField,
} from "./controls";
import { hrmsRequest } from "@/lib/hrms/client";
import { Modal, Notice, useHrms } from "./shared";
import styles from "./hrms.module.css";
export function WorkplacesPanel({
  workspaceId,
  boot,
  revision,
  onSaved,
}: {
  workspaceId: string;
  boot: HrmsBootstrap;
  revision: number;
  onSaved: () => void;
}) {
  const places = useHrms<WorkLocation[]>(
      workspaceId,
      "locations",
      revision,
      "projects",
    ),
    contexts = useHrms<WorkContext[]>(workspaceId, "", revision, "projects"),
    assignments = useHrms<ProjectAssignment[]>(
      workspaceId,
      "assignments",
      revision,
      "projects",
    ),
    people = useHrms<HrmsPerson[]>(workspaceId, "people", revision);
  const [editing, setEditing] = useState<WorkLocation | null | undefined>(),
    [assigning, setAssigning] = useState<
      ProjectAssignment | null | undefined
    >(),
    [release, setRelease] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <>
      <div className={styles.sectionHeading}>
        <div>
          <h3>Offices & project sites</h3>
          <p>
            A site belongs to a planning or delivery project. Its location is
            checked at attendance capture.
          </p>
        </div>
        <Button variant="secondary" onClick={() => setEditing(null)}>
          Add workplace
        </Button>
      </div>
      {error ||
      places.error ||
      contexts.error ||
      assignments.error ||
      people.error ? (
        <Notice error>
          {error ||
            places.error ||
            contexts.error ||
            assignments.error ||
            people.error}
        </Notice>
      ) : null}
      {places.data?.length ? (
        <DataTable
          caption="Attendance workplaces"
          rows={places.data}
          getRowKey={(p) => p.id}
          columns={[
            {
              key: "name",
              header: "Workplace",
              render: (p) => (
                <>
                  <strong>{p.name}</strong>
                  <small className={styles.block}>{p.address}</small>
                </>
              ),
            },
            {
              key: "kind",
              header: "Type",
              render: (p) => (p.kind === "site" ? "Project site" : "Office"),
            },
            {
              key: "context",
              header: "Project",
              render: (p) =>
                contexts.data?.find((c) => c.id === (p.projectId ?? p.caseId))
                  ?.name ?? "General office",
            },
            {
              key: "boundary",
              header: "Boundary",
              render: (p) => `${p.radiusM} m`,
            },
            {
              key: "active",
              header: "Status",
              render: (p) => (p.active ? "Active" : "Inactive"),
            },
            {
              key: "action",
              header: "",
              render: (p) => (
                <Button variant="ghost" onClick={() => setEditing(p)}>
                  Edit workplace
                </Button>
              ),
            },
          ]}
        />
      ) : (
        <p className={styles.muted}>
          Add your office and site coordinates to enable location verification.
        </p>
      )}
      <div className={styles.sectionHeading}>
        <div>
          <h3>Project assignments</h3>
          <p>Choose who can check in to each project and its sites.</p>
        </div>
        <Button
          variant="secondary"
          onClick={() => setAssigning(null)}
          disabled={!contexts.data?.length}
        >
          Assign employee
        </Button>
      </div>
      {assignments.data?.length ? (
        <DataTable
          caption="Project assignments"
          rows={assignments.data}
          getRowKey={(a) => a.id}
          columns={[
            {
              key: "person",
              header: "Employee",
              render: (a) =>
                people.data?.find((p) => p.membershipId === a.membershipId)
                  ?.name ?? "Workspace member",
            },
            {
              key: "context",
              header: "Project",
              render: (a) =>
                contexts.data?.find((c) => c.id === (a.projectId ?? a.caseId))
                  ?.name ?? "Project",
            },
            {
              key: "role",
              header: "Access",
              render: (a) => (a.isManager ? "Project lead" : "Assigned member"),
            },
            {
              key: "status",
              header: "Status",
              render: (a) => (a.active ? "Active" : "Inactive"),
            },
            {
              key: "action",
              header: "",
              render: (a) => (
                <Button variant="ghost" onClick={() => setAssigning(a)}>
                  Edit assignment
                </Button>
              ),
            },
          ]}
        />
      ) : (
        <p className={styles.muted}>
          No project assignments yet. General office work does not require a
          project.
        </p>
      )}
      {boot.permissions.manageProjects ? (
        <form
          className={styles.settingsForm}
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await hrmsRequest(
                workspaceId,
                "from-pre-project",
                "POST",
                { caseId: release },
                "projects",
              );
              setRelease("");
              onSaved();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <h3>Start project attendance</h3>
          <p>
            Release a won planning into delivery. Its sites and employee
            assignments move with it.
          </p>
          <div className={styles.filters}>
            <SelectField
              id="release-case"
              label="Won planning"
              required
              value={release}
              onChange={(e) => setRelease(e)}
            >
              <option value="">Select a planning</option>
              {contexts.data
                ?.filter((c) => c.kind === "pre_project")
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </SelectField>
            <Button type="submit" loading={busy} disabled={!release}>
              Create delivery project
            </Button>
          </div>
        </form>
      ) : null}
      {editing !== undefined ? (
        <LocationForm
          workspaceId={workspaceId}
          item={editing}
          contexts={contexts.data ?? []}
          onClose={() => setEditing(undefined)}
          onSaved={onSaved}
        />
      ) : null}
      {assigning !== undefined ? (
        <AssignmentForm
          workspaceId={workspaceId}
          item={assigning}
          contexts={contexts.data ?? []}
          people={people.data ?? []}
          onClose={() => setAssigning(undefined)}
          onSaved={onSaved}
        />
      ) : null}
    </>
  );
}
function LocationForm({
  workspaceId,
  item,
  contexts,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  item: WorkLocation | null;
  contexts: WorkContext[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(item?.name ?? ""),
    [kind, setKind] = useState(item?.kind ?? "office"),
    [context, setContext] = useState(item?.projectId ?? item?.caseId ?? ""),
    [address, setAddress] = useState(item?.address ?? ""),
    [lat, setLat] = useState(item ? String(item.latitude) : ""),
    [lng, setLng] = useState(item ? String(item.longitude) : ""),
    [radius, setRadius] = useState(item?.radiusM ?? 150),
    [active, setActive] = useState(item?.active ?? true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [locating, setLocating] = useState(false);
  function locate() {
    setLocating(true);
    if (!navigator.geolocation) {
      setError("This browser cannot share location. Enter the coordinates.");
      setLocating(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLat(String(p.coords.latitude));
        setLng(String(p.coords.longitude));
        setLocating(false);
      },
      () => {
        setError("Location unavailable. Enter the site coordinates manually.");
        setLocating(false);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  }
  return (
    <Modal title={item ? "Edit workplace" : "Add workplace"} onClose={onClose}>
      <form
        className={styles.formGrid}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const c = contexts.find((c) => c.id === context);
            await hrmsRequest(
              workspaceId,
              "locations",
              "PUT",
              {
                ...(item ? { id: item.id } : {}),
                version: item?.version ?? 0,
                name,
                kind,
                address,
                latitude: Number(lat),
                longitude: Number(lng),
                radiusM: radius,
                active,
                projectId:
                  kind === "site" && c?.kind === "project" ? c.id : null,
                caseId:
                  kind === "site" && c?.kind === "pre_project" ? c.id : null,
              },
              "projects",
            );
            onSaved();
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <TextField
          id="site-name"
          label="Workplace name"
          required
          maxLength={160}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <SelectField
          id="site-kind"
          label="Workplace type"
          value={kind}
          onChange={(e) => setKind(e as "office" | "site")}
        >
          <option value="office">Office</option>
          <option value="site">Project site</option>
        </SelectField>
        {kind === "site" ? (
          <SelectField
            id="site-context"
            label="Project / planning"
            required
            value={context}
            onChange={(e) => setContext(e)}
          >
            <option value="">Select project</option>
            {contexts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.kind === "project" ? "Delivery" : "Planning"}
              </option>
            ))}
          </SelectField>
        ) : null}
        <TextArea
          id="site-address"
          label="Address"
          maxLength={500}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
        <Button variant="secondary" loading={locating} onClick={locate}>
          Use my current location
        </Button>
        <div className={styles.twoColumns}>
          <TextField
            id="site-latitude"
            label="Latitude"
            type="number"
            min={-90}
            max={90}
            step="any"
            required
            value={lat}
            onChange={(e) => setLat(e.target.value)}
          />
          <TextField
            id="site-longitude"
            label="Longitude"
            type="number"
            min={-180}
            max={180}
            step="any"
            required
            value={lng}
            onChange={(e) => setLng(e.target.value)}
          />
        </div>
        {lat && lng ? (
          <a
            href={`https://www.openstreetmap.org/?mlat=${encodeURIComponent(lat)}&mlon=${encodeURIComponent(lng)}#map=18/${encodeURIComponent(lat)}/${encodeURIComponent(lng)}`}
            target="_blank"
            rel="noreferrer"
          >
            Preview workplace on map ↗
          </a>
        ) : null}
        <TextField
          id="site-radius"
          label="Site boundary radius (m)"
          required
          type="number"
          min={25}
          max={2000}
          value={radius}
          onChange={(e) => setRadius(Number(e.target.value))}
        />
        <Checkbox checked={active} onChange={(e) => setActive(e)}>
          Available for check-in
        </Checkbox>
        {error ? <Notice error>{error}</Notice> : null}
        <Button type="submit" loading={busy}>
          Save workplace
        </Button>
      </form>
    </Modal>
  );
}
function AssignmentForm({
  workspaceId,
  item,
  contexts,
  people,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  item: ProjectAssignment | null;
  contexts: WorkContext[];
  people: HrmsPerson[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [context, setContext] = useState(item?.projectId ?? item?.caseId ?? ""),
    [member, setMember] = useState(item?.membershipId ?? ""),
    [manager, setManager] = useState(item?.isManager ?? false),
    [active, setActive] = useState(item?.active ?? true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Modal title="Project assignment" onClose={onClose}>
      <form
        className={styles.formGrid}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const c = contexts.find((c) => c.id === context)!;
            await hrmsRequest(
              workspaceId,
              "assignments",
              "PUT",
              {
                [c.kind === "project" ? "projectId" : "caseId"]: c.id,
                membershipId: member,
                isManager: manager,
                active,
              },
              "projects",
            );
            onSaved();
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <SelectField
          id="assignment-context"
          label="Project"
          required
          disabled={Boolean(item)}
          value={context}
          onChange={(e) => setContext(e)}
        >
          <option value="">Choose project</option>
          {contexts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          id="assignment-person"
          label="Employee"
          required
          disabled={Boolean(item)}
          value={member}
          onChange={(e) => setMember(e)}
        >
          <option value="">Choose member</option>
          {people
            .filter((p) => p.status === "active")
            .map((p) => (
              <option key={p.membershipId} value={p.membershipId}>
                {p.name}
              </option>
            ))}
        </SelectField>
        <Checkbox checked={manager} onChange={(e) => setManager(e)}>
          Project lead · can view project attendance
        </Checkbox>
        <Checkbox checked={active} onChange={(e) => setActive(e)}>
          Active assignment
        </Checkbox>
        {error ? <Notice error>{error}</Notice> : null}
        <Button type="submit" loading={busy}>
          Save assignment
        </Button>
      </form>
    </Modal>
  );
}
