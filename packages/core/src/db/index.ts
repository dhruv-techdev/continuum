export { SCHEMA_VERSION } from './schema';

export { MetadataDB, openDB, closeDB, closeAllDBs, dbPath } from './database';

export {
  syncProject,
  syncProjects,
  syncSession,
  syncSessions,
  syncEvent,
  syncEvents,
  getWatermark,
  setWatermark,
  syncArtifact,
  syncArtifacts,
  countEvents,
  countAllEvents,
  searchEvents,
} from './sync';

export { recoverSession, recoverWorkspace } from './recovery';

export type { RecoveryResult } from './recovery';

export {
  ensureFTS,
  extractContent,
  indexEvent,
  indexEvents,
  search,
  countIndexed,
} from './fts';

export type { SearchResult, SearchOptions } from './fts';
