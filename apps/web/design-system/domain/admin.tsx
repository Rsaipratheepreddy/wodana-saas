"use client";

import { useState } from "react";
import { Building2, Globe2, KeyRound, ShieldCheck } from "lucide-react";
import { Button } from "../components/actions";
import { FileUploader, PropertyRow, SelectField, Switch, TextInput } from "../components/forms";
import { Badge } from "../components/status";

export function OrganizationBranding({ initialName = "", onSave }: { initialName?: string; onSave?: (value: { name: string; logo?: File }) => void }) { const [name, setName] = useState(initialName); const [logo, setLogo] = useState<File>(); return <div className="wd-property-sheet"><PropertyRow label="Organization name"><TextInput aria-label="Organization name" label={<span className="wd-visually-hidden">Organization name</span>} onChange={setName} value={name} /></PropertyRow><PropertyRow description="PNG, WebP or SVG. Maximum 2 MB." label="Logo"><FileUploader label="Choose logo" multiple={false} onFiles={(files) => setLogo(files[0])} /></PropertyRow><footer><Button onPress={() => onSave?.({ name, logo })} variant="primary">Save branding</Button></footer></div>; }

export type CompanyRecord = { id: string; name: string; domain: string; currency: string; timeZone: string; status: "active" | "pending" };
export function CompanyRows({ companies, onOpen }: { companies: CompanyRecord[]; onOpen?: (company: CompanyRecord) => void }) { return <div className="wd-admin-rows">{companies.map((company) => <button key={company.id} onClick={() => onOpen?.(company)} type="button"><Building2 size={16} /><span><strong>{company.name}</strong><small>{company.domain}</small></span><span>{company.currency}</span><span>{company.timeZone}</span><Badge tone={company.status === "active" ? "success" : "warning"}>{company.status}</Badge></button>)}</div>; }

export type Permission = { id: string; label: string; roles: Record<string, boolean> };
export function PermissionMatrix({ onChange, permissions, roles }: { onChange?: (permissions: Permission[]) => void; permissions: Permission[]; roles: string[] }) { return <div className="wd-permission-matrix" style={{ "--wd-role-count": roles.length } as React.CSSProperties}><header><span>Permission</span>{roles.map((role) => <strong key={role}>{role}</strong>)}</header>{permissions.map((permission) => <div key={permission.id}><span>{permission.label}</span>{roles.map((role) => <Switch aria-label={`${role}: ${permission.label}`} isSelected={permission.roles[role]} key={role} onChange={(selected) => onChange?.(permissions.map((item) => item.id === permission.id ? { ...item, roles: { ...item.roles, [role]: selected } } : item))} />)}</div>)}</div>; }

export function SecuritySettings() { return <div className="wd-property-sheet"><PropertyRow description="Require a second factor for every member." label="Multi-factor authentication"><Switch>Required</Switch></PropertyRow><PropertyRow description="Automatically end inactive browser sessions." label="Session timeout"><SelectField aria-label="Session timeout" items={[{ id: "8", label: "8 hours" }, { id: "24", label: "24 hours" }, { id: "168", label: "7 days" }]} label={<span className="wd-visually-hidden">Session timeout</span>} selectedKey="24" /></PropertyRow></div>; }

export function ApiKeyRow({ created, lastUsed, name, onRevoke }: { created: string; lastUsed?: string; name: string; onRevoke?: () => void }) { return <div className="wd-api-key"><KeyRound size={15} /><span><strong>{name}</strong><small>Created {created} · {lastUsed ? `Last used ${lastUsed}` : "Never used"}</small></span><code>wd_••••••••</code><Button onPress={onRevoke} size="compact" variant="danger">Revoke</Button></div>; }

export function DomainRow({ domain, state, onVerify }: { domain: string; state: "verified" | "pending"; onVerify?: () => void }) { return <div className="wd-domain-row"><Globe2 size={15} /><strong>{domain}</strong><Badge tone={state === "verified" ? "success" : "warning"}>{state === "verified" ? <><ShieldCheck size={12} />Verified</> : "Pending"}</Badge>{state === "pending" ? <Button onPress={onVerify} size="compact">Verify</Button> : null}</div>; }
