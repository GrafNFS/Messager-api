import { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';

const prisma = new PrismaClient();

// 1. Загрузка/пополнение ключей (вызывается клиентом после регистрации и при ротации)
export const uploadKeys = async (req: AuthRequest, res: Response) => {
  try {
    // userId БЕРЁМ ИЗ ТОКЕНА — клиентский userId из тела игнорируем.
    // Иначе любой мог бы перезаписать чужие ключи = полный MITM.
    const userId = req.user!.id;
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
      // Не генерируем случайный registrationId на сервере —
      // он обязан совпадать с клиентским SignalProtocolStore.
      return res.status(400).json({ error: 'registrationId is required' });
    }

    await prisma.cryptoKeys.upsert({
      where: { userId },
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
        identityKey,
        signedPreKeyId: signedPreKeyId ?? 0,
        signedPreKeyPublic,
        signedPreKeySig,
        registrationId,
        lastBundleUpdate: new Date()
      }
    });

    // Пополняем запас ОДНОРАЗОВЫХ ключей.
    // ВАЖНО: старые ключи НЕ удаляем — этот endpoint теперь и есть механизм ротации.
    if (Array.isArray(oneTimeKeys) && oneTimeKeys.length > 0) {
      await prisma.oneTimePreKey.createMany({
        data: oneTimeKeys.map((k: any) => ({
          userId,
          keyId: k.keyId,
          publicKey: k.publicKey
        })),
        skipDuplicates: true
      });
    }

    const remaining = await prisma.oneTimePreKey.count({ where: { userId } });
    res.json({ success: true, remaining });
  } catch (error) {
    console.error('Upload keys error:', error);
    res.status(500).json({ error: 'Failed to upload keys' });
  }
};

// 2. Prekey bundle другого пользователя.
// Публичные ключи — публичны, но отдаём РОВНО ОДИН one-time prekey
// и сразу удаляем его транзакцией (он одноразовый).
export const getKeysBundle = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.params.userId as string;

    const keys = await prisma.cryptoKeys.findUnique({
      where: { userId },
      include: { oneTimePreKeys: { orderBy: { keyId: 'asc' }, take: 1 } }
    });

    // Ключи ещё не загружены (или 'pending'-заглушка) — не отдаём мусор
    if (!keys || keys.identityKey === 'pending' || !keys.signedPreKeyPublic) {
      return res.status(404).json({ error: 'Keys not found for this user' });
    }

    // Атомарно забираем один OTK
    let givenKey: { keyId: number; publicKey: string } | null = null;
    const candidate = keys.oneTimePreKeys[0];
    if (candidate) {
      const deleted = await prisma.oneTimePreKey.deleteMany({
        where: { id: candidate.id, userId } // deleteMany как атомарный DELETE по id
      });
      if (deleted.count === 1) {
        givenKey = { keyId: candidate.keyId, publicKey: candidate.publicKey };
      }
    }

    res.json({
      identityKey: keys.identityKey,
      signedPreKeyId: keys.signedPreKeyId,
      signedPreKeyPublic: keys.signedPreKeyPublic,
      signedPreKeySig: keys.signedPreKeySig,
      registrationId: keys.registrationId ?? 1,
      // 0 или 1 ключ — клиент libsignal умеет работать и без OTK (X3DH со signed prekey)
      oneTimeKeys: givenKey ? [givenKey] : []
    });
  } catch (error) {
    console.error('Fetch keys error:', error);
    res.status(500).json({ error: 'Failed to fetch keys' });
  }
};

// 3. Сколько one-time prekeys осталось на сервере (для ротации на клиенте)
export const getRemainingPreKeys = async (req: AuthRequest, res: Response) => {
  try {
    const count = await prisma.oneTimePreKey.count({ where: { userId: req.user!.id } });
    res.json({ remaining: count });
  } catch (error) {
    res.status(500).json({ error: 'Failed to count keys' });
  }
};