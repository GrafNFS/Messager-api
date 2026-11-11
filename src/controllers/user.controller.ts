import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';

const prisma = new PrismaClient();

// 1. Отправить заявку
export const sendFriendRequest = async (req: Request, res: Response) => {
  try {
    const { userId, contactUserId } = req.body;
    if (!userId || !contactUserId) return res.status(400).json({ error: "Missing IDs" });
    if (userId === contactUserId) return res.status(400).json({ error: "Cannot add yourself" });

    const senderId = userId
    const receiverId = contactUserId

    const alreadyFriends = await prisma.contact.findFirst({
      where: { userId: userId, contactUserId: contactUserId }
    });
    if (alreadyFriends) return res.status(400).json({ error: "Already in contacts" });

    await prisma.friendRequest.upsert({
      where: { senderId_receiverId: { senderId, receiverId } },
      update: { status: "PENDING" },
      create: { senderId, receiverId, status: "PENDING" }
    });

    res.json({ success: true, message: "Request sent" });
  } catch (error) {
    res.status(500).json({ error: "Failed to send request" });
    console.log(`✅ Found messages for chat ${error}`);
  }
};

// 2. Получить входящие заявки
export const getPendingRequests = async (req: Request, res: Response) => {
  try {
    const userId = req.query.userId as string;
    const requests = await prisma.friendRequest.findMany({
      where: { receiverId: userId, status: "PENDING" },
      include: {
        sender: { select: { id: true, username: true, displayName: true, avatarUrl: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(requests);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch requests" });
  }
};

// 2. Получить входящие заявки
export const getPendingCountRequests = async (req: Request, res: Response) => {
  try {
    const userId = req.query.userId as string;
    const requests = await prisma.friendRequest.count({
      where: { receiverId: userId, status: "PENDING" },
      orderBy: { createdAt: 'desc' }
    });
    res.json(requests);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch requests" });
  }
};

// 3. Подтвердить или отклонить заявку
export const respondToFriendRequest = async (req: Request, res: Response) => {
  try {
    const { requestId, status } = req.body; // status: "ACCEPTED" или "REJECTED"
    
    // Используем транзакцию для атомарности
    await prisma.$transaction(async (tx) => {
      // 1. Обновляем статус заявки
      await tx.friendRequest.update({
        where: { id: requestId },
        data: { status }
      });

      // 2. Если принято, создаем взаимные контакты
      if (status === "ACCEPTED") {
        const request = await tx.friendRequest.findUnique({ where: { id: requestId } });
        if (request) {
          // Добавляем отправителя в контакты получателя
          await tx.contact.upsert({
            where: { userId_contactUserId: { userId: request.receiverId, contactUserId: request.senderId } },
            update: {},
            create: { userId: request.receiverId, contactUserId: request.senderId }
          });
          // (Опционально) Добавляем получателя в контакты отправителя, если нужно взаимное добавление
          await tx.contact.upsert({
            where: { userId_contactUserId: { userId: request.senderId, contactUserId: request.receiverId } },
            update: {},
            create: { userId: request.senderId, contactUserId: request.receiverId }
          });
        }
      }
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to respond to request" });
  }
};

// 🔍 Поиск пользователей (по username, email или displayName)
export const searchUsers = async (req: Request, res: Response) => {
  try {
    const { query } = req.query;
    const currentUserId = req.query.userId as string; // Пока берем из query, позже заменим на JWT middleware

    if (!query) return res.status(400).json({ error: "Query parameter is required" });

    const users = await prisma.user.findMany({
        where: {
          OR: [
            { username: { contains: query as string } },
            { displayName: { contains: query as string } }
          ],
          id: { not: currentUserId }
        },
        select: {
          id: true,
          username: true,
          displayName: true,
          avatarUrl: true
        },
        take: 20
    });

    res.json(users);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Search failed" });
  }
};

// ➕ Добавить контакт
export const addContact = async (req: Request, res: Response) => {
  try {
    const { userId, contactUserId } = req.body;

    if (!userId || !contactUserId) {
      return res.status(400).json({ error: "Missing userId or contactUserId in request body" });
    }

    const exists = await prisma.contact.findFirst({
      where: { userId, contactUserId }
    });

    if (exists) {
      return res.status(400).json({ error: "User already in your contacts" });
    }

    await prisma.contact.create({
      data: { userId, contactUserId }
    });

    res.json({ success: true, message: "Contact added" });
  } catch (error: any) {
    console.error(" Add Contact DB Error:", error);
    // Если ошибка от Prisma/MySQL, вернём её код и сообщение
    const dbError = error.code || error.message || "Database constraint failed";
    res.status(500).json({ error: dbError });
  }
};

export const getMyContacts = async (req: Request, res: Response) => {
  try {
    // ID текущего пользователя (приходит в запросе)
    const userId = req.query.userId as string;

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    // 1. Ищем все связи в таблице Contact, где userId = текущий юзер
    const relations = await prisma.contact.findMany({
      where: { userId },
      include: {
        // 2. Подтягиваем информацию о самом контакте из таблицы User
        contact: true 
      }
    });

    // 3. Формируем ответ только нужными полями
    const contactsList = relations.map(rel => ({
      id: rel.contact.id,
      username: rel.contact.username,
      displayName: rel.contact.displayName,
      avatarUrl: rel.contact.avatarUrl || null,
      status: "Tap to chat" // Пока статус по умолчанию, позже сделаем реальный
    }));

    res.json(contactsList);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch contacts" });
  }
};
// ==========================================
// GET: Получить профиль пользователя
// ==========================================
export const getMyProfile = async (req: AuthRequest, res: Response) => {
    try {
        // ✅ БЕЗОПАСНО: Берем ID из токена, а не из URL
        const userId = req.user!.id;

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                username: true,
                email: true,
                phone: true,
                displayName: true,
                avatarUrl: true,
                status: true,
                createdAt: true,
                updatedAt: true,
            }
        });

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        res.json(user);
    } catch (error) {
        console.error("Error in getMyProfile:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

// ==========================================
// PUT: Обновить профиль пользователя
// ==========================================
export const updateMyProfile = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user!.id;
        const { displayName, phone, avatarUrl } = req.body;

        const updatedUser = await prisma.user.update({
            where: { id: userId },
            data: {
                displayName: displayName,
                phone: phone,
                avatarUrl: avatarUrl,
            },
            select: {
                id: true,
                username: true,
                email: true,
                phone: true,
                displayName: true,
                avatarUrl: true,
                status: true,
                createdAt: true,
                updatedAt: true,
            }
        });

        res.json(updatedUser);
    } catch (error: any) {
        console.error("Error in updateMyProfile:", error);
        if (error.code === 'P2025') {
            return res.status(404).json({ error: "User not found" });
        }
        res.status(500).json({ error: "Failed to update profile" });
    }
};