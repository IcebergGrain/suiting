export function normalizeAvatar(value) {
  return typeof value === 'string' && value.length <= 180000 && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/u.test(value) ? value : '';
}

export function validateAvatarFile(file) {
  if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('请选择 PNG、JPEG 或 WebP 图片，不支持 SVG 和动图。');
  if (file.size <= 0 || file.size > 2 * 1024 * 1024) throw new Error('头像图片需要小于 2 MB。');
}

export function avatarDimensions(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width * height > 25000000) throw new Error('图片尺寸过大或无法识别，请选一张较小的图片。');
  const side = Math.min(width, height);
  return { size: Math.min(256, side), side, left: (width - side) / 2, top: (height - side) / 2 };
}
