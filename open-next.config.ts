import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default {
  ...defineCloudflareConfig({}),
  buildCommand:
    "if [ -f .env.cloudflare ]; then next build --env-file=.env.cloudflare; else next build; fi",
};
