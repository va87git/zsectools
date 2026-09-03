# Refactoring zsectools 1.2.2 — Split dei file monolitici

## Obiettivo

Ridurre i file sorgente che superavano le 3000 righe in moduli di dominio coerenti,
mantenendo **comportamento e superficie pubblica identici** (refactoring
behavior-preserving). Nessuna modifica agli endpoint REST, al database o alla logica
di business: solo riorganizzazione del codice.

## Principi applicati

1. **Codice spostato, non riscritto** — i corpi delle funzioni sono stati spostati
   verbatim nei nuovi moduli; nessuna modifica alla logica.
2. **Facade di compatibilità** — `db.js` esiste ancora e re-esporta tutto da `./db/`;
   `server.js` non è stato toccato.
3. **Dipendenze esplicite** — ogni modulo dichiara i propri import; le sezioni React
   ricevono tramite un oggetto `ctx` solo lo stato e i handler che effettivamente usano.
4. **Verifica automatica** — ogni file generato è stato controllato con parse AST,
   ESLint (`no-undef`) e smoke test di import/build.

## Backend: `db.js` (4160 righe → 11 moduli)

| Modulo (`backend/src/db/`) | Righe | Responsabilità |
|---|---|---|
| `client.js` | 146 | Pool PostgreSQL, health check, tabelle di sistema, app settings |
| `realms.js` | 91 | CRUD dei realm SAP (tabella `sap_realms`) |
| `sapImport.js` | 304 | Import tabelle SAP: conversione tipi (`convertSapDate/Time/Packed`, `mapSapTypeToPg`) e COPY bulk |
| `userStats.js` | 296 | Statistiche utente: salvataggio, lettura, import/export, aggregazioni |
| `txtTransfer.js` | 171 | Export/import tabelle e statistiche verso/da TXT |
| `sod.js` | 208 | Tabelle SOD: import da TXT, ruleset, export, pulizia |
| `utils.js` | 13 | Helper condivisi (`tableExists`) |
| `sodAnalysis.js` | 1106 | Motore SOD: RA elements, descrizioni, `runSodAnalysis`, authorization checks |
| `reports.js` | 1103 | `buildAdditionalInfos`, `executeReport`, `getReportRows` |
| `coverage.js` | 347 | Analisi Coverage: utenti, ruoli, tcodes, risultati |
| `mapper.js` | 365 | Analisi Mapper: elementi, ruoli, tcodes, risultati |
| `index.js` | 14 | Barrel: re-export della superficie pubblica |

### Compatibilità

- `backend/src/db.js` è ora una **facade** da 4 righe: `export * from './db/index.js'`.
  Tutti gli import esistenti (`server.js`) continuano a funzionare senza modifiche.
- `server.js` e `sap.js` sono **byte-per-byte identici** all'originale.
- Unica aggiunta alla superficie pubblica: `tableExists` (era privato nel monolite,
  ora condiviso dai moduli di dominio). Additiva, non breaking.

### Grafò delle dipendenze tra moduli

```
client.js  ←  tutti (pool)
utils.js   ←  sapImport, sodAnalysis, reports, coverage, mapper (tableExists)
realms.js  ←  sodAnalysis, reports, coverage (getSapRealm)
```

## Frontend: `App.jsx` (3906 righe → App 2196 + 12 file)

| File nuovo | Righe | Contenuto |
|---|---|---|
| `src/sections/SettingsSection.jsx` | 283 | Settings + sottosezioni Health / General / About (render helper interni, come prima) |
| `src/sections/RealmSection.jsx` | 95 | Gestione realm SAP |
| `src/sections/ReportsSection.jsx` | 231 | Esecuzione report (+ catalogo `availableReports`) |
| `src/sections/ImportSection.jsx` | 217 | Import tabelle + statistiche |
| `src/sections/RfcSection.jsx` | 255 | Esecuzione RFC |
| `src/sections/SodSection.jsx` | 382 | SOD & Audit |
| `src/sections/CoverageSection.jsx` | 225 | Coverage |
| `src/sections/MapperSection.jsx` | 224 | Mapper |
| `src/components/StatusBlock.jsx` | 11 | Componente riutilizzabile di stato |
| `src/constants.js` | 2 | `PAGE_SIZE` |
| `src/styles.js` | 8 | `panelStyle` condiviso |

### Pattern `ctx`

Ogni sezione è un componente che dichiara **esplicitamente** le dipendenze da App:

```jsx
export default function SodSection({ ctx }) {
  const { sodRuleset, setSodRuleset, runSodAnalysisAction, ... } = ctx;
  // ... corpo identico al precedente renderSodSection()
}
```

In `App.jsx` i contesti sono costruiti prima del main return (`settingsCtx`,
`sodCtx`, …) e passati così: `<SodSection ctx={sodCtx} />`. Gli handler async e gli
useEffect restano in App (sono gli "controller" cross-sezione).

### Pulizie incluse (comportamento neutro)

- **`renderRealmSelector` rimosso**: era uno stub che restituiva `null`
  ("Realm selector removed from individual sections"); anche i 4 punti di chiamata
  `{renderRealmSelector()}` sono stati eliminati — renderizzavano `null`.
- **`API_BASE` deduplicato**: era definito identico in `api.js` e `App.jsx`;
  ora vive solo in `api.js` ed è esportato.
- `PAGE_SIZE` e `availableReports` spostati nelle loro sedi naturali
  (`constants.js` e `ReportsSection.jsx`).

## Verifiche eseguite

| Check | Esito |
|---|---|
| `node --check` su tutti i file backend | ✅ |
| ESLint `no-undef` su tutti i file backend | ✅ 0 errori |
| Import ESM reale della facade `db.js` (smoke test) | ✅ |
| Confronto superficie esportata db.js originale vs nuova | ✅ identica (salvo `tableExists`, additivo) |
| Parse AST (babel) di tutti i file frontend generati | ✅ |
| ESLint `no-undef` su tutti i file frontend | ✅ 0 errori |
| `vite build` di produzione | ✅ 28 moduli, bundle ok |
| `package.json` / `package-lock.json` invariati | ✅ |

## Prossimi passi consigliati (non inclusi in questa passata)

1. **Decomporre le due funzioni "monolite" residue**: `runSodAnalysis` (~750 righe in
   `sodAnalysis.js`) ed `executeReport` (~680 in `reports.js`) in sotto-step
   con nomi significativi.
2. **Custom hooks per dominio** (`useSod`, `useCoverage`, `useMapper`, …): spostare
   stato + handler dalle sezioni in hook testabili; App diventerebbe ~300 righe.
3. **`server.js` (1718 righe)**: suddividere in router Express per dominio
   (`routes/realms.js`, `routes/sod.js`, …) con lo stesso approccio facade.
4. **Test di regressione**: prima di intervenire sulle funzioni del punto 1,
   aggiungere test di caratterizzazione (Vitest + fixture di righe SAP).
