declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    SHED_TIME_ZONE?: string;
    SHED_AUTH_REQUIRED?: string;
    SHED_BOOTSTRAP_TOKEN?: string;
    SHED_DISPLAY_TOKEN?: string;
  }
}
