import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator } from 'expo-image-manipulator';

import { pickAvatar } from '../pickAvatar';

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));

const mockSaveAsync = jest.fn();
const mockRenderAsync = jest.fn(async () => ({ saveAsync: mockSaveAsync }));
const mockResize = jest.fn();
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: { manipulate: jest.fn(() => ({ resize: mockResize, renderAsync: mockRenderAsync })) },
}));

const picker = ImagePicker as jest.Mocked<typeof ImagePicker>;

beforeEach(() => {
  jest.clearAllMocks();
  picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true } as never);
  picker.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file://big.heic' }] } as never);
  mockSaveAsync.mockResolvedValue({ base64: 'SMALL' });
});

describe('pickAvatar', () => {
  it('resizes to a 256 square JPEG', async () => {
    expect(await pickAvatar()).toEqual({ ok: true, base64: 'SMALL' });
    expect(picker.launchImageLibraryAsync).toHaveBeenCalledWith(
      expect.objectContaining({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1] }),
    );
    expect(ImageManipulator.manipulate).toHaveBeenCalledWith('file://big.heic');
    expect(mockResize).toHaveBeenCalledWith({ width: 256, height: 256 });
    expect(mockSaveAsync).toHaveBeenCalledWith({ format: 'jpeg', compress: 0.8, base64: true });
  });

  it("opens the picker without asking for access to the whole library", async () => {
    await pickAvatar();
    expect(picker.requestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
    expect(picker.launchImageLibraryAsync).toHaveBeenCalled();
  });

  it('does nothing when you cancel', async () => {
    picker.launchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: null } as never);
    expect(await pickAvatar()).toEqual({ ok: false, reason: 'canceled' });
  });

  it('reports a photo it could not convert', async () => {
    mockSaveAsync.mockRejectedValue(new Error('decode'));
    expect(await pickAvatar()).toEqual({ ok: false, reason: 'failed' });
  });
});
