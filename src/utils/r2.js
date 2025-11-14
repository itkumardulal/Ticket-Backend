import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const s3Client = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME;
const PUBLIC_URL = process.env.R2_PUBLIC_URL;

/**
 * Upload QR code image to Cloudflare R2
 * @param {Buffer} buffer - Image buffer
 * @param {string} filename - Filename (e.g., "ticket-{token}.png")
 * @returns {Promise<string>} Public URL of uploaded image
 */
export async function uploadQRToR2(buffer, filename) {
  try {
    const key = `qrcodes/${filename}`;
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: "image/png",
      CacheControl: "public, max-age=31536000",
    });

    await s3Client.send(command);
    const publicUrl = `${PUBLIC_URL}/${key}`;
    return publicUrl;
  } catch (error) {
    console.error("Failed to upload QR to R2:", error);
    throw error;
  }
}
