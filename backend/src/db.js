// Compatibility facade: the old monolithic db.js file (4000+ lines) has been split
// into domain modules in ./db/. server.js and other consumers continue to
// import from './db.js' without changes.
export * from './db/index.js';
