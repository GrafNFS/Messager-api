import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { MediaController } from '../controllers/mediaController';

const router = Router();

// ✅ Настройка multer прямо в роутах
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, path.join(__dirname, '../../uploads'));
  },
  filename: (req, _file, cb) => {
    const fileId = (req.query.fileId as string) || require('crypto').randomUUID();
    cb(null, `${fileId}.enc`);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB лимит
});

// ✅ Маршруты
router.post('/upload', upload.single('file'), MediaController.uploadFile);
router.get('/:fileId', MediaController.downloadFile);
router.delete('/:fileId', MediaController.deleteFile);

export default router;