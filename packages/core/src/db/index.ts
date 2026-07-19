export { SCHEMA_VERSION, CREATE_TABLES } from './schema';
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
