import { tokens } from '../design-system/tokens.generated';
import { fontFamilies } from '../design-system/font-families';
import { workspacePrimaryColorStyle } from '../../../web/lib/workspace/primary-color';

export type Palette = { [K in keyof typeof tokens.colors.light]: string };
export type Theme = {
  scheme: 'light' | 'dark';
  colors: Palette;
  /** The 4px grid: space(4) = 16. */
  space: (steps: number) => number;
  radius: typeof tokens.radius;
  size: typeof tokens.fontSize;
  font: { regular: string; medium: string; semibold: string; bold: string };
  motion: typeof tokens.motion;
  /** Touch sizes: the smallest target (44) and a standard control (48). */
  touch: { min: number; control: number; large: number };
  /** Right-to-left layout: rows already flip; icons that point a way mirror with it. */
  rtl: boolean;
};

export type Brand = { primaryColor?: string | null; secondaryColor?: string | null } | null | undefined;

/**
 * The palette for the device's appearance with the tenant's co-branding: the same accessible action
 * colours the web derives from the brand (actions, focus and selection follow it; text stays readable).
 */
export function buildTheme(scheme: 'light' | 'dark', brand?: Brand, script: 'latin' | 'arabic' = 'latin', rtl = false): Theme {
  const base = { ...(tokens.colors.light as Palette), ...(scheme === 'dark' ? (tokens.colors.dark as Partial<Palette>) : {}) } as Palette;
  const colors = { ...base };
  const style = brand ? (workspacePrimaryColorStyle({ primaryColor: brand.primaryColor, secondaryColor: brand.secondaryColor }) as Record<string, string> | undefined) : undefined;
  const mode = scheme === 'dark' ? 'dark' : 'light';
  const action = style?.[`--wd-workspace-action-${mode}-primary`];
  if (action) {
    colors.actionPrimary = action;
    colors.actionPrimaryHover = style[`--wd-workspace-action-${mode}-hover`] ?? action;
    colors.actionPrimaryPressed = style[`--wd-workspace-action-${mode}-pressed`] ?? action;
    colors.actionPrimarySubtle = style[`--wd-workspace-action-${mode}-subtle`] ?? base.actionPrimarySubtle;
    colors.actionOnPrimary = style[`--wd-workspace-action-${mode}-on`] ?? (mode === 'light' ? '#FFFFFF' : base.actionOnPrimary);
    colors.navigationSelected = colors.actionPrimarySubtle;
    colors.focus = action;
    colors.link = action;
  }
  return {
    scheme, colors, space: (steps) => steps * 4, radius: tokens.radius, size: tokens.fontSize,
    font: fontFamilies[script], motion: tokens.motion, touch: { min: 44, control: 48, large: 56 }, rtl,
  };
}

