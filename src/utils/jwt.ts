import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'secret_key';

export const generateToken = (userId: string): string => {
  return jwt.sign({ id: userId }, SECRET, { expiresIn: '30d' });
};

export const verifyToken = (token: string): { id: string } | null => {
  try {
    return jwt.verify(token, SECRET) as { id: string };
  } catch (error) {
    return null;
  }
};
