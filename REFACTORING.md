# Refactoring zsectools 1.2.2 — Splitting the monolithic files

## Objective

Reduce the source files that exceeded 3000 lines into coherent domain modules,
keeping **behavior and public surface identical** (behavior-preserving
refactoring). No changes to REST endpoints, database, or business logic: only
code reorganization.

## Principles applied

1. **Code moved, not rewritten** — function bodies were moved verbatim into the
   new modules; no changes to the logic.
2. **Compatibility facade** — `db.js` still exists and re-exports everything
   from `./db/`; `server.js` was not touched.
3. **Explicit dependencies** — each module declares its own imports; the React
   sections receive through a `ctx` object only the state and handlers they
   actually use.
4. **Automated verification** — every generated file was checked with AST
   parsing, ESLint (`no-undef`), and import/build smoke tests.

## Backend: `db.js` (4,160 lines → 11 modules)

| Module (`backend/src/db/`) | Lines | Responsibility |
|---|---|---|
| `client.js` | 146 | PostgreSQL pool, health check, system tables, app settings |
| `realms.js` | 91 | CRUD for SAP realms (`sap_realms` table) |
| `sapImport.js` | 304 | SAP table import: type conversion (`convertSapDate/Time/Packed`, `mapSapTypeToPg`) and bulk COPY |
| `userStats.js` | 296 | User statistics: save, read, import/export, aggregations |
| `txtTransfer.js` | 171 | Export/import of tables and statistics to/from TXT |
| `sod.js` | 208 | SOD tables: TXT import, ruleset, export, cleanup |
| `utils.js` | 13 | Shared helpers (`tableExists`) |
| `sodAnalysis.js` | 1106 | SOD engine: RA elements, descriptions, `runSodAnalysis`, authorization checks |
| `reports.js` | 1103 | `buildAdditionalInfos`, `executeReport`, `getReportRows` |
| `coverage.js` | 347 | Coverage analysis: users, roles, tcodes, results |
| `mapper.js` | 365 | Mapper analysis: elements, roles, tcodes, results |
| `index.js` | 14 | Barrel: re-export of the public surface |

### Compatibility

- `backend/src/db.js` is now a 4-line **facade**: `export * from './db/index.js'`.
  All existing imports (`server.js`) keep working without any change.
- `server.js` and `sap.js` are **byte-for-byte identical** to the original.
- Only addition to the public surface: `tableExists` (it was private in the
  monolith, now shared by the domain modules). Additive, non-breaking.

### Module dependency graph

```
client.js  ←  all modules (pool)
utils.js   ←  sapImport, sodAnalysis, reports, coverage, mapper (tableExists)
realms.js  ←  sodAnalysis, reports, coverage (getSapRealm)
```

## Frontend: `App.jsx` (3,906 lines → App 2,196 + 12 files)

| New file | Lines | Content |
|---|---|---|
| `src/sections/SettingsSection.jsx` | 283 | Settings + Health / General / About subsections (internal render helpers, as before) |
| `src/sections/RealmSection.jsx` | 95 | SAP realm management |
| `src/sections/ReportsSection.jsx` | 231 | Report execution (+ `availableReports` catalog) |
| `src/sections/ImportSection.jsx` | 217 | Table + statistics import |
| `src/sections/RfcSection.jsx` | 255 | RFC execution |
| `src/sections/SodSection.jsx` | 382 | SOD & Audit |
| `src/sections/CoverageSection.jsx` | 225 | Coverage |
| `src/sections/MapperSection.jsx` | 224 | Mapper |
| `src/components/StatusBlock.jsx` | 11 | Reusable status component |
| `src/constants.js` | 2 | `PAGE_SIZE` |
| `src/styles.js` | 8 | Shared `panelStyle` |

### The `ctx` pattern

Each section is a component that **explicitly** declares its dependencies on
App:

```jsx
export default function SodSection({ ctx }) {
  const { sodRuleset, setSodRuleset, runSodAnalysisAction, ... } = ctx;
  // ... body identical to the previous renderSodSection()
}
```

In `App.jsx` the context objects are built before the main return
(`settingsCtx`, `sodCtx`, …) and passed like this: `<SodSection ctx={sodCtx} />`.
Async handlers and useEffect hooks stay in App (they are the cross-section
"controllers").

### Included cleanups (behavior-neutral)

- **`renderRealmSelector` removed**: it was a stub returning `null`
  ("Realm selector removed from individual sections"); the 4 call sites
  `{renderRealmSelector()}` were removed as well — they rendered `null`.
- **`API_BASE` deduplicated**: it was defined identically in both `api.js` and
  `App.jsx`; it now lives only in `api.js` and is exported.
- `PAGE_SIZE` and `availableReports` moved to their natural homes
  (`constants.js` and `ReportsSection.jsx`).

## Checks performed

| Check | Result |
|---|---|
| `node --check` on all backend files | ✅ |
| ESLint `no-undef` on all backend files | ✅ 0 errors |
| Real ESM import of the `db.js` facade (smoke test) | ✅ |
| Comparison of exported surface: original vs new `db.js` | ✅ identical (except `tableExists`, additive) |
| AST parsing (babel) of all generated frontend files | ✅ |
| ESLint `no-undef` on all frontend files | ✅ 0 errors |
| Production `vite build` | ✅ 28 modules, bundle ok |
| `package.json` / `package-lock.json` unchanged | ✅ |

## Recommended next steps (not included in this pass)

1. **Decompose the two remaining "monolith" functions**: `runSodAnalysis`
   (~750 lines in `sodAnalysis.js`) and `executeReport` (~680 in `reports.js`)
   into sub-steps with meaningful names.
2. **Domain custom hooks** (`useSod`, `useCoverage`, `useMapper`, …): move
   state + handlers from the sections into testable hooks; App would shrink to
   ~300 lines.
3. **`server.js` (1,718 lines)**: split it into per-domain Express routers
   (`routes/realms.js`, `routes/sod.js`, …) using the same facade approach.
4. **Regression tests**: before touching the functions in point 1, add
   characterization tests (Vitest + SAP row fixtures).
