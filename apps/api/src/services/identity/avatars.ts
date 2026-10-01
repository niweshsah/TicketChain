import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { config } from '../../shared/config';
import { one, transaction } from '../../shared/db';
import { assertRule, requireValue, AppError } from '../../shared/errors';
import { type Account } from '../../shared/types';

export const storage = new S3Client({
  endpoint: config.AVATAR_S3_ENDPOINT,
  region: 'us-east-1',
  forcePathStyle: true,
  credentials: {
    accessKeyId: config.AVATAR_S3_ACCESS_KEY,
    secretAccessKey: config.AVATAR_S3_SECRET_KEY,
  },
});

export const Bucket = config.AVATAR_S3_BUCKET;

export async function processAvatar(input: Buffer): Promise<Buffer> {
  assertRule(
    input.length > 0 && input.length <= 5 * 1024 * 1024,
    'INVALID_IMAGE',
    'Images must be at most 5 MB',
    400,
  );
  try {
    const decoder = sharp(input, {
      limitInputPixels: 20000000,
      failOn: 'warning',
    });
    const metadata = await decoder.metadata();
    assertRule(
      ['jpeg', 'png', 'webp'].includes(metadata.format || '') &&
        (metadata.pages || 1) === 1,
      'INVALID_IMAGE',
      'Use a single JPEG, PNG or WebP image',
      400,
    );
    return await decoder
      .rotate()
      .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      400,
      'INVALID_IMAGE',
      'Cannot decode image. Use JPEG, PNG or WebP up to 20 megapixels.',
    );
  }
}

export async function replaceAvatar(userId: string, input: Buffer | null) {
  const Key = input ? `${userId}/${randomUUID()}.webp` : null;
  if (input && Key) {
    const Body = await processAvatar(input);
    // Bucket creation is idempotent locally. Production can provision the bucket separately.
    try {
      await storage.send(new CreateBucketCommand({ Bucket }));
    } catch (error) {
      if (
        !['BucketAlreadyOwnedByYou', 'BucketAlreadyExists'].includes(
          (error as Error).name,
        )
      )
        throw error;
    }
    await storage.send(
      new PutObjectCommand({ Bucket, Key, Body, ContentType: 'image/webp' }),
    );
  }
  let previousKey: string | null = null;
  let account: Account;
  try {
    account = await transaction(async (tx) => {
      const current = requireValue(
        await one<Account>(
          tx,
          'SELECT * FROM tc_account WHERE id=$1::uuid FOR UPDATE',
          userId,
        ),
      );
      previousKey = current.avatar_key;
      return requireValue(
        await one<Account>(
          tx,
          'UPDATE tc_account SET avatar_key=$2 WHERE id=$1::uuid RETURNING *',
          userId,
          Key,
        ),
      );
    });
  } catch (error) {
    if (Key)
      await storage
        .send(new DeleteObjectCommand({ Bucket, Key }))
        .catch(() => undefined);
    throw error;
  }
  if (previousKey)
    await storage
      .send(new DeleteObjectCommand({ Bucket, Key: previousKey }))
      .catch(() => undefined);
  return account;
}

export async function avatarImage(key: string) {
  assertRule(
    /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.webp$/.test(key),
    'NOT_FOUND',
    'Image not found',
    404,
  );
  try {
    const result = await storage.send(
      new GetObjectCommand({ Bucket, Key: key }),
    );
    return Buffer.from(await result.Body!.transformToByteArray());
  } catch {
    throw new AppError(404, 'NOT_FOUND', 'Image not found');
  }
}
