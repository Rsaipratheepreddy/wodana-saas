"use client";

/* eslint-disable @next/next/no-img-element -- static brand files from /public */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Check, Trash2 } from "lucide-react";
import { AVATAR_KEYS, AVATAR_ROLES, avatarPath, chosenAvatarKey, roleAvatarKey, type AvatarRole } from "@wodana/contracts/brand";
import { Avatar, Button, InlineNotice, SettingsPage, SettingsRow, SettingsSection } from "@/design-system";
import { LanguageSelect } from "@/components/i18n/language-select";
import { useT } from "@/lib/i18n/i18n-provider";
import { tKey } from "@/lib/i18n/keys";
import { removeMyPhoto, saveMyAvatar, uploadMyPhoto, type MyProfile } from "@/lib/workspace/profile";
import styles from "./profile-appearance.module.css";

const PHOTO_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024;

const roleLabels: Record<AvatarRole, ReturnType<typeof tKey>> = {
  owner: tKey("Owner"), sales: tKey("Sales"), designer: tKey("Designer"), estimator: tKey("Estimator"),
  project_manager: tKey("Project manager"), site_supervisor: tKey("Site supervisor"), purchasing: tKey("Purchasing"),
  finance: tKey("Finance"), people: tKey("People"), factory: tKey("Factory"), carpenter: tKey("Carpenter"),
  electrician: tKey("Electrician"), painter: tKey("Painter"), installer: tKey("Installer"), client: tKey("Client"), default: tKey("Default"),
};

/** Your photo; without one, your role's avatar, or any picture from the set if you pick one. */
export function ProfileAppearance({ workspaceId, userId, name, email, roles, initial }: { workspaceId: string; userId: string; name: string; email: string; roles?: ReadonlyArray<string>; initial: MyProfile }) {
  const t = useT();
  const router = useRouter();
  const [profile, setProfile] = useState(initial);
  const [busy, setBusy] = useState<"photo" | "avatar" | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const run = async (kind: "photo" | "avatar", work: () => Promise<MyProfile>, success: string) => {
    setBusy(kind); setMessage(null);
    try { setProfile(await work()); setMessage({ tone: "success", text: success }); router.refresh(); }
    catch (reason) { setMessage({ tone: "error", text: reason instanceof Error ? reason.message : t("Your profile could not be saved.") }); }
    finally { setBusy(null); }
  };
  const choose = (file: File | undefined) => {
    if (!file) return;
    if (!PHOTO_TYPES.includes(file.type)) { setMessage({ tone: "error", text: t("Use a PNG, JPG or WebP photo.") }); return; }
    if (file.size > MAX_BYTES) { setMessage({ tone: "error", text: t("Photo must be 5 MB or smaller.") }); return; }
    void run("photo", () => uploadMyPhoto(workspaceId, file), t("Photo updated."));
  };
  const selected = chosenAvatarKey(profile.avatarPreset);
  const myRole = roleAvatarKey(roles);

  return <SettingsPage title={t("Profile")}>
    <SettingsSection id="profile-photo" title={t("Photo")}>
      <SettingsRow hint={<span dir="ltr">{email}</span>} label={name}>
        <Avatar name={name} preset={selected ?? "auto"} roles={roles} seed={userId} size="lg" src={profile.photoUrl} />
        <input accept={PHOTO_TYPES.join(",")} className={styles.fileInput} onChange={(event) => { choose(event.target.files?.[0]); event.target.value = ""; }} ref={input} tabIndex={-1} type="file" aria-hidden="true" />
        <Button isLoading={busy === "photo"} onPress={() => input.current?.click()} size="compact" variant="quiet"><Camera aria-hidden="true" size={14} />{profile.photoUrl ? t("Change photo") : t("Upload photo")}</Button>
        {profile.photoUrl ? <Button isDisabled={busy !== null} onPress={() => void run("photo", () => removeMyPhoto(workspaceId), t("Photo removed."))} size="compact" variant="quiet"><Trash2 aria-hidden="true" size={14} />{t("Remove")}</Button> : null}
      </SettingsRow>
    </SettingsSection>

    <SettingsSection id="language" title={t("Language")}>
      <SettingsRow label={t("Interface language")}>
        <LanguageSelect className={styles.language} label={null} />
      </SettingsRow>
    </SettingsSection>

    <SettingsSection id="avatar" title={t("Avatar")}>
      <p className={styles.muted}>{profile.photoUrl ? t("Your photo is shown. The avatar is used if you remove it.") : selected ? t("Your chosen avatar is shown. Choose it again to go back to your role’s avatar.") : t("Your role’s avatar is shown. Choose another picture if you prefer.")}</p>
      <div className={styles.grid} role="radiogroup" aria-label={t("Avatar")}>
        {AVATAR_KEYS.map((key) => {
          const role = AVATAR_ROLES.find((candidate) => key.startsWith(`${candidate}-`)) ?? "default";
          const label = `${t(roleLabels[role])} · ${t(key.endsWith("-f") ? "Woman" : "Man")}`;
          const isSelected = selected === key;
          return <button aria-checked={isSelected} aria-label={label} className={styles.option} data-role={role === myRole ? "mine" : undefined} data-selected={isSelected || undefined} disabled={busy !== null} key={key}
            onClick={() => void run("avatar", () => saveMyAvatar(workspaceId, isSelected ? null : key, profile.version), isSelected ? t("Avatar cleared.") : t("Avatar saved."))} role="radio" title={label} type="button">
            <img alt="" decoding="async" draggable={false} height={48} src={avatarPath(key)} width={48} />
            {isSelected ? <span className={styles.check}><Check aria-hidden="true" size={12} /></span> : null}
          </button>;
        })}
      </div>
    </SettingsSection>
    {message ? <InlineNotice message={message.text} tone={message.tone} /> : null}
  </SettingsPage>;
}
