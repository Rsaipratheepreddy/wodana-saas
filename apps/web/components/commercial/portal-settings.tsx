"use client";
import Image from "next/image";
import { useState, type CSSProperties } from "react";
import { ArrowUpRight, Upload } from "lucide-react";
import type { PortalBrand, PortalSettings } from "@/lib/commercial/types";
import { commercialPath, jsonRequest } from "@/lib/commercial/client";
import s from "./commercial.module.css";
export function BrandLogo({ brand }: { brand: PortalBrand }) {
  return (
    <div className={s.logo}>
      {brand.logo ? (
        <Image
          unoptimized
          src={brand.logo}
          alt={brand.name}
          width={160}
          height={48}
          style={{ objectFit: "contain", width: "auto", height: "auto" }}
        />
      ) : (
        <>
          <span
            className={s.logoMark}
            aria-hidden
            style={{
              background: `linear-gradient(135deg,${brand.primaryColor},${brand.accentColor})`,
            }}
          >
            {brand.name
              .split(/\s+/)
              .slice(0, 2)
              .map((w) => w[0])
              .join("")
              .toUpperCase()}
          </span>
          <span>{brand.name}</span>
        </>
      )}
    </div>
  );
}
export function PortalSettingsPage({ initial }: { initial: PortalSettings }) {
  const [data, setData] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const patch = (v: Partial<PortalBrand>) =>
    setData({ ...data, brand: { ...data.brand, ...v } });
  async function save() {
    setBusy(true);
    setError("");
    try {
      const next = await jsonRequest<PortalSettings>(
        commercialPath(data.workspaceId, "portal-settings"),
        "PUT",
        { version: data.version, enabled: data.enabled, brand: data.brand },
      );
      setData(next);
      setNotice("Portal settings saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const style = {
    "--wd-brand-gradient": `linear-gradient(110deg,${data.brand.primaryColor},${data.brand.accentColor})`,
  } as CSSProperties;
  return (
    <section className={s.page}>
      <header className={s.header}>
        <div>
          <h1>Client portal</h1>
          <p>Your brand, one clear place for your clients.</p>
        </div>
        <div className={s.actions}>
          {data.enabled && (
            <a
              className={s.button}
              href={`/portal/${data.slug}`}
              target="_blank"
              rel="noreferrer"
            >
              Open portal
              <ArrowUpRight size={15} />
            </a>
          )}
          {data.canManage && (
            <button
              className={s.primary}
              disabled={busy}
              onClick={() => void save()}
            >
              {busy ? "Saving…" : "Save settings"}
            </button>
          )}
        </div>
      </header>
      {error && (
        <p role="alert" className={s.error}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className={s.muted}>
          {notice}
        </p>
      )}
      <div className={s.settingsGrid}>
        <fieldset
          disabled={!data.canManage || busy}
          className={s.form}
          style={{ border: 0, padding: 0, margin: 0 }}
        >
          <div className={s.section}>
            <h2>Portal access</h2>
            <label className={s.check}>
              <input
                type="checkbox"
                checked={data.enabled}
                onChange={(e) =>
                  setData({ ...data, enabled: e.target.checked })
                }
              />
              Enable client portal
            </label>
            <p className={s.muted}>
              /portal/{data.slug} · Contacts are added from each Pre-execution’s
              Client access.
            </p>
            {data.testMode && (
              <p className={s.notice}>
                WhatsApp OTP · Demo mode
                <br />
                Test contacts use <strong>123456</strong>. No WhatsApp message
                is sent.
              </p>
            )}
          </div>
          <h2 style={{ fontSize: ".95rem", margin: 0 }}>Brand identity</h2>
          <label>
            Display name
            <input
              value={data.brand.name}
              maxLength={100}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </label>
          <label>
            <span>
              <Upload size={14} style={{ display: "inline" }} /> Logo · PNG,
              JPEG or WebP, up to 300 KB
            </span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (
                  file.size > 300000 ||
                  !["image/png", "image/jpeg", "image/webp"].includes(file.type)
                ) {
                  setError("Choose a PNG, JPEG or WebP logo up to 300 KB.");
                  return;
                }
                const reader = new FileReader();
                reader.onload = () => patch({ logo: String(reader.result) });
                reader.readAsDataURL(file);
              }}
            />
          </label>
          {data.brand.logo && (
            <button className={s.button} onClick={() => patch({ logo: "" })}>
              Use name & initials instead
            </button>
          )}
          <div className={s.grid}>
            <label>
              Primary colour
              <input
                type="color"
                value={data.brand.primaryColor}
                onChange={(e) => patch({ primaryColor: e.target.value })}
              />
            </label>
            <label>
              Accent colour
              <input
                type="color"
                value={data.brand.accentColor}
                onChange={(e) => patch({ accentColor: e.target.value })}
              />
            </label>
          </div>
          <label>
            Appearance
            <select
              value={data.brand.layout}
              onChange={(e) =>
                patch({ layout: e.target.value as PortalBrand["layout"] })
              }
            >
              <option value="soft">Soft gradient</option>
              <option value="minimal">Minimal white</option>
            </select>
          </label>
          <label>
            Welcome title
            <input
              value={data.brand.welcomeTitle}
              maxLength={120}
              onChange={(e) => patch({ welcomeTitle: e.target.value })}
            />
          </label>
          <label>
            Welcome message
            <textarea
              value={data.brand.welcomeText}
              maxLength={500}
              onChange={(e) => patch({ welcomeText: e.target.value })}
            />
          </label>
          <label>
            Support WhatsApp number · optional
            <input
              type="tel"
              placeholder="+971501234567"
              value={data.brand.supportPhone}
              onChange={(e) => patch({ supportPhone: e.target.value })}
            />
          </label>
        </fieldset>
        <aside
          className={s.preview}
          style={{
            ...style,
            background:
              data.brand.layout === "soft"
                ? `linear-gradient(135deg,color-mix(in srgb,${data.brand.primaryColor} 15%,white),color-mix(in srgb,${data.brand.accentColor} 9%,white))`
                : "#fff",
            color: "#202522",
          }}
        >
          <p className={s.previewLabel}>Live preview · mobile login</p>
          <BrandLogo brand={data.brand} />
          <div style={{ marginTop: "3rem" }}>
            <h2
              style={{
                fontSize: "1.7rem",
                lineHeight: 1.25,
                letterSpacing: "-.04em",
              }}
            >
              {data.brand.welcomeTitle}
            </h2>
            <p
              style={{ fontSize: ".85rem", lineHeight: 1.7, color: "#58615c" }}
            >
              {data.brand.welcomeText}
            </p>
            <div
              style={{
                marginTop: "2rem",
                padding: "1rem",
                background: "white",
                borderRadius: ".6rem",
              }}
            >
              <small style={{ color: "#58615c" }}>WhatsApp mobile number</small>
              <p>+971 50 123 4567</p>
            </div>
            <div
              className={s.primary}
              style={{ display: "flex", marginTop: ".8rem" }}
            >
              Continue with WhatsApp
            </div>
            <p
              style={{
                textAlign: "center",
                fontSize: ".7rem",
                color: "#58615c",
              }}
            >
              A private space, shared with you.
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}
