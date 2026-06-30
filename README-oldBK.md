Per Linux:
```bash
sudo ./setup.sh
sudo ./run.sh
```
Add services (optional):
```bash
sudo ./install-services.sh
```

Per Windows:
```bash
.\setup.bat
.\run.bat
```
Add services (optional), as administrator:
```bash
.\install-services.bat
```

Scaricare nodejs:
https://nodejs.org/en/download

Scaricare postgresql:
https://www.enterprisedb.com/download-postgresql-binaries

Scaricare sap nw rfc sdk:
https://me.sap.com/swdcnav/products/_APP=00200682500000001943&_EVENT=DISPHIER&HEADER=Y&FUNCTIONBAR=N&EVENT=TREE&NE=NAVIGATE&ENR=01200314690100002214&V=MAINT
(nota SAP: https://me.sap.com/notes/2573790)

Come primissima cosa vanno installate:

## le dipendenze locali (backend):

```bash
cd backend
npm install --ignore-scripts
```
Se npm è locale allora dovrà essere qualcosa tipo:
```bash
..\node-v24.16.0-win-x64\npm install --ignore-scripts
```
stessa cosa per il frontend:
```bash
:: 1. Vai nella cartella del frontend
cd frontend
:: 2. imposta temporaneamente la variabile d ambiente che punti al nodejs locale
set PATH=%PATH%;C:\Users\ValerioLocal\OneDrive\Desktop\sapsecmgmt-main\node-v24.16.0-win-x64
:: 3. Installa le dipendenze del frontend usando il Node portable
..\node-v24.16.0-win-x64\npm install
:: 4. Lancia la build (di solito Vite o React genera la cartella dist)
..\node-v24.16.0-win-x64\npm run build
:: 5. creare il file cjs come compilazione in backend
cd backend
..\node-v24.16.0-win-x64\npx esbuild .\src\server.js --bundle --platform=node --target=node20 --format=cjs --outfile=dist/server.cjs --external:node-rfc --minify
```
## Comandi per build eseguibile:
```bash
:: compilare se non fatto precedentemente
npx esbuild .\src\server.js --bundle --platform=node --target=node20 --format=cjs --outfile=dist/server.cjs --external:node-rfc
npx pkg .\dist\server.cjs --targets node18-win-x64 --output opengrc.exe
```

Se usi nodeJS locale allora i comandi saranno ad esempio:

```bash
cd backend
..\node-v24.16.0-win-x64\npx esbuild .\src\server.js --bundle --platform=node --target=node20 --format=cjs --outfile=dist/server.cjs --external:node-rfc --minify
..\node-v24.16.0-win-x64\npx pkg .\dist\server.cjs --targets node18-win-x64 --output opengrc.exe
```

Nel caso per migliorare offuscamento di server.cjs (primo comando box precedente) posso usare:
```bash
cd backend
..\node-v24.16.0-win-x64\npm install -D javascript-obfuscator
..\node-v24.16.0-win-x64\npx javascript-obfuscator .\dist\server.cjs --output .\dist\server.cjs --compact true --self-defending true
```

1. Prepara il file di configurazione
Crea un file chiamato sea-config.json direttamente nella cartella principale del tuo backend (C:\Users\vangeloni\Desktop\testRelease\App\backend) e incolla questo testo:

JSON
{
  "main": "dist/server.cjs",
  "output": "sea-prep.blob",
  "disableSentinel": true
}
2. Genera l'eseguibile nativo (I comandi magici)
Assicurati di aver generato il file aggiornato con esbuild come al solito, poi esegui questi 3 comandi in sequenza nel terminale:

A) Crea il BLOB di preparazione:

PowerShell
node --experimental-sea-config sea-config.json
(Questo genererà un file chiamato sea-prep.blob).

B) Copia l'eseguibile di Node ufficiale del tuo PC nella cartella (usandolo come base di partenza):

PowerShell
copy "$env:ProgramFiles\nodejs\node.exe" cursor-backend.exe
C) Inietta il tuo codice direttamente dentro l'eseguibile ufficiale (usando npx postject):

PowerShell
npx postject cursor-backend.exe NODE_SEA_BLOB sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680d440f2430aab546b323ef089be --macho-segment-name NODE_SEA

La Soluzione Nativa (Senza postject)
Esegui questi due comandi nel tuo terminale di PowerShell:

1. Ripristina l'eseguibile pulito:

PowerShell
copy "$env:ProgramFiles\nodejs\node.exe" cursor-backend.exe
2. Usa lo strumento nativo di Node per iniettare il blob:
Invece di postject, usiamo direttamente la funzione integrata di Node pensata per Windows. Scrivi questo comando (attento a copiare anche l'ultima parte con l'eseguibile):

PowerShell
npx @node/sea --config sea-config.json

Prepara la cartella di Node Portable
Se non ce l'hai già, scarica la versione "Windows Binary (.zip)" di Node 20 (visto che sul tuo PC hai la 20 ed è super stabile) direttamente dal sito ufficiale di Node.js.
Estranne il contenuto e schiaffalo dentro la cartella App\bin\, in modo da avere questo percorso:
C:\Users\vangeloni\Desktop\testRelease\App\bin\node-v20.20.2-win-x64\node.exe

