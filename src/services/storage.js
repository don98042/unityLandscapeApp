import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';

const s3 = new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' });

export async function uploadPhoto(buffer) {
  const key = `photos/${new Date().toISOString().slice(0,10)}/${randomUUID()}.jpg`;
  await s3.send(new PutObjectCommand({
    Bucket:      'field-quote-photos',
    Key:         key,
    Body:        buffer,
    ContentType: 'image/jpeg',
  }));
  return key;
}
