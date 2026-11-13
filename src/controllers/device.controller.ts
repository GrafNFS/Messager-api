import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { messaging } from '../firebase';

const prisma = new PrismaClient();

// 🌟 НОВЫЙ МЕТОД: Отправка "тихого" пуша с зашифрованными данными Signal/AES
export const sendSilentMessagePush = async (
  userId: string,
  from: string,
  messageId: string,
  payload: any,
  typeMsg: string
) => {
  try {
    // Находим все активные устройства получателя пуша
    const devices = await prisma.device.findMany({
      where: {
        userId,
        isActive: true,
        pushToken: { not: null }
      }
    });
    var encryptedPayload = ""

    if (devices.length === 0) {
      console.log(`[FCM] ⚠️ Нет активных устройств для пуша пользователю ${userId}`);
      return;
    }

    if (typeMsg == "text") {
      encryptedPayload = JSON.stringify(payload)
    }
    // Собираем "тихий" Data-пакет
    const message = {
      data: {
        senderId: from,
        messageId: messageId,
        timestamp: Date.now().toString(),
        // Сериализуем зашифрованный payload сокета в строку для Android клиентов
        encryptedPayload: encryptedPayload,
        typeMsg: typeMsg
      },
      tokens: devices.map(d => d.pushToken!)
    };

    // Отправляем через мультикаст Firebase
    const response = await messaging.sendEachForMulticast(message);
    console.log(`[FCM] 🚀 Тихий пуш для ${userId}: ${response.successCount} отправлено, ${response.failureCount} сбоев`);

    if (response.failureCount > 0) {
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          // 🌟 ДОБАВЛЯЕМ ЭТОТ ЛОГ: выведет точный код и описание ошибки от Google
          console.error(`[FCM] ❌ Детали сбоя для токена #${idx}:`, resp.error?.code, resp.error?.message);

          const invalidToken = resp.error?.code === 'messaging/invalid-registration-token' ||
                              resp.error?.code === 'messaging/registration-token-not-registered';
          if (invalidToken) {
            prisma.device.update({
              where: { id: devices[idx].id },
              data: { isActive: false }
            }).catch(console.error);
          }
        }
      });
    }
  } catch (error) {
    console.error('[FCM] ❌ Ошибка multicast отправки пуша:', error);
  }
};

// Регистрация устройства (сохранение FCM токена)
export const registerDevice = async (req: Request, res: Response) => {
  try {
    const { userId, deviceId, pushToken, platform } = req.body;

    if (!userId || !deviceId || !pushToken) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Сохраняем или обновляем устройство
    await prisma.device.upsert({
      where: {
        userId_deviceId: { userId, deviceId }
      },
      update: {
        pushToken,
        isActive: true,
        lastSeen: new Date()
      },
      create: {
        userId,
        deviceId,
        pushToken,
        isActive: true
      }
    });
    console.log(`[FCM] Зарегестрирован ${userId}`);
    res.json({ success: true });
  } catch (error) {
    console.error('Register device error:', error);
    res.status(500).json({ error: 'Failed to register device' });
  }
};

// Удаление устройства (при выходе из аккаунта)
export const unregisterDevice = async (req: Request, res: Response) => {
  try {
    const { deviceId } = req.params;
    await prisma.device.update({
      where: { id: deviceId },
      data: { isActive: false }
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to unregister device' });
  }
};

// Вспомогательная функция: отправка пуша пользователю
export const sendPushToUser = async (
  userId: string,
  title: string,
  body: string,
  data: Record<string, string> = {}
) => {
  try {
    // Находим все активные устройства пользователя с токенами
    const devices = await prisma.device.findMany({
      where: {
        userId,
        isActive: true,
        pushToken: { not: null }
      }
    });

    if (devices.length === 0) {
      console.log(`No active devices for user ${userId}`);
      return;
    }

    // Формируем сообщение для Firebase
    const message = {
      notification: {
        title,
        body
      },
      data: {
        ...data,
        timestamp: Date.now().toString()
      },
      tokens: devices.map(d => d.pushToken!)
    };

    // Отправляем через Firebase
    const response = await messaging.sendEachForMulticast(message);
    
    console.log(`Push sent to user ${userId}: ${response.successCount} success, ${response.failureCount} failed`);

    // Если токен невалиден — помечаем устройство как неактивное
    if (response.failureCount > 0) {
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const invalidToken = resp.error?.code === 'messaging/invalid-registration-token' ||
                              resp.error?.code === 'messaging/registration-token-not-registered';
          if (invalidToken) {
            prisma.device.update({
              where: { id: devices[idx].id },
              data: { isActive: false }
            }).catch(console.error);
          }
        }
      });
    }
  } catch (error) {
    console.error('sendPushToUser error:', error);
  }
};