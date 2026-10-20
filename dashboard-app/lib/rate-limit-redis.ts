import { Redis } from "@upstash/redis";
import { RateLimitStore } from "./rate-limit-store";

// Atomic Lua script for sliding-window counter rate limiting.
// Keys:   KEYS[1]   rate limit key
// Args:   ARGV[1]   window in milliseconds
//         ARGV[2]   max requests allowed in the window
//         ARGV[3]   current timestamp in milliseconds
// Returns: [allowed (1/0), remaining, resetAt]
const RATE_LIMIT_SCRIPT = `
local key = KEYS[1]
local window = tonumber(ARGV[1])
local max = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local current = redis.call("GET", key)
if not current then
  redis.call("SET", key, 1, "PX", window)
  return {1, max - 1, now + window}
end

local count = tonumber(current)
local ttl = redis.call("PTTL", key)
if ttl < 0 then ttl = window end

if count >= max then
  return {0, 0, now + ttl}
end

redis.call("INCR", key)
return {1, max - count - 1, now + ttl}
`;

export interface UpstashRedisRateLimitStoreOptions {
  url: string;
  token: string;
}

export class UpstashRedisRateLimitStore implements RateLimitStore {
  private readonly redis: Redis;

  constructor(options: UpstashRedisRateLimitStoreOptions) {
    if (!options.url || !options.token) {
      throw new Error("Upstash Redis rate limiting requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN");
    }
    this.redis = new Redis({ url: options.url, token: options.token });
  }

  async increment(
    key: string,
    windowMs: number,
    maxRequests: number
  ): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
    const now = Date.now();
    const result = (await this.redis.eval(
      RATE_LIMIT_SCRIPT,
      [key],
      [String(windowMs), String(maxRequests), String(now)]
    )) as [number, number, number];

    return {
      allowed: result[0] === 1,
      remaining: Math.max(0, result[1]),
      resetAt: result[2],
    };
  }
}
