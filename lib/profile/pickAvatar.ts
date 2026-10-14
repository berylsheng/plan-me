import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { AVATAR_SIZE } from './avatars';

export type PickedAvatar = { ok: true; base64: string } | { ok: false; reason: 'canceled' | 'failed' };

/** Let the user choose a photo, cropped square, and shrink it to a small JPEG for upload. */
export async function pickAvatar(): Promise<PickedAvatar> {
  // No permission request: the system picker runs out of process and only hands back the photo chosen
  // (SDK 54 docs), so refusing full library access must not stop someone choosing a photo.
  const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 });
  const asset = picked.canceled ? null : picked.assets?.[0];
  if (!asset) return { ok: false, reason: 'canceled' };

  try {
    const context = ImageManipulator.manipulate(asset.uri);
    context.resize({ width: AVATAR_SIZE, height: AVATAR_SIZE });
    const image = await context.renderAsync();
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8, base64: true });
    return saved.base64 ? { ok: true, base64: saved.base64 } : { ok: false, reason: 'failed' };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
