import { normalizeAvatar, validateAvatarFile, avatarDimensions } from '../src/avatar.mjs';

export async function readAvatar(file) {
  validateAvatarFile(file);
  const url = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('无法读取图片，请重新选择。'));
    reader.readAsDataURL(file);
  });
    const picture = new Image();
    await new Promise((resolve, reject) => {
      picture.onload = resolve;
      picture.onerror = () => reject(new Error('图片解码失败，请换一张图片。'));
      picture.src = url;
    });
    const crop = avatarDimensions(picture.naturalWidth, picture.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = crop.size; canvas.height = crop.size;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前设备不能处理图片，请先使用默认头像。');
    context.drawImage(picture, crop.left, crop.top, crop.side, crop.side, 0, 0, crop.size, crop.size);
    const result = normalizeAvatar(canvas.toDataURL('image/webp', 0.82));
    if (!result) throw new Error('压缩后的头像仍太大，请换一张简单的图片。');
    return result;
}
