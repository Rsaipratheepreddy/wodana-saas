import type { Preview } from "@storybook/nextjs-vite";
import { DesignSystemProvider } from "../design-system";
import "../app/globals.css";

const preview: Preview = {
  decorators: [
    (Story, context) => (
      <DesignSystemProvider
        density={context.globals.density}
        direction={context.globals.direction}
        locale={context.globals.direction === "rtl" ? "ar-AE" : "en-AE"}
        theme={context.globals.theme}
      >
        <div style={{ minHeight: "100vh", padding: 24 }}><Story /></div>
      </DesignSystemProvider>
    ),
  ],
  globalTypes: {
    theme: { description: "Theme", defaultValue: "light", toolbar: { icon: "paintbrush", items: ["light", "dark", "high-contrast"] } },
    density: { description: "Density", defaultValue: "comfortable", toolbar: { icon: "component", items: ["comfortable", "compact"] } },
    direction: { description: "Direction", defaultValue: "ltr", toolbar: { icon: "transfer", items: ["ltr", "rtl"] } },
  },
  parameters: {
    a11y: { test: "error" },
    controls: { expanded: true },
    layout: "fullscreen",
  },
};

export default preview;
