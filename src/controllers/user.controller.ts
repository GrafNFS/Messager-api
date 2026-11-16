import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';

const prisma = new PrismaClient();

// 1. Отправить заявку в друзья
export const sendFriendRequest = async (req: AuthRequest, res: Response) => {
  try {
    const senderId = req.user!.id; // из токена
    const { contactUserId } = req.body; // кому

    if (!contactUserId) return res.status(400).json({ error: 'Missing contactUserId' });
    if (senderId === contactUserId) return res.status(400).json({ error: 'Cannot add yourself' });

    const receiverExists = await prisma.user.findUnique({ where: { id: contactUserId }, select: { id: true } });
    if (!receiverExists) return res.status(404).json({ error: 'User not found' });

    const alreadyFriends = await prisma.contact.findFirst({
      where: { userId: senderId, contactUserId }
    });
    if (alreadyFriends) return res.status(400).json({ error: 'Already in contacts' });

    await prisma.friendRequest.upsert({
      where: { senderId_receiverId: { senderId, receiverId: contactUserId } },
      update: { status: 'PENDING' },
      create: { senderId, receiverId: contactUserId, status: 'PENDING' }
    });

    res.json({ success: true, message: 'Request sent' });
  } catch (error) {
    console.error('sendFriendRequest error:', error);
    res.status(500).json({ error: 'Failed to send request' });
  }
};

// 2. Входящие заявки (только свои)
export const getPendingRequests = async (req: AuthRequest, res: Response) => {
  try {
    const requests = await prisma.friendRequest.findMany({
      where: { receiverId: req.user!.id, status: 'PENDING' },
      include: {
        sender: { select: { id: true, username: true, displayName: true, avatarUrl: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(requests);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
};

// Количество входящих заявок
export const getPendingCountRequests = async (req: AuthRequest, res: Response) => {
  try {
    const count = await prisma.friendRequest.count({
      where: { receiverId: req.user!.id, status: 'PENDING' }
    });
    res.json(count);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch count' });
  }
};

// 3. Принять/отклонить заявку. Отвечать может ТОЛЬКО получатель.
export const respondToFriendRequest = async (req: AuthRequest, res: Response) => {
  try {
    const me = req.user!.id;
    const { requestId, status } = req.body;
    if (!requestId || !['ACCEPTED', 'REJECTED'].includes(status)) {
      return res.status(400).json({ error: 'Invalid request' });
    }

    await prisma.$transaction(async (tx) => {
      const request = await tx.friendRequest.findUnique({ where: { id: requestId } });
      if (!request) throw new Error('NOT_FOUND');
      if (request.receiverId !== me) throw new Error('FORBIDDEN');

      await tx.friendRequest.update({ where: { id: requestId }, data: { status } });

      if (status === 'ACCEPTED') {
        await tx.contact.upsert({
          where: { userId_contactUserId: { userId: request.receiverId, contactUserId: request.senderId } },
          update: {},
          create: { userId: request.receiverId, contactUserId: request.senderId }
        });
        await tx.contact.upsert({
          where: { userId_contactUserId: { userId: request.senderId, contactUserId: request.receiverId } },
          update: {},
          create: { userId: request.senderId, contactUserId: request.receiverId }
        });
      }
    });

    res.json({ success: true });
  } catch (error: any) {
    if (error.message === 'NOT_FOUND') return res.status(404).json({ error: 'Request not found' });
    if (error.message === 'FORBIDDEN') return res.status(403).json({ error: 'Not your request' });
    res.status(500).json({ error: 'Failed to respond to request' });
  }
};

// 🔍 Поиск пользователей
export const searchUsers = async (req: AuthRequest, res: Response) => {
  try {
    const { query } = req.query;
    const currentUserId = req.user!.id;

    if (!query || typeof query !== 'string' || query.trim().length < 2) {
      return res.status(400).json({ error: 'Query (min 2 chars) is required' });
    }

    const users = await prisma.user.findMany({
      where: {
        OR: [
          { username: { contains: query.trim() } },
          { displayName: { contains: query.trim() } }
        ],
        id: { not: currentUserId },
        status: 'ACTIVE'
      },
      select: { id: true, username: true, displayName: true, avatarUrl: true },
      take: 20
    });

    res.json(users);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Search failed' });
  }
};

// ➕ Добавить контакт напрямую
export const addContact = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { contactUserId } = req.body;

    if (!contactUserId) {
      return res.status(400).json({ error: 'Missing contactUserId in request body' });
    }
    if (userId === contactUserId) {
      return res.status(400).json({ error: 'Cannot add yourself' });
    }

    const exists = await prisma.contact.findFirst({ where: { userId, contactUserId } });
    if (exists) return res.status(400).json({ error: 'User already in your contacts' });

    await prisma.contact.create({ data: { userId, contactUserId } });
    res.json({ success: true, message: 'Contact added' });
  } catch (error: any) {
    console.error('Add Contact DB Error:', error);
    res.status(500).json({ error: 'Failed to add contact' });
  }
};

// Мои контакты
export const getMyContacts = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    const relations = await prisma.contact.findMany({
      where: { userId },
      include: { contact: true }
    });

    const contactsList = relations.map(rel => ({
      id: rel.contact.id,
      username: rel.contact.username,
      displayName: rel.contact.displayName,
      avatarUrl: rel.contact.avatarUrl || null,
      status: 'Tap to chat'
    }));

    res.json(contactsList);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch contacts' });
  }
};

// ==========================================
// GET: Мой профиль
// ==========================================
export const getMyProfile = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, username: true, email: true, phone: true,
        displayName: true, avatarUrl: true, status: true,
        createdAt: true, updatedAt: true
      }
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (error) {
    console.error('Error in getMyProfile:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ==========================================
// PUT: Обновить профиль
// ==========================================
export const updateMyProfile = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { displayName, phone, avatarUrl } = req.body;

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { displayName, phone, avatarUrl },
      select: {
        id: true, username: true, email: true, phone: true,
        displayName: true, avatarUrl: true, status: true,
        createdAt: true, updatedAt: true
      }
    });
    res.json(updatedUser);
  } catch (error: any) {
    console.error('Error in updateMyProfile:', error);
    if (error.code === 'P2025') return res.status(404).json({ error: 'User not found' });
    res.status(500).json({ error: 'Failed to update profile' });
  }
};