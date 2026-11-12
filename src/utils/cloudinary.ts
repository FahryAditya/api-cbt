import crypto from "crypto";

function getCloudinaryConfig() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  const apiKey = process.env.CLOUDINARY_API_KEY?.trim();
  const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error(
      "Konfigurasi Cloudinary belum lengkap (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET)."
    );
  }

  return { cloudName, apiKey, apiSecret };
}

function signCloudinaryParams(params: Record<string, string | number>, apiSecret: string): string {
  const sorted = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== "")
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");

  return crypto.createHash("sha1").update(`${sorted}${apiSecret}`).digest("hex");
}

function sanitizeFilename(name: string): string {
  return name
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 100);
}

export async function uploadSoftfileToCloudinary(opts: {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  folder: string;
}): Promise<{ secureUrl: string; publicId: string; bytes: number }> {
  const { cloudName, apiKey, apiSecret } = getCloudinaryConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const safeName = sanitizeFilename(opts.fileName) || `soal_${timestamp}`;
  const publicId = `${timestamp}_${safeName}`;

  const signature = signCloudinaryParams(
    {
      folder: opts.folder,
      public_id: publicId,
      timestamp,
    },
    apiSecret
  );

  const formData = new FormData();
  const uint8 = new Uint8Array(opts.buffer);
  const blob = new Blob([uint8], { type: opts.mimeType || "application/octet-stream" });
  formData.append("file", blob, opts.fileName);
  formData.append("api_key", apiKey);
  formData.append("timestamp", String(timestamp));
  formData.append("folder", opts.folder);
  formData.append("public_id", publicId);
  formData.append("signature", signature);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/raw/upload`, {
    method: "POST",
    body: formData,
  });

  const data: any = await res.json().catch(() => null);
  if (!res.ok || !data?.secure_url) {
    throw new Error(data?.error?.message || `Upload Cloudinary gagal (HTTP ${res.status}).`);
  }

  return {
    secureUrl: String(data.secure_url),
    publicId: String(data.public_id),
    bytes: Number(data.bytes || opts.buffer.length),
  };
}

export async function deleteFromCloudinary(publicId: string): Promise<void> {
  if (!publicId) return;
  const { cloudName, apiKey, apiSecret } = getCloudinaryConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signCloudinaryParams({ public_id: publicId, timestamp }, apiSecret);

  const formData = new FormData();
  formData.append("public_id", publicId);
  formData.append("api_key", apiKey);
  formData.append("timestamp", String(timestamp));
  formData.append("signature", signature);

  await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/raw/destroy`, {
    method: "POST",
    body: formData,
  }).catch(() => null);
}
