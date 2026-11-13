const SETTINGS_BYTES = 64 * 1024 * 1024;
const MAX_WATCHED = 10000;
const MAX_IDS_PER_TAG = 1000000;
const MAX_TOTAL_IDS = 4000000;
const MAX_RULES = 100000;
const MAX_STRING = 16384;
const defaults = () => ({ columns: 8, gridStyle: 'apple', theme: 'system', rating: 'all',
  history: [], watched: [], disabledBlacklist: [], downloadFolder: null });

function validateSettings(value) {
  const fail = () => { throw new Error('Invalid settings or settings size limit exceeded'); };
  let budget = 1024;
  const string = item => {
    if (typeof item !== 'string' || item.length > MAX_STRING) return false;
    budget += Buffer.byteLength(JSON.stringify(item)) + 1;
    return budget <= SETTINGS_BYTES;
  };
  const postID = id => {
    if (!Number.isSafeInteger(id) || id <= 0) return false;
    budget += String(id).length + 1;
    return budget <= SETTINGS_BYTES;
  };
  const array = (items, limit, valid) => {
    if (!Array.isArray(items) || items.length > limit) return false;
    for (const item of items) if (!valid(item)) return false;
    return true;
  };
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !Object.hasOwn(defaults(), key)) ||
      !Number.isInteger(value.columns) || value.columns < 2 || value.columns > 16 ||
      !['square', 'apple', 'masonry'].includes(value.gridStyle) ||
      !['system', 'dark', 'light'].includes(value.theme) || !['all', 's', 'q', 'e'].includes(value.rating) ||
      !array(value.history, 50, string) || !array(value.disabledBlacklist, MAX_RULES, string) ||
      !(value.downloadFolder === null || string(value.downloadFolder)) ||
      !Array.isArray(value.watched) || value.watched.length > MAX_WATCHED) fail();
  let ids = 0;
  for (const item of value.watched) {
    budget += 128;
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
        Object.keys(item).some(key => !['name', 'seen', 'unseen', 'checkpoint'].includes(key)) ||
        !string(item.name) || !item.name.trim() ||
        !array(item.seen, MAX_IDS_PER_TAG, postID) ||
        !array(item.unseen, MAX_IDS_PER_TAG, postID) ||
        (item.checkpoint !== undefined && (!Number.isSafeInteger(item.checkpoint) || item.checkpoint < 0))) fail();
    ids += item.seen.length + item.unseen.length;
    if (ids > MAX_TOTAL_IDS) fail();
  }
  if (Buffer.byteLength(JSON.stringify(value)) > SETTINGS_BYTES) fail();
  return value;
}

module.exports = { validateSettings, defaults, SETTINGS_BYTES, MAX_WATCHED, MAX_IDS_PER_TAG, MAX_TOTAL_IDS, MAX_RULES, MAX_STRING };
