import type { NextConfig } from "next";
import { versionFromCommitSha } from "./lib/version";

const buildVersion = versionFromCommitSha(process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA);
const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_GAME_VERSION: buildVersion
  }
};

export default nextConfig;
