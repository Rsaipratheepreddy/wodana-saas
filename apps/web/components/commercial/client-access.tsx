"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Copy, Pencil, Plus } from "lucide-react";
import { DataGrid, ControlledModalDialog, EmptyState } from "@/design-system";
import type { CommercialState, PortalGrant } from "@/lib/commercial/types";
import { commercialPath, jsonRequest } from "@/lib/commercial/client";
import s from "./commercial.module.css";
export function ClientAccess({
  state,
  reload,
}: {
  state: CommercialState;
  reload: () => Promise<unknown>;
}) {
  const [edit, setEdit] = useState<Partial<PortalGrant> | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const pending = (id?: string) =>
    state.data.quotes.some((q) => q.status === "issued" && q.approverId === id);
  async function save(contact: Partial<PortalGrant>) {
    setBusy(true);
    setError("");
    try {
      await jsonRequest(
        commercialPath(state.workspaceId, `cases/${state.caseId}/contacts`),
        "PUT",
        contact,
      );
      await reload();
      setEdit(null);
      setNotice("Client access saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className={s.toolbar}>
        <span className={s.muted}>
          {state.contacts.filter((c) => c.active).length} active logins · Each
          person uses their own WhatsApp number
        </span>
        <div className={s.actions}>
          {state.portalSlug && (
            <>
              <button
                className={s.button}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      `${location.origin}/portal/${state.portalSlug}`,
                    );
                    setNotice("Portal link copied.");
                  } catch {
                    setError(
                      "Could not copy. Open the portal and copy its address.",
                    );
                  }
                }}
              >
                <Copy size={14} />
                Copy portal link
              </button>
              <a
                href={`/portal/${state.portalSlug}`}
                target="_blank"
                rel="noreferrer"
                className={s.button}
              >
                Open portal
                <ArrowUpRight size={14} />
              </a>
            </>
          )}
          {state.canManagePortal && (
            <button
              className={s.primary}
              onClick={() => {
                setError("");
                setEdit({
                  name: "",
                  phone: "",
                  role: "viewer",
                  active: true,
                  testContact: !!state.testMode,
                });
              }}
            >
              <Plus size={15} />
              Add client login
            </button>
          )}
        </div>
      </div>
      {notice && (
        <p role="status" className={s.muted}>
          {notice}
        </p>
      )}
      {error && !edit && (
        <p role="alert" className={s.error}>
          {error}
        </p>
      )}
      {!state.portalEnabled && (
        <p className={s.notice}>
          Enable this portal in{" "}
          <Link href="/workspace/settings/client-portal">Portal settings</Link>{" "}
          before clients sign in.
        </p>
      )}
      {state.contacts.length ? (
        <DataGrid ariaLabel="Client access" data={state.contacts} getRowId={row=>row.id} searchLabel="Search client access" exportFileName="client-access.csv"  columns={[{id:"name",header:"Client contact",size:230,accessorFn:(c)=>c.name,cell:({row:{original:c}})=>{return <>
                    <strong>{c.name}</strong>
                    {pending(c.id) && (
                      <small className={s.detail}>
                        Assigned a quotation for approval
                      </small>
                    )}
                  </>;}},
{id:"phone",header:"WhatsApp mobile",size:180,accessorFn:(c)=>c.phone,cell:({row:{original:c}})=>{return <>{c.phone}</>;}},
{id:"role",header:"Permission",size:130,accessorFn:(c)=>c.role === "approver" ? "Approver" : "Viewer",cell:({row:{original:c}})=>{return <>{c.role === "approver" ? "Approver" : "Viewer"}</>;}},
{id:"status",header:"Status",size:160,accessorFn:(c)=>c.active ? "Active" : "Access removed",cell:({row:{original:c}})=>{return <>
                    <span className={s.status}>
                      {c.active ? "Active" : "Access removed"}
                    </span>
                    {c.testContact && (
                      <small className={s.detail}>Demo login</small>
                    )}
                  </>;}},
{id:"action",header:"Action",size:210,enableSorting:false,enableColumnFilter:false,cell:({row:{original:c}})=>{return <>
                    {state.canManagePortal && (
                      <div className={s.actions}>
                        <button
                          className={s.icon}
                          aria-label={`Edit ${c.name}`}
                          onClick={() => {
                            setError("");
                            setEdit(c);
                          }}
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          className={s.button}
                          disabled={busy || pending(c.id)}
                          title={
                            pending(c.id)
                              ? "Withdraw their pending quotation before changing access"
                              : undefined
                          }
                          onClick={() => void save({ ...c, active: !c.active })}
                        >
                          {c.active ? "Remove access" : "Restore access"}
                        </button>
                      </div>
                    )}
                  </>;}}]}/>
      ) : (
        <EmptyState title="Add the people involved in this project" description="Each client contact gets their own login, limited to this project." />
      )}
      <section className={s.section}>
        <div className={s.grid}>
          <div>
            <h3>Viewer</h3>
            <p className={s.muted}>
              Views issued quotations, shared records and payments. Can raise
              questions and change requests.
            </p>
          </div>
          <div>
            <h3>Approver</h3>
            <p className={s.muted}>
              Also accepts or requests changes to quotations assigned to them.
              Every decision records the person and version.
            </p>
          </div>
        </div>
      </section>
      <section className={s.section}>
        <h2>Portal appearance</h2>
        <p className={s.muted}>
          One brand experience for your clients. Edit the logo, colours and
          welcome screen in{" "}
          <Link href="/workspace/settings/client-portal">
            Workspace portal settings
          </Link>
          .
        </p>
        {state.testMode && (
          <p className={s.muted}>
            Demo mode: registered demo contacts use <strong>123456</strong>.
            WhatsApp delivery is not connected yet.
          </p>
        )}
      </section>
      <ControlledModalDialog
        isOpen={!!edit}
        onOpenChange={(open) => !open && setEdit(null)}
        title={edit?.id ? "Edit client login" : "Add client login"}
      >
        {edit && (
          <form
            className={s.form}
            onSubmit={(e) => {
              e.preventDefault();
              void save(edit);
            }}
          >
            <label>
              Contact name
              <input
                required
                maxLength={160}
                value={edit.name ?? ""}
                onChange={(e) => setEdit({ ...edit, name: e.target.value })}
              />
            </label>
            <label>
              WhatsApp mobile
              <input
                required
                type="tel"
                autoComplete="tel"
                disabled={!!edit.id}
                placeholder="+971 50 123 4567"
                value={edit.phone ?? ""}
                onChange={(e) => setEdit({ ...edit, phone: e.target.value })}
              />
            </label>
            {edit.id && (
              <p className={s.muted}>
                To change a mobile number, add a new login and remove the old
                access.
              </p>
            )}
            <label>
              Permission
              <select
                value={edit.role ?? "viewer"}
                onChange={(e) =>
                  setEdit({
                    ...edit,
                    role: e.target.value as PortalGrant["role"],
                  })
                }
              >
                <option value="viewer">Viewer</option>
                <option value="approver">Approver</option>
              </select>
            </label>
            {state.testMode && (
              <label className={s.check}>
                <input
                  type="checkbox"
                  checked={!!edit.testContact}
                  onChange={(e) =>
                    setEdit({ ...edit, testContact: e.target.checked })
                  }
                />
                Demo login · code 123456
              </label>
            )}
            {pending(edit.id) && (
              <p className={s.notice}>
                Withdraw the pending quotation in{" "}
                <Link
                  href={`/workspace/pre-projects/cases/${state.caseId}/quotations`}
                >
                  Quotations
                </Link>{" "}
                before updating this login.
              </p>
            )}
            {error && (
              <p className={s.error} role="alert">
                {error}
              </p>
            )}
            <button className={s.primary} disabled={busy || pending(edit.id)}>
              Save login
            </button>
          </form>
        )}
      </ControlledModalDialog>
    </>
  );
}
