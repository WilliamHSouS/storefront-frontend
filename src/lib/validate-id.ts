const STORAGE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function validateStorageId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && STORAGE_ID_PATTERN.test(id);
}
