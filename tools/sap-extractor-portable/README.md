# zsectools Portable SAP Extractor

A portable, zero-install extractor for SAP tables and user statistics that runs on any Windows machine with the **SAP GUI** already installed (tested with SAP GUI 800). It speaks RFC directly through the standard SAP automation DLLs shipped with the SAP GUI, so nothing has to be installed on the machine — no Node.js, no database, no zsectools.

The output `.txt` files are **fully compatible with zsectools**: same field selections, same RFC WHERE filters, same batch size, same value normalization, same file layout. Copy the `TABLES-EXPORT` folder to your workstation and import it with **Import SAP Tables → Import TXT Folder**.

---

## Scenario

You need to extract SAP tables and user statistics from a SAP system by accessing a machine that is **not owned by you** (a customer PC, a jump host, a colleague's workstation), and the owner does **not** want zsectools installed on it.

This script solves the problem: it is a single `.vbs` file plus a small `.bat` launcher. It connects to SAP via RFC using the DLLs that come with the SAP GUI (`wdtlog.ocx` / `wdtfuncs.ocx`), extracts what you need, and writes plain `.txt` files that zsectools can import later, from your own environment.

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Windows with SAP GUI installed | Tested with **SAP GUI 800** (32-bit frontend DLLs) |
| 32-bit Windows Script Host | Already present on every Windows: `C:\Windows\SysWOW64\cscript.exe` (the provided `.bat` uses it) |
| RFC authorizations | The SAP user needs `S_RFC` access to `RFC_READ_TABLE` and to function group `SWNC_COLONNEL` (home of `SWNC_COLLECTOR_GET_AGGREGATES`), plus `S_TABU_DIS` authorization for the tables to be read |
| One-time OCX registration | Run once from an elevated command prompt (see below) |

One-time OCX registration (needed because the SAP GUI installer does not register the automation controls for scripting by default):

```bat
regsvr32 /i /n /s "C:\Program Files (x86)\SAP\FrontEnd\SapGui\wdtlog.ocx"
regsvr32 /i /n /s "C:\Program Files (x86)\SAP\FrontEnd\SapGui\wdtfuncs.ocx"
```

If `regsvr32` reports a missing entry point or load failure, run the 32-bit version explicitly: `C:\Windows\SysWOW64\regsvr32.exe`.

---

## Configuration

All connection settings live in a plain-text file named `connection` (no extension) in the same folder as `sap-extractor.vbs`. The file is not shipped with the extractor: `connection.example` is the template - copy it to `connection` and fill in the values of **your SAP system**. `connection` contains your system data: keep it private (add it to .gitignore); `connection.example` is the only one that may be committed.

| Variable | Meaning |
|---|---|
| `SAP_SYSTEM` | SAP system ID shown in the logon (e.g. `S4S`) |
| `SAP_ASHOST` | Application server host or IP |
| `SAP_SYSNR` | System number (two digits) |
| `SAP_CLIENT` | Client (mandante) |
| `SAP_USER` | RFC user. **Leave empty to be asked at runtime** (recommended on machines you do not own: no password is stored on disk) |
| `SAP_PASSWORD` | Password. Leave empty to be asked at runtime |
| `SAP_LANG` | Logon language |
| `SAP_ROUTER` | SAProuter string, if needed to reach the system |
| `SYSTEM_ID` | Label used only in the statistics file name |

Format: `KEY = VALUE`, one per line; lines starting with ', # or ; are comments (inline comments after a value are allowed too, if preceded by a space); values may be double-quoted; save as ANSI or UTF-8 **without BOM**. If the file is missing or the system coordinates are not filled in, the script stops with a clear message.

`tables.txt` lists the tables to extract, one table name per line (empty lines and `#` comments are skipped). The file shipped with the extractor contains the AGR_* roles/authorizations tables used by zsectools reports; edit it to taste — it does not have to match zsectools' `SAP-TABLE-LIST.txt`, but the tables you want to use in zsectools reports must be present.

---

## Usage

Double-click **`sap-extractor-run.bat`**. The script runs in a console window and asks, in order (**only once per run**: the questions are not repeated when the extractor restarts itself, see *Unattended restarts* below):

```text
Step 0a - SAP user:               <- only if SAP_USER is empty in the config
Step 0b - SAP password:           <- only if SAP_PASSWORD is empty in the config
Step 1 - Do you also want to extract user statistics? (y/n)
Step 2 - Period type (m=month, w=week, d=day)          <- only if step 1 = y
Step 3 - Date in YYYYMMDD format (e.g. 20260528)       <- only if step 1 = y
```

- **Step 4** (automatic): if you answered `y`, the user statistics are downloaded with the same RFC used by zsectools (`SWNC_COLLECTOR_GET_AGGREGATES`, `PERIODTYPE` = M/W/D, `PERIODSTRT` = period start, `COMPONENT` = `TOTAL`) and written to
  `TABLES-EXPORT\sap_statistics_<SYSTEM_ID>_<M|W|D>_<YYYYMMDD>.txt`. SAP keys the aggregates by the **first day of the period** (`M` -> 1st of the month, `W` -> Monday, `D` -> the date itself), so the extractor automatically snaps the date typed in Step 3 to the period start and prints the value it used.
- Then the script loops over `tables.txt` and downloads every table. Tables are read in **batches of 50.000 rows** (`ROWS_PER_BATCH`) (`RFC_READ_TABLE` with `ROWSKIPS`/`ROWCOUNT`, exactly like zsectools), so heavy tables stream to disk progressively instead of loading everything in memory and risking timeouts. The console shows the progress per batch:

```text
Exporting table: AGR_TCODES
  batch 1: 50000 rows (total 50000)
  batch 2: 50000 rows (total 100000)
  batch 3: 14122 rows (total 114122)
  -> Downloaded 114122 lines: .\TABLES-EXPORT\AGR_TCODES.txt
```

### Unattended restarts (v8)

The SAP GUI OCX slowly degrades the memory of the 32-bit `cscript.exe`; on big extractions the process must be restarted from time to time. The extractor now does it **by itself**: `sap-extractor.vbs` is a small *supervisor* that asks user / password / statistics once and then runs the real extraction in a *worker* process (`sap-extractor.vbs /worker`), relaunching it whenever it stops:

| Worker exit code | Meaning | Supervisor action |
|---|---|---|
| 0 | all tables processed | finish, print the summary |
| 2 | planned restart (`PROCESS_ROW_BUDGET` rows reached, between two tables) | relaunch immediately |
| 3 | crash / out of memory / reconnection failed | relaunch after `RETRY_WAIT_SEC`; give up after `MAX_FAILED_RESTARTS` launches in a row that complete no new table |
| 4 | SAP logon failed | **never retried** at the first logon (a wrong password must not lock the SAP user) |
| 5 | configuration problem (OCX not registered, credentials missing) | stop |

Credentials are passed to the worker through its process environment only: they are never written to disk and never appear on a command line. Resume is automatic because a table's `.txt` is created only when the table is complete; a table that fails with an RFC error is remembered for the session (not retried at every relaunch) and listed in the final summary. Every launch, exit code, failed table and skipped record is written to **`sap-extractor.log`** (next to the script; no passwords, no SAP data unless `LOG_RECORD_SAMPLE = True`).

When finished you can close the window (`pause` keeps it open so you can read the summary). Copy the whole `TABLES-EXPORT` folder somewhere you can reach zsectools from.

---

## Output file format

Table files (`TABLES-EXPORT\<TABLE>.txt`) are UTF-8 (without BOM), tab-separated:

```text
# Table: AGR_USERS
# TYPES: text|text|date|text|time without time zone|numeric|...
mandt	agr_name	user_name	from_dat	to_dat	...
100	Z_TEST	SMITH	2024-01-01	2024-12-31	...
```

- Line 1: `# Table: <NAME>` — the table identity (used by the zsectools import).
- Line 2: `# TYPES: <pg types joined by |>` — the PostgreSQL column types, mapped from the SAP DDIC types with the **same** `mapSapTypeToPg` rules used by zsectools.
- Line 3: header (lowercase field names, tab-separated) — taken from the FIELDS metadata returned by RFC, so the header always matches the data.
- Following lines: the data. Dates are normalized to `YYYY-MM-DD`, times to `HH:MM:SS`, empty SAP dates (`00000000`), empty times (`000000`) and **invalid** values (e.g. `04041417` in a DATS column) are written as empty cells — the same validation zsectools applies to its own RFC downloads. Numeric (`P`) values are validated; everything else is kept as text.

Statistics files start with `# PERIOD_TYPE: X` followed by the header and rows:

```text
# PERIOD_TYPE: D
selected_at	account	entry_id	entry_count	...	action	actiontype
2026-05-28T00:00:00.000Z	SMITH	SU01               T	42	...	SU01	T
```

The `action` and `actiontype` columns are derived from `ENTRY_ID` with the same parsing zsectools uses (last character = `actiontype`, the rest trimmed = `action`), so the STAT reports work out of the box.

---

## Compatibility with zsectools (what is intentionally identical)

| Aspect | This extractor | zsectools |
|---|---|---|
| Field selections | `USR02`, `ADRP`, `PA0002`, `TDEVC`, `TBTCO`, `TBTCP`, `USRACL` use the same restricted field lists (`TABLE_FIELD_OVERRIDES`) — required because these tables exceed the `RFC_READ_TABLE` 512-byte row limit | same |
| WHERE filters | `TADIR` (transactions + programs), `AGR_TEXTS` (SPRAS I/E), `AGR_HIERT` (SPRAS I/E/D), `TOBJT` (LANGU E/I) | same |
| Batch size | `RFC_READ_TABLE` with `ROWSKIPS` stepping by `ROWCOUNT` = 50.000 rows (zsectools: 100.000; smaller to keep the OCX buffers small), stop when a batch returns fewer rows | same logic |
| WA delimiter | `\|` (same as `readSapTable`) | same |
| Type mapping | `D→date`, `T→time without time zone`, `I→integer`, `F→double precision`, `P→numeric`, `b→smallint`, everything else → `text` | `mapSapTypeToPg` |
| Value normalization | dates/times validated and normalized, invalid → empty; integer (`I`, `b`) and float (`F`) fields validated (SAP trailing minus `5-` → `-5`), invalid → empty | `convertSapDate` / `convertSapTime` / `convertSapPacked` / `convertSapInteger` / `convertSapFloat` |
| Dirty values | NUL and other control characters removed from every value (tab/CR/LF → space) | `CONTROL_CHARS_RE` in `sapImport.js` |
| Delimiter inside a value | the record is **skipped and logged** (otherwise every following column is shifted: text in a date column…) | `parseReadTableRows` |
| Date format | `DATE_FORMAT = "ISO"` (`YYYY-MM-DD`) by default | dates are strings `YYYY-MM-DD` (no timezone conversion) |
| File layout | `# Table:` + `# TYPES:` + header + tab-separated rows; `# PERIOD_TYPE:` for statistics | `exportTablesToTxt` / `exportStatisticsToTxt` |

One known difference is by design: source columns named `id` (e.g. `AGR_DATEU.id`) are **not renamed** by the extractor — the file keeps the original SAP field name. When importing, zsectools renames them automatically to `id_sap` (the same policy it applies to its own RFC downloads), because `id` collides with the internal primary key of the imported tables. The import also strips a possible UTF-8 BOM, so files edited on Windows stay importable.

---

## Importing into zsectools

1. Start zsectools and select the target realm.
2. Go to **Import SAP Tables**.
3. Click **Import TXT Folder** and pick the `TABLES-EXPORT` folder: every `.txt` file containing a valid `# Table:` header is imported, one file per table, with a progress bar and a final summary (imported tables/rows, skipped rows, failed files).
   - Alternatively, **Import TXT** accepts selecting multiple individual files with Ctrl/Shift.
4. For the statistics file: click **Import Statistics TXT** and select the `sap_statistics_*.txt` file. The realm is taken from the realm selected in the UI; the period type comes from the `# PERIOD_TYPE:` line in the file.
5. After importing the tables (and statistics) remember to run **Build additional infos**, as you would after a direct download, so the reports can use them.

---

## Limitations and troubleshooting

- **512-byte row limit**: `RFC_READ_TABLE` cannot return rows wider than 512 bytes. The field overrides mentioned above exist for this reason; if you add a very wide table to `tables.txt` and get `DATA_BUFFER_EXCEEDED` / a short-dump on the SAP side, add a field override for it in `GetFieldOverride` (both in this script and, if you also download it directly, in zsectools).
- **"The extractor stops / goes in timeout"**: look at the last console lines and at `sap-extractor.log`. `row budget reached … planned restart` is **normal** (the supervisor relaunches by itself). `RFC_READ_TABLE error at batch N … SAP exception: …` is a SAP-side problem: check ST22 (e.g. `TIME_OUT` on very large tables, because every batch re-scans the rows skipped by `ROWSKIPS`) and SM21. A VBScript runtime error / `not enough memory` is a crash of the 32-bit process: the worker is relaunched automatically.
- **`SKIPPED RECORD` / "record(s) SKIPPED" warnings**: the value of some field contains the `|` delimiter, so the record cannot be split reliably; it is left out instead of being written with shifted columns. The log gives table and record number (position in the `RFC_READ_TABLE` result).
- **Old exports**: tables already present in `TABLES-EXPORT` are skipped (resume). Files produced by versions before v8 may contain `DD.MM.YYYY` dates or unfiltered control characters: delete them (or set `SKIP_EXISTING = False`) to extract them again.
- **`RFC_READ_TABLE error for <table>`**: usually a missing `S_TABU_DIS` authorization for the table, or a table that does not exist in the target system. Check with SE11/SE16.
- **No statistics rows**: `SWNC_COLLECTOR_GET_AGGREGATES` only returns data for periods that have been aggregated by the SAP workload collector; very recent dates (today) may not have daily aggregates yet, and monthly aggregates typically appear only after the month has closed.
- **Statistics call failed**: the script prints the real `SAP exception:` line returned by the RFC. The most common causes are a missing `S_RFC` authorization for function group `SWNC_COLONNEL`, or no aggregates collected for the requested period (verify in ST03N which periods are available).
- **Logon errors**: double-check ASHOST/SYSNR/CLIENT and the SAProuter string; the router string must contain the full route including the password part if the router requires one.
- **Nothing happens on double-click of the `.vbs`**: the file association opens it with `wscript.exe` (GUI host). Use `sap-extractor-run.bat`, which forces the 32-bit `cscript.exe`.
- The script never writes to the SAP system: only reads (`RFC_READ_TABLE`, `SWNC_COLLECTOR_GET_AGGREGATES`).
