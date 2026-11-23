import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';

const UPLOAD_DIR = path.join(__dirname, '../../uploads');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

export class MediaController {
  static uploadFile(req: Request, res: Response): void {
    try {
      const fileId = req.query.fileId as string; // валидирован в роуте
      const file = req.file;

      if (!file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      // ✅ Проверка целостности: клиент передаёт ожидаемый размер (?size=).
      //    Если тело запроса обрезано по пути (прокси/сеть) — отклоняем,
      //    чтобы обрезок не лёг в хранилище и не отвечал 200.
      const declaredSize = Number(req.query.size);
      if (Number.isFinite(declaredSize) && declaredSize > 0 && file.size !== declaredSize) {
        fs.unlink(file.path, () => {}); // удаляем обрезок
        console.warn(`⚠️ Upload size mismatch for ${fileId}: declared ${declaredSize}, got ${file.size} — rejected`);
        res.status(400).json({
          error: 'Size mismatch',
          expected: declaredSize,
          got: file.size
        });
        return;
      }

      const tmpPath = file.path;
      const finalPath = path.join(UPLOAD_DIR, `${fileId}.enc`);

      // Атомарное переименование: файл полностью записан на диск до ответа клиенту
      fs.rename(tmpPath, finalPath, (err) => {
        if (err) {
          console.error('Upload rename error:', err);
          res.status(500).json({ error: 'Upload failed' });
          return;
        }
        res.json({ fileId, size: file.size, uploadedAt: Date.now() });
      });
    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({ error: 'Upload failed' });
    }
  }

  static downloadFile(req: Request, res: Response): void {
    try {
      const { fileId } = req.params; // валидирован в роуте
      const filePath = path.join(UPLOAD_DIR, `${fileId}.enc`);

      if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      // res.sendFile поддерживает Range автоматически (206 + докачка)
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${fileId}.enc"`);
      res.sendFile(filePath);
    } catch (error) {
      console.error('Download error:', error);
      res.status(500).json({ error: 'Download failed' });
    }
  }

  static deleteFile(req: Request, res: Response): void {
    try {
      const { fileId } = req.params; // валидирован в роуте
      const filePath = path.join(UPLOAD_DIR, `${fileId}.enc`);

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        res.json({ success: true });
      } else {
        res.status(404).json({ error: 'File not found' });
      }
    } catch (error) {
      console.error('Delete error:', error);
      res.status(500).json({ error: 'Delete failed' });
    }
  }
}
