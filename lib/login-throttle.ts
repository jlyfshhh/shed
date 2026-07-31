type AttemptState = {
  failures: number;
  windowStartedAt: number;
  blockedUntil: number;
};

export type ThrottleResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

export class LoginThrottle {
  private state: AttemptState = { failures: 0, windowStartedAt: 0, blockedUntil: 0 };
  private readonly maxFailures: number;
  private readonly windowMs: number;
  private readonly blockMs: number;

  constructor(
    maxFailures = 10,
    windowMs = 10 * 60_000,
    blockMs = 15 * 60_000,
  ) {
    this.maxFailures = maxFailures;
    this.windowMs = windowMs;
    this.blockMs = blockMs;
  }

  check(now = Date.now()): ThrottleResult {
    if (this.state.blockedUntil > now) {
      return { allowed: false, retryAfterSeconds: Math.ceil((this.state.blockedUntil - now) / 1000) };
    }
    if (this.state.windowStartedAt && now - this.state.windowStartedAt >= this.windowMs) {
      this.reset();
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }

  fail(now = Date.now()): ThrottleResult {
    if (!this.state.windowStartedAt || now - this.state.windowStartedAt >= this.windowMs) {
      this.state = { failures: 0, windowStartedAt: now, blockedUntil: 0 };
    }
    this.state.failures += 1;
    if (this.state.failures >= this.maxFailures) {
      this.state.blockedUntil = now + this.blockMs;
      return { allowed: false, retryAfterSeconds: Math.ceil(this.blockMs / 1000) };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }

  success(): void {
    this.reset();
  }

  reset(): void {
    this.state = { failures: 0, windowStartedAt: 0, blockedUntil: 0 };
  }
}

export const loginThrottle = new LoginThrottle();
