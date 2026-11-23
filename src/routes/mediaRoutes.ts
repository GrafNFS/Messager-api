import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { MediaController } from '../controllers/mediaController';
import { authenticate } from '../middleware/auth';

const router = Router();

// fileId приходит от клиента (UUID) — строго валидируем, иначе path traversal
const FILE_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function validateFileId(req: Request, res: Response, next: NextFunction) {
  const fileId = (req.query.fileId ?? req.params.fileId) as string;
  if (!fileId || !FILE_ID_RE.test(fileId)) {
    return res.status(400).json({ error: 'Invalid fileId' });
  }
  next();
}

const UPLOAD_DIR = path.join(__dirname, '../../uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, _file, cb) => {
    const fileId = req.query.fileId as string; // уже провалидирован middleware'ом
    cb(null, `${fileId}.enc`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 } // 100 МБ
});

// Все медиа-операции — только с валидным JWT
router.post('/upload', authenticate, validateFileId, upload.single('file'), MediaController.uploadFile);
router.get('/:fileId', authenticate, validateFileId, MediaController.downloadFile);
router.delete('/:fileId', authenticate, validateFileId, MediaController.deleteFile);

export default router;
