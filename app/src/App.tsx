import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { GalleryGrid, type GalleryAnchor, type GalleryHandle } from './GalleryGrid';
import { InitialSkeleton } from './InitialSkeleton';
import { MembranePopover } from './MembranePopover';
import { Viewer } from './Viewer';
import { refreshAccountPages } from './accountRefresh';
import { parseBlacklist } from './blacklist';
import { refilterStoredPages, type StoredPage } from './blacklistRebuild';
import { DetailLoader } from './detailLoader';
import { shouldApplyDownloadReaction } from './downloadReactions';
import { postRatio } from './gridLayout';
import { PageLoadTracker } from './pageLoadTracker';
import { cursorAfter } from './searchPagination';
import { applyLocalReaction, type ReactionOverride } from './reactionVisibility';
import { pruneResidentPages } from './residentPages';
import { filterSearchPosts } from './searchResults';
import { nearestSurvivingId } from './scrollAnchor';
import { captureSearchSession, discardResumedReactions, resumeSearchSession } from './searchSession';
import { applyRatingFilter, completeSearchToken, explicitRating, searchTokenAtCaret } from './searchQuery';
import { collectWatchedIds, markWatchedPost, mergeWatchedRefresh, normalizeWatched, watchedTagQuery } from './watchlist';
import type { BlacklistRule, DownloadJob, Page, Post, PostDetail, Profile, SearchSession, Settings, Slot, TagSuggestion } from './types';

type Panel = 'none' | 'history' | 'filter' | 'menu' | 'blacklist' | 'watchlist' | 'account' | 'settings' | 'downloads' | 'shortcuts';
type PanelOrigin = 'menu' | 'toolbar' | 'status';
const defaults: Settings = { columns: 8, gridStyle: 'apple', theme: 'system', rating: 'all', history: [], watched: [], disabledBlacklist: [], downloadFolder: null };
const pageMargin = 3;

