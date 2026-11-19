import { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';

const prisma = new PrismaClient();

const MEMBER_SELECT = {
  user: {
    select: { id: true, username: true, displayName: true, avatarUrl: true }
  }
};

// Создать группу. body: { name, memberIds: string[] } — создатель становится OWNER
export const createGroup = async (req: AuthRequest, res: Response) => {
  try {
    const me = req.user!.id;
    const { name, memberIds } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Group name is required' });
    }
    const members = Array.isArray(memberIds) ? memberIds.filter((id: any) => typeof id === 'string') : [];

    if (members.length > 0) {
      const found = await prisma.user.findMany({ where: { id: { in: members } }, select: { id: true } });
      if (found.length !== new Set(members).size) {
        return res.status(400).json({ error: 'Some member ids are invalid' });
      }
    }

    const group = await prisma.group.create({
      data: {
        name: name.trim(),
        createdById: me,
        members: {
          create: [
            { userId: me, role: 'OWNER' },
            ...[...new Set(members)].filter(id => id !== me).map(userId => ({ userId, role: 'MEMBER' as const }))
          ]
        }
      },
      include: { members: { include: MEMBER_SELECT } }
    });

    res.status(201).json(group);
  } catch (error) {
    console.error('createGroup error:', error);
    res.status(500).json({ error: 'Failed to create group' });
  }
};

// Мои группы
export const getMyGroups = async (req: AuthRequest, res: Response) => {
  try {
    const me = req.user!.id;
    const memberships = await prisma.groupMember.findMany({
      where: { userId: me },
      include: {
        group: { include: { members: { include: MEMBER_SELECT } } }
      },
      orderBy: { joinedAt: 'desc' }
    });

    const groups = memberships.map(m => ({
      id: m.group.id,
      name: m.group.name,
      avatarUrl: m.group.avatarUrl,
      createdById: m.group.createdById,
      myRole: m.role,
      members: m.group.members.map(gm => ({
        userId: gm.userId,
        role: gm.role,
        username: gm.user.username,
        displayName: gm.user.displayName,
        avatarUrl: gm.user.avatarUrl
      }))
    }));

    res.json(groups);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
};

// Участники группы (только члены группы)
export const getGroupMembers = async (req: AuthRequest, res: Response) => {
  try {
    const me = req.user!.id;
    const groupId = req.params.groupId as string;

    const membership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: me } }
    });
    if (!membership) return res.status(403).json({ error: 'Not a group member' });

    const members = await prisma.groupMember.findMany({
      where: { groupId },
      include: MEMBER_SELECT
    });

    res.json(members.map(m => ({
      userId: m.userId,
      role: m.role,
      username: m.user.username,
      displayName: m.user.displayName,
      avatarUrl: m.user.avatarUrl
    })));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch members' });
  }
};

// Добавить участника (только OWNER). body: { userId }
export const addGroupMember = async (req: AuthRequest, res: Response) => {
  try {
    const me = req.user!.id;
    const groupId = req.params.groupId as string;
    const { userId } = req.body;

    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const myMembership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: me } }
    });
    if (!myMembership) return res.status(403).json({ error: 'Not a group member' });
    if (myMembership.role !== 'OWNER') return res.status(403).json({ error: 'Only owner can add members' });

    const userExists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!userExists) return res.status(404).json({ error: 'User not found' });

    // update не пустой: upsert(update:{}) на MySQL бросает P2002 — тот же баг,
    // что был с Message. Повторное добавление = безопасный no-op.
    await prisma.groupMember.upsert({
      where: { groupId_userId: { groupId, userId } },
      update: { role: 'MEMBER' },
      create: { groupId, userId, role: 'MEMBER' }
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add member' });
  }
};

// Удалить участника: OWNER — кого угодно; обычный член — только себя (выход)
export const removeGroupMember = async (req: AuthRequest, res: Response) => {
  try {
    const me = req.user!.id;
    const groupId = req.params.groupId as string;
    const userId = req.params.userId as string;

    const myMembership = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: me } }
    });
    if (!myMembership) return res.status(403).json({ error: 'Not a group member' });

    const isSelfLeave = userId === me;
    if (!isSelfLeave && myMembership.role !== 'OWNER') {
      return res.status(403).json({ error: 'Only owner can remove members' });
    }
    if (isSelfLeave && myMembership.role === 'OWNER') {
      return res.status(400).json({ error: 'Owner cannot leave. Transfer ownership first (not implemented).' });
    }

    await prisma.groupMember.delete({
      where: { groupId_userId: { groupId, userId } }
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove member' });
  }
};
