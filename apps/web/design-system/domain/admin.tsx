"use client";

import { useT } from "@/lib/i18n/i18n-provider";
import { useState } from "react";
import { Building2, Globe2, KeyRound, ShieldCheck } from "lucide-react";
import { Button } from "../components/actions";
import { FileUploader, PropertyRow, SelectField, Switch, TextInput } from "../components/forms";
import { Badge } from "../components/status";

export function OrganizationBranding({ initialName = "", onSave }: { initialName?: string; onSave?: (value: { name: string; logo?: File }) => void }) {
  const t = useT(); const [name, setName] = useState(initialName); const [logo, setLogo] = useState<File>(); return <div className="wd-property-sheet"><PropertyRow label={t("Organization name")}><TextInput aria-label={t("Organization name")} label={<span className="wd-visually-hidden">{t("Organization name")}</span>} onChange={setName} value={name} /></PropertyRow><PropertyRow description={t("PNG, WebP or SVG. Maximum 2 MB.")} label={t("Logo")}><FileUploader label={t("Choose logo")} multiple={false} onFiles={(files) => setLogo(files[0])} /></PropertyRow><footer><Button onPress={() => onSave?.({ name, logo })} variant="primary">{t("Save branding")}</Button></footer></div>; }

export type CompanyRecord = { id: string; name: string; domain: string; currency: string; timeZone: string; status: "active" | "pending" };
export function CompanyRows({ companies, onOpen }: { companies: CompanyRecord[]; onOpen?: (company: CompanyRecord) => void }) { const t = useT(); return <div className="wd-admin-rows">{companies.map((company) => <button key={company.id} onClick={() => onOpen?.(company)} type="button"><Building2 size={16} /><span><strong>{company.name}</strong><small>{company.domain}</small></span><span>{company.currency}</span><span>{company.timeZone}</span><Badge tone={company.status === "active" ? "success" : "warning"}>{company.status === "active" ? t("Active") : t("Pending")}</Badge></button>)}</div>; }

export type Permission = { id: string; label: string; roles: Record<string, boolean> };
export function PermissionMatrix({ onChange, permissions, roles }: { onChange?: (permissions: Permission[]) => void; permissions: Permission[]; roles: string[] }) {
  const t = useT(); return <div className="wd-permission-matrix" style={{ "--wd-role-count": roles.length } as React.CSSProperties}><header><span>{t("Permission")}</span>{roles.map((role) => <strong key={role}>{role}</strong>)}</header>{permissions.map((permission) => <div key={permission.id}><span>{permission.label}</span>{roles.map((role) => <Switch aria-label={`${role}: ${permission.label}`} isSelected={permission.roles[role]} key={role} onChange={(selected) => onChange?.(permissions.map((item) => item.id === permission.id ? { ...item, roles: { ...item.roles, [role]: selected } } : item))} />)}</div>)}</div>; }

export function SecuritySettings() {
  const t = useT(); return <div className="wd-property-sheet"><PropertyRow description={t("Require a second factor for every member.")} label={t("Multi-factor authentication")}><Switch>{t("Required")}</Switch></PropertyRow><PropertyRow description={t("Automatically end inactive browser sessions.")} label={t("Session timeout")}><SelectField aria-label={t("Session timeout")} items={[{ id: "8", label: t("{count} hours", { count: 8 }) }, { id: "24", label: t("{count} hours", { count: 24 }) }, { id: "168", label: t("{count} days", { count: 7 }) }]} label={<span className="wd-visually-hidden">{t("Session timeout")}</span>} selectedKey="24" /></PropertyRow></div>; }

export function ApiKeyRow({ created, lastUsed, name, onRevoke }: { created: string; lastUsed?: string; name: string; onRevoke?: () => void }) {
  const t = useT(); return <div className="wd-api-key"><KeyRound size={15} /><span><strong>{name}</strong><small>{t("Created {date}", { date: created })} · {lastUsed ? t("Last used {date}", { date: lastUsed }) : t("Never used")}</small></span><code>wd_••••••••</code><Button onPress={onRevoke} size="compact" variant="danger">{t("Revoke")}</Button></div>; }

export function DomainRow({ domain, state, onVerify }: { domain: string; state: "verified" | "pending"; onVerify?: () => void }) {
  const t = useT(); return <div className="wd-domain-row"><Globe2 size={15} /><strong>{domain}</strong><Badge tone={state === "verified" ? "success" : "warning"}>{state === "verified" ? <><ShieldCheck size={12} />{t("Verified")}</> : t("Pending")}</Badge>{state === "pending" ? <Button onPress={onVerify} size="compact">{t("Verify")}</Button> : null}</div>; }
