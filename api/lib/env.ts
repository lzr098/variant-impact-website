import "dotenv/config";

function envVar(name: string): string {
  return process.env[name] ?? "";
}

export const env = {
  appId: envVar("APP_ID"),
  appSecret: envVar("APP_SECRET"),
  isProduction: process.env.NODE_ENV === "production",
  databaseUrl: envVar("DATABASE_URL"),
};
