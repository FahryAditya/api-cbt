import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

// In-memory fallback cache when Redis is unavailable or offline
const memoryCache = new Map<string, { value: any; expiry: number | null }>();

let isRedisConnected = false;
let redisClient: Redis | null = null;

try {
  redisClient = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 1,
    retryStrategy: () => null, // don't spam reconnect if server is offline
    lazyConnect: true,
  });

  redisClient.connect().then(() => {
    isRedisConnected = true;
    console.log("⚡ [Redis] Terhubung ke Redis Server:", REDIS_URL);
  }).catch((err) => {
    isRedisConnected = false;
    console.warn("⚠️  [Redis] Server offline, beralih ke Fast In-Memory Fallback Cache:", err.message);
  });

  redisClient.on("error", (err) => {
    isRedisConnected = false;
  });
} catch (err: any) {
  isRedisConnected = false;
  console.warn("⚠️  [Redis] Inisialisasi fallback:", err?.message);
}

/**
 * Simpan data ke cache dengan opsi TTL (Time To Live dalam detik)
 */
export async function cacheSet(key: string, value: any, ttlSeconds?: number): Promise<void> {
  const serialized = JSON.stringify(value);
  if (isRedisConnected && redisClient) {
    try {
      if (ttlSeconds) {
        await redisClient.set(key, serialized, "EX", ttlSeconds);
      } else {
        await redisClient.set(key, serialized);
      }
      return;
    } catch {
      // fallback to memory
    }
  }

  // Memory fallback
  const expiry = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
  memoryCache.set(key, { value, expiry });
}

/**
 * Ambil data dari cache
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  if (isRedisConnected && redisClient) {
    try {
      const data = await redisClient.get(key);
      if (data) return JSON.parse(data) as T;
      return null;
    } catch {
      // fallback to memory
    }
  }

  // Memory fallback
  const cached = memoryCache.get(key);
  if (!cached) return null;

  if (cached.expiry && Date.now() > cached.expiry) {
    memoryCache.delete(key);
    return null;
  }

  return cached.value as T;
}

/**
 * Hapus key dari cache
 */
export async function cacheDel(key: string): Promise<void> {
  if (isRedisConnected && redisClient) {
    try {
      await redisClient.del(key);
    } catch {
      // ignore
    }
  }
  memoryCache.delete(key);
}

export default redisClient;

