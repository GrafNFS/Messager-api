import { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { messaging } from '../firebase';
import { AuthRequest } from '../middleware/auth';

const prisma = new PrismaClient();

// Тихий пуш с зашифрованными данными (payload виден только как шифртекст)
export const sendSilentMessagePush = async (
  userId: string,
  from: string,
  messageId: string,
  payload: any,
  typeMsg: string
) => {
  try {
    const devices = await prisma.device.findMany({
      where: { userId, isActive: true, pushToken: { not: null } }
    });

    if (devices.length === 0) return;

    // В пуш уходят только текстовые сообщения (медиа догрузится при открытии чата)
    const encryptedPayload = typeMsg === 'text' ? JSON.stringify(payload) : '';

    const message = {
      data: {
        senderId: from,
        messageId,
        timestamp: Date.now().toString(),
        encryptedPayload,
        typeMsg
      },
      tokens: devices.map(d => d.pushToken!)
    };

    const response = await messaging.sendEachForMulticast(message);

    if (response.failureCount > 0) {
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const invalidToken =
            resp.error?.code === 'messaging/invalid-registration-token' ||
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
    console.error('[FCM] Push error:', error);
  }
};

// Регистрация устройства: userId — только из токена
export const registerDevice = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { deviceId, pushToken } = req.body;

    if (!deviceId || !pushToken) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    await prisma.device.upsert({
      where: { userId_deviceId: { userId, deviceId } },
      update: { pushToken, isActive: true, lastSeen: new Date() },
      create: { userId, deviceId, pushToken, isActive: true }
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Register device error:', error);
    res.status(500).json({ error: 'Failed to register device' });
  }
};

// Удаление устройства: только своего
export const unregisterDevice = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const deviceId = req.params.deviceId as string;

    const device = await prisma.device.findFirst({ where: { id: deviceId, userId } });
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    await prisma.device.update({ where: { id: device.id }, data: { isActive: false } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to unregister device' });
  }
};

// Уведомляющий пуш (заголовок + текст)
export const sendPushToUser = async (
  userId: string,
  title: string,
  body: string,
  data: Record<string, string> = {}
) => {
  try {
    const devices = await prisma.device.findMany({
      where: { userId, isActive: true, pushToken: { not: null } }
    });
    if (devices.length === 0) return;

    const message = {
      notification: { title, body },
      data: { ...data, timestamp: Date.now().toString() },
      tokens: devices.map(d => d.pushToken!)
    };

    const response = await messaging.sendEachForMulticast(message);

    if (response.failureCount > 0) {
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const invalidToken =
            resp.error?.code === 'messaging/invalid-registration-token' ||
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