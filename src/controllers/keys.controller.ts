import { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';

const prisma = new PrismaClient();

// 1. Загрузка/пополнение ключей устройства. body: { deviceId, identityKey,
//    signedPreKeyId, signedPreKeyPublic, signedPreKeySig, oneTimeKeys, registrationId }
export const uploadKeys = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const deviceId = String(req.body.deviceId || '1');
    const {
      identityKey,
      signedPreKeyId,
      signedPreKeyPublic,
      signedPreKeySig,
      oneTimeKeys,
      registrationId
    } = req.body;

    if (!identityKey || !signedPreKeyPublic || !signedPreKeySig) {
      return res.status(400).json({ error: 'Missing required key fields' });
    }
    if (!registrationId || typeof registrationId !== 'number') {
      return res.status(400).json({ error: 'registrationId is required' });
    }

    await prisma.deviceKeys.upsert({
      where: { userId_deviceId: { userId, deviceId } },
      update: {
        identityKey,
        signedPreKeyId: signedPreKeyId ?? 0,
        signedPreKeyPublic,
        signedPreKeySig,
        registrationId,
        lastBundleUpdate: new Date()
      },
      create: {
        userId,
        deviceId,
        identityKey,
        signedPreKeyId: signedPreKeyId ?? 0,
        signedPreKeyPublic,
        signedPreKeySig,
        registrationId,
        lastBundleUpdate: new Date()
      }
    });

    if (Array.isArray(oneTimeKeys) && oneTimeKeys.length > 0) {
      await prisma.deviceOneTimePreKey.createMany({
        data: oneTimeKeys.map((k: any) => ({ userId, deviceId, keyId: k.keyId, publicKey: k.publicKey })),
        skipDuplicates: true
      });
    }

    const remaining = await prisma.deviceOneTimePreKey.count({ where: { userId, deviceId } });
    res.json({ success: true, remaining });
  } catch (error) {
    console.error('Upload keys error:', error);
    res.status(500).json({ error: 'Failed to upload keys' });
  }
};

// 2. Бандлы ВСЕХ устройств пользователя (для мульти-девайс шифрования).
//    Каждый bundle содержит ровно один one-time prekey (удаляется при выдаче).
//    Легаси CryptoKeys отдаётся как устройство '1' для плавной миграции.
export const getDevicesBundle = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.params.userId as string;

    const deviceKeys = await prisma.deviceKeys.findMany({
      where: { userId },
      orderBy: { lastBundleUpdate: 'asc' }
    });

    const devices = [];
    for (const dk of deviceKeys) {
      if (dk.identityKey === 'pending' || !dk.signedPreKeyPublic) continue;

      let givenKey: { keyId: number; publicKey: string } | null = null;
      const candidate = await prisma.deviceOneTimePreKey.findFirst({
        where: { userId, deviceId: dk.deviceId },
        orderBy: { keyId: 'asc' }
      });
      if (candidate) {
        const deleted = await prisma.deviceOneTimePreKey.deleteMany({
          where: { id: candidate.id, userId, deviceId: dk.deviceId }
        });
        if (deleted.count === 1) {
          givenKey = { keyId: candidate.keyId, publicKey: candidate.publicKey };
        }
      }

      devices.push({
        deviceId: dk.deviceId,
        identityKey: dk.identityKey,
        signedPreKeyId: dk.signedPreKeyId,
        signedPreKeyPublic: dk.signedPreKeyPublic,
        signedPreKeySig: dk.signedPreKeySig,
        registrationId: dk.registrationId ?? 1,
        oneTimeKeys: givenKey ? [givenKey] : []
      });
    }

    // Легаси: старые ключи (до мульти-девайса) — как устройство '1'
    if (devices.length === 0) {
      const legacy = await prisma.cryptoKeys.findUnique({
        where: { userId },
        include: { oneTimePreKeys: { orderBy: { keyId: 'asc' }, take: 1 } }
      });
      if (legacy && legacy.identityKey !== 'pending' && legacy.signedPreKeyPublic) {
        let givenKey: { keyId: number; publicKey: string } | null = null;
        const candidate = legacy.oneTimePreKeys[0];
        if (candidate) {
          const deleted = await prisma.oneTimePreKey.deleteMany({ where: { id: candidate.id, userId } });
          if (deleted.count === 1) {
            givenKey = { keyId: candidate.keyId, publicKey: candidate.publicKey };
          }
        }
        devices.push({
          deviceId: '1',
          identityKey: legacy.identityKey,
          signedPreKeyId: legacy.signedPreKeyId,
          signedPreKeyPublic: legacy.signedPreKeyPublic,
          signedPreKeySig: legacy.signedPreKeySig,
          registrationId: legacy.registrationId ?? 1,
          oneTimeKeys: givenKey ? [givenKey] : []
        });
      }
    }

    if (devices.length === 0) {
      return res.status(404).json({ error: 'Keys not found for this user' });
    }

    res.json({ devices });
  } catch (error) {
    console.error('Fetch keys error:', error);
    res.status(500).json({ error: 'Failed to fetch keys' });
  }
};

// 3. Только identity-ключ (для safety number) — БЕЗ расхода one-time prekeys
export const getIdentityKey = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.params.userId as string;
    const dk = await prisma.deviceKeys.findFirst({
      where: { userId },
      orderBy: { lastBundleUpdate: 'asc' },
      select: { identityKey: true }
    });
    const identityKey = dk?.identityKey
      ?? (await prisma.cryptoKeys.findUnique({ where: { userId }, select: { identityKey: true } }))?.identityKey;
    if (!identityKey || identityKey === 'pending') {
      return res.status(404).json({ error: 'Keys not found' });
    }
    res.json({ identityKey });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch identity key' });
  }
};

// 4. Остаток one-time prekeys устройства (для ротации)
export const getRemainingPreKeys = async (req: AuthRequest, res: Response) => {
  try {
    const deviceId = String(req.query.deviceId || '1');
    const count = await prisma.deviceOneTimePreKey.count({ where: { userId: req.user!.id, deviceId } });
    res.json({ remaining: count, deviceId });
  } catch (error) {
    res.status(500).json({ error: 'Failed to count keys' });
  }
};

// 5. Загрузка ТОЛЬКО one-time prekeys устройства (ротация)
export const uploadOneTimeKeys = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const deviceId = String(req.body.deviceId || '1');
    const { oneTimeKeys } = req.body;

    if (!Array.isArray(oneTimeKeys) || oneTimeKeys.length === 0) {
      return res.status(400).json({ error: 'oneTimeKeys is required' });
    }

    await prisma.deviceOneTimePreKey.createMany({
      data: oneTimeKeys.map((k: any) => ({ userId, deviceId, keyId: k.keyId, publicKey: k.publicKey })),
      skipDuplicates: true
    });

    const remaining = await prisma.deviceOneTimePreKey.count({ where: { userId, deviceId } });
    res.json({ success: true, remaining });
  } catch (error) {
    console.error('Upload one-time keys error:', error);
    res.status(500).json({ error: 'Failed to upload one-time keys' });
  }
};