2. Semplifica il backend (Usa il file unico di esbuild)
Non abbiamo più bisogno di pkg o sea. Ci basta il file super-ottimizzato dist/server.cjs che genera esbuild (e che abbiamo già visto funzionare e trovare il frontend!).

Nel terminale del backend lancia solo questo comando per aggiornare il file unico:

Bash
npx esbuild .\src\server.js --bundle --platform=node --target=node20 --format=cjs --outfile=dist/server.cjs --external:node-rfc

# Browser App Starter: PostgreSQL + SAP RFCPING

This starter provides a browser app architecture that runs on Linux and Windows:

- Frontend: React + Vite (browser UI)
- Backend: Node.js + Express (API)
- Database: PostgreSQL
- SAP: RFC call `RFCPING` through `node-rfc`

## Why this design

A browser app should not connect directly to databases or SAP RFC endpoints. The backend API handles:

- DB read/write operations
- SAP credential management
- RFC calls (including `RFCPING`)

## Project structure

- `frontend/`: browser UI
- `backend/`: API and integration logic
- `node-v24.16.0-win-x64/`: Local NodeJS
- `postgres`: Local postgresql
- `nwrfcsdk`: SAP NW RFC SDK downloaded from SAP
- `docker-compose.yml`: local multi-service startup

## Local run (without Docker)

### Prerequisites (Linux/Windows)

- Install **Node.js** (so you have `node` and `npm`)
- Install **PostgreSQL** (or run via Docker)
- For SAP RFC calls: install **SAP NetWeaver RFC SDK** (SAP GUI/Client alone is usually not enough)

### 1) Backend

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

Backend listens on `http://localhost:3000`.

### 2) Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Frontend listens on `http://localhost:5173`.

### 3) Database

Run PostgreSQL locally (native install or container) and update backend `.env` DB settings.

## Docker run

```bash
docker compose up --build
```

Services:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3000`
- PostgreSQL: `localhost:5432`

## SAP RFC setup (Linux + Windows)

`node-rfc` requires SAP NetWeaver RFC SDK native libraries.

### Linux

- Install SAP NW RFC SDK files (e.g. into `/opt/sap/nwrfcsdk`).
- Ensure native libs are discoverable:
  - `export SAPNWRFC_HOME=/opt/sap/nwrfcsdk`
  - `export LD_LIBRARY_PATH=$SAPNWRFC_HOME/lib:$LD_LIBRARY_PATH`

### Windows

- Install SAP NW RFC SDK files.
- Add SDK `bin` directory to `PATH`.

### App setting: SDK path (persisted)

The app has a **Health Checks** panel where you can save the SDK path. It is stored in the database and applied on backend startup:

- Linux example: `/opt/sap/nwrfcsdk`
- Windows example: `C:\\nwrfcsdk`

### SAP connection variables

Set backend SAP environment variables (or save per-system values under **SAP Realms**):

- `SAP_USER`
- `SAP_PASSWORD`
- `SAP_ASHOST`
- `SAP_SYSNR`
- `SAP_CLIENT`
- `SAP_LANG` (optional, default `EN`)

### Docker + SAP SDK

If you want to call SAP RFC from the backend container, you must provide the SDK inside the container.

Example (Linux host):

```bash
docker compose up --build
```

By default, `docker-compose.yml` sets:

- container SDK target: `/opt/sap/nwrfcsdk`
- `SAPNWRFC_HOME=/opt/sap/nwrfcsdk`
- `LD_LIBRARY_PATH=/opt/sap/nwrfcsdk/lib`

The host mount source is optional and defaults to a placeholder path to avoid compose failures on restricted systems.
Set `SAPNWRFC_HOST_PATH` when you want to enable actual SDK mount.

Troubleshooting (`mkdir /opt/sap: read-only file system`):

- Your Docker daemon cannot use `/opt/sap/nwrfcsdk` as host bind source.
- Workaround: copy SDK to a user-writable path and mount from there.

Example:

```bash
mkdir -p "$HOME/sap/nwrfcsdk"
# copy SDK content into $HOME/sap/nwrfcsdk
export SAPNWRFC_HOST_PATH="$HOME/sap/nwrfcsdk"
export SAPNWRFC_CONTAINER_PATH="/opt/sap/nwrfcsdk"
docker compose up --build
```

## API endpoints

- `GET /api/health` -> backend health
- `GET /api/health/db` -> PostgreSQL health (`SELECT 1`)
- `GET /api/health/sap` -> SAP `RFCPING`

## Notes

- `node-rfc` is set as an optional dependency so the app can start even if SAP SDK is not installed yet.
- Once SDK and SAP credentials are configured, `/api/health/sap` will return RFC ping status.

## Next production steps

- Add authentication (OIDC/JWT)
- Add role-based authorization
- Add structured logging and audit trails
- Add retry/timeout/circuit-breaker for SAP calls
- Add integration tests for DB and SAP health paths
