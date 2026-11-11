import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// 1. Загрузка ключей на сервер (выполняется клиентом после логина)
export const uploadKeys = async (req: Request, res: Response) => {
  try {
    const { 
      userId, 
      identityKey, 
      signedPreKeyId, 
      signedPreKeyPublic, 
      signedPreKeySig, 
      oneTimeKeys, // ✅ Массив ключей
      registrationId 
    } = req.body;

    if (!userId || !identityKey) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // 1. Обновляем/создаём основные ключи
    await prisma.cryptoKeys.upsert({
      where: { userId },
      update: {
        identityKey,
        signedPreKeyId,
        signedPreKeyPublic,
        signedPreKeySig,
        registrationId: registrationId || Math.floor(Math.random() * 16380) + 1,
        lastBundleUpdate: new Date()
      },
      create: {
        userId,
        identityKey,
        signedPreKeyId,
        signedPreKeyPublic,
        signedPreKeySig,
        registrationId: registrationId || Math.floor(Math.random() * 16380) + 1,
        lastBundleUpdate: new Date()
      }
    });

    // ✅ 2. СОХРАНЯЕМ One-Time PreKeys (самое важное!)
    if (oneTimeKeys && Array.isArray(oneTimeKeys) && oneTimeKeys.length > 0) {
      // Сначала удаляем старые ключи этого пользователя (опционально, чтобы не дублировать)
      await prisma.oneTimePreKey.deleteMany({ where: { userId } });

      // Создаём новые
      const keysToCreate = oneTimeKeys.map((key: any) => ({
        userId,
        keyId: key.keyId,
        publicKey: key.publicKey
      }));

      await prisma.oneTimePreKey.createMany({
        data: keysToCreate,
        skipDuplicates: true // На случай если ключи уже есть
      });
      
      console.log(`✅ Saved ${keysToCreate.length} One-Time PreKeys for ${userId}`);
    }

    res.json({ success: true, message: "Keys uploaded successfully" });
    
  } catch (error) {
    console.error("❌ Upload keys error:", error);
    res.status(500).json({ error: "Failed to upload keys" });
  }
};

// 2. Получение "пакета" ключей другого пользователя (для начала чата)
export const getKeysBundle = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    // ✅ Обязательно указываем include, иначе oneTimePreKeys будут пустыми!
    const keys = await prisma.cryptoKeys.findUnique({
      where: { userId },
      include: {
        oneTimePreKeys: true 
      }
    });

    if (!keys) {
      return res.status(404).json({ error: "Keys not found for this user" });
    }

    // ✅ Формируем ответ в точности как ожидает Android
    const bundle = {
      identityKey: keys.identityKey,
      signedPreKeyId: keys.signedPreKeyId,
      signedPreKeyPublic: keys.signedPreKeyPublic,
      signedPreKeySig: keys.signedPreKeySig,
      registrationId: keys.registrationId || 1,
      oneTimeKeys: keys.oneTimePreKeys.map(k => ({
        keyId: k.keyId,
        publicKey: k.publicKey
      }))
    };

    console.log(`📤 Sending keys bundle for ${userId}`);
    res.json(bundle);
  } catch (error) {
    console.error("❌ Fetch keys error:", error);
    res.status(500).json({ error: "Failed to fetch keys" });
  }
};
