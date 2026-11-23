import { defineConfig } from "astro/config";

// A static site: one page, built to plain files. No adapter is needed for Vercel.
export default defineConfig({
  site: "https://reelseasy.com",
  devToolbar: { enabled: false },
});
