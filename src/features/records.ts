export interface InboxRecord {
  id: string;
  folder: string;
  createdAt: string;
  expiresAt: number;
  revoked: boolean;
  uploadCount: number;
}

export interface InboxItemRecord {
  id: string;
  linkId: string;
  objectKey: string;
  name: string;
  size: number;
  uploadedAt: string;
}

export interface GalleryFileRecord {
  key: string;
  name: string;
  size: number;
  contentType: string;
}

export interface GalleryRecord {
  id: string;
  folder: string;
  mode: "photos" | "files";
  title: string;
  createdAt: string;
  revoked: boolean;
  files: GalleryFileRecord[];
}
