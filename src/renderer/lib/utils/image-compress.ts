/**
 * 图片压缩工具：拖拽/选择的图片文件压缩为 JPEG dataURL，用于 Bot 逆向与头像。
 * 全部在渲染进程完成（canvas），不经过主进程与磁盘。
 */

export interface CompressImageOptions {
  /** 长边上限（px），默认 1536，兼顾识别质量与请求体积 */
  maxEdge?: number;
  /** JPEG 质量 0-1，默认 0.85 */
  quality?: number;
  /** 输出 mime，默认 image/jpeg（PNG 透明场景可传 image/png，但体积大） */
  mime?: string;
}

export const DEFAULT_AVATAR_MAX_EDGE = 256;

/**
 * 读取 File/Blob 为 dataURL
 */
export function readImageAsDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('read-failed'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('decode-failed'));
    image.src = src;
  });
}

/**
 * 压缩 dataURL 图片：等比缩放到长边 ≤ maxEdge，输出 JPEG dataURL。
 * 源图小于上限且已是 JPEG 时直接返回，避免重复编码。
 */
export async function compressImageDataUrl(
  dataUrl: string,
  options: CompressImageOptions = {}
): Promise<string> {
  const { maxEdge = 1536, quality = 0.85, mime = 'image/jpeg' } = options;
  const image = await loadImage(dataUrl);

  const longestEdge = Math.max(image.naturalWidth, image.naturalHeight);
  const needsResize = longestEdge > maxEdge;
  const alreadyTargetMime = dataUrl.startsWith(`data:${mime};`);

  if (!needsResize && alreadyTargetMime) {
    return dataUrl;
  }

  const scale = needsResize ? maxEdge / longestEdge : 1;
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('canvas-unavailable');
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, width, height);

  return canvas.toDataURL(mime, quality);
}

/**
 * 拖拽事件中的文件是否为浏览器可解码的图片
 */
export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

/**
 * 从 DataTransfer 中取出第一张图片文件
 */
export function extractImageFile(dataTransfer: DataTransfer): File | null {
  if (dataTransfer.files && dataTransfer.files.length > 0) {
    for (const file of Array.from(dataTransfer.files)) {
      if (isImageFile(file)) return file;
    }
  }
  if (dataTransfer.items) {
    for (const item of Array.from(dataTransfer.items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) return file;
      }
    }
  }
  return null;
}
