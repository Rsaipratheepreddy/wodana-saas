"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Check, Trash2 } from "lucide-react";
import { AVATAR_PRESETS, Avatar, Button, InlineNotice, PageHeader, PresetPortrait } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { removeMyPhoto, saveMyAvatar, uploadMyPhoto, type MyProfile } from "@/lib/workspace/profile";
import styles from "./profile-appearance.module.css";

const PHOTO_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024;

/** Your photo, or one of the drawn avatars when you'd rather not upload one. */
export function ProfileAppearance({ workspaceId, userId, name, email, initial }: { workspaceId: string; userId: string; name: string; email: string; initial: MyProfile }) {
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
  const selected = profile.avatarPreset;

  return <div className={styles.page}>
    <PageHeader title={t("Profile")} />
    <section aria-label={t("Photo")} className={styles.identity}>
      <Avatar name={name} preset={selected ?? "auto"} seed={userId} size="xl" src={profile.photoUrl} />
      <div className={styles.who}><strong>{name}</strong><small dir="ltr">{email}</small></div>
      <div className={styles.photoActions}>
        <input accept={PHOTO_TYPES.join(",")} className={styles.fileInput} onChange={(event) => { choose(event.target.files?.[0]); event.target.value = ""; }} ref={input} tabIndex={-1} type="file" aria-hidden="true" />
        <Button isLoading={busy === "photo"} onPress={() => input.current?.click()} size="compact"><Camera aria-hidden="true" size={14} />{profile.photoUrl ? t("Change photo") : t("Upload photo")}</Button>
        {profile.photoUrl ? <Button isDisabled={busy !== null} onPress={() => void run("photo", () => removeMyPhoto(workspaceId), t("Photo removed."))} size="compact" variant="quiet"><Trash2 aria-hidden="true" size={14} />{t("Remove")}</Button> : null}
      </div>
    </section>

    <section aria-labelledby="avatar-heading" className={styles.avatars}>
      <h2 id="avatar-heading">{t("Avatar")}</h2>
      {profile.photoUrl ? <p className={styles.muted}>{t("Your photo is shown. The avatar is used if you remove it.")}</p> : null}
      <div className={styles.grid} role="radiogroup" aria-label={t("Avatar")}>
        {AVATAR_PRESETS.map((preset) => {
          const isSelected = selected === preset.id;
          return <button aria-checked={isSelected} aria-label={t("Avatar {number}", { number: AVATAR_PRESETS.indexOf(preset) + 1 })} className={styles.option} data-selected={isSelected || undefined} disabled={busy !== null} key={preset.id}
            onClick={() => void run("avatar", () => saveMyAvatar(workspaceId, isSelected ? null : preset.id, profile.version), isSelected ? t("Avatar cleared.") : t("Avatar saved."))} role="radio" type="button">
            <PresetPortrait preset={preset} />
            {isSelected ? <span className={styles.check}><Check aria-hidden="true" size={12} /></span> : null}
          </button>;
        })}
      </div>
    </section>
    {message ? <InlineNotice message={message.text} tone={message.tone} /> : null}
  </div>;
}
