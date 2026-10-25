import type { LocalFileAdapter, StorageAdapterType } from './storage.ts';
import { getStoredAssetFolderHandle, scanAssetFolder, verifyAssetFolderPermission } from './storage.ts';

export interface AssetEntry {
  assetId: string;
  name: string;
  type: 'svg' | 'image';
  category: string;
  categoryZh: string;
  path: string;
  fileHandle: FileSystemFileHandle;
}

export async function getAssetFolder(storageType: StorageAdapterType, adapter: LocalFileAdapter): Promise<FileSystemDirectoryHandle | null> {
  let directory: FileSystemDirectoryHandle | null;
  if (storageType === 'localfile') {
    if (!await adapter.ensureReady({ prompt: false })) throw new Error('Asset folder access is unavailable. Select and authorize the storage folder in the UI.');
    const root = adapter.getRootHandle();
    if (!root) throw new Error('No storage folder selected.');
    try {
      directory = await root.getDirectoryHandle('lib');
    } catch (error) {
      if (error instanceof Error && error.name === 'NotFoundError') return null;
      throw error;
    }
  } else {
    directory = await getStoredAssetFolderHandle();
  }
  if (directory && !await verifyAssetFolderPermission(directory, false, 'read')) {
    throw new Error('Asset folder permission is required. Authorize the asset folder in the UI.');
  }
  return directory;
}

export async function folderAssets(directory: FileSystemDirectoryHandle): Promise<AssetEntry[]> {
  const groups = await scanAssetFolder(directory);
  return groups.flatMap(group => group.items.map(item => ({
    assetId: `folder:${item.key}`,
    name: item.name,
    type: item.assetType,
    category: group.category,
    categoryZh: group.categoryZh,
    path: item.key,
    fileHandle: item.fileHandle
  })));
}

export async function findAsset(assetId: string, directory: FileSystemDirectoryHandle | null): Promise<AssetEntry> {
  if (!assetId.startsWith('folder:')) throw new Error('Invalid assetId. Use an ID from search_assets.');
  const path = assetId.slice('folder:'.length);
  const parts = path.split('/');
  if (parts.length !== 2 || parts.some(part => !part || part === '.' || part === '..' || /[\\\u0000]/.test(part)) || !/\.(svg|png)$/i.test(parts[1])) {
    throw new Error('Invalid folder assetId. Expected folder:category/file.svg or .png.');
  }
  if (!directory) throw new Error('No asset folder configured. Select an asset folder in the UI.');
  const group = await directory.getDirectoryHandle(parts[0]);
  const fileHandle = await group.getFileHandle(parts[1]);
  return {
    assetId,
    name: parts[1].replace(/\.(svg|png)$/i, ''),
    type: /\.svg$/i.test(parts[1]) ? 'svg' : 'image',
    category: parts[0],
    categoryZh: parts[0],
    path,
    fileHandle
  };
}