function Icon({ name }: { name: string }) { return <img className="icon" src={`./icons/${name}.png`} alt="" />; }
function downloadProgress(job: DownloadJob) {
  if (job.totalBytes > 0) return `${Math.round(job.fraction * 100)}%`;
  if (job.receivedBytes < 1048576) return `${Math.round(job.receivedBytes / 1024)} KiB`;
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(job.receivedBytes / 1048576)} MiB`;
}
function rowIcon(name: string, text: string, click: () => void, trailing?: string) {
  return <button className="menu-row" onClick={click}><Icon name={name} /><span>{text}</span>{trailing && <small>{trailing}</small>}</button>;
}
function normalizedBlacklist(text: string) {
  return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).join('\n');
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(defaults);
  const [booted, setBooted] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [accountIssue, setAccountIssue] = useState<string | null>(null);
  const [storageIssues, setStorageIssues] = useState<string[]>([]);
  const [accountRetrying, setAccountRetrying] = useState(false);
  const [accountRefreshPending, setAccountRefreshPending] = useState(false);
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('order:hot');
  const [pages, setPages] = useState<StoredPage[]>([]);
  const [failedPages, setFailedPages] = useState<Set<number>>(() => new Set());
  const [nextCursor, setNextCursor] = useState<string | null>('');
  const [loading, setLoading] = useState(false);
  const [loadingNext, setLoadingNext] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [nextError, setNextError] = useState(false);
  const [rawResultCount, setRawResultCount] = useState(0);
  const [availableCount, setAvailableCount] = useState(0);
  const [blacklistedCount, setBlacklistedCount] = useState(0);
  const [reactedHiddenCount, setReactedHiddenCount] = useState(0);
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([]);
  const [suggestionIndex, setSuggestionIndex] = useState(-1);
  const [panel, setPanel] = useState<Panel>('none');
  const [panelOrigin, setPanelOrigin] = useState<PanelOrigin>('menu');
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchCaret, setSearchCaret] = useState(0);
  const [searchSelectionEnd, setSearchSelectionEnd] = useState(0);
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedSnapshot, setSelectedSnapshot] = useState<Post | null>(null);
  const [detail, setDetail] = useState<PostDetail | null>(null);
  const [detailError, setDetailError] = useState(false);
  const [blacklist, setBlacklist] = useState<BlacklistRule[]>([]);
  const [newRule, setNewRule] = useState('');
  const [newWatched, setNewWatched] = useState('');
  const [loginName, setLoginName] = useState('');
  const [loginKey, setLoginKey] = useState('');
  const [downloads, setDownloads] = useState<DownloadJob[]>([]);
  const [upvoteBusy, setUpvoteBusy] = useState<Set<number>>(() => new Set());
  const [favoriteBusy, setFavoriteBusy] = useState<Set<number>>(() => new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [effectiveColumns, setEffectiveColumns] = useState(() => Math.max(2, Math.min(8, Math.floor((window.innerWidth - 24) / 128))));
  const [watchRefreshing, setWatchRefreshing] = useState(false);
  const [blacklistSyncing, setBlacklistSyncing] = useState(false);
  const [blacklistIssue, setBlacklistIssue] = useState<string | null>(null);
  const [blacklistRebuilding, setBlacklistRebuilding] = useState(false);
  const [searchReady, setSearchReady] = useState(false);
  const [restoringPosition, setRestoringPosition] = useState<GalleryAnchor | null>(null);
  const [systemLight, setSystemLight] = useState(() => window.matchMedia('(prefers-color-scheme: light)').matches);

  const grid = useRef<GalleryHandle>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const blacklistTrigger = useRef<HTMLButtonElement>(null);
  const historyTrigger = useRef<HTMLButtonElement>(null);
  const filterTrigger = useRef<HTMLButtonElement>(null);
  const downloadsTrigger = useRef<HTMLButtonElement>(null);
  const menuPanelElement = useRef<HTMLDivElement>(null);
  const menuRowRefs = useRef<Partial<Record<Panel, HTMLButtonElement | null>>>({});
  const panelElement = useRef<HTMLDivElement>(null);
  const panelReturnFocus = useRef<HTMLElement | null>(null);
  const previousPanel = useRef<Panel>('none');
  const completedSearchToken = useRef<{ query: string; caret: number } | null>(null);
  const generation = useRef(0);
  const gridAdjustmentVersion = useRef(0);
  const blacklistRebuildVersion = useRef(0);
  const blacklistRebuildInFlight = useRef(false);
  const pendingBlacklist = useRef<BlacklistRule[] | null>(null);
  const pagesRef = useRef(pages);
  const slotsRef = useRef<Slot[]>([]);
  const rulesRef = useRef<BlacklistRule[]>([]);
  const pagesGeneration = useRef(0);
  const watchedRef = useRef(settings.watched);
  const pageSlotsCache = useRef(new WeakMap<StoredPage, { index: number; failed: boolean; slots: Slot[] }>());
  const pinnedSnapshotKeys = useRef<string | null>(null);
  const loadingPages = useRef(new PageLoadTracker());
  const restoringPages = useRef(new Map<string, Promise<Page>>());
  const visiblePages = useRef({ first: 0, last: 0 });
  const residentPages = useRef({ first: 0, last: 0 });
  const pendingNext = useRef<Promise<Post | null> | null>(null);
  const knownIds = useRef(new Set<number>());
  const blacklistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blacklistSyncVersion = useRef(0);
  const blacklistConfirmedText = useRef('');
  const blacklistRequestsInFlight = useRef(0);
  const watchRefreshInFlight = useRef(false);
  const watchRefreshVersion = useRef(0);
  const watchCancelTail = useRef<Promise<void>>(Promise.resolve());
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsSaveReady = useRef(false);
  const accountVersion = useRef(-1);
  const searchAccountId = useRef<number | null>(null);
  const accountSyncFlight = useRef<{ ticket: number; revision: number } | null>(null);
  const accountSnapshot = useRef<{ profile: Profile | null; accountIssue: string | null }>({ profile: null, accountIssue: null });
  const settingsRef = useRef(settings);
  const searchStarted = useRef(false);
  const deferredAccountRefresh = useRef(false);
  const selectedIdRef = useRef<number | null>(null);
  const pendingViewerAdvance = useRef<number | null>(null);
  const viewerFallbackId = useRef<number | null>(null);
  const submittedRef = useRef(submitted);
  const startupSession = useRef<SearchSession | null>(null);
  const restoringPositionRef = useRef<GalleryAnchor | null>(null);
  const captureSession = useRef<() => SearchSession | null>(() => null);
  const sessionSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reactionUpdates = useRef(new Map<number, ReactionOverride>());
  const resumedReactionValues = useRef<Map<number, ReactionOverride> | null>(null);
  const pendingUpvotes = useRef(new Set<number>());
  const pendingFavorites = useRef(new Set<number>());
  const detailLoader = useRef<DetailLoader<PostDetail> | null>(null);
  useLayoutEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  useLayoutEffect(() => { pagesRef.current = pages; }, [pages]);
  useLayoutEffect(() => { watchedRef.current = settings.watched; }, [settings.watched]);
  useLayoutEffect(() => { settingsRef.current = settings; }, [settings]);
  useLayoutEffect(() => {
    const from = previousPanel.current;
    previousPanel.current = panel;
    if (panel === 'none') {
      const target = panelReturnFocus.current;
      panelReturnFocus.current = null;
      if (target?.isConnected) target.focus({ preventScroll: true });
      return;
    }
    if (!panelReturnFocus.current) {
      const active = document.activeElement;
      panelReturnFocus.current = active instanceof HTMLElement && active !== document.body
        ? active : document.querySelector<HTMLElement>('.search-trigger');
    }
    if (panel === 'menu' && from !== 'none') {
      const row = menuRowRefs.current[from];
      if (row) { row.focus({ preventScroll: true }); return; }
    }
    if (panel === 'menu') {
      menuPanelElement.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
      return;
    }
    const selectors = panel === 'settings' ? ['select, button']
      : ['history', 'filter'].includes(panel) ? ['.panel-list button']
      : ['blacklist', 'watchlist'].includes(panel) || (panel === 'account' && !profile) ? ['.panel-body input']
      : [];
    const first = [...selectors, 'button']
      .map(selector => panelElement.current?.querySelector<HTMLElement>(selector)).find(Boolean);
    (first || menuRowRefs.current[panel])?.focus({ preventScroll: true });
  }, [panel, panelOrigin, profile]);

  useLayoutEffect(() => {
    if (panel === 'none') return;
    const positionPanels = () => {
      const menu = panelOrigin === 'menu' ? menuPanelElement.current : null;
      if (menu && menuTrigger.current) {
        const trigger = menuTrigger.current.getBoundingClientRect();
        menu.style.left = `${Math.max(5, Math.min(trigger.left + 4, window.innerWidth - menu.offsetWidth - 5))}px`;
        const pill = menuTrigger.current.closest('.search-pill')?.getBoundingClientRect();
        menu.style.top = `${(pill?.bottom ?? trigger.bottom - 3) + 6}px`;
      }
      const child = panelElement.current;
      if (!child || panel === 'menu') return;
      const trigger = panelOrigin === 'menu' ? menuRowRefs.current[panel]
        : panelOrigin === 'status' ? downloadsTrigger.current
        : panel === 'blacklist' ? blacklistTrigger.current
        : panel === 'history' ? historyTrigger.current : filterTrigger.current;
      if (!trigger) return;
      const bounds = trigger.getBoundingClientRect();
      const gap = 5;
      const desiredLeft = menu ? menu.offsetLeft + menu.offsetWidth + gap : bounds.left;
      const fallbackLeft = menu ? menu.offsetLeft - child.offsetWidth - gap : bounds.right - child.offsetWidth;
      const left = desiredLeft + child.offsetWidth <= window.innerWidth - 5 ? desiredLeft : fallbackLeft;
      const pill = trigger.closest('.search-pill')?.getBoundingClientRect();
      const desiredTop = menu ? menu.offsetTop + trigger.offsetTop
        : panelOrigin === 'status' ? bounds.top - child.offsetHeight - gap
          : (pill?.bottom ?? bounds.bottom - 3) + 6;
      child.style.left = `${Math.max(5, Math.min(left, window.innerWidth - child.offsetWidth - 5))}px`;
      child.style.top = `${Math.max(5, Math.min(desiredTop, window.innerHeight - child.offsetHeight - 5))}px`;
      child.style.transformOrigin = menu ? 'top left' : panelOrigin === 'status' ? 'bottom right' : 'top left';
    };
    positionPanels();
    const observer = new ResizeObserver(positionPanels);
    const shell = document.querySelector('.app-shell');
    if (shell) observer.observe(shell);
    const searchPill = menuTrigger.current?.closest('.search-pill');
    if (searchPill) observer.observe(searchPill);
    if (downloadsTrigger.current) observer.observe(downloadsTrigger.current);
    window.addEventListener('resize', positionPanels);
    window.visualViewport?.addEventListener('resize', positionPanels);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', positionPanels);
      window.visualViewport?.removeEventListener('resize', positionPanels);
    };
  }, [panel, panelOrigin, searchFocused, query]);

  useEffect(() => {
    if (panel === 'none') return;
    const trapTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !panelElement.current) return;
      const roots = [menuPanelElement.current, panelElement.current].filter((root): root is HTMLDivElement => Boolean(root));
      const focusable = roots.flatMap(root => [...root.querySelectorAll<HTMLElement>('button, input, select, [tabindex]:not([tabindex="-1"])')])
        .filter(element => !element.hasAttribute('disabled') && element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && (document.activeElement === first || !roots.some(root => root.contains(document.activeElement)))) {
        last.focus(); event.preventDefault();
      } else if (!event.shiftKey && (document.activeElement === last || !roots.some(root => root.contains(document.activeElement)))) {
        first.focus(); event.preventDefault();
      }
    };
    document.addEventListener('keydown', trapTab, true);
    return () => document.removeEventListener('keydown', trapTab, true);
  }, [panel]);

  useEffect(() => {
    if (panel === 'none') return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuPanelElement.current?.contains(target) || panelElement.current?.contains(target)) return;
      if ([menuTrigger.current, blacklistTrigger.current, historyTrigger.current, filterTrigger.current, downloadsTrigger.current]
        .some(trigger => trigger?.contains(target))) return;
      setPanel('none');
    };
    document.addEventListener('pointerdown', closeOutside, true);
    return () => document.removeEventListener('pointerdown', closeOutside, true);
  }, [panel]);

  const focusSearch = useCallback(() => {
    completedSearchToken.current = null;
    searchInput.current?.focus();
    searchInput.current?.select();
    setSearchCaret(searchInput.current?.selectionStart ?? 0);
    setSearchSelectionEnd(searchInput.current?.selectionEnd ?? 0);
    setSuggestions([]);
    setSuggestionIndex(-1);
  }, []);

  useEffect(() => {
    const loader = new DetailLoader<PostDetail>(id => window.e322.detail(id));
    detailLoader.current = loader;
    return () => { loader.dispose(); if (detailLoader.current === loader) detailLoader.current = null; };
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const update = () => setSystemLight(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const clearResumedReactions = useCallback(() => {
    if (!resumedReactionValues.current) return;
    reactionUpdates.current = discardResumedReactions(reactionUpdates.current, resumedReactionValues.current);
    resumedReactionValues.current = null;
  }, []);

  const saveSession = useCallback(async () => {
    if (sessionSaveTimer.current) clearTimeout(sessionSaveTimer.current);
    sessionSaveTimer.current = null;
    const session = captureSession.current();
    if (!session) return;
    try { await window.e322.saveSession(session); }
    catch (error) { showToast(`Could not save the search: ${String((error as Error).message || error)}`); }
  }, [showToast]);
  const scheduleSessionSave = useCallback(() => {
    if (sessionSaveTimer.current) clearTimeout(sessionSaveTimer.current);
    sessionSaveTimer.current = setTimeout(() => { void saveSession(); }, 500);
  }, [saveSession]);
  useEffect(() => {
    const off = window.e322.onSessionFlush(() => {
      void saveSession().finally(() => { void window.e322.finishSessionFlush().catch(() => {}); });
    });
    return () => {
      off();
      if (sessionSaveTimer.current) clearTimeout(sessionSaveTimer.current);
      sessionSaveTimer.current = null;
    };
  }, [saveSession]);

  useEffect(() => {
    const keys = [...new Set(pages.map(page => page.snapshotKey))];
    const signature = keys.join(',');
    if (signature === pinnedSnapshotKeys.current) return;
    pinnedSnapshotKeys.current = signature;
    void window.e322.pinSnapshots(keys).catch(error => {
      pinnedSnapshotKeys.current = '';
      showToast(`Could not protect cached pages: ${String(error.message || error)}`);
    });
  }, [pages, showToast]);

  const updateSettings = useCallback((patch: Partial<Settings> | ((previous: Settings) => Partial<Settings> | null)) => {
    setSettings(previous => {
      const value = typeof patch === 'function' ? patch(previous) : patch;
      if (!value) return previous;
      return { ...previous, ...value };
    });
  }, []);

  const changeGrid = useCallback((patch: Partial<Settings>) => {
    const anchor = grid.current?.captureAnchor();
    const ticket = generation.current;
    const version = ++gridAdjustmentVersion.current;
    updateSettings(patch);
    if (anchor) requestAnimationFrame(() => {
      if (ticket === generation.current && version === gridAdjustmentVersion.current) grid.current?.restoreAnchor(anchor);
    });
  }, [updateSettings]);

  useEffect(() => {
    if (!booted) return;
    if (!settingsSaveReady.current) { settingsSaveReady.current = true; return; }
    void window.e322.saveSettings(settings).catch(error => showToast(String(error.message || error)));
  }, [settings, booted, showToast]);

  useEffect(() => {
    let alive = true;
    const applyAccount = (value: { profile: Profile | null; accountIssue: string | null; revision: number }, disabled: string[]) => {
      if (value.revision < accountVersion.current) {
        const rules = parseBlacklist(accountSnapshot.current.profile?.blacklisted_tags || '', disabled);
        rulesRef.current = rules;
        setBlacklist(rules);
        return false;
      }
      const changed = value.revision > accountVersion.current;
      accountVersion.current = value.revision;
      accountSnapshot.current = { profile: value.profile, accountIssue: value.accountIssue };
      blacklistConfirmedText.current = normalizedBlacklist(value.profile?.blacklisted_tags || '');
      setProfile(value.profile);
      setAccountIssue(value.accountIssue);
      const rules = parseBlacklist(value.profile?.blacklisted_tags || '', disabled);
      rulesRef.current = rules;
      setBlacklist(rules);
      return changed;
    };
    const offAccount = window.e322.onAccount(value => {
      if (!alive) return;
      const previousProfile = accountSnapshot.current.profile;
      const accountId = value.profile?.id ?? null;
      const changed = applyAccount(value, settingsRef.current.disabledBlacklist);
      if (changed) {
        blacklistSyncVersion.current++;
        if (blacklistTimer.current) clearTimeout(blacklistTimer.current);
        setBlacklistSyncing(false);
        setBlacklistIssue(null);
        if ((previousProfile?.id ?? searchAccountId.current) !== (value.profile?.id ?? null)) {
          reactionUpdates.current.clear();
        }
      }
      if (changed && value.accountIssue) showToast(value.accountIssue);
      if (changed && searchStarted.current && (value.profile || previousProfile || searchAccountId.current !== accountId)) {
        if (restoringPositionRef.current || selectedIdRef.current !== null || !grid.current?.isNearTop()) {
          deferredAccountRefresh.current = true;
          setAccountRefreshPending(true);
          showToast('Refreshing results for this account');
          queueMicrotask(() => document.dispatchEvent(new Event('e322-account-sync')));
        } else queueMicrotask(() => document.dispatchEvent(new Event('e322-refresh')));
      }
    });
    const offStorage = window.e322.onStorageIssues(value => { if (alive) setStorageIssues(value); });
    void window.e322.bootstrap().then(value => {
      if (!alive) return;
      const watched = normalizeWatched(value.settings.watched || []);
      const restoredSettings = { ...defaults, ...value.settings, watched };
      startupSession.current = value.session || null;
      if (value.session) restoredSettings.rating = value.session.rating;
      setSettings(restoredSettings);
      if (watched !== value.settings.watched) void window.e322.saveSettings(restoredSettings).catch(error => showToast(String(error.message || error)));
      applyAccount({ profile: value.profile, accountIssue: value.accountIssue, revision: value.accountRevision ?? 0 }, value.settings.disabledBlacklist || []);
      setStorageIssues(value.storageIssues || []);
      setDownloads(value.downloads);
      setBooted(true);
    }).catch(error => showToast(String(error.message || error)));
    const offDownload = window.e322.onDownload(job => {
      setDownloads(previous => [job, ...previous.filter(item => item.id !== job.id)].slice(0, 100));
      if (!shouldApplyDownloadReaction(job, accountVersion.current)) return;
      const voted = job.result.includes('Upvoted');
      const favorited = job.result.includes('Favorited');
      if (!voted && !favorited) return;
      reactionUpdates.current.set(job.postId, { ...reactionUpdates.current.get(job.postId), ...(voted ? { vote: 1 } : {}), ...(favorited ? { is_favorited: true } : {}) });
      const change = (post: Post) => ({ ...post,
        vote: voted ? 1 : post.vote,
        score: voted && post.vote !== 1 ? post.score + 1 : post.score,
        is_favorited: favorited || post.is_favorited,
        fav_count: favorited && !post.is_favorited ? post.fav_count + 1 : post.fav_count,
      });
      detailLoader.current?.invalidate(job.postId);
      setPages(previous => previous.map(page => page.slots.some(slot => slot.id === job.postId) ? {
        ...page,
        slots: page.slots.map(slot => slot.id === job.postId ? { ...slot, reacted: true } : slot),
        posts: page.posts?.map(post => post?.id === job.postId ? change(post) : post) || null,
      } : page));
      setSelectedSnapshot(previous => previous?.id === job.postId ? change(previous) : previous);
      if (selectedIdRef.current === job.postId) {
        setDetail(null);
        detailLoader.current?.request(job.postId,
          value => { if (selectedIdRef.current === job.postId) setDetail(value); },
          () => { if (selectedIdRef.current === job.postId) setDetailError(true); }, true);
      }
    });
    return () => { alive = false; offAccount(); offStorage(); offDownload(); };
  }, [showToast]);

  const expression = useCallback((text: string, rating: Settings['rating']) =>
    rating === 'all' || /(?:^|\s)rating:\S+/i.test(text) ? text : `${text} rating:${rating}`, []);

  const restoreStoredPage = useCallback((index: number, page: StoredPage, ticket: number, text: string, rating: Settings['rating']) => {
    const query = expression(text, rating);
    const key = `${ticket}:${index}:${page.snapshotKey}:${page.cursor}:${query}`;
    const existing = restoringPages.current.get(key);
    if (existing) return existing;
    const request = window.e322.restorePage(page.snapshotKey, query, page.cursor);
    restoringPages.current.set(key, request);
    void request.then(() => { if (restoringPages.current.get(key) === request) restoringPages.current.delete(key); },
      () => { if (restoringPages.current.get(key) === request) restoringPages.current.delete(key); });
    return request;
  }, [expression]);

  useLayoutEffect(() => { rulesRef.current = blacklist; }, [blacklist]);

  const search = useCallback(async (text: string, rating = settings.rating, refresh = false, keepPanel = false) => {
    clearResumedReactions();
    searchStarted.current = true;
    deferredAccountRefresh.current = false;
    setAccountRefreshPending(false);
    const clean = text.trim() || 'order:hot';
    const ticket = ++generation.current;
    restoringPositionRef.current = null;
    setRestoringPosition(null);
    searchAccountId.current = accountSnapshot.current.profile?.id ?? null;
    blacklistRebuildVersion.current++;
    blacklistRebuildInFlight.current = false;
    pendingBlacklist.current = null;
    setBlacklistRebuilding(false);
    submittedRef.current = clean;
    detailLoader.current?.cancel();
    grid.current?.scrollToTop();
    if (!refresh) setQuery(text.trim() ? clean : '');
    setSubmitted(clean); setPages([]); setFailedPages(new Set()); setNextCursor(''); setLoading(true); setRawResultCount(0); setAvailableCount(0); setBlacklistedCount(0); setReactedHiddenCount(0); setSearchError(false); setNextError(false);
    pagesRef.current = [];
    pendingNext.current = null; setLoadingNext(false);
    selectedIdRef.current = null;
    pendingViewerAdvance.current = null;
    viewerFallbackId.current = null;
    setFocusedId(null); setSelectedId(null); setSelectedSnapshot(null); setDetail(null);
    setDetailError(false);
    if (!keepPanel) setPanel('none');
    setSuggestions([]); setSuggestionIndex(-1); visiblePages.current = { first: 0, last: 0 }; residentPages.current = { first: 0, last: 0 }; loadingPages.current.clear();
    restoringPages.current.clear();
    knownIds.current.clear();
    if (!refresh) updateSettings(previous => ({ history: [clean, ...previous.history.filter(item => item !== clean)].slice(0, 50) }));
    try {
      const result = await window.e322.search(expression(clean, rating), '', refresh);
      if (ticket !== generation.current) return;
      setRawResultCount(result.posts.length);
      const filtered = filterSearchPosts(result.posts, clean, rulesRef.current, reactionUpdates.current);
      setAvailableCount(filtered.available); setBlacklistedCount(filtered.blacklisted); setReactedHiddenCount(filtered.reacted);
      const visible = filtered.posts;
      knownIds.current = new Set(visible.map(post => post.id));
      const firstPage = [{ cursor: '', snapshotKey: result.snapshotKey, slots: visible.map(post => ({ id: post.id, ratio: postRatio(post), reacted: post.vote === 1 || post.is_favorited })), posts: visible }];
      pagesRef.current = firstPage;
      pagesGeneration.current = ticket;
      setPages(firstPage);
      setNextCursor(cursorAfter(result.posts, '', expression(clean, rating)));
      setFocusedId(visible[0]?.id || null);
      if (result.fromCache) showToast('Showing a cached page');
    } catch (error) { if (ticket === generation.current) { setSearchError(true); showToast(String((error as Error).message || error)); } }
    finally { if (ticket === generation.current) setLoading(false); }
  }, [settings.rating, expression, updateSettings, showToast, clearResumedReactions]);

  useEffect(() => {
    if (!booted || searchReady) return;
    setSearchReady(true);
    const session = startupSession.current;
    startupSession.current = null;
    if (!session?.pages.length) {
      void search(session?.query || '', settings.rating);
      if (session) setQuery(session.draft);
      return;
    }
    const restored = resumeSearchSession(session, accountVersion.current > 0 ? accountSnapshot.current.profile?.id ?? null : undefined);
    const ticket = ++generation.current;
    searchStarted.current = true;
    searchAccountId.current = session.accountId;
    submittedRef.current = session.query;
    pagesRef.current = restored.pages;
    pagesGeneration.current = ticket;
    knownIds.current = restored.ids;
    reactionUpdates.current = restored.reactions;
    resumedReactionValues.current = new Map(restored.reactions);
    setSubmitted(session.query);
    setQuery(session.draft);
    setPages(restored.pages);
    setNextCursor(session.nextCursor);
    setRawResultCount(session.counts.raw);
    setAvailableCount(session.counts.available);
    setBlacklistedCount(session.counts.blacklisted);
    setReactedHiddenCount(session.counts.reacted);
    setFocusedId(restored.anchor?.id ?? restored.ids.values().next().value ?? null);
    setRestoringPosition(restored.anchor);
    restoringPositionRef.current = restored.anchor;
    if (accountVersion.current > 0 && (accountSnapshot.current.profile !== null || session.accountId !== null)) {
      deferredAccountRefresh.current = true;
      setAccountRefreshPending(true);
      queueMicrotask(() => document.dispatchEvent(new Event('e322-account-sync')));
    }
  }, [booted, searchReady, search, settings.rating]);
  useEffect(() => {
    const refresh = () => { void search(submitted, settings.rating, true); };
    document.addEventListener('e322-refresh', refresh);
    return () => document.removeEventListener('e322-refresh', refresh);
  }, [search, submitted, settings.rating]);

  useEffect(() => {
    const synchronize = () => {
      const revision = accountVersion.current;
      const accountId = accountSnapshot.current.profile?.id ?? null;
      const ticket = generation.current;
      const depth = pagesRef.current.length;
      const query = submittedRef.current;
      const rating = settingsRef.current.rating;
      const rules = rulesRef.current;
      if (!deferredAccountRefresh.current && searchAccountId.current === accountId) return;
      if (!depth) { void search(query, rating, true); return; }
      if (accountSyncFlight.current?.ticket === ticket && accountSyncFlight.current.revision === revision) return;
      clearResumedReactions();
      const flight = { ticket, revision };
      accountSyncFlight.current = flight;
      const cancelled = () => ticket !== generation.current || revision !== accountVersion.current;
      void refreshAccountPages(depth, expression(query, rating), query, rules, reactionUpdates.current,
        cursor => window.e322.search(expression(query, rating), cursor, true, true), cancelled)
        .then(result => {
          if (!result || cancelled()) return;
          const anchor = restoringPositionRef.current || grid.current?.captureAnchor();
          restoringPositionRef.current = null;
          setRestoringPosition(null);
          const restoreId = nearestSurvivingId(slotsRef.current, anchor?.id ?? null, result.ids);
          const viewingId = selectedIdRef.current;
          viewerFallbackId.current = viewingId !== null && !result.ids.has(viewingId)
            ? nearestSurvivingId(slotsRef.current, viewingId, result.ids) : null;
          const refreshedViewerPost = viewingId === null ? null
            : result.pages.flatMap(page => page.posts || []).find(post => post?.id === viewingId) || null;
          const nextTicket = ++generation.current;
          loadingPages.current.clear();
          restoringPages.current.clear();
          pendingNext.current = null;
          searchAccountId.current = accountId;
          deferredAccountRefresh.current = false;
          const { first, last } = residentPages.current;
          const nextPages = pruneResidentPages(result.pages, first, last, pageMargin);
          pagesRef.current = nextPages;
          pagesGeneration.current = nextTicket;
          knownIds.current = result.ids;
          rulesRef.current = rules;
          setPages(nextPages);
          setFailedPages(new Set());
          setNextCursor(result.nextCursor);
          setRawResultCount(result.raw);
          setAvailableCount(result.available);
          setBlacklistedCount(result.blacklisted);
          setReactedHiddenCount(result.reacted);
          setLoadingNext(false);
          setNextError(false);
          setFocusedId(previous => previous && result.ids.has(previous) ? previous : restoreId);
          if (refreshedViewerPost) {
            setSelectedSnapshot(refreshedViewerPost);
            detailLoader.current?.invalidate(refreshedViewerPost.id);
            setDetail(null);
            detailLoader.current?.request(refreshedViewerPost.id,
              value => { if (selectedIdRef.current === refreshedViewerPost.id) setDetail(value); },
              () => { if (selectedIdRef.current === refreshedViewerPost.id) setDetailError(true); }, true);
          }
          setAccountRefreshPending(viewingId !== null && !refreshedViewerPost);
          const positionVersion = gridAdjustmentVersion.current;
          if (restoreId && anchor) requestAnimationFrame(() => {
            if (positionVersion === gridAdjustmentVersion.current) grid.current?.restoreAnchor({ id: restoreId, offset: anchor.offset });
          });
        }).catch(error => {
          if (!cancelled()) showToast(`Could not refresh account results: ${String((error as Error).message || error)}`);
        }).finally(() => { if (accountSyncFlight.current === flight) accountSyncFlight.current = null; });
    };
    document.addEventListener('e322-account-sync', synchronize);
    return () => document.removeEventListener('e322-account-sync', synchronize);
  }, [expression, search, showToast, clearResumedReactions]);

  const loadNext = useCallback((): Promise<Post | null> => {
    if (restoringPositionRef.current) return Promise.resolve(null);
    if (deferredAccountRefresh.current || searchAccountId.current !== (accountSnapshot.current.profile?.id ?? null)) return Promise.resolve(null);
    if (blacklistRebuildInFlight.current) return Promise.resolve(null);
    if (pagesGeneration.current !== generation.current || pagesRef.current !== pages) return Promise.resolve(null);
    if (pendingNext.current) return pendingNext.current;
    if (!nextCursor || !pages.length) return Promise.resolve(null);
    setLoadingNext(true);
    setNextError(false);
    const ticket = generation.current;
    const accountTicket = accountSnapshot.current.profile?.id ?? null;
    const cursor = nextCursor;
    const request = (async () => {
      try {
        const result = await window.e322.search(expression(submitted, settings.rating), cursor, false);
        if (ticket !== generation.current || accountTicket !== (accountSnapshot.current.profile?.id ?? null) || deferredAccountRefresh.current) return null;
        setRawResultCount(count => count + result.posts.length);
        const filtered = filterSearchPosts(result.posts.filter(post => !knownIds.current.has(post.id)), submitted, rulesRef.current, reactionUpdates.current);
        setAvailableCount(count => count + filtered.available);
        setBlacklistedCount(count => count + filtered.blacklisted);
        setReactedHiddenCount(count => count + filtered.reacted);
        const visible = filtered.posts;
        for (const post of visible) knownIds.current.add(post.id);
        setPages(previous => {
          const appended = [...previous, { cursor, snapshotKey: result.snapshotKey, slots: visible.map(post => ({ id: post.id, ratio: postRatio(post), reacted: post.vote === 1 || post.is_favorited })), posts: visible }];
          const { first, last } = residentPages.current;
          return pruneResidentPages(appended, first, last, pageMargin);
        });
        setNextCursor(cursorAfter(result.posts, cursor, expression(submitted, settings.rating)));
        return visible[0] || null;
      } catch (error) {
        if (ticket === generation.current) { setNextError(true); showToast(String((error as Error).message || error)); }
        return null;
      }
    })();
    pendingNext.current = request;
    void request.finally(() => {
      if (pendingNext.current === request) pendingNext.current = null;
      if (ticket === generation.current) setLoadingNext(false);
    });
    return request;
  }, [nextCursor, pages, expression, submitted, settings.rating, showToast]);

  const loadPages = useCallback(async (indices: number[], retry = false) => {
    const ticket = generation.current;
    if (pagesGeneration.current !== ticket || pagesRef.current !== pages) return;
    const requests = indices.filter(index => pages[index] && !pages[index].posts && (retry || !failedPages.has(index)) && loadingPages.current.claim(index, ticket))
      .map(index => ({ index }));
    if (!requests.length) return;
    try {
      const results = await Promise.allSettled(requests.map(request => restoreStoredPage(request.index, pages[request.index], ticket, submitted, settings.rating)));
      if (ticket !== generation.current) return;
      const loaded = new Map<number, { posts: Map<number, Post>; snapshotKey: string }>();
      const failed: number[] = [];
      let lostSnapshot = false;
      results.forEach((result, position) => {
        if (result.status === 'fulfilled') loaded.set(requests[position].index, {
          posts: new Map(result.value.posts.map(post => [post.id, post])), snapshotKey: result.value.snapshotKey,
        });
        else {
          failed.push(requests[position].index);
          if (String(result.reason).includes('Page snapshot was lost')) lostSnapshot = true;
        }
      });
      if (failed.length) showToast(lostSnapshot ? 'Page snapshot was lost. Refresh the search.' : 'Could not restore a page. Click it to retry.');
      setFailedPages(previous => {
        const next = new Set(previous);
        for (const { index } of requests) {
          if (loaded.has(index)) next.delete(index);
          else next.add(index);
        }
        return next.size === previous.size && [...next].every(index => previous.has(index)) ? previous : next;
      });
      if (loaded.size) setPages(previous => previous.map((candidate, pageIndex) => {
        const result = loaded.get(pageIndex);
        if (!result || candidate.posts || pageIndex < residentPages.current.first - pageMargin || pageIndex > residentPages.current.last + pageMargin) return candidate;
        return { ...candidate, snapshotKey: result.snapshotKey, posts: candidate.slots.map(slot => {
          const post = result.posts.get(slot.id);
          return post ? applyLocalReaction(post, reactionUpdates.current.get(slot.id)) : null;
        }) };
      }));
    } finally {
      for (const { index } of requests) loadingPages.current.release(index, ticket);
    }
  }, [pages, failedPages, restoreStoredPage, submitted, settings.rating, showToast]);
  const loadPage = useCallback((index: number) => loadPages([index], true), [loadPages]);

  const slots = useMemo<Slot[]>(() => pages.flatMap((page, pageIndex) => {
    const failed = failedPages.has(pageIndex);
    const cached = pageSlotsCache.current.get(page);
    if (cached && cached.index === pageIndex && cached.failed === failed) return cached.slots;
    const mapped = page.slots.map((slot, index) => ({
      ...slot, pageIndex, post: page.posts?.[index] || null, unavailable: Boolean(page.posts && !page.posts[index]), failed,
    }));
    pageSlotsCache.current.set(page, { index: pageIndex, failed, slots: mapped });
    return mapped;
  }), [pages, failedPages]);
  const visibleGeometryCache = useRef<{
    pageSlots: StoredPage['slots'][]; query: string;
    geometry: { id: number; ratio: number }[]; indices: Map<number, number>;
  } | null>(null);
  const visibleGeometry = useMemo(() => {
    const pageSlots = pages.map(page => page.slots);
    const cached = visibleGeometryCache.current;
    if (cached && cached.query === submitted &&
        cached.pageSlots.length === pageSlots.length && cached.pageSlots.every((part, index) => part === pageSlots[index])) return cached;
    const geometry = slots.map(slot => ({ id: slot.id, ratio: slot.ratio }));
    const indices = new Map(geometry.map((slot, index) => [slot.id, index]));
    const next = { pageSlots, query: submitted, geometry, indices };
    visibleGeometryCache.current = next;
    return next;
  }, [pages, slots, submitted]);
  const slotIndices = visibleGeometry.indices;
  useLayoutEffect(() => { slotsRef.current = slots; }, [slots]);

  useLayoutEffect(() => {
    captureSession.current = () => {
      if (!booted || !searchReady || blacklistRebuildInFlight.current) return null;
      return captureSearchSession({
        query: submitted, draft: query, rating: settings.rating, accountId: searchAccountId.current,
        nextCursor, anchor: restoringPositionRef.current || grid.current?.captureAnchor() || null,
        counts: { raw: rawResultCount, available: availableCount, blacklisted: blacklistedCount, reacted: reactedHiddenCount },
      }, pages, reactionUpdates.current);
    };
  }, [booted, searchReady, submitted, query, settings.rating, nextCursor, rawResultCount, availableCount, blacklistedCount, reactedHiddenCount, pages]);
  useEffect(() => {
    if (booted && searchReady) scheduleSessionSave();
  }, [booted, searchReady, query, submitted, settings.rating, pages, nextCursor, scheduleSessionSave]);
  const finishPositionRestore = useCallback(() => {
    restoringPositionRef.current = null;
    setRestoringPosition(null);
    scheduleSessionSave();
  }, [scheduleSessionSave]);

  useEffect(() => {
    if (!loading && !loadingNext && !nextError && !slots.length && nextCursor && pages.length > 0 && pages.length < 4) void loadNext();
  }, [loading, loadingNext, nextError, slots.length, nextCursor, pages.length, loadNext]);

  const onVisible = useCallback((firstIndex: number, lastIndex: number, firstPrefetch: number, lastPrefetch: number) => {
    const first = slots[firstIndex]?.pageIndex;
    const last = slots[lastIndex]?.pageIndex;
    const residentFirst = slots[firstPrefetch]?.pageIndex;
    const residentLast = slots[lastPrefetch]?.pageIndex;
    if (first === undefined || last === undefined || residentFirst === undefined || residentLast === undefined) return;
    visiblePages.current = { first, last };
    if (first === 0 && grid.current?.isNearTop() && deferredAccountRefresh.current && selectedIdRef.current === null) {
      deferredAccountRefresh.current = false;
      setAccountRefreshPending(false);
      queueMicrotask(() => document.dispatchEvent(new Event('e322-refresh')));
    }
    const prior = residentPages.current;
    residentPages.current = { first: residentFirst, last: residentLast };
    if (prior.first !== residentFirst || prior.last !== residentLast) {
      setPages(previous => pruneResidentPages(previous, residentFirst, residentLast, pageMargin));
    }
    const missing = [];
    for (let pageIndex = residentFirst; pageIndex <= residentLast; pageIndex++) {
      if (!pages[pageIndex]?.posts && !failedPages.has(pageIndex)) missing.push(pageIndex);
    }
    if (missing.length) void loadPages(missing);
  }, [slots, pages, failedPages, loadPages]);

  const selectedPost = selectedId === null ? null : selectedSnapshot?.id === selectedId ? selectedSnapshot : slots[slotIndices.get(selectedId) ?? -1]?.post || null;

  const fetchDetail = useCallback((id: number, immediate = false) => {
    setDetailError(false);
    detailLoader.current?.request(id,
      value => { if (selectedIdRef.current === id) { setDetail(value); setDetailError(false); } },
      () => { if (selectedIdRef.current === id) setDetailError(true); }, immediate);
  }, []);

  const selectPost = useCallback((post: Post) => {
    selectedIdRef.current = post.id;
    viewerFallbackId.current = null;
    setSelectedId(post.id); setSelectedSnapshot(post); setFocusedId(post.id); setDetail(null);
    fetchDetail(post.id);
    updateSettings(previous => {
      const watched = markWatchedPost(previous.watched, post.id, post.tags || '');
      return watched === previous.watched ? null : { watched };
    });
  }, [updateSettings, fetchDetail]);

  const openPost = useCallback((id: number) => {
    const post = slots[slotIndices.get(id) ?? -1]?.post;
    if (!post) return;
    selectPost(post);
    if ((slotIndices.get(id) ?? -1) >= slots.length - 10) void loadNext();
  }, [slots, slotIndices, loadNext, selectPost]);

  const closeViewer = useCallback((restoreScroll = true, focusGallery = true) => {
    const id = selectedId;
    const focusAtClose = document.activeElement;
    const restoreId = id !== null && slotIndices.has(id) ? id : viewerFallbackId.current;
    selectedIdRef.current = null;
    viewerFallbackId.current = null;
    if (!deferredAccountRefresh.current && searchAccountId.current === (accountSnapshot.current.profile?.id ?? null)) setAccountRefreshPending(false);
    pendingViewerAdvance.current = null;
    detailLoader.current?.cancel();
    setSelectedId(null); setDetail(null);
    setFocusedId(restoreId);
    if (restoreId && restoreScroll) requestAnimationFrame(() => {
      const focusStillAvailable = document.activeElement === focusAtClose || document.activeElement === document.body;
      grid.current?.scrollToPost(restoreId, focusGallery && focusStillAvailable);
    });
  }, [selectedId, slotIndices]);

  const moveViewer = useCallback(async (delta: number) => {
    if (selectedId === null) return;
    const index = slotIndices.get(selectedId) ?? -1;
    const next = slots[index + delta];
    if (!next) {
      if (delta > 0) {
        pendingViewerAdvance.current = selectedId;
        void loadNext();
      }
      return;
    }
    pendingViewerAdvance.current = null;
    if (!next.post) {
      try {
        const ticket = generation.current;
        const page = await restoreStoredPage(next.pageIndex, pages[next.pageIndex], ticket, submitted, settings.rating);
        if (ticket !== generation.current || selectedIdRef.current !== selectedId) return;
        const raw = page.posts.find(item => item.id === next.id);
        const post = raw && applyLocalReaction(raw, reactionUpdates.current.get(raw.id));
        if (post) {
          const byId = new Map(page.posts.map(item => [item.id, item]));
          setPages(previous => previous.map((candidate, index) => index === next.pageIndex && !candidate.posts ? {
            ...candidate, snapshotKey: page.snapshotKey,
            posts: candidate.slots.map(slot => {
              const item = byId.get(slot.id);
              return item ? applyLocalReaction(item, reactionUpdates.current.get(slot.id)) : null;
            }),
          } : candidate));
          setFailedPages(previous => {
            if (!previous.has(next.pageIndex)) return previous;
            const updated = new Set(previous);
            updated.delete(next.pageIndex);
            return updated;
          });
          selectPost(post);
        }
      } catch (error) { showToast(String((error as Error).message || error)); }
      return;
    }
    openPost(next.id);
  }, [selectedId, slots, slotIndices, loadNext, pages, restoreStoredPage, submitted, settings.rating, openPost, selectPost, showToast]);

  useEffect(() => {
    const waitingFor = pendingViewerAdvance.current;
    if (waitingFor === null) return;
    if (selectedId !== waitingFor || nextError) { pendingViewerAdvance.current = null; return; }
    const index = slotIndices.get(waitingFor);
    const next = index === undefined ? null : slots[index + 1];
    if (next?.post) {
      pendingViewerAdvance.current = null;
      selectPost(next.post);
    } else if (next) {
      pendingViewerAdvance.current = null;
      void moveViewer(1);
    } else if (!next && !loadingNext) {
      if (nextCursor) void loadNext();
      else pendingViewerAdvance.current = null;
    }
  }, [selectedId, slots, slotIndices, nextCursor, loadingNext, nextError, loadNext, moveViewer, selectPost]);

  const mutatePost = useCallback((id: number, change: (post: Post) => Post) => {
    const current = slots[slotIndices.get(id) ?? -1]?.post || (selectedSnapshot?.id === id ? selectedSnapshot : null);
    if (!current) return;
    const next = change(current);
    reactionUpdates.current.set(id, { vote: next.vote, is_favorited: next.is_favorited });
    detailLoader.current?.invalidate(id);
    setPages(previous => previous.map(page => page.slots.some(slot => slot.id === id) ? {
      ...page,
      slots: page.slots.map(slot => slot.id === id ? { ...slot, reacted: next.vote === 1 || next.is_favorited } : slot),
      posts: page.posts?.map(post => post?.id === id ? next : post) || null,
    } : page));
    setSelectedSnapshot(previous => previous?.id === id ? next : previous);
    setDetail(previous => previous?.id === id ? { ...previous, score: { total: next.score }, fav_count: next.fav_count } : previous);
  }, [slots, slotIndices, selectedSnapshot]);

  const accountDataStale = useCallback(() => deferredAccountRefresh.current ||
    searchAccountId.current !== (accountSnapshot.current.profile?.id ?? null), []);

  const upvote = useCallback(async (id: number) => {
    if (!profile) { setPanelOrigin('menu'); setPanel('account'); return; }
    if (accountDataStale()) { showToast('Refresh results after switching accounts'); return; }
    if (pendingUpvotes.current.has(id)) return;
    pendingUpvotes.current.add(id);
    setUpvoteBusy(previous => new Set(previous).add(id));
    const revision = accountVersion.current;
    try {
      await window.e322.upvote(id);
      if (revision !== accountVersion.current) return;
      mutatePost(id, post => ({ ...post, score: post.score + (post.vote === 1 ? 0 : 1), vote: 1 }));
      showToast('Upvoted');
    } catch (error) { if (revision === accountVersion.current) showToast(String((error as Error).message || error)); }
    finally {
      pendingUpvotes.current.delete(id);
      setUpvoteBusy(previous => {
        const next = new Set(previous);
        next.delete(id);
        return next;
      });
    }
  }, [profile, accountDataStale, mutatePost, showToast]);

  const favorite = useCallback(async (id: number) => {
    if (!profile) { setPanelOrigin('menu'); setPanel('account'); return; }
    if (accountDataStale()) { showToast('Refresh results after switching accounts'); return; }
    if (pendingFavorites.current.has(id)) return;
    pendingFavorites.current.add(id);
    setFavoriteBusy(previous => new Set(previous).add(id));
    const revision = accountVersion.current;
    const current = slots[slotIndices.get(id) ?? -1]?.post?.is_favorited ?? (selectedSnapshot?.id === id ? selectedSnapshot.is_favorited : false);
    try {
      await window.e322.favorite(id, !current);
      if (revision !== accountVersion.current) return;
      mutatePost(id, post => ({ ...post, is_favorited: !current, fav_count: Math.max(0, post.fav_count + (current ? -1 : 1)) }));
      showToast(current ? 'Removed from favorites' : 'Added to favorites');
    } catch (error) { if (revision === accountVersion.current) showToast(String((error as Error).message || error)); }
    finally {
      pendingFavorites.current.delete(id);
      setFavoriteBusy(previous => {
        const next = new Set(previous);
        next.delete(id);
        return next;
      });
    }
  }, [profile, accountDataStale, slots, slotIndices, selectedSnapshot, mutatePost, showToast]);

  const download = useCallback(async (post: Post, combined: boolean) => {
    if (combined && !profile) { setPanelOrigin('menu'); setPanel('account'); return; }
    if (combined && accountDataStale()) { showToast('Refresh results after switching accounts'); return; }
    try {
      if (!settings.downloadFolder) {
        const folder = await window.e322.chooseFolder();
        if (!folder) return;
        setSettings(previous => ({ ...previous, downloadFolder: folder }));
      }
      await window.e322.startDownload({ id: post.id }, combined);
    } catch (error) { showToast(String((error as Error).message || error)); }
  }, [profile, accountDataStale, settings.downloadFolder, showToast]);

  const rebuildBlacklist = useCallback((rules: BlacklistRule[]) => {
    const version = ++blacklistRebuildVersion.current;
    const searchTicket = ++generation.current;
    blacklistRebuildInFlight.current = true;
    pendingNext.current = null;
    loadingPages.current.clear();
    restoringPages.current.clear();
    setLoadingNext(false);
    setBlacklistRebuilding(true);
    void (async () => {
      try {
        for (let attempt = 0; attempt < 4; attempt++) {
          const source = pagesRef.current;
          if (!source.length) return;
          const result = await refilterStoredPages(source, submittedRef.current, rules, reactionUpdates.current,
            page => window.e322.restorePage(page.snapshotKey, expression(submittedRef.current, settings.rating), page.cursor),
            () => version !== blacklistRebuildVersion.current || searchTicket !== generation.current);
          if (!result) return;
          if (pagesRef.current !== source) continue;
          const anchor = grid.current?.captureAnchor();
          const nextIds = new Set<number>();
          for (const page of result.pages) for (const slot of page.slots) nextIds.add(slot.id);
          const previousSlots = slotsRef.current;
          const oldIndex = anchor ? previousSlots.findIndex(slot => slot.id === anchor.id) : -1;
          let restoreId: number | null = anchor && nextIds.has(anchor.id) ? anchor.id : null;
          for (let index = Math.max(0, oldIndex + 1); restoreId === null && index < previousSlots.length; index++) {
            if (nextIds.has(previousSlots[index].id)) restoreId = previousSlots[index].id;
          }
          for (let index = oldIndex - 1; restoreId === null && index >= 0; index--) {
            if (nextIds.has(previousSlots[index].id)) restoreId = previousSlots[index].id;
          }
          if (restoreId === null) restoreId = nextIds.values().next().value ?? null;
          pagesRef.current = result.pages;
          pagesGeneration.current = searchTicket;
          setPages(result.pages);
          knownIds.current = nextIds;
          setFailedPages(new Set());
          setRawResultCount(result.raw);
          setAvailableCount(result.available);
          setBlacklistedCount(result.blacklisted);
          setReactedHiddenCount(result.reacted);
          setFocusedId(previous => previous && nextIds.has(previous) ? previous : restoreId);
          const positionVersion = gridAdjustmentVersion.current;
          if (restoreId && anchor) requestAnimationFrame(() => {
            if (positionVersion === gridAdjustmentVersion.current) grid.current?.restoreAnchor({ id: restoreId, offset: anchor.offset });
          });
          return;
        }
        throw new Error('Pages changed while updating the blacklist');
      } catch (error) {
        if (version === blacklistRebuildVersion.current) {
          showToast(`Blacklist: ${String((error as Error).message || error)}. Refreshing search`);
          void search(submittedRef.current, settings.rating, true, true);
        }
      } finally {
        if (version === blacklistRebuildVersion.current) {
          blacklistRebuildInFlight.current = false;
          setBlacklistRebuilding(false);
          if (deferredAccountRefresh.current && searchAccountId.current !== (accountSnapshot.current.profile?.id ?? null)) {
            queueMicrotask(() => document.dispatchEvent(new Event('e322-account-sync')));
          }
        }
      }
    })();
  }, [search, expression, settings.rating, showToast]);

  useEffect(() => {
    if (selectedId !== null || !pendingBlacklist.current) return;
    const rules = pendingBlacklist.current;
    pendingBlacklist.current = null;
    rebuildBlacklist(rules);
  }, [selectedId, rebuildBlacklist]);

  const queueBlacklistSync = useCallback((rules: BlacklistRule[]) => {
    const version = ++blacklistSyncVersion.current;
    setBlacklistIssue(null);
    setBlacklist(rules);
    rulesRef.current = rules;
    updateSettings({ disabledBlacklist: rules.filter(rule => !rule.enabled).map(rule => rule.text) });
    if (pagesRef.current.length) {
      if (deferredAccountRefresh.current && searchAccountId.current !== (accountSnapshot.current.profile?.id ?? null)) {
        generation.current++;
        queueMicrotask(() => document.dispatchEvent(new Event('e322-account-sync')));
      } else if (selectedIdRef.current === null) rebuildBlacklist(rules);
      else pendingBlacklist.current = rules;
    }
    if (blacklistTimer.current) clearTimeout(blacklistTimer.current);
    if (!profile) return;
    const nextRules = rules.map(rule => rule.text).join('\n');
    if (nextRules === blacklistConfirmedText.current && !blacklistRequestsInFlight.current) { setBlacklistSyncing(false); return; }
    setBlacklistSyncing(true);
    blacklistTimer.current = setTimeout(() => {
      if (nextRules === blacklistConfirmedText.current && !blacklistRequestsInFlight.current) {
        if (version === blacklistSyncVersion.current) setBlacklistSyncing(false);
        return;
      }
      blacklistRequestsInFlight.current++;
      void window.e322.updateBlacklist(nextRules)
        .then(value => {
          if (accountSnapshot.current.profile?.id !== value.id) return;
          blacklistConfirmedText.current = normalizedBlacklist(value.blacklisted_tags || '');
          accountSnapshot.current = { ...accountSnapshot.current, profile: value };
          if (version === blacklistSyncVersion.current) {
            setProfile(value);
            setBlacklistIssue(null);
          }
        }).catch(error => {
          if (version === blacklistSyncVersion.current) {
            setBlacklistIssue('Rules are not synced with e621');
            showToast(`Blacklist: ${String(error.message || error)}`);
          }
        }).finally(() => {
          blacklistRequestsInFlight.current--;
          if (version === blacklistSyncVersion.current) setBlacklistSyncing(false);
        });
    }, 450);
  }, [profile, updateSettings, showToast, rebuildBlacklist]);

  const toggleBlacklist = useCallback((raw: string) => {
    if (!profile) { setPanelOrigin('menu'); setPanel('account'); return; }
    const tag = raw.trim();
    if (!tag) return;
    const existing = blacklist.find(rule => rule.text.toLowerCase() === tag.toLowerCase());
    if (existing) queueBlacklistSync(blacklist.map(rule => rule === existing ? { ...rule, enabled: !rule.enabled } : rule));
    else queueBlacklistSync([...blacklist, { text: tag, enabled: true }]);
  }, [profile, blacklist, queueBlacklistSync]);

  const navigateSearch = useCallback((text: string) => { closeViewer(false); void search(text); }, [closeViewer, search]);

  const completeSuggestion = useCallback((tag: TagSuggestion) => {
    const result = completeSearchToken(query, searchInput.current?.selectionStart ?? searchCaret, tag.name);
    completedSearchToken.current = result;
    setQuery(result.query);
    setSearchCaret(result.caret);
    setSearchSelectionEnd(result.caret);
    setSuggestions([]);
    setSuggestionIndex(-1);
    searchInput.current?.focus();
    requestAnimationFrame(() => searchInput.current?.setSelectionRange(result.caret, result.caret));
  }, [query, searchCaret]);

  useEffect(() => {
    const input = searchInput.current;
    const token = searchTokenAtCaret(query, searchCaret);
    const term = token?.text || '';
    if (!searchFocused || searchCaret !== searchSelectionEnd || input?.selectionStart !== input?.selectionEnd ||
        (completedSearchToken.current?.query === query && completedSearchToken.current.caret === searchCaret) ||
        term.length < 2 || term.includes(':')) { setSuggestions([]); setSuggestionIndex(-1); return; }
    let alive = true;
    const timer = setTimeout(() => { void window.e322.autocomplete(term).then(values => {
      if (alive) { setSuggestions(values); setSuggestionIndex(-1); }
    }).catch(() => { if (alive) setSuggestions([]); }); }, 260);
    return () => { alive = false; clearTimeout(timer); };
  }, [query, searchFocused, searchCaret, searchSelectionEnd]);

  const watchedNamesKey = JSON.stringify(settings.watched.map(item => item.name));
  const refreshWatched = useCallback(async () => {
    const names = JSON.parse(watchedNamesKey) as string[];
    if (watchRefreshInFlight.current || !names.length) return;
    const version = ++watchRefreshVersion.current;
    watchRefreshInFlight.current = true;
    setWatchRefreshing(true);
    try {
      await watchCancelTail.current;
      if (version !== watchRefreshVersion.current) return;
      const found = new Map<string, number[]>();
      let failures = 0;
      for (const name of names) {
        if (version !== watchRefreshVersion.current) return;
        try {
          const item = watchedRef.current.find(value => value.name.toLowerCase() === name.toLowerCase());
          found.set(name.toLowerCase(), await collectWatchedIds(item?.checkpoint ?? 0, cursor => window.e322.search(watchedTagQuery(name), cursor, false, true)));
        } catch { failures++; }
      }
      if (version !== watchRefreshVersion.current) return;
      if (found.size) updateSettings(previous => {
        const watched = mergeWatchedRefresh(previous.watched, found);
        return watched === previous.watched ? null : { watched };
      });
      if (failures) showToast(`Tags not refreshed: ${failures}`);
    } finally {
      if (version === watchRefreshVersion.current) {
        watchRefreshInFlight.current = false;
        setWatchRefreshing(false);
      }
    }
  }, [watchedNamesKey, updateSettings, showToast]);

  const cancelWatchedRefresh = useCallback(() => {
    if (!watchRefreshInFlight.current) return;
    watchRefreshVersion.current++;
    watchRefreshInFlight.current = false;
    setWatchRefreshing(false);
    watchCancelTail.current = window.e322.cancelBackgroundSearch().catch(() => {});
  }, []);

  useEffect(() => {
    if (panel !== 'watchlist') return;
    void refreshWatched();
    return cancelWatchedRefresh;
  }, [panel, refreshWatched, cancelWatchedRefresh]);

  useEffect(() => {
    return window.e322.onMenu(command => {
      if (command === 'search') {
        if (selectedId !== null) closeViewer(true, false);
        requestAnimationFrame(focusSearch);
      } else if (command === 'refresh') document.dispatchEvent(new CustomEvent('e322-refresh'));
      else if (command === 'blacklist') { setPanelOrigin('toolbar'); setPanel('blacklist'); }
      else if (command === 'downloads') { setPanelOrigin('status'); setPanel('downloads'); }
      else if (command === 'watchlist' || command === 'shortcuts') { setPanelOrigin('menu'); setPanel(command); }
      else if (panel === 'none') {
        const post = selectedPost ?? (focusedId !== null ? slots[slotIndices.get(focusedId) ?? -1]?.post : null);
        if (!post) return;
        if (command === 'download') void download(post, false);
        else if (command === 'upvote') void upvote(post.id);
        else if (command === 'favorite') void favorite(post.id);
        else if (command === 'all') void download(post, true);
      }
    });
  }, [selectedId, closeViewer, focusSearch, panel, selectedPost, focusedId, slots, slotIndices, download, upvote, favorite]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const editable = ['INPUT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable;
      if (event.metaKey && ['/', '?'].includes(event.key)) { event.preventDefault(); setPanelOrigin('menu'); setPanel('shortcuts'); return; }
      if (event.key === 'Escape') {
        if (panelOrigin === 'menu' && panel !== 'menu' && panel !== 'none') { setPanel('menu'); event.preventDefault(); return; }
        if (panel !== 'none') { setPanel('none'); event.preventDefault(); return; }
        if (selectedId !== null) { closeViewer(); event.preventDefault(); return; }
        if (document.activeElement === searchInput.current) {
          searchInput.current?.blur(); setSuggestions([]); setSuggestionIndex(-1); event.preventDefault(); return;
        }
      }
      if (editable || panel !== 'none' || event.metaKey || event.ctrlKey || event.altKey) return;
      if (selectedId !== null) {
        if (event.key === ' ') { closeViewer(); event.preventDefault(); return; }
        if (target.closest('video, .viewer-side')) return;
        if (event.key === '/') {
          closeViewer(true, false);
          requestAnimationFrame(focusSearch);
          event.preventDefault(); return;
        }
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { void moveViewer(-1); event.preventDefault(); return; }
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { void moveViewer(1); event.preventDefault(); return; }
        if (!selectedPost) return;
        switch (event.key.toLowerCase()) {
          case 'c': void window.e322.copyPost(selectedPost.id).then(() => showToast('Link copied')); break;
          case 'b': document.dispatchEvent(new Event('e322-viewer-tags')); break;
          case 'i': document.dispatchEvent(new Event('e322-viewer-info')); break;
          default: return;
        }
        event.preventDefault(); return;
      }
      const index = focusedId === null ? -1 : slotIndices.get(focusedId) ?? -1;
      let next = index < 0 ? 0 : index;
      if (event.key === 'ArrowLeft') next--;
      else if (event.key === 'ArrowRight') next++;
      else if (event.key === 'ArrowUp') next -= effectiveColumns;
      else if (event.key === 'ArrowDown') next += effectiveColumns;
      else if ((event.key === ' ' || event.key === 'Enter') && focusedId) {
        if (target.closest('button, [role="button"], a, select')) return;
        openPost(focusedId); event.preventDefault(); return;
      }
      else if (event.key === '/') { focusSearch(); event.preventDefault(); return; }
      else if (event.key === '?') { setPanelOrigin('menu'); setPanel('shortcuts'); event.preventDefault(); return; }
      else return;
      next = Math.max(0, Math.min(slots.length - 1, next));
      if (slots[next]) { setFocusedId(slots[next].id); grid.current?.scrollToPost(slots[next].id); }
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panel, panelOrigin, selectedId, selectedPost, focusedId, slots, slotIndices, effectiveColumns, openPost, moveViewer, closeViewer, download, upvote, favorite, showToast, focusSearch]);

  const downloadActive = downloads.filter(job => job.status === 'running' || job.status === 'waiting');
  const downloadLast = downloads.find(job => ['complete', 'failed', 'cancelled'].includes(job.status));
  const visibleCount = slots.length;
  const accountResultsStale = accountRefreshPending || searchAccountId.current !== (profile?.id ?? null);
  const shownRating = explicitRating(query.trim() || submitted) || settings.rating;
  const searchEditorWidth = useMemo(() => {
    const context = document.createElement('canvas').getContext('2d');
    if (!context) return 110;
    context.font = '12px -apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif';
    // Leave room for the clear button, input padding and the last glyph.
    return Math.max(104, Math.ceil(context.measureText(query || 'Search tags').width) + 40);
  }, [query]);

  const lightAppearance = settings.theme === 'light' || (settings.theme === 'system' && systemLight);
  const menuOpen = panel !== 'none' && panelOrigin === 'menu';
  const searchExpanded = searchFocused || Boolean(query);
  const searchControlsVisible = searchExpanded || (panelOrigin === 'toolbar' && (panel === 'history' || panel === 'filter'));
  const menuItem = (target: Exclude<Panel, 'none' | 'menu' | 'blacklist' | 'downloads'>, icon: string, title: string, trailing?: string) =>
    <button ref={element => { menuRowRefs.current[target] = element; }} className={`menu-row ${panel === target ? 'active' : ''}`}
      aria-haspopup="dialog" aria-expanded={panel === target}
      onClick={() => { setPanelOrigin('menu'); setPanel(panel === target ? 'menu' : target); if (target === 'watchlist') void refreshWatched(); }}>
      <Icon name={icon} /><span>{title}</span>{trailing && <small>{trailing}</small>}
    </button>;

  return <div className={`app-shell ${lightAppearance ? 'light' : ''}`}>
    <div className="drag-strip" />
    <header className="topbar">
      <div className={`search-pill glass ${searchExpanded ? 'expanded' : ''} ${searchControlsVisible ? 'controls-visible' : ''} ${query ? 'has-query' : ''}`}
        style={{ '--search-editor-width': `${searchEditorWidth}px` } as CSSProperties}>
        <img className="app-logo" src="./libfurry.svg" alt="libfurry" width="52" height="16" draggable={false} />
        <button className="icon-button search-trigger" aria-label={searchFocused ? 'Search' : 'Edit search'}
          onMouseDown={event => event.preventDefault()}
          onClick={() => {
            if (!searchFocused) { searchInput.current?.focus(); return; }
            void search(query);
            searchInput.current?.blur();
          }}><Icon name="search" /></button>
        <div className="search-editor">
          <input ref={searchInput} value={query} placeholder="Search tags" aria-label="Search tags"
            tabIndex={searchExpanded ? 0 : -1}
            role="combobox" aria-autocomplete="list" aria-expanded={searchFocused && suggestions.length > 0}
            aria-controls="search-suggestions" aria-activedescendant={suggestionIndex >= 0 ? `search-suggestion-${suggestionIndex}` : undefined}
            onFocus={event => { setSearchFocused(true); setSearchCaret(event.currentTarget.selectionStart ?? 0); setSearchSelectionEnd(event.currentTarget.selectionEnd ?? 0); setPanel('none'); }}
            onBlur={() => {
              setSearchFocused(false); setSuggestions([]); setSuggestionIndex(-1);
              if (!query.trim() && submittedRef.current !== 'order:hot') void search('', settings.rating, false, true);
            }}
            onChange={event => { completedSearchToken.current = null; setQuery(event.target.value); setSearchCaret(event.target.selectionStart ?? 0); setSearchSelectionEnd(event.target.selectionEnd ?? 0); setSuggestionIndex(-1); }}
            onSelect={event => {
              if (event.currentTarget.selectionStart !== completedSearchToken.current?.caret) completedSearchToken.current = null;
              setSearchCaret(event.currentTarget.selectionStart ?? 0);
              setSearchSelectionEnd(event.currentTarget.selectionEnd ?? 0);
              if (event.currentTarget.selectionStart !== event.currentTarget.selectionEnd) { setSuggestions([]); setSuggestionIndex(-1); }
            }}
            onKeyDown={event => {
              if (event.key === 'ArrowDown' && suggestions.length) { setSuggestionIndex(index => (index + 1) % suggestions.length); event.preventDefault(); }
              else if (event.key === 'ArrowUp' && suggestions.length) { setSuggestionIndex(index => index <= 0 ? suggestions.length - 1 : index - 1); event.preventDefault(); }
              else if (event.key === 'Enter') {
                if (suggestionIndex >= 0 && suggestions[suggestionIndex]) completeSuggestion(suggestions[suggestionIndex]);
                else { void search(query); searchInput.current?.blur(); }
                event.preventDefault();
              }
            }} />
          <button className="icon-button subtle clear-search" title="Clear" tabIndex={query ? 0 : -1} aria-hidden={!query}
            onMouseDown={event => event.preventDefault()}
            onClick={() => { setQuery(''); searchInput.current?.focus(); }}><Icon name="close" /></button>
        </div>
        {searchFocused && suggestions.length > 0 && <div className="suggestions glass">
          <div id="search-suggestions" role="listbox">{suggestions.map((tag, index) => <button key={tag.id}
            id={`search-suggestion-${index}`} role="option" aria-selected={suggestionIndex === index}
            className={suggestionIndex === index ? 'active' : ''}
            onMouseDown={event => event.preventDefault()} onMouseEnter={() => setSuggestionIndex(index)}
            onClick={() => completeSuggestion(tag)}><span>{tag.name}</span><small>{tag.post_count}</small></button>)}</div>
        </div>}
        <span className="bar-separator" />
        <button ref={blacklistTrigger} className="icon-button" title="Blacklist · ⌘B" aria-haspopup="dialog" aria-expanded={panel === 'blacklist'} onMouseDown={event => event.preventDefault()} onClick={event => { panelReturnFocus.current = event.currentTarget; searchInput.current?.blur(); setPanelOrigin('toolbar'); setPanel(panel === 'blacklist' ? 'none' : 'blacklist'); }}><Icon name="blacklist" /></button>
        <button ref={historyTrigger} className="icon-button toolbar-secondary" title="History" aria-haspopup="dialog" aria-expanded={panel === 'history'} tabIndex={searchControlsVisible ? 0 : -1} aria-hidden={!searchControlsVisible} onMouseDown={event => event.preventDefault()} onClick={event => { panelReturnFocus.current = query ? event.currentTarget : document.querySelector<HTMLElement>('.search-trigger'); searchInput.current?.blur(); setPanelOrigin('toolbar'); setPanel(panel === 'history' && panelOrigin === 'toolbar' ? 'none' : 'history'); }}><Icon name="history" /></button>
        <button ref={filterTrigger} className="icon-button toolbar-secondary" title="Rating" aria-haspopup="dialog" aria-expanded={panel === 'filter'} tabIndex={searchControlsVisible ? 0 : -1} aria-hidden={!searchControlsVisible} onMouseDown={event => event.preventDefault()} onClick={event => { panelReturnFocus.current = query ? event.currentTarget : document.querySelector<HTMLElement>('.search-trigger'); searchInput.current?.blur(); setPanelOrigin('toolbar'); setPanel(panel === 'filter' && panelOrigin === 'toolbar' ? 'none' : 'filter'); }}><Icon name="filter" /></button>
        <button className="icon-button toolbar-secondary" title="Refresh · ⌘R" tabIndex={searchControlsVisible ? 0 : -1} aria-hidden={!searchControlsVisible} onMouseDown={event => event.preventDefault()} onClick={() => { searchInput.current?.blur(); void search(submitted, settings.rating, true); }}><Icon name="refresh" /></button>
        <button ref={menuTrigger} className="icon-button" title="Menu" aria-haspopup="dialog" aria-expanded={menuOpen} onMouseDown={event => event.preventDefault()} onClick={event => { panelReturnFocus.current = event.currentTarget; searchInput.current?.blur(); setPanelOrigin('menu'); setPanel(menuOpen ? 'none' : 'menu'); }}><Icon name="more" /></button>
      </div>
      <div className="grid-pill glass">
        <button className="icon-button" title={`Grid: ${settings.gridStyle}`} onClick={() => changeGrid({ gridStyle: settings.gridStyle === 'apple' ? 'masonry' : settings.gridStyle === 'masonry' ? 'square' : 'apple' })}><Icon name={settings.gridStyle === 'square' ? 'gridSquare' : 'gridOriginal'} /></button>
        <input type="range" min="2" max="16" step="1" value={settings.columns} aria-label="Number of columns"
          onChange={event => changeGrid({ columns: Number(event.target.value) })} />
        <span>{settings.columns}</span>
      </div>
    </header>

    <GalleryGrid ref={grid} slots={slots} geometrySlots={visibleGeometry.geometry} columns={settings.columns} style={settings.gridStyle} focusedId={focusedId} loading={!booted || loading || loadingNext} hasMore={Boolean(nextCursor)}
      emptyMessage={searchError ? 'Could not load posts' : nextError ? 'Could not load this page' : availableCount && blacklistedCount === availableCount ? 'Posts hidden by blacklist' : availableCount && reactedHiddenCount === availableCount ? 'Posts already upvoted or favorited' : rawResultCount ? nextCursor ? 'Filtered posts so far' : 'All posts filtered out' : 'No posts found'}
      emptyActionLabel={searchError || nextError ? 'Retry' : availableCount && blacklistedCount === availableCount ? 'Blacklist' : nextCursor && pages.length >= 4 ? 'Search further' : undefined}
      onEmptyAction={searchError ? () => void search(submitted, settings.rating, true) : nextError ? loadNext : availableCount && blacklistedCount === availableCount ? () => { setPanelOrigin('toolbar'); setPanel('blacklist'); } : loadNext}
      loadError={nextError && visibleCount > 0} onRetry={loadNext}
      onOpen={openPost} onRetryPage={loadPage} onFocus={setFocusedId} onVisible={onVisible} onEnd={loadNext} onColumnsChange={setEffectiveColumns}
      restorePosition={restoringPosition} onPositionRestored={finishPositionRestore} onScrollPositionChange={scheduleSessionSave} />
    {(!booted || loading) && !visibleCount && <InitialSkeleton columns={effectiveColumns} style={settings.gridStyle} />}

    <div className="gallery-footer">
      <div className="gallery-status">
        <button className="download-status to-top glass" onClick={() => {
          restoringPositionRef.current = null;
          setRestoringPosition(null);
          gridAdjustmentVersion.current++;
          closeViewer(false, false);
          setPanel('none');
          grid.current?.scrollToTop();
          setFocusedId(slots[0]?.id ?? null);
          scheduleSessionSave();
        }}><Icon name="back" /><span>To the top</span></button>
        <button ref={downloadsTrigger} className="download-status glass" aria-haspopup="dialog" aria-expanded={panel === 'downloads'} onClick={event => { panelReturnFocus.current = event.currentTarget; setPanelOrigin('status'); setPanel(panel === 'downloads' ? 'none' : 'downloads'); }}>
          <Icon name="download" />
          <span>{downloadActive.length ? `${downloadActive.length} · ${downloadActive[0].status === 'waiting' ? 'Waiting' : downloadProgress(downloadActive[0])}` : downloadLast ? downloadLast.status === 'complete' ? 'Downloaded' : downloadLast.status === 'failed' ? 'Download failed' : 'Cancelled' : 'Downloads'}</span>
        </button>
      </div>
      {selectedId === null && <div className="shortcut-strip glass" aria-label="Keyboard shortcuts">
        <span className="shortcut-hint" title="Download + upvote + favorite"><kbd>⌘S</kbd>All</span>
        <span className="shortcut-hint"><kbd>⌘U</kbd>Upvote</span>
        <span className="shortcut-hint"><kbd>⌘F</kbd>Favorite</span>
        <span className="shortcut-hint"><kbd>⌘D</kbd>Download</span>
        <button className="shortcut-hint shortcut-open" aria-haspopup="dialog" aria-expanded={panel === 'shortcuts'} onClick={event => { panelReturnFocus.current = event.currentTarget; setPanelOrigin('menu'); setPanel(panel === 'shortcuts' && panelOrigin === 'menu' ? 'none' : 'shortcuts'); }}><kbd>⌘/</kbd>Keys</button>
      </div>}
    </div>
    {storageIssues.length > 0 && <button className="storage-issue glass" onClick={() => { setPanelOrigin('menu'); setPanel('settings'); }} title="Show local data errors"><Icon name="info" /><span>Local data</span></button>}

    <AnimatePresence>{toast && <motion.div className="toast glass" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>{toast}</motion.div>}</AnimatePresence>
    <AnimatePresence>{selectedPost && selectedId !== null && <Viewer key="viewer" post={selectedPost} detail={detail} detailError={detailError} account={Boolean(profile)} accountStale={accountResultsStale} upvoteBusy={upvoteBusy.has(selectedPost.id)} favoriteBusy={favoriteBusy.has(selectedPost.id)} blacklist={blacklist}
      onClose={() => closeViewer()} onMove={moveViewer} onSearch={navigateSearch} onBlacklist={toggleBlacklist}
      onRefresh={() => void search(submitted, settings.rating, true)}
      onRetryDetail={() => fetchDetail(selectedPost.id, true)}
      onDownload={combined => void download(selectedPost, combined)} onVote={() => void upvote(selectedPost.id)}
      onFavorite={() => void favorite(selectedPost.id)}
      onCopy={() => void window.e322.copyPost(selectedPost.id).then(() => showToast('Link copied'))}
      onCopySource={source => void window.e322.copyText(source).then(() => showToast('Source copied'))}
      onBrowser={() => void window.e322.openPost(selectedPost.id)} />}</AnimatePresence>

    <AnimatePresence>{panel !== 'none' && <motion.div className="popover-layer" initial={{ opacity: 1 }} animate={{ opacity: 1 }} exit={{ opacity: 0, pointerEvents: 'none' }} transition={{ duration: .24 }}>
      <AnimatePresence propagate initial={false}>
      {menuOpen && <MembranePopover key="menu" panelRef={menuPanelElement} className="panel panel-menu" label="Menu">
        <div className="panel-list">
          {menuItem('history', 'history', 'History')}
          {menuItem('filter', 'filter', 'Rating')}
          {rowIcon('refresh', 'Refresh', () => void search(submitted, settings.rating, true))}
          {menuItem('watchlist', 'tag', 'Watched Tags')}
          {menuItem('account', 'user', profile?.name || 'Sign In')}
          {menuItem('settings', 'settings', 'Settings')}
          {menuItem('shortcuts', 'keyboard', 'Keyboard Shortcuts', '⌘/')}
        </div>
      </MembranePopover>}
      {panel !== 'menu' && <MembranePopover key={`${panelOrigin}-${panel}`} panelRef={panelElement} className={`panel panel-${panel} ${panelOrigin === 'menu' ? 'nested-panel' : ''}`}
        label={({ history: 'History', filter: 'Rating', blacklist: 'Blacklist', watchlist: 'Watched Tags', account: 'Account', settings: 'Settings', downloads: 'Downloads', shortcuts: 'Keyboard Shortcuts' } as Record<Exclude<Panel, 'none' | 'menu'>, string>)[panel]}>
        {panel === 'history' && <div className="panel-list">{settings.history.map(item => rowIcon('history', item, () => navigateSearch(item)))}</div>}
        {panel === 'filter' && <div className="panel-list">{([['all', 'All Ratings'], ['s', 'Safe'], ['q', 'Questionable'], ['e', 'Explicit']] as const).map(([value, label]) => rowIcon(value === shownRating ? 'check' : 'filter', label, () => { const text = applyRatingFilter(query.trim() || submitted, value); updateSettings({ rating: value }); setQuery(text); void search(text, value, true); }))}</div>}
        {panel === 'account' && <div className="panel-body">{profile ? <>
          <div className="account-name">{profile.name}</div>
          {accountRefreshPending && <button className="wide-button" onClick={() => void search(submitted, settings.rating, true)}>Refresh results</button>}
          <button className="wide-button" onClick={() => { void window.e322.logout().then(value => { if (value.stale || value.revision < accountVersion.current) return; accountVersion.current = value.revision; accountSnapshot.current = { profile: null, accountIssue: null }; blacklistConfirmedText.current = ''; blacklistSyncVersion.current++; if (blacklistTimer.current) clearTimeout(blacklistTimer.current); setBlacklistSyncing(false); setBlacklistIssue(null); reactionUpdates.current.clear(); setProfile(null); setAccountIssue(null); setBlacklist([]); setPanel('none'); void search(submitted, settings.rating, true); }).catch(error => showToast(String(error.message || error))); }}>Sign Out</button>
        </> : <form onSubmit={event => { event.preventDefault(); void window.e322.login(loginName, loginKey).then(value => {
          accountVersion.current = value.revision; accountSnapshot.current = { profile: value.profile, accountIssue: null }; blacklistConfirmedText.current = normalizedBlacklist(value.profile.blacklisted_tags || ''); blacklistSyncVersion.current++; if (blacklistTimer.current) clearTimeout(blacklistTimer.current); setBlacklistSyncing(false); setBlacklistIssue(null);
          reactionUpdates.current.clear(); setProfile(value.profile); setAccountIssue(null); setBlacklist(parseBlacklist(value.profile.blacklisted_tags || '', settings.disabledBlacklist)); setLoginKey(''); setPanel('none'); void search(submitted, settings.rating, true);
        }).catch(error => showToast(String(error.message || error))); }}>
          {accountIssue && <div className="account-issue" role="alert">{accountIssue}<button type="button" className="wide-button" disabled={accountRetrying} onClick={() => {
            setAccountRetrying(true);
            void window.e322.retryAccount().then(value => {
              if (value.profile) setPanel('none');
            }).catch(error => showToast(String(error.message || error))).finally(() => setAccountRetrying(false));
          }}>{accountRetrying ? 'Checking…' : 'Retry'}</button></div>}
          <label>Username<input autoComplete="username" value={loginName} onChange={event => setLoginName(event.target.value)} /></label>
          <label>API Key<input type="password" autoComplete="off" value={loginKey} onChange={event => setLoginKey(event.target.value)} /></label>
          <button className="wide-button primary" type="submit">Sign In</button>
        </form>}</div>}
        {panel === 'blacklist' && <div className="panel-body">
          {!profile && <button className="wide-button" onClick={() => { setPanelOrigin('menu'); setPanel('account'); }}>Sign in to sync</button>}
          {profile && <form className="inline-form" onSubmit={event => { event.preventDefault(); toggleBlacklist(newRule); setNewRule(''); }}><input placeholder="Add a rule" value={newRule} onChange={event => setNewRule(event.target.value)} /><button title="Add">+</button></form>}
          <div className="rule-list">{blacklist.map(rule => <div className="rule" key={rule.text}>
            <button className={`rule-switch ${rule.enabled ? 'on' : ''}`} aria-label={rule.enabled ? 'Disable' : 'Enable'} onClick={() => toggleBlacklist(rule.text)}>{rule.enabled ? '●' : '○'}</button>
            <span>{rule.text}</span><button className="remove-rule" title="Remove" onClick={() => queueBlacklistSync(blacklist.filter(item => item !== rule))}>×</button>
          </div>)}</div>
          {(blacklistRebuilding || blacklistSyncing) && <span className="muted">{blacklistRebuilding ? 'Applying…' : 'Syncing…'}</span>}
          {blacklistIssue && <button className="wide-button" aria-live="polite" onClick={() => queueBlacklistSync(blacklist)}>{blacklistIssue} · Retry</button>}
        </div>}
        {panel === 'watchlist' && <div className="panel-body">
          <form className="inline-form" onSubmit={event => { event.preventDefault(); const name = newWatched.trim(); if (name && !settings.watched.some(item => item.name.toLowerCase() === name.toLowerCase())) updateSettings({ watched: [...settings.watched, { name, unseen: [], seen: [], checkpoint: 0 }] }); setNewWatched(''); }}><input placeholder="Tag" value={newWatched} onChange={event => setNewWatched(event.target.value)} /><button title="Add">+</button></form>
          <div className="rule-list">{settings.watched.map(item => <div className="rule" key={item.name}><button className="watch-name" onClick={() => navigateSearch(item.name)}>{item.name}</button><small>{item.unseen.length}</small><button className="remove-rule" title="Remove" onClick={() => updateSettings({ watched: settings.watched.filter(value => value !== item) })}>×</button></div>)}</div>
          <button className="wide-button" disabled={watchRefreshing} onClick={() => void refreshWatched()}>{watchRefreshing ? 'Refreshing…' : 'Refresh'}</button>
        </div>}
        {panel === 'downloads' && <div className="panel-body downloads-list">{downloads.length ? downloads.map(job => <div className="download-row" key={job.id}>
          <div><strong>#{job.postId}</strong><span>{job.status === 'running' ? downloadProgress(job) : job.status === 'waiting' ? 'Waiting' : job.result.join(' · ') || job.status}</span></div>
          {job.status === 'running' && job.totalBytes > 0 && <div className="progress"><span style={{ width: `${job.fraction * 100}%` }} /></div>}
          {['running', 'waiting'].includes(job.status) && <button className="icon-button" title="Cancel" onClick={() => void window.e322.cancelDownload(job.id)}><Icon name="close" /></button>}
        </div>) : <div className="muted empty-panel">No downloads yet</div>}</div>}
        {panel === 'shortcuts' && <div className="panel-body shortcut-list">{[
          ['← ↑ → ↓', 'Move through posts'], ['Space', 'Open / close post'], ['Esc', 'Close viewer'], ['⌘ L', 'Search'], ['⌘ B', 'Blacklist'], ['⌘ T', 'Watched Tags'], ['⌘ /', 'Keyboard Shortcuts'], ['⌘ D', 'Download'], ['⌘ U', 'Upvote'], ['⌘ F', 'Favorite'], ['⌘ S', 'Download + upvote + favorite'], ['C', 'Copy link'],
        ].map(([keys, title]) => <div key={keys}><span>{title}</span><kbd>{keys}</kbd></div>)}</div>}
        {panel === 'settings' && <div className="settings-popover-content">
        {storageIssues.map(issue => <p className="settings-issue" role="alert" key={issue}>{issue}</p>)}
        <label className="settings-popover-row"><span>Theme</span><select aria-label="Theme" value={settings.theme} onChange={event => updateSettings({ theme: event.target.value as Settings['theme'] })}><option value="system">System</option><option value="dark">Dark</option><option value="light">Light</option></select></label>
        <div className="settings-popover-row"><span>Folder</span><button title={settings.downloadFolder || 'Choose download folder'} onClick={() => void window.e322.chooseFolder().then(folder => { if (folder) setSettings(previous => ({ ...previous, downloadFolder: folder })); })}>{settings.downloadFolder?.split(/[\\/]/).filter(Boolean).at(-1) || 'Choose'}</button></div>
        </div>}
      </MembranePopover>}
      </AnimatePresence>
    </motion.div>}</AnimatePresence>
  </div>;
}
