export interface Post {
  id: number;
  width: number | null;
  height: number | null;
  file_ext: string | null;
  file_url: string | null;
  preview_url: string | null;
  preview_webp: string | null;
  sample_url: string | null;
  tags: string;
  pools: string;
  rating: string;
  score: number;
  fav_count: number;
  is_favorited: boolean;
  vote: number;
  size?: number;
  uploader_id?: number;
  flags?: string;
  uploader: string | null;
}

export interface PostDetail {
  id: number;
  file: { url: string | null; ext: string | null; size?: number; md5?: string | null };
  sample: { url: string | null };
  preview: { url: string | null };
  tags: Record<string, string[]>;
  pools: number[];
  uploader: string | null;
  uploader_name?: string | null;
  created_at?: string;
  fav_count?: number;
  comment_count?: number;
  score?: { total: number };
  duration?: number | null;
  sources?: string[];
}

export interface TagSuggestion { id: number; name: string; post_count: number; category: number }
export interface Profile { id: number; name: string; blacklisted_tags?: string }
export interface WatchedTag { name: string; unseen: number[]; seen: number[]; checkpoint?: number }
export interface BlacklistRule { text: string; enabled: boolean }
export interface Settings {
  columns: number;
  gridStyle: 'square' | 'apple' | 'masonry';
  theme: 'system' | 'dark' | 'light';
  rating: 'all' | 's' | 'q' | 'e';
  history: string[];
  watched: WatchedTag[];
  disabledBlacklist: string[];
  downloadFolder: string | null;
}
export interface DownloadJob {
  id: string;
  postId: number;
  folder: string;
  combined: boolean;
  accountRevision?: number | null;
  status: 'waiting' | 'running' | 'complete' | 'failed' | 'cancelled';
  fraction: number;
  receivedBytes: number;
  totalBytes: number;
  result: string[];
}
export interface Page { posts: Post[]; fromCache: boolean; snapshotKey: string }
export interface Slot { id: number; ratio: number; reacted: boolean; post: Post | null; pageIndex: number; unavailable: boolean; failed: boolean }

export interface SearchSession {
  version: 1;
  query: string;
  draft: string;
  rating: Settings['rating'];
  accountId: number | null;
  pages: { cursor: string; snapshotKey: string; slots: { id: number; ratio: number; reacted: boolean }[] }[];
  nextCursor: string | null;
  anchor: { id: number; offset: number } | null;
  counts: { raw: number; available: number; blacklisted: number; reacted: number };
  reactions: { id: number; vote?: number; is_favorited?: boolean }[];
}

export interface E322Bridge {
  bootstrap(): Promise<{ settings: Settings; session: SearchSession | null; profile: Profile | null; accountIssue: string | null; accountRevision: number; storageIssues: string[]; downloads: DownloadJob[] }>;
  saveSession(session: SearchSession): Promise<void>;
  onSessionFlush(callback: () => void): () => void;
  finishSessionFlush(): Promise<void>;
  saveSettings(settings: Settings): Promise<Settings>;
  search(query: string, cursor: string, refresh: boolean, background?: boolean): Promise<Page>;
  cancelBackgroundSearch(): Promise<void>;
  snapshotPage(key: string): Promise<Page>;
  pinSnapshots(keys: string[]): Promise<void>;
  restorePage(key: string, query: string, cursor: string): Promise<Page>;
  autocomplete(prefix: string): Promise<TagSuggestion[]>;
  detail(id: number): Promise<PostDetail>;
  login(username: string, apiKey: string): Promise<{ profile: Profile; revision: number }>;
  retryAccount(): Promise<{ profile: Profile | null; accountIssue: string | null; revision: number }>;
  logout(): Promise<{ revision: number; stale?: boolean }>;
  updateBlacklist(rules: string): Promise<Profile>;
  upvote(id: number): Promise<void>;
  favorite(id: number, active: boolean): Promise<void>;
  chooseFolder(): Promise<string | null>;
  startDownload(post: Pick<Post, 'id'>, combined: boolean): Promise<string>;
  cancelDownload(id: string): Promise<void>;
  openPost(id: number): Promise<void>;
  copyPost(id: number): Promise<void>;
  copyText(value: string): Promise<void>;
  onDownload(callback: (job: DownloadJob) => void): () => void;
  onAccount(callback: (state: { profile: Profile | null; accountIssue: string | null; revision: number }) => void): () => void;
  onStorageIssues(callback: (issues: string[]) => void): () => void;
  onMenu(callback: (command: string) => void): () => void;
}

declare global { interface Window { e322: E322Bridge } }
