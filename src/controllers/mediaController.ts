import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';

// Явно логируем, куда указывает путь при запуске
const UPLOAD_DIR = path.join(__dirname, '../../uploads');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

export class MediaController {
static uploadFile(req: Request, res: Response): void {
    try {
        const fileId = req.query.fileId as string;
        const file = req.file;
        
        if (!file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        if (!fileId) {
            return res.status(400).json({ error: 'fileId is required' });
        }

        const tmpPath = file.path; // Путь к .tmp.enc файлу
        const finalPath = path.join(path.dirname(tmpPath), `${fileId}.enc`);

        // Атомарное переименование. Гарантирует, что файл полностью записан на диск.
        fs.rename(tmpPath, finalPath, (err) => {
            if (err) {
                console.error('Upload rename error:', err);
                return res.status(500).json({ error: 'Upload failed' });
            }
            
            console.log(`[MediaController] Upload success: fileId=${fileId}`);
            console.log(`[MediaController] Actual saved path=${finalPath}`);
            
            res.json({
                fileId,
                size: file.size,
                uploadedAt: Date.now()
            });
        });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Upload failed' });
    }
}

  static downloadFile(req: Request, res: Response): void {
    try {
      const { fileId } = req.params;
      const filePath = path.join(UPLOAD_DIR, `${fileId}.enc`);
      
      console.log(`🔍 DOWNLOAD DEBUG: fileId=[${fileId}]`);
      console.log(`🔍 DOWNLOAD DEBUG: UPLOAD_DIR=[${UPLOAD_DIR}]`);
      console.log(`🔍 DOWNLOAD DEBUG: filePath=[${filePath}]`);
      console.log(`🔍 DOWNLOAD DEBUG: exists=${fs.existsSync(filePath)}`);
      
      if (!fs.existsSync(filePath)) {
        console.error(`❌ File not found at path: ${filePath}`);
        res.status(404).json({ error: 'File not found' });
        return;
      }
      
      console.log(`✅ File found! Starting download: ${fileId}`);
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
      const { fileId } = req.params;
      const filePath = path.join(UPLOAD_DIR, `${fileId}.enc`);
      
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`[MediaController] File deleted: ${fileId}`);
        res.json({ success: true });
      } else {
        res.status(404).json({ error: 'File not found' });
      }
    } catch (error) {
      console.error('[MediaController] Delete error:', error);
      res.status(500).json({ error: 'Delete failed' });
    }
  }
}