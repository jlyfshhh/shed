declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    ANTHROPIC_API_KEY?: string;
    SHED_VOICE_TOKEN?: string;
    SHED_TIME_ZONE?: string;
    SHED_AUTH_REQUIRED?: string;
  }
}
