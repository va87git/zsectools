' =============================================================================
'  zsectools portable SAP extractor (VBScript + SAP GUI RFC OCX)
' -----------------------------------------------------------------------------
'  Extracts SAP tables (and user statistics) via RFC using the standard SAP DLL
'  shipped with the SAP GUI (wdtlog.ocx / wdtfuncs.ocx). Designed for the
'  scenario where tables must be extracted from a machine that is NOT owned by
'  the operator and where zsectools cannot be installed. The output .txt files
'  are compatible with the "Import TXT / Import TXT Folder" functions of
'  zsectools (same field selections, same RFC filters, same file format).
'
'  HOW TO RUN (see README.md for details):
'    1. one time only, register the SAP GUI OCX controls (as admin):
'         regsvr32 /i /n /s "C:\Program Files (x86)\SAP\FrontEnd\SapGui\wdtlog.ocx"
'         regsvr32 /i /n /s "C:\Program Files (x86)\SAP\FrontEnd\SapGui\wdtfuncs.ocx"
'    2. double-click sap-extractor-run.bat (it uses the 32-bit cscript.exe
'       required by the SAP GUI OCX controls)
'
'  Tested with SAP GUI 800.
'
'  v8 - unattended run: the script now has TWO roles inside the same file.
'    - SUPERVISOR (default): asks user / password / statistics ONCE, then
'      starts the WORKER process and relaunches it by itself whenever it
'      stops. Credentials travel to the worker through the process
'      environment only (never written to disk, never on the command line).
'    - WORKER (/worker): the SAP part. It logs on, extracts the statistics
'      (first launch only) and the tables of tables.txt.
'  Why a worker/relaunch design: the SAP GUI OCX (wdtaocx) slowly degrades
'  the 32-bit heap of cscript.exe; after ~1.5M extracted rows any allocation
'  can fail ("Memoria insufficiente"). A fresh process is the only thing that
'  provably resets the heap. Countermeasures (unchanged from v7):
'    - the RFC connection is recycled every RECYCLE_ROWS rows /
'      RECYCLE_BATCHES batches (fresh SAP.LogonControl + connection);
'    - a COM error on the RFC call recycles the connection and retries the
'      same batch once;
'    - if the OCX dies while reading rows, the partial output is thrown away
'      and the table is restarted on a fresh connection;
'    - after PROCESS_ROW_BUDGET rows the worker stops itself BEFORE starting
'      another table; the supervisor relaunches it (resume is automatic
'      because a table's .txt appears only when the table is complete).
'  Worker exit codes: 0 = finished, 2 = planned restart (row budget reached),
'  3 = crash / memory error (relaunched, gives up after MAX_FAILED_RESTARTS
'  launches in a row without any new table completed), 4 = SAP logon failed
'  (NEVER retried automatically at the first logon: a wrong password must
'  not lock the SAP user), 5 = configuration problem (OCX not registered...).
'
'  v8 - data hygiene, same fixes as the zsectools "SAP table import" bugs:
'    - NUL / control characters (e.g. USR01-MENUE of DDIC) are removed from
'      every value: they made the PostgreSQL import fail ("0x00");
'    - a record whose values contain the delimiter "|" would shift every
'      following column (e.g. text landing in a DATE column): such records
'      are SKIPPED and logged in sap-extractor.log, never written shifted;
'    - integer (I, b) and float (F) fields are validated like date/time/
'      packed ones: invalid content becomes an empty cell;
'    - INT1 fields (type "b") are mapped to SMALLINT like zsectools does;
'    - DATE_FORMAT defaults to ISO (YYYY-MM-DD): DD.MM.YYYY is read by
'      PostgreSQL according to the server DateStyle (day/month can swap).
' =============================================================================

Option Explicit

' ── CONFIGURATION ────────────────────────────────────────────────────────────
' Connection parameters. Leave SAP_USER / SAP_PASSWORD empty to be asked at
' runtime (recommended when running on machines you do not own: no password
' is stored on disk).
Dim SAP_SYSTEM, SAP_ASHOST, SAP_SYSNR, SAP_CLIENT, SAP_USER, SAP_PASSWORD, SAP_LANG, SAP_ROUTER, SYSTEM_ID
SAP_SYSTEM     = ""
SAP_ASHOST     = ""
SAP_SYSNR      = ""
SAP_CLIENT     = ""
SAP_USER       = ""                 ' empty = asked at runtime
SAP_PASSWORD   = ""                 ' empty = asked at runtime
SAP_LANG       = ""
SAP_ROUTER     = ""
SYSTEM_ID      = ""              ' used only in the statistics file name

LoadConnectionConfig

' Extraction behaviour (kept identical to zsectools):
Const ROWS_PER_BATCH = 50000          ' zsectools uses 100000; 50000 keeps every SAP GUI OCX (wdtaocx) buffer small
Const DELIMITER_CHAR = "|"             ' same WA delimiter as zsectools readSapTable

' Resume support: tables whose .txt already exists in the output folder
' are skipped. After a crash just re-run the script: it continues where
' it stopped, and the fresh process starts with a CLEAN 32-bit heap (the
' restart is what resets the memory degradation that killed the previous
' run). Set it to False to re-download everything.
Const SKIP_EXISTING = True

' Memory hygiene (the 32-bit heap of cscript.exe degrades after ~1.5M
' extracted rows - see v7 notes in the header):
'  - RECYCLE_BATCHES / RECYCLE_ROWS: tear the RFC connection down and
'    rebuild it (silent re-logon) every N batches or N rows, whichever
'    comes first - this resets the internal state of the SAP GUI OCX;
'  - PROCESS_ROW_BUDGET: planned process restart. When the rows extracted
'    in THIS process reach the budget, the script exits with code 2 before
'    starting another table and the .bat relaunches it (fresh heap, resume
'    automatic). Budget + largest table stays far below the ~1.5M-row
'    exhaustion point observed on this system.
Const RECYCLE_BATCHES    = 5
Const RECYCLE_ROWS       = 250000
Const PROCESS_ROW_BUDGET = 400000

' Unattended restarts (supervisor):
'  - MAX_FAILED_RESTARTS: give up after this many consecutive launches that
'    ended abnormally WITHOUT completing any new table;
'  - RETRY_WAIT_SEC: pause before relaunching after an abnormal end;
'  - MAX_LAUNCHES: absolute safety cap on the number of worker launches.
Const MAX_FAILED_RESTARTS = 3
Const RETRY_WAIT_SEC      = 20
Const MAX_LAUNCHES        = 200

' Event log (restarts, failed tables, skipped records). It lives next to the
' script, NOT in TABLES-EXPORT. It never contains passwords; it contains no
' SAP data either unless LOG_RECORD_SAMPLE = True (first 80 chars of a skipped
' record, useful to debug).
Const LOG_FILE          = ".\sap-extractor.log"
Const LOG_RECORD_SAMPLE = False
Const MAX_LOGGED_SKIPS  = 20          ' skipped records logged in detail per table

' Worker exit codes (see header)
Const EXIT_DONE   = 0
Const EXIT_BUDGET = 2
Const EXIT_CRASH  = 3
Const EXIT_LOGON  = 4
Const EXIT_CONFIG = 5

' Date format written for table DATE fields:
'   "ISO" -> YYYY-MM-DD (e.g. 2026-09-01; PostgreSQL-native, unambiguous: DEFAULT)
'   "SAP" -> DD.MM.YYYY (SAP GUI display format, e.g. 01.09.2026)
' WARNING: PostgreSQL reads DD.MM.YYYY according to the server DateStyle
' (initdb sets it from the OS locale): on an MDY server 01.09.2026 becomes
' January 9th and 16.02.2007 is rejected. Use "SAP" only if you know the
' target PostgreSQL uses DMY.
' NOTE: the selected_at column of the statistics file is ALWAYS ISO whatever
' this setting is (zsectools casts it to PostgreSQL timestamptz).
Const DATE_FORMAT = "ISO"
Dim OUTPUT_FOLDER, TABLES_FILE
OUTPUT_FOLDER = ".\TABLES-EXPORT\"
TABLES_FILE   = ".\tables.txt"

Dim fso, shell, gRole
Dim gTotalRows, gConnRows, gConnBatches   ' memory-hygiene counters
Dim LogonControl, SapConn, SapFunc
Dim reCtrlTest, reCtrlWs, reCtrlStrip, reFloat
gTotalRows = 0
gConnRows = 0
gConnBatches = 0
gRole = "supervisor"

' Reads the "connection" file (same folder as this script, no extension) and
' overrides the defaults above. A missing file is not an error here: the
' validation in MAIN stops the script with clear instructions instead.
' Unknown keys (typos) produce a warning, missing keys keep their defaults.
Sub LoadConnectionConfig
    Dim cfgFso, cfgPath, cfgFile, line, eqPos, key, val
    Dim i, c, inQ
    Set cfgFso = CreateObject("Scripting.FileSystemObject")
    cfgPath = cfgFso.GetParentFolderName(WScript.ScriptFullName) & "\connection"
    If Not cfgFso.FileExists(cfgPath) Then Exit Sub
    On Error Resume Next
    Set cfgFile = cfgFso.OpenTextFile(cfgPath, 1)
    If Err.Number <> 0 Then
        WScript.Echo "Warning: cannot open " & cfgPath & " (" & Err.Description & ")"
        Err.Clear
        On Error GoTo 0
        Exit Sub
    End If
    On Error GoTo 0
    Do Until cfgFile.AtEndOfStream
        line = Trim(cfgFile.ReadLine)
        ' a UTF-8 BOM read as ANSI shows up as three extra leading characters
        If Left(line, 3) = Chr(239) & Chr(187) & Chr(191) Then line = Mid(line, 4)
        If line <> "" And Left(line, 1) <> "'" And Left(line, 1) <> "#" And Left(line, 1) <> ";" Then
            eqPos = InStr(line, "=")
            If eqPos > 1 Then
                key = UCase(Trim(Left(line, eqPos - 1)))
                val = Trim(Mid(line, eqPos + 1))
                ' strip inline comments (a ', # or ; preceded by a space and not
                ' inside double quotes), then one pair of surrounding quotes
                ' NOTE: VBScript does NOT short-circuit And/Or: EVERY operand is
                ' evaluated even when the previous one is already False. A call
                ' like Mid(val, i - 1, ...) must therefore stay INSIDE a guarded
                ' branch, never in the condition itself: with i = 1 it becomes
                ' Mid(val, 0, ...) -> "Invalid procedure call or argument: 'Mid'".
                inQ = False
                For i = 1 To Len(val)
                    c = Mid(val, i, 1)
                    If c = """" Then
                        inQ = Not inQ
                    ElseIf Not inQ And i > 1 And (c = "'" Or c = "#" Or c = ";") Then
                        If Mid(val, i - 1, 1) = " " Or Mid(val, i - 1, 1) = vbTab Then
                            val = Trim(Left(val, i - 1))
                            Exit For
                        End If
                    End If
                Next
                If Len(val) >= 2 And Left(val, 1) = """" And Right(val, 1) = """" Then
                    val = Mid(val, 2, Len(val) - 2)
                End If
                Select Case key
                    Case "SAP_SYSTEM"   : SAP_SYSTEM = val
                    Case "SAP_ASHOST"   : SAP_ASHOST = val
                    Case "SAP_SYSNR"    : SAP_SYSNR = val
                    Case "SAP_CLIENT"   : SAP_CLIENT = val
                    Case "SAP_USER"     : SAP_USER = val
                    Case "SAP_PASSWORD" : SAP_PASSWORD = val
                    Case "SAP_LANG"     : SAP_LANG = val
                    Case "SAP_ROUTER"   : SAP_ROUTER = val
                    Case "SYSTEM_ID"    : SYSTEM_ID = val
                    Case Else           : WScript.Echo "Warning: unknown key in connection file: " & key
                End Select
            End If
        End If
    Loop
    cfgFile.Close
    If Trim(SAP_LANG) = "" Then SAP_LANG = "EN"
    If Trim(SYSTEM_ID) = "" Then SYSTEM_ID = SAP_SYSTEM
End Sub

' ── MAIN ─────────────────────────────────────────────────────────────────────
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

' The interactive prompts require cscript.exe (sap-extractor-run.bat does it)
If InStr(1, LCase(WScript.FullName), "wscript.exe") > 0 Then
    MsgBox "Please run this script with cscript.exe:" & vbCrLf & _
           "double-click sap-extractor-run.bat", vbExclamation, "sap-extractor"
    WScript.Quit EXIT_CONFIG
End If

InitRegex

If WScript.Arguments.Count > 0 Then
    If LCase(WScript.Arguments(0)) = "/worker" Then
        gRole = "worker"
        RunWorker
        WScript.Quit EXIT_DONE
    End If
End If

WScript.Quit RunSupervisor()

' =============================================================================
'  SUPERVISOR: prompts once, then launches/relaunches the worker process
' =============================================================================
Function RunSupervisor()
    Dim envP, answer, statsPeriod, statsDate, statDateYmd, statsFile
    Dim runNo, failedRuns, everConnected, pendingBefore, pendingAfter, code, missing, res

    res = EXIT_DONE
    RunSupervisor = EXIT_DONE
    Set envP = shell.Environment("PROCESS")

    If Not fso.FileExists(TABLES_FILE) Then
        WScript.Echo "Error: file tables.txt not found!"
        RunSupervisor = EXIT_CONFIG
        Exit Function
    End If
    If Not fso.FolderExists(OUTPUT_FOLDER) Then
        fso.CreateFolder(OUTPUT_FOLDER)
    End If

    ' Remove leftovers of interrupted runs (old per-batch temp files, stats
    ' temp file of a crashed statistics download, failed-tables memory)
    On Error Resume Next
    fso.DeleteFile OUTPUT_FOLDER & "~batch_*.tmp", True
    fso.DeleteFile OUTPUT_FOLDER & "~stats_*.tmp", True
    fso.DeleteFile OUTPUT_FOLDER & "~failed.lst", True
    On Error GoTo 0

    WScript.Echo "=== zsectools portable SAP extractor ==="
    WScript.Echo "Target: " & SAP_SYSTEM & " (" & SAP_ASHOST & ":" & SAP_SYSNR & ", client " & SAP_CLIENT & ")"
    WScript.Echo ""

    ' Credentials: asked ONCE here, handed to the worker processes through
    ' their environment (not on the command line, never written to disk)
    If Trim(SAP_USER) = "" Then
        WScript.StdOut.Write "Step 0a - SAP user: "
        SAP_USER = Trim(WScript.StdIn.ReadLine)
    End If
    If Trim(SAP_PASSWORD) = "" Then
        WScript.StdOut.Write "Step 0b - SAP password: "
        SAP_PASSWORD = WScript.StdIn.ReadLine
    End If
    envP("ZSEC_SAP_USER") = SAP_USER
    envP("ZSEC_SAP_PASSWORD") = SAP_PASSWORD

    ' Optional user statistics (prompted once, executed by the first worker)
    envP("ZSEC_STATS") = ""
    statsFile = ""
    WScript.StdOut.Write "Step 1 - Do you also want to extract user statistics? (y/n): "
    answer = LCase(Trim(WScript.StdIn.ReadLine))
    If answer = "y" Or answer = "yes" Then
        Do
            WScript.StdOut.Write "Step 2 - Period type (m=month, w=week, d=day): "
            statsPeriod = UCase(Trim(WScript.StdIn.ReadLine))
        Loop While statsPeriod <> "M" And statsPeriod <> "W" And statsPeriod <> "D"
        Do
            WScript.StdOut.Write "Step 3 - Date in YYYYMMDD format (e.g. 20260528): "
            statsDate = Trim(WScript.StdIn.ReadLine)
        Loop While ConvertSapDate(statsDate) = ""
        ' The SWNC collector stores the aggregates keyed by the FIRST day of the
        ' period: M -> 1st day of the month, W -> Monday of that week, D -> the
        ' date itself. Snap the typed date to that key so the RFC finds the record.
        statDateYmd = GetPeriodStart(statsPeriod, statsDate)
        If statDateYmd <> statsDate Then
            WScript.Echo "  -> " & statsPeriod & " aggregates are keyed by period start: using " & statDateYmd
        End If
        envP("ZSEC_STATS") = statsPeriod & "|" & statDateYmd
        statsFile = StatsFileName(statsPeriod, statDateYmd)
    End If
    WScript.Echo ""

    ' SKIP_EXISTING = False means "redo everything": delete the old exports
    ' ONCE, here. The workers always resume (skip existing files), otherwise
    ' every relaunch would restart from the first table.
    If Not SKIP_EXISTING Then DeleteExistingExports statsFile

    LogEvent "session start: " & SAP_SYSTEM & " client " & SAP_CLIENT & ", tables to export: " & CountPending()

    runNo = 0
    failedRuns = 0
    everConnected = False
    Do
        runNo = runNo + 1
        If runNo > MAX_LAUNCHES Then
            WScript.Echo "Too many restarts (" & MAX_LAUNCHES & "): stopping."
            res = EXIT_CRASH
            Exit Do
        End If
        pendingBefore = CountPending()
        LogEvent "launch " & runNo & " (tables still to export: " & pendingBefore & ")"
        code = RunWorkerProcess()
        pendingAfter = CountPending()
        LogEvent "worker " & runNo & " ended with exit code " & code & " (tables still to export: " & pendingAfter & ")"

        If code = EXIT_DONE Then Exit Do

        If code <> EXIT_LOGON And code <> EXIT_CONFIG Then
            everConnected = True
            envP("ZSEC_STATS") = ""     ' the statistics step has been attempted: never again
        End If

        If code = EXIT_CONFIG Then
            WScript.Echo ""
            WScript.Echo "Configuration problem: not retrying (see the message above and README.md)."
            res = EXIT_CONFIG
            Exit Do
        End If
        If code = EXIT_LOGON And Not everConnected Then
            WScript.Echo ""
            WScript.Echo "SAP logon failed: NOT retrying automatically (a wrong password could lock the SAP user)."
            WScript.Echo "Check user / password / host / client / SAProuter and start again."
            res = EXIT_LOGON
            Exit Do
        End If

        If code = EXIT_BUDGET Then
            failedRuns = 0
            WScript.Echo ""
            WScript.Echo "--- planned restart (fresh process = fresh memory), " & pendingAfter & " table(s) to go ---"
            WScript.Echo ""
        Else
            If pendingAfter < pendingBefore Then
                failedRuns = 0
            Else
                failedRuns = failedRuns + 1
            End If
            If failedRuns >= MAX_FAILED_RESTARTS Then
                WScript.Echo ""
                WScript.Echo "The extractor stopped abnormally " & failedRuns & " times in a row without completing any new table:"
                WScript.Echo "giving up. Details in sap-extractor.log. Run the .bat again to resume."
                res = EXIT_CRASH
                Exit Do
            End If
            WScript.Echo ""
            If failedRuns = 0 Then
                WScript.Echo "--- worker stopped (exit code " & code & ") after completing tables: relaunching in " & RETRY_WAIT_SEC & " s ---"
            Else
                WScript.Echo "--- worker stopped abnormally (exit code " & code & "): relaunching in " & RETRY_WAIT_SEC & _
                             " s (failure " & failedRuns & " of " & MAX_FAILED_RESTARTS & " in a row) ---"
            End If
            WScript.Echo ""
            WScript.Sleep RETRY_WAIT_SEC * 1000
        End If
    Loop

    ' Final summary: a table with no .txt was not exported
    WScript.Echo ""
    PendingTables missing
    If res = EXIT_DONE Then
        WScript.Echo "Exporting process finished."
    Else
        WScript.Echo "Exporting process INTERRUPTED."
    End If
    If Len(missing) > 0 Then
        WScript.Echo "Tables NOT exported: " & missing
        WScript.Echo "(RFC error / missing authorization / table not found: see the messages above and sap-extractor.log)"
    Else
        WScript.Echo "All tables of tables.txt are exported."
    End If
    WScript.Echo "Files are in " & fso.GetAbsolutePathName(OUTPUT_FOLDER)
    WScript.Echo "Import them into zsectools with: Import SAP Tables -> Import TXT Folder"
    LogEvent "session end (exit " & res & ")"
    RunSupervisor = res
End Function

' Starts one worker process, relays its output live and returns its exit code
Function RunWorkerProcess()
    Dim oExec, errText
    Set oExec = shell.Exec(Q(WScript.FullName) & " //nologo " & Q(WScript.ScriptFullName) & " /worker")
    Do While Not oExec.StdOut.AtEndOfStream
        WScript.Echo oExec.StdOut.ReadLine
    Loop
    Do While oExec.Status = 0
        WScript.Sleep 100
    Loop
    ' stderr carries the VBScript runtime errors of a crashed worker
    errText = oExec.StdErr.ReadAll
    If Len(Trim(errText)) > 0 Then
        WScript.Echo errText
        LogEvent "worker stderr: " & Replace(Replace(Trim(errText), vbCr, " "), vbLf, " ")
    End If
    RunWorkerProcess = oExec.ExitCode
End Function

' Number of tables of tables.txt without a .txt in the output folder; their
' names (comma separated) come back in the ByRef parameter
Function PendingTables(ByRef names)
    Dim ts, nm, n
    n = 0
    names = ""
    Set ts = fso.OpenTextFile(TABLES_FILE, 1)
    Do Until ts.AtEndOfStream
        nm = Trim(ts.ReadLine)
        If nm <> "" And Left(nm, 1) <> "#" Then
            If Not fso.FileExists(OUTPUT_FOLDER & nm & ".txt") Then
                n = n + 1
                If names <> "" Then names = names & ", "
                names = names & nm
            End If
        End If
    Loop
    ts.Close
    PendingTables = n
End Function

Function CountPending()
    Dim dummy
    CountPending = PendingTables(dummy)
End Function

' "Redo everything" (SKIP_EXISTING = False): delete previous exports once
Sub DeleteExistingExports(ByVal statsFile)
    Dim ts, nm
    On Error Resume Next
    Set ts = fso.OpenTextFile(TABLES_FILE, 1)
    Do Until ts.AtEndOfStream
        nm = Trim(ts.ReadLine)
        If nm <> "" And Left(nm, 1) <> "#" Then
            If fso.FileExists(OUTPUT_FOLDER & nm & ".txt") Then fso.DeleteFile OUTPUT_FOLDER & nm & ".txt", True
        End If
    Loop
    ts.Close
    If statsFile <> "" Then
        If fso.FileExists(statsFile) Then fso.DeleteFile statsFile, True
    End If
    On Error GoTo 0
End Sub

Function StatsFileName(ByVal periodType, ByVal dateYmd)
    StatsFileName = OUTPUT_FOLDER & "sap_statistics_" & SYSTEM_ID & "_" & periodType & "_" & dateYmd & ".txt"
End Function

' =============================================================================
'  WORKER: SAP logon, statistics (first launch only), tables
' =============================================================================
Sub RunWorker()
    Dim envP, stats, parts, tableName, txtTables, rc, ok, failedDict

    Set envP = shell.Environment("PROCESS")
    If Len(envP("ZSEC_SAP_USER")) > 0 Then SAP_USER = envP("ZSEC_SAP_USER")
    If Len(envP("ZSEC_SAP_PASSWORD")) > 0 Then SAP_PASSWORD = envP("ZSEC_SAP_PASSWORD")
    If Trim(SAP_USER) = "" Or Len(SAP_PASSWORD) = 0 Then
        WScript.Echo "SAP credentials not available: start the extractor with sap-extractor-run.bat"
        WScript.Quit EXIT_CONFIG
    End If

    WScript.Echo "Connecting to SAP..."
    rc = ConnectSap()
    If rc <> EXIT_DONE Then
        LogEvent "logon failed (code " & rc & ")"
        WScript.Quit rc
    End If
    WScript.Echo "Connected."
    WScript.Echo ""
    LogEvent "connected"

    ' optional user statistics: asked once by the supervisor; non-fatal here
    stats = envP("ZSEC_STATS")
    If Len(stats) > 0 Then
        parts = Split(stats, "|")
        If fso.FileExists(StatsFileName(parts(0), parts(1))) Then
            WScript.Echo "Statistics already downloaded, skipped: " & StatsFileName(parts(0), parts(1))
        Else
            On Error Resume Next
            ExtractStatistics parts(0), parts(1), YmdToIsoDate(parts(1))
            If Err.Number <> 0 Then
                WScript.Echo "  Statistics download failed: " & Err.Description
                LogEvent "statistics failed: " & Err.Description
                Err.Clear
            End If
            On Error GoTo 0
        End If
        WScript.Echo ""
    End If

    ' tables download as per tables.txt
    Set failedDict = LoadFailedTables()
    Set txtTables = fso.OpenTextFile(TABLES_FILE, 1)
    Do Until txtTables.AtEndOfStream
        tableName = Trim(txtTables.ReadLine)
        If tableName <> "" And Left(tableName, 1) <> "#" Then
            If fso.FileExists(OUTPUT_FOLDER & tableName & ".txt") Then
                WScript.Echo "Skipping " & tableName & " (already downloaded)"
            ElseIf failedDict.Exists(UCase(tableName)) Then
                WScript.Echo "Skipping " & tableName & " (failed earlier in this session, see sap-extractor.log)"
            Else
                ' planned process restart BEFORE starting another table:
                ' budget + largest single table stays far below the heap
                ' exhaustion point observed on this system (~1.5M rows)
                If gTotalRows >= PROCESS_ROW_BUDGET Then
                    WScript.Echo "Row budget reached (" & gTotalRows & " rows extracted in this process):"
                    WScript.Echo "restarting with a fresh process (automatic, completed tables are skipped)."
                    LogEvent "row budget reached (" & gTotalRows & " rows): planned restart"
                    SafeLogoff
                    WScript.Quit EXIT_BUDGET
                End If
                WScript.Echo "Exporting table: " & tableName
                ok = ExtractTable(tableName)
            End If
        End If
    Loop
    txtTables.Close

    SafeLogoff
    LogEvent "worker finished"
End Sub

' Tables that failed (RFC error) earlier in this session: not retried at every relaunch
Function LoadFailedTables()
    Dim d, ts, nm
    Set d = CreateObject("Scripting.Dictionary")
    If fso.FileExists(OUTPUT_FOLDER & "~failed.lst") Then
        Set ts = fso.OpenTextFile(OUTPUT_FOLDER & "~failed.lst", 1)
        Do Until ts.AtEndOfStream
            nm = Trim(ts.ReadLine)
            If nm <> "" Then
                If Not d.Exists(UCase(nm)) Then d.Add UCase(nm), True
            End If
        Loop
        ts.Close
    End If
    Set LoadFailedTables = d
End Function

Sub RecordTableFailure(ByVal tabName, ByVal msg, ByVal sapException)
    Dim ts
    WScript.Echo "  " & msg & " for " & tabName
    If Len(sapException) > 0 Then WScript.Echo "  SAP exception: " & sapException
    WScript.Echo "  -> table skipped (no file written)"
    LogEvent "TABLE FAILED " & tabName & ": " & msg & IIf(Len(sapException) > 0, " - SAP exception: " & sapException, "")
    On Error Resume Next
    Set ts = fso.OpenTextFile(OUTPUT_FOLDER & "~failed.lst", 8, True)
    If Err.Number = 0 Then
        ts.WriteLine UCase(tabName)
        ts.Close
    End If
    Err.Clear
    On Error GoTo 0
End Sub

Sub LogSkippedRecord(ByVal tabName, ByVal recNo, ByVal raw)
    Dim msg
    msg = "SKIPPED RECORD " & tabName & " #" & recNo & " (delimiter '" & DELIMITER_CHAR & "' inside a value)"
    If LOG_RECORD_SAMPLE Then msg = msg & ": " & Left(raw, 80)
    LogEvent msg
End Sub

Function IIf(ByVal cond, ByVal a, ByVal b)
    If cond Then
        IIf = a
    Else
        IIf = b
    End If
End Function

Function Q(ByVal s)
    Q = Chr(34) & s & Chr(34)
End Function

' Appends a line to the event log; a logging problem must never stop the run
Sub LogEvent(ByVal msg)
    Dim ts
    On Error Resume Next
    Set ts = fso.OpenTextFile(LOG_FILE, 8, True)
    If Err.Number = 0 Then
        ts.WriteLine Now & " [" & gRole & "] " & msg
        ts.Close
    End If
    Err.Clear
    On Error GoTo 0
End Sub

' =============================================================================
'  VALUE HYGIENE (same rules as the zsectools import fixes)
' =============================================================================
Sub InitRegex()
    ' ONE shared RegExp object per pattern: creating one per value is far too slow
    Set reCtrlTest = CreateObject("VBScript.RegExp")
    reCtrlTest.Pattern = "[\x00-\x1F\x7F]"
    Set reCtrlWs = CreateObject("VBScript.RegExp")
    reCtrlWs.Pattern = "[\x09\x0A\x0D]"
    reCtrlWs.Global = True
    Set reCtrlStrip = CreateObject("VBScript.RegExp")
    reCtrlStrip.Pattern = "[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]"
    reCtrlStrip.Global = True
    Set reFloat = CreateObject("VBScript.RegExp")
    reFloat.Pattern = "^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$"
End Sub

' Control characters out of a value: tab / CR / LF would break the TSV layout
' (-> space), NUL and the other control chars are removed (a 0x00 makes the
' PostgreSQL import fail: invalid byte sequence for encoding "UTF8": 0x00)
Function CleanControlChars(ByVal s)
    s = reCtrlWs.Replace(s, " ")
    CleanControlChars = reCtrlStrip.Replace(s, "")
End Function

' Column kind used by the row conversion: 0 text, 1 date, 2 time, 3 packed,
' 4 integer (I, INT1), 5 float
Function SapTypeKind(ByVal t)
    Select Case t
        Case "D"
            SapTypeKind = 1
        Case "T"
            SapTypeKind = 2
        Case "P"
            SapTypeKind = 3
        Case "I", "B"
            SapTypeKind = 4
        Case "F"
            SapTypeKind = 5
        Case Else
            SapTypeKind = 0
    End Select
End Function

Function ConvertByKind(ByVal k, ByVal v)
    If k = 0 Then
        ConvertByKind = Trim(v)
    ElseIf k = 1 Then
        ConvertByKind = ConvertSapDate(Trim(v))
    ElseIf k = 2 Then
        ConvertByKind = ConvertSapTime(Trim(v))
    ElseIf k = 3 Then
        ConvertByKind = ConvertSapPacked(v)
    ElseIf k = 4 Then
        ConvertByKind = ConvertSapInteger(v)
    Else
        ConvertByKind = ConvertSapFloat(v)
    End If
End Function

' Turns one RFC_READ_TABLE WA record into an output line (lineOut).
' Returns 0 = ok, 1 = record to SKIP (more values than fields: the delimiter
' is also inside a value and every following column would be shifted, e.g.
' text landing in a DATE column), 2 = ok but padded (fewer values than fields)
Function BuildLine(ByVal raw, ByVal nFields, ByRef fieldKind, ByRef lineOut)
    Dim vals, ub, j, k, v, padded()
    If reCtrlTest.Test(raw) Then raw = CleanControlChars(raw)
    vals = Split(raw, DELIMITER_CHAR)
    ub = UBound(vals)
    If ub > nFields - 1 Then
        BuildLine = 1
        Exit Function
    End If
    If ub = nFields - 1 Then
        ' normal case: the WA splits into exactly the field count
        BuildLine = 0
        For j = 0 To ub
            k = fieldKind(j)
            If k = 0 Then
                vals(j) = Trim(vals(j))
            ElseIf k = 1 Then
                vals(j) = ConvertSapDate(Trim(vals(j)))
            ElseIf k = 2 Then
                vals(j) = ConvertSapTime(Trim(vals(j)))
            ElseIf k = 3 Then
                vals(j) = ConvertSapPacked(vals(j))
            ElseIf k = 4 Then
                vals(j) = ConvertSapInteger(vals(j))
            Else
                vals(j) = ConvertSapFloat(vals(j))
            End If
        Next
        lineOut = Join(vals, vbTab)
    Else
        BuildLine = 2
        ReDim padded(nFields - 1)
        For j = 0 To nFields - 1
            If j <= ub Then
                v = vals(j)
            Else
                v = ""
            End If
            padded(j) = ConvertByKind(fieldKind(j), v)
        Next
        lineOut = Join(padded, vbTab)
    End If
End Function

' Integer (I / INT1): optional sign (SAP may put it AFTER the digits: "5-"),
' digits only; anything else -> empty cell
Function ConvertSapInteger(ByVal v)
    Dim neg
    ConvertSapInteger = ""
    v = Trim(v & "")
    If Len(v) = 0 Then Exit Function
    neg = False
    If Right(v, 1) = "-" Then
        neg = True
        v = Left(v, Len(v) - 1)
    ElseIf Left(v, 1) = "-" Then
        neg = True
        v = Mid(v, 2)
    End If
    If Not IsAllDigits(v) Then Exit Function
    If neg Then
        ConvertSapInteger = "-" & v
    Else
        ConvertSapInteger = v
    End If
End Function

' Float (F): plain decimal / scientific notation, optional trailing sign
Function ConvertSapFloat(ByVal v)
    ConvertSapFloat = ""
    v = Trim(v & "")
    If Len(v) = 0 Then Exit Function
    If Right(v, 1) = "-" Then v = "-" & Left(v, Len(v) - 1)
    If reFloat.Test(v) Then ConvertSapFloat = v
End Function

' =============================================================================
'  TABLE EXTRACTION (same logic as zsectools /api/import-sap/tables)
' =============================================================================

' Field selection for specific tables, IDENTICAL to TABLE_FIELD_OVERRIDES in
' zsectools backend (server.js). These overrides avoid the RFC_READ_TABLE
' 512-byte row limit ("DATA_BUFFER_EXCEEDED") on wide tables. Returns ""
' when all fields must be read (all tables not listed here).
Function GetFieldOverride(tabName)
    GetFieldOverride = ""
    Select Case UCase(tabName)
        Case "USR02"
            GetFieldOverride = "BNAME|GLTGV|GLTGB|USTYP|CLASS|LOCNT|UFLAG|ACCNT|ANAME|" & _
                "ERDAT|TRDAT|LTIME|PWDCHGDATE|PWDSTATE|RESERVED|PWDHISTORY|PWDLGNDATE|" & _
                "PWDSETDATE|PWDINITIAL|PWDLOCKDATE|SECURITY_POLICY"
        Case "ADRP"
            GetFieldOverride = "PERSNUMBER|DATE_FROM|NATION|DATE_TO|TITLE|NAME_FIRST|NAME_LAST|" & _
                "NAME2|NAMEMIDDLE|NAME_LAST2|NAME_TEXT|CONVERTED|NICKNAME|INITIALS|SORT1|" & _
                "SORT2|MC_NAMEFIR|MC_NAMELAS|MC_NAME2"
        Case "PA0002"
            GetFieldOverride = "PERNR|BEGDA|ENDDA|NACHN|VORNA|NCHMC|VNAMC"
        Case "TDEVC"
            GetFieldOverride = "DEVCLASS|AS4USER|COMPONENT|NAMESPACE"
        Case "TBTCO"
            GetFieldOverride = "JOBNAME|JOBCOUNT|JOBGROUP|INTREPORT|STEPCOUNT|SDLSTRTDT|SDLSTRTTM|" & _
                "BTCSYSTEM|SDLDATE|SDLTIME|SDLUNAME|LASTCHDATE|LASTCHTIME|LASTCHNAME|RELDATE|" & _
                "RELTIME|RELUNAME|STRTDATE|STRTTIME|ENDDATE|ENDTIME|PRDMINS|PRDHOURS|PRDDAYS|" & _
                "PRDWEEKS|PRDMONTHS|PERIODIC|STATUS|NEWFLAG|AUTHCKNAM|AUTHCKMAN|SUCCNUM|" & _
                "PREDNUM|JOBLOG|LASTSTRTTM|EVENTID|EVENTPARM|JOBCLASS|PRIORITY|CHECKSTAT"
        Case "TBTCP"
            GetFieldOverride = "JOBNAME|JOBCOUNT|STEPCOUNT|PROGNAME|SDLDATE|SDLTIME|SDLUNAME|" & _
                "VARIANT|AUTHCKNAM|LISTIDENT|XPGPID|STATUS|EXITCODE|PDEST|PLIST|PRIMM|PRREL|" & _
                "PRBER|REPORT"
        Case "USRACL"
            GetFieldOverride = "BNAME|PNAME"
    End Select
End Function

' RFC WHERE filters, IDENTICAL to the switch on cleanName in zsectools server.js
Function GetTableFilter(tabName)
    GetTableFilter = ""
    Select Case UCase(tabName)
        Case "TADIR"
            GetTableFilter = "PGMID EQ 'R3TR' AND ( OBJECT EQ 'TRAN' OR OBJECT EQ 'PROG' )"
        Case "AGR_TEXTS"
            GetTableFilter = "SPRAS EQ 'I' OR SPRAS EQ 'E'"
        Case "AGR_HIERT"
            GetTableFilter = "SPRAS eq 'I' or SPRAS eq 'E' or SPRAS eq 'D'"
        Case "TOBJT"
            GetTableFilter = "LANGU eq 'E' or LANGU eq 'I'"
    End Select
End Function

' SAP type -> PostgreSQL type, IDENTICAL to mapSapTypeToPg in zsectools sapImport.js
Function MapSapType(sapType)
    ' Returns EXACTLY the same strings as mapSapTypeToPg in zsectools sapImport.js.
    ' NOTE: the types read from the RFC metadata are upper-cased by the caller,
    ' so INT1 ("b" in SAP) arrives here as "B": both spellings are accepted.
    Select Case sapType
        Case "D"
            MapSapType = "DATE"
        Case "T"
            MapSapType = "TIME"
        Case "I"
            MapSapType = "INTEGER"
        Case "F"
            MapSapType = "DOUBLE PRECISION"
        Case "P"
            MapSapType = "NUMERIC"
        Case "b", "B"
            MapSapType = "SMALLINT"
        Case Else
            MapSapType = "TEXT"   ' N (leading zeros), C, STRING, X, ...
    End Select
End Function

' Builds (or rebuilds) the complete SAP GUI OCX object graph: LogonControl,
' connection and SAP.Functions container. Called once at worker startup and
' then by RecycleConnection: a fresh connection drops whatever internal state
' the OCX accumulated, which is what degrades batch times over a long run.
' Returns EXIT_DONE (0) when logged on, EXIT_LOGON when the logon failed,
' EXIT_CONFIG when the OCX controls are not registered.
Function ConnectSap()
    Dim okLogon, logonErr
    ConnectSap = EXIT_DONE
    logonErr = ""

    On Error Resume Next
    Set LogonControl = CreateObject("SAP.LogonControl.1")
    If Err.Number = 0 Then Set SapFunc = CreateObject("SAP.Functions")
    If Err.Number <> 0 Then
        WScript.Echo "Cannot create the SAP GUI OCX objects (" & Err.Description & ")."
        WScript.Echo "The controls are not registered: see Prerequisites in README.md (regsvr32 wdtlog.ocx / wdtfuncs.ocx)."
        Err.Clear
        On Error GoTo 0
        ConnectSap = EXIT_CONFIG
        Exit Function
    End If
    On Error GoTo 0

    Set SapConn = LogonControl.NewConnection
    SapConn.System = SAP_SYSTEM
    SapConn.ApplicationServer = SAP_ASHOST
    SapConn.SystemNumber = SAP_SYSNR
    SapConn.Client = SAP_CLIENT
    SapConn.User = SAP_USER
    SapConn.Password = SAP_PASSWORD
    SapConn.Language = SAP_LANG
    SapConn.SAPRouter = SAP_ROUTER

    okLogon = False
    On Error Resume Next
    okLogon = SapConn.Logon(0, True)
    If Err.Number <> 0 Then logonErr = Err.Description
    Err.Clear
    On Error GoTo 0
    If okLogon <> True Then
        If Len(logonErr) > 0 Then
            WScript.Echo "Error connecting to SAP! (" & logonErr & ")"
        Else
            WScript.Echo "Error connecting to SAP!"
        End If
        ConnectSap = EXIT_LOGON
        Exit Function
    End If
    SapFunc.Connection = SapConn
    gConnBatches = 0
    gConnRows = 0
End Function

' Tears the connection down and rebuilds it (same credentials, silent logon).
' If the reconnection fails the worker stops (exit 3): the supervisor relaunches it.
Sub RecycleConnection()
    Dim rc
    WScript.Echo "  -> recycling the RFC connection (memory hygiene)"
    SafeLogoff
    Set SapConn = Nothing
    Set SapFunc = Nothing
    Set LogonControl = Nothing
    WScript.Sleep 500
    rc = ConnectSap()
    If rc <> EXIT_DONE Then
        WScript.Echo "  -> reconnection failed: the launcher will retry with a fresh process"
        LogEvent "reconnection failed (code " & rc & ")"
        WScript.Quit EXIT_CRASH
    End If
End Sub

Sub SafeLogoff()
    On Error Resume Next
    SapConn.Logoff
    Err.Clear
    On Error GoTo 0
End Sub

' Recycles the connection when it has served too much data
Sub CheckRecycleConnection()
    If gConnBatches >= RECYCLE_BATCHES Or gConnRows >= RECYCLE_ROWS Then
        RecycleConnection
    End If
End Sub

Function ExtractTable(tabName)
    Dim rfcData, tblData, tblFieldsOut, tblOptions, tblFieldsParam
    Dim fileBase, tmpFile, batchIndex, totalRows, nRows, i, j, ub
    Dim fieldNames(), fieldTypes(), nFields, headerWritten
    Dim fieldKind(), lineStatus, tblSkipped, tblShort, rfcEx
    Dim valuesArray, paddedArr, rawString, singleValue, lineOut
    Dim fieldOverride, tableFilter, pendingHeader
    Dim rowStream, tRfc, tConv, singlePart(0)
    Dim callOk, callErr, callErrDesc
    Dim convErr, convErrDesc, restartTable, tableDone, outerAttempt
    Dim batchRetryCount

    ExtractTable = False
    fileBase = OUTPUT_FOLDER & tabName & ".txt"
    tmpFile = OUTPUT_FOLDER & tabName & ".tmp"
    fieldOverride = GetFieldOverride(tabName)
    tableFilter = GetTableFilter(tabName)

    ' MEMORY STRATEGY (learned the hard way): the 32-bit heap of cscript.exe
    ' degrades over a long run and ANY medium-large allocation can fail after
    ' ~1.5M rows ("Out of string space" on a Join, "wdtaocx: not enough
    ' memory" on a Value() read). Countermeasures:
    '   - ONE output stream per TABLE (opened once, written one line at a
    '     time, saved once at the end): no per-batch temp files, no merge;
    '   - NEVER joins rows: the largest string is a single output line;
    '   - the RFC function object is created fresh for every batch and
    '     released IMMEDIATELY after conversion;
    '   - ROWS_PER_BATCH = 50000 keeps every OCX buffer small;
    '   - the RFC CONNECTION is torn down and rebuilt every RECYCLE_ROWS
    '     rows / RECYCLE_BATCHES batches (CheckRecycleConnection);
    '   - if the OCX still dies mid-batch, the partial output is discarded
    '     and the table restarted on a fresh connection; a second death
    '     exits with code 3 and the supervisor relaunches the process (a fresh
    '     process is the only thing that provably resets the heap);
    '   - SKIP_EXISTING skips tables whose .txt is already there.
    ' Batching (ROWSKIPS/ROWCOUNT) is the only paging mode that ever
    ' completed AGR_1251 (695,736 rows) on this system.

    ' RETRY STRUCTURE: outerAttempt 1 = first try; if the conversion dies
    ' mid-batch the table is restarted once in-process (fresh connection);
    ' a second death stops the process (exit code 3, relaunched by the supervisor). A table that does not
    ' complete writes NO .txt and NO .tmp: every restart starts it from
    ' zero, so a partial file can never be produced.
    tableDone = False
    outerAttempt = 0
    Do Until tableDone
        outerAttempt = outerAttempt + 1
        restartTable = False
        batchRetryCount = 0
        ' a .tmp left here means a previous run died on THIS table: start over
        If fso.FileExists(tmpFile) Then fso.DeleteFile tmpFile, True
        batchIndex = 0
        totalRows = 0
        headerWritten = False
        pendingHeader = ""
        tblSkipped = 0
        tblShort = 0

        ' memory hygiene: fresh connection if the current one served enough
        CheckRecycleConnection

        ' ONE output stream for the whole table: written line by line in the
        ' batch loop below, saved ONCE at the end of the table
        Set rowStream = CreateObject("ADODB.Stream")
        rowStream.Type = 2          ' adTypeText
        rowStream.Charset = "utf-8"
        rowStream.Open
        Do
            CheckRecycleConnection

            Set rfcData = SapFunc.Add("RFC_READ_TABLE")
            rfcData.Exports("QUERY_TABLE") = tabName
            rfcData.Exports("DELIMITER") = DELIMITER_CHAR
            rfcData.Exports("ROWSKIPS") = batchIndex * ROWS_PER_BATCH
            rfcData.Exports("ROWCOUNT") = ROWS_PER_BATCH

            ' same WHERE filters as zsectools
            If tableFilter <> "" Then
                Set tblOptions = rfcData.Tables("OPTIONS")
                tblOptions.Rows.Add
                tblOptions.Value(tblOptions.Rows.Count, "TEXT") = tableFilter
            End If

            ' same field selections as zsectools
            If fieldOverride <> "" Then
                Set tblFieldsParam = rfcData.Tables("FIELDS")
                Dim overrideFields, k
                overrideFields = Split(fieldOverride, "|")
                For k = 0 To UBound(overrideFields)
                    tblFieldsParam.Rows.Add
                    tblFieldsParam.Value(tblFieldsParam.Rows.Count, "FIELDNAME") = overrideFields(k)
                Next
            End If

            ' the Call itself can raise a COM error (wdtaocx "not enough
            ' memory"): guard it so the batch can be retried on a fresh
            ' connection instead of killing the run
            callOk = False
            Err.Clear
            On Error Resume Next
            tRfc = Timer
            callOk = rfcData.Call
            callErr = Err.Number
            callErrDesc = Err.Description
            On Error GoTo 0

            If callErr <> 0 Then
                ' COM hard error on the Call: release, recycle, retry the
                ' SAME batch once (ROWSKIPS did not advance, no duplicates)
                Set tblData = Nothing
                Set tblFieldsOut = Nothing
                Set tblOptions = Nothing
                Set tblFieldsParam = Nothing
                On Error Resume Next
                SapFunc.Remove(rfcData)
                On Error GoTo 0
                Set rfcData = Nothing
                If batchRetryCount < 1 Then
                    batchRetryCount = batchRetryCount + 1
                    WScript.Echo "  -> COM error on the RFC call (" & callErrDesc & ")"
                    WScript.Echo "  -> recycling the RFC connection and retrying this batch"
                    RecycleConnection
                Else
                    WScript.Echo "  -> FATAL: the RFC call failed twice: " & callErrDesc
                    rowStream.Close
                    Set rowStream = Nothing
                    WScript.Echo "  -> no file written for " & tabName & ": the launcher restarts automatically and redoes this table"
                    LogEvent "FATAL on " & tabName & ": " & callErrDesc
                    WScript.Quit EXIT_CRASH   ' crash restart: fresh process = fresh heap, resume automatic
                End If
            ElseIf callOk <> True Then
                ' RFC-level exception (e.g. DATA_BUFFER_EXCEEDED): skip table
                rfcEx = ""
                On Error Resume Next
                rfcEx = rfcData.Exception & ""
                Err.Clear
                On Error GoTo 0
                RecordTableFailure tabName, "RFC_READ_TABLE error at batch " & (batchIndex + 1) & _
                    " (" & totalRows & " rows already read)", rfcEx
                rowStream.Close
                Set rowStream = Nothing
                Set tblData = Nothing
                Set tblFieldsOut = Nothing
                Set tblOptions = Nothing
                Set tblFieldsParam = Nothing
                On Error Resume Next
                SapFunc.Remove(rfcData)
                On Error GoTo 0
                Set rfcData = Nothing
                ExtractTable = False
                Exit Function
            Else
                tRfc = Timer - tRfc
                If tRfc < 0 Then tRfc = 0
                Set tblData = rfcData.Tables("DATA")
                Set tblFieldsOut = rfcData.Tables("FIELDS")
                nRows = tblData.Rows.Count

                If nRows = 0 Then
                    Set tblData = Nothing
                    Set tblFieldsOut = Nothing
                    Set tblOptions = Nothing
                    Set tblFieldsParam = Nothing
                    On Error Resume Next
                    SapFunc.Remove(rfcData)
                    On Error GoTo 0
                    Set rfcData = Nothing
                    Exit Do
                End If

                ' build header/types once, from the returned FIELDS metadata
                If Not headerWritten Then
                    nFields = tblFieldsOut.Rows.Count
                    ReDim fieldNames(nFields - 1)
                    ReDim fieldTypes(nFields - 1)
                    For i = 1 To nFields
                        fieldNames(i - 1) = LCase(Trim(tblFieldsOut.Value(i, "FIELDNAME")))
                        fieldTypes(i - 1) = UCase(Trim(tblFieldsOut.Value(i, "TYPE")))
                    Next
                    ' precomputed conversion kind of each column (see SapTypeKind)
                    ReDim fieldKind(nFields - 1)
                    For i = 0 To nFields - 1
                        fieldKind(i) = SapTypeKind(fieldTypes(i))
                    Next
                    ' the file header rides in the first batch stream
                    pendingHeader = "# Table: " & UCase(tabName) & vbCrLf & _
                                    "# TYPES: " & Join(MapTypesArray(fieldTypes), "|") & vbCrLf & _
                                    Join(fieldNames, vbTab) & vbCrLf
                    headerWritten = True
                End If

                ' convert each row (same conversions as zsectools: split |, Trim
                ' per field, conversions only on D/T/P columns) and write it to
                ' the table stream immediately - one line at a time, no row
                ' array, no Join of rows. The largest string here is a line.
                ' The whole loop is guarded: the OCX can raise "not enough
                ' memory" on Value() after many batches - in that case the
                ' partial output is discarded and the table is restarted.
                convErr = False
                convErrDesc = ""
                tConv = Timer
                Err.Clear
                On Error Resume Next
                If pendingHeader <> "" Then
                    rowStream.WriteText pendingHeader   ' already ends with CRLF
                    pendingHeader = ""
                End If
                If Err.Number = 0 Then
                    For i = 1 To nRows
                        ' BuildLine strips control chars (NUL...), splits on the delimiter,
                        ' converts each field and returns: 0 = ok, 1 = skip (delimiter
                        ' inside a value: columns would be shifted), 2 = ok but padded
                        lineStatus = BuildLine(tblData.Value(i, "WA") & "", nFields, fieldKind, lineOut)
                        If Err.Number <> 0 Then
                            convErr = True
                            convErrDesc = Err.Description
                            Exit For
                        End If
                        If lineStatus = 1 Then
                            tblSkipped = tblSkipped + 1
                            If tblSkipped <= MAX_LOGGED_SKIPS Then
                                LogSkippedRecord tabName, batchIndex * ROWS_PER_BATCH + i, tblData.Value(i, "WA") & ""
                            End If
                        Else
                            If lineStatus = 2 Then tblShort = tblShort + 1
                            rowStream.WriteText lineOut, 1   ' adWriteLine: line + CRLF
                            If Err.Number <> 0 Then
                                convErr = True
                                convErrDesc = Err.Description
                                Exit For
                            End If
                        End If
                    Next
                End If
                Err.Clear
                On Error GoTo 0

                ' release the RFC objects IMMEDIATELY (the OCX tables hold the
                ' whole batch result): never carry them into the next batch
                Set tblData = Nothing
                Set tblFieldsOut = Nothing
                Set tblOptions = Nothing
                Set tblFieldsParam = Nothing
                On Error Resume Next
                SapFunc.Remove(rfcData)
                On Error GoTo 0
                Set rfcData = Nothing

                If convErr Then
                    rowStream.Close
                    Set rowStream = Nothing
                    RecycleConnection
                    If outerAttempt >= 2 Then
                        WScript.Echo "  -> FATAL: " & convErrDesc
                        WScript.Echo "  -> no file written for " & tabName & ": the launcher restarts automatically and redoes this table"
                        LogEvent "FATAL on " & tabName & ": " & convErrDesc
                        WScript.Quit EXIT_CRASH   ' crash restart: fresh process = fresh heap, resume automatic
                    End If
                    WScript.Echo "  -> error during conversion (" & convErrDesc & "):"
                    WScript.Echo "     discarding the partial output and restarting this table"
                    restartTable = True
                    Exit Do
                End If

                tConv = Timer - tConv
                If tConv < 0 Then tConv = 0

                totalRows = totalRows + nRows
                gTotalRows = gTotalRows + nRows
                gConnRows = gConnRows + nRows
                gConnBatches = gConnBatches + 1
                batchIndex = batchIndex + 1
                batchRetryCount = 0
                WScript.Echo "  batch " & batchIndex & ": " & nRows & " rows in " & _
                    FormatNumber(tRfc, 1) & "s (RFC) + " & FormatNumber(tConv, 1) & "s (conversion), total " & totalRows

                If nRows < ROWS_PER_BATCH Then
                    Exit Do
                End If
            End If
        Loop

        If Not restartTable Then
            tableDone = True
        End If
    Loop

    If totalRows = 0 Then
        ' table exists but is empty (or metadata never arrived): write the
        ' self-describing header anyway, like zsectools does for empty exports
        rowStream.Close
        Set rowStream = Nothing
        WriteHeaderOnly tabName, fileBase
        WScript.Echo "  -> 0 rows (header only)"
    Else
        ' save the whole table into ONE temp file (it carries the stream
        ' BOM), then ConcatTempFiles strips the BOM with 1 MB slices and
        ' writes the final .txt, deleting the temp afterwards
        rowStream.SaveToFile tmpFile, 2 ' adSaveCreateOverWrite (with BOM)
        rowStream.Close
        Set rowStream = Nothing
        singlePart(0) = tmpFile
        ConcatTempFiles singlePart, 1, fileBase
        WScript.Echo "  -> Downloaded " & (totalRows - tblSkipped) & " lines: " & fileBase
    End If
    If tblSkipped > 0 Then
        WScript.Echo "  -> WARNING: " & tblSkipped & " record(s) SKIPPED: the delimiter '" & DELIMITER_CHAR & _
                     "' appears inside a value (columns would be shifted). Details in sap-extractor.log"
        LogEvent "table " & tabName & ": " & tblSkipped & " record(s) skipped (delimiter inside a value)"
    End If
    If tblShort > 0 Then
        WScript.Echo "  -> note: " & tblShort & " record(s) shorter than the field list were padded with empty values"
        LogEvent "table " & tabName & ": " & tblShort & " short record(s) padded"
    End If
    LogEvent "table " & tabName & " done: " & (totalRows - tblSkipped) & " rows"
    ExtractTable = True
End Function

' Fallback metadata call (NO_DATA) used only for tables with zero rows
Sub WriteHeaderOnly(tabName, fileBase)
    Dim rfcMetadata, tblFields, i, nFields
    Dim fieldNames(), typeArr()

    Set rfcMetadata = SapFunc.Add("RFC_READ_TABLE")
    rfcMetadata.Exports("QUERY_TABLE") = tabName
    rfcMetadata.Exports("NO_DATA") = "X"

    If rfcMetadata.Call = True Then
        Set tblFields = rfcMetadata.Tables("FIELDS")
        nFields = tblFields.Rows.Count
        If nFields > 0 Then
            ReDim fieldNames(nFields - 1)
            ReDim typeArr(nFields - 1)
            For i = 1 To nFields
                fieldNames(i - 1) = LCase(Trim(tblFields.Value(i, "FIELDNAME")))
                typeArr(i - 1) = MapSapType(UCase(Trim(tblFields.Value(i, "TYPE"))))
            Next
            SaveTextFileUtf8NoBom fileBase, _
                "# Table: " & UCase(tabName) & vbCrLf & _
                "# TYPES: " & Join(typeArr, "|") & vbCrLf & _
                Join(fieldNames, vbTab) & vbCrLf
        Else
            SaveTextFileUtf8NoBom fileBase, "# Table: " & UCase(tabName) & vbCrLf
        End If
    Else
        SaveTextFileUtf8NoBom fileBase, "# Table: " & UCase(tabName) & vbCrLf
    End If
    SapFunc.Remove(rfcMetadata)
End Sub

Sub ConcatTempFiles(ByRef batchTmpFiles, ByVal count, ByVal fileBase)
    ' The parts were written by UTF-8 TEXT streams, so each one starts with
    ' a 3-byte BOM: skip it on every part while merging (the final file must
    ' have NO BOM, as expected by the zsectools import). Copies in 1 MB
    ' slices to keep every allocation small.
    Dim final, part, i, bytesRead
    Set final = CreateObject("ADODB.Stream")
    final.Type = 1
    final.Open
    For i = 0 To count - 1
        Set part = CreateObject("ADODB.Stream")
        part.Type = 1
        part.Open
        part.LoadFromFile batchTmpFiles(i)
        part.Position = 3          ' skip the UTF-8 BOM of this part
        Do While part.Position < part.Size
            bytesRead = part.Read(1048576)   ' 1 MB slice
            final.Write bytesRead
        Loop
        part.Close
        fso.DeleteFile batchTmpFiles(i), True
    Next
    final.SaveToFile fileBase, 2 ' adSaveCreateOverWrite
    final.Close
End Sub

' =============================================================================
'  USER STATISTICS (same logic as zsectools /api/import-sap/user-statistics)
' =============================================================================
' Calls SWNC_COLLECTOR_GET_AGGREGATES (PERIODTYPE M/W/D, PERIODSTRT YYYYMMDD,
' COMPONENT 'TOTAL'), takes the USERTCODE table and writes a file with the
' same layout zsectools exports: "# PERIOD_TYPE: X" first line, then the
' header (selected_at + all RFC columns + action + actiontype), then rows.
Sub ExtractStatistics(periodType, dateYmd, dateIso)
    Dim MyFunc, tbl, nRows, nCols, colNamesRaw, colNamesFile
    Dim base, i, c, entryIdCol, lineVal
    Dim entryId, action, actiontype
    Dim fileName, headerContent, rfcEx
    Dim statsParts(), statsPath, rowStream
    Dim colReadable(), colSkipped, cellVal, probe, nOutCols
    Dim outNamesFile()

    WScript.Echo "Step 4 - Downloading user statistics (period " & periodType & ", date " & dateYmd & ")..."

    Set MyFunc = SapFunc.Add("SWNC_COLLECTOR_GET_AGGREGATES")
    MyFunc.Exports("PERIODTYPE") = periodType
    MyFunc.Exports("PERIODSTRT") = dateYmd
    MyFunc.Exports("COMPONENT") = "TOTAL"

    If MyFunc.Call <> True Then
        ' surface the real reason returned by SAP instead of a generic message
        rfcEx = ""
        On Error Resume Next
        rfcEx = MyFunc.Exception & ""
        If Err.Number <> 0 Then
            Err.Clear
            rfcEx = ""
        End If
        On Error GoTo 0
        WScript.Echo "  SWNC_COLLECTOR_GET_AGGREGATES call failed."
        If Len(rfcEx) > 0 Then
            WScript.Echo "  SAP exception: " & rfcEx
        End If
        WScript.Echo "  Likely causes: no aggregates collected for that period (check ST03N)," & _
                     " missing S_RFC authorization for function group SWNC_COLONNEL," & _
                     " or the date is not the period start (M -> 1st of month, W -> Monday)."
        SapFunc.Remove(MyFunc)
        Exit Sub
    End If

    Set tbl = MyFunc.Tables("USERTCODE")
    nRows = tbl.Rows.Count
    nCols = tbl.Columns.Count

    If nRows = 0 Or nCols = 0 Then
        WScript.Echo "  -> 0 statistics rows for the requested period (nothing written)."
        SapFunc.Remove(MyFunc)
        Exit Sub
    End If

    ' column names: keep the original case for Value() lookups and a
    ' lowercased copy for the file header (zsectools stores lowercase)
    ReDim colNamesRaw(nCols - 1)
    ReDim colNamesFile(nCols - 1)

    ' the OCX Columns collection is 0-based on some versions, 1-based on
    ' others: detect it by probing the first names (with error guard)
    Dim probe0, probe1
    base = 0
    On Error Resume Next
    probe0 = tbl.Columns(0).Name & ""
    If Err.Number <> 0 Then
        Err.Clear
        probe0 = ""
    End If
    If Len(Trim(probe0)) = 0 And nCols > 1 Then
        probe1 = tbl.Columns(1).Name & ""
        If Err.Number = 0 Then
            If Len(Trim(probe1)) > 0 Then base = 1
        End If
        Err.Clear
    End If
    On Error GoTo 0
    For c = 0 To nCols - 1
        colNamesRaw(c) = Trim(tbl.Columns(c + base).Name & "")
        If colNamesRaw(c) = "" Then colNamesRaw(c) = "column" & (c + 1)
        colNamesFile(c) = LCase(colNamesRaw(c))
    Next

    ' locate ENTRY_ID (action/actiontype are derived from it, like zsectools)
    entryIdCol = -1
    For c = 0 To nCols - 1
        If UCase(colNamesRaw(c)) = "ENTRY_ID" Then entryIdCol = c
    Next

    ' The SWNC structures contain DATS/TIMS/DEC fields: on some values the
    ' SAP GUI Table OCX raises "wdtaocx: Type mismatch" instead of returning
    ' the value. Probe each column on the first row (guarded) and skip the
    ' ones the OCX cannot convert, so the download never aborts.
    ReDim colReadable(nCols - 1)
    colSkipped = 0
    On Error Resume Next
    For c = 0 To nCols - 1
        Err.Clear
        probe = tbl.Value(1, colNamesRaw(c)) & ""
        If Err.Number <> 0 Then
            Err.Clear
            probe = tbl.Value(1, c + 1) & ""
            If Err.Number <> 0 Then
                Err.Clear
                colReadable(c) = False
                colSkipped = colSkipped + 1
            Else
                colReadable(c) = True
            End If
        Else
            colReadable(c) = True
        End If
    Next
    Err.Clear
    On Error GoTo 0

    nOutCols = 0
    ReDim outNamesFile(nCols - 1)
    For c = 0 To nCols - 1
        If colReadable(c) Then
            outNamesFile(nOutCols) = colNamesFile(c)
            nOutCols = nOutCols + 1
        End If
    Next
    If nOutCols = 0 Then
        WScript.Echo "  -> the SAP GUI OCX cannot read any column of the USERTCODE table (nothing written)."
        SapFunc.Remove(MyFunc)
        Exit Sub
    End If
    If colSkipped > 0 Then
        WScript.Echo "  note: " & colSkipped & " column(s) skipped (not convertible by the SAP GUI OCX)."
    End If
    ReDim Preserve outNamesFile(nOutCols - 1)

    ' write the statistics file ONE ROW AT A TIME into a UTF-8 stream
    ' (no row array, no giant Join - the largest string here is a single
    ' line), then save and merge it through ConcatTempFiles, which also
    ' strips the stream BOM
    Set rowStream = CreateObject("ADODB.Stream")
    rowStream.Type = 2          ' adTypeText
    rowStream.Charset = "utf-8"
    rowStream.Open
    headerContent = "# PERIOD_TYPE: " & periodType & vbCrLf & _
                    "selected_at" & vbTab & Join(outNamesFile, vbTab) & vbTab & "action" & vbTab & "actiontype" & vbCrLf
    rowStream.WriteText headerContent
    fileName = StatsFileName(periodType, dateYmd)
    On Error Resume Next
    For i = 1 To nRows
        lineVal = dateIso & "T00:00:00.000Z"
        entryId = ""
        For c = 0 To nCols - 1
            If colReadable(c) Then
                Err.Clear
                cellVal = tbl.Value(i, colNamesRaw(c)) & ""
                If Err.Number <> 0 Then
                    Err.Clear
                    cellVal = tbl.Value(i, c + 1) & ""
                    If Err.Number <> 0 Then
                        Err.Clear
                        cellVal = ""
                    End If
                End If
                If reCtrlTest.Test(cellVal) Then cellVal = CleanControlChars(cellVal)
                lineVal = lineVal & vbTab & cellVal
                If c = entryIdCol Then entryId = cellVal
            End If
        Next
        ParseEntryId entryId, action, actiontype
        rowStream.WriteText lineVal & vbTab & action & vbTab & actiontype, 1   ' line + CRLF
    Next
    On Error GoTo 0
    statsPath = OUTPUT_FOLDER & "~stats_" & periodType & "_" & dateYmd & ".tmp"
    rowStream.SaveToFile statsPath, 2 ' adSaveCreateOverWrite (with BOM)
    rowStream.Close
    Set rowStream = Nothing
    ' single-part merge: ConcatTempFiles strips the 3-byte BOM of the part
    ReDim statsParts(0)
    statsParts(0) = statsPath
    ConcatTempFiles statsParts, 1, fileName

    WScript.Echo "  -> Downloaded " & nRows & " statistics rows: " & fileName
    SapFunc.Remove(MyFunc)
End Sub

' Same parsing as saveUserStats in zsectools: ENTRY_ID = "<action><actiontype>"
' e.g. "SU01               T" -> action = "SU01", actiontype = "T"
Sub ParseEntryId(ByVal entryId, ByRef action, ByRef actiontype)
    Dim t
    action = ""
    actiontype = ""
    t = RTrim(entryId & "")
    If Len(t) = 0 Then Exit Sub
    actiontype = Right(t, 1)
    action = RTrim(Left(t, Len(t) - 1))
End Sub

' =============================================================================
'  VALUE CONVERSIONS (same rules as zsectools sapImport.js)
' =============================================================================

Function IsAllDigits(ByVal v)
    ' Digit check WITHOUT RegExp: creating a RegExp object for every value was
    ' one of the main slowdowns on large tables (called for every D/T field)
    Dim i, n, ch
    IsAllDigits = False
    n = Len(v)
    If n = 0 Then Exit Function
    For i = 1 To n
        ch = AscW(Mid(v, i, 1))
        If ch < 48 Or ch > 57 Then Exit Function
    Next
    IsAllDigits = True
End Function

' Snap a YYYYMMDD date to the period start used by the SWNC collector:
' M -> 1st day of the month, W -> Monday of that week, D -> unchanged.
Function GetPeriodStart(periodType, dateYmd)
    Dim dte
    dte = DateSerial(CInt(Left(dateYmd, 4)), CInt(Mid(dateYmd, 5, 2)), CInt(Right(dateYmd, 2)))
    If periodType = "M" Then
        dte = DateSerial(Year(dte), Month(dte), 1)
    ElseIf periodType = "W" Then
        dte = DateAdd("d", -(Weekday(dte, vbMonday) - 1), dte)
    End If
    GetPeriodStart = CStr(Year(dte)) & Pad2(Month(dte)) & Pad2(Day(dte))
End Function

' YYYYMMDD -> date string; "" when invalid/empty (same validation rules as
' convertSapDate in zsectools). Output format follows DATE_FORMAT:
' "SAP" = DD.MM.YYYY (SAP GUI display format), "ISO" = YYYY-MM-DD.
' Used ONLY for table DATE fields: statistics selected_at is always ISO
' (see YmdToIsoDate).
Function ConvertSapDate(ByVal v)
    Dim y, m, d
    ConvertSapDate = ""
    If Not IsAllDigits(v) Then Exit Function
    If Len(v) <> 8 Then Exit Function
    If v = "00000000" Then Exit Function
    y = CInt(Left(v, 4))
    m = CInt(Mid(v, 5, 2))
    d = CInt(Right(v, 2))
    ' Same checks, same order as convertSapDate in zsectools: the year cap is
    ' evaluated FIRST, so values like 99991231 (common in TO_DAT columns, e.g.
    ' AGR_USERS) are rejected gracefully as empty - exactly like zsectools.
    ' No DateSerial here: DateSerial(9999, 13, 0) overflows the OLE date range
    ' (max year 9999) and raised "Invalid procedure call".
    If y < 1 Or y > 4714 Then Exit Function
    If m < 1 Or m > 12 Then Exit Function
    If d < 1 Or d > DaysInMonth(y, m) Then Exit Function
    If DATE_FORMAT = "ISO" Then
        ConvertSapDate = y & "-" & Pad2(m) & "-" & Pad2(d)
    Else
        ConvertSapDate = Pad2(d) & "." & Pad2(m) & "." & y
    End If
End Function

' Days in month, pure arithmetic (no Date/DateSerial involved: the OLE date
' type overflows for extreme years like 9999)
Function DaysInMonth(ByVal y, ByVal m)
    Select Case m
        Case 1, 3, 5, 7, 8, 10, 12
            DaysInMonth = 31
        Case 4, 6, 9, 11
            DaysInMonth = 30
        Case 2
            If (y Mod 4 = 0 And y Mod 100 <> 0) Or (y Mod 400 = 0) Then
                DaysInMonth = 29
            Else
                DaysInMonth = 28
            End If
        Case Else
            DaysInMonth = 0
    End Select
End Function

' YYYYMMDD -> YYYY-MM-DD without re-validation (input already normalized by
' GetPeriodStart). zsectools stores selected_at as timestamptz, so the
' statistics file must keep the ISO format regardless of DATE_FORMAT.
Function YmdToIsoDate(ByVal v)
    YmdToIsoDate = Left(v, 4) & "-" & Mid(v, 5, 2) & "-" & Right(v, 2)
End Function

' HHMMSS -> HH:MM:SS; "" when invalid/empty (same as convertSapTime)
Function ConvertSapTime(ByVal v)
    Dim hh, mi, ss
    ConvertSapTime = ""
    If Not IsAllDigits(v) Then Exit Function
    If Len(v) <> 6 Then Exit Function
    If v = "000000" Then Exit Function
    hh = CInt(Left(v, 2))
    mi = CInt(Mid(v, 3, 2))
    ss = CInt(Right(v, 2))
    If hh > 23 Or mi > 59 Or ss > 59 Then Exit Function
    ConvertSapTime = Pad2(hh) & ":" & Pad2(mi) & ":" & Pad2(ss)
End Function

' Packed number validation, same rule as convertSapPacked (^-?\d+(\.\d+)?$)
' but with a plain character loop instead of RegExp (speed)
Function ConvertSapPacked(ByVal v)
    Dim i, n, ch, seenDot, seenDigit
    ConvertSapPacked = ""
    v = Trim(v & "")
    n = Len(v)
    If n = 0 Then Exit Function
    seenDot = False
    seenDigit = False
    For i = 1 To n
        ch = AscW(Mid(v, i, 1))
        If ch >= 48 And ch <= 57 Then
            seenDigit = True
        ElseIf ch = 45 Then            ' minus sign: only as first character
            If i > 1 Then Exit Function
        ElseIf ch = 46 Then            ' decimal point: once, never first/last
            If seenDot Or i = 1 Or i = n Or Not seenDigit Then Exit Function
            seenDot = True
        Else
            Exit Function
        End If
    Next
    If seenDigit Then ConvertSapPacked = v
End Function

Function Pad2(ByVal n)
    If n < 10 Then
        Pad2 = "0" & CStr(n)
    Else
        Pad2 = CStr(n)
    End If
End Function

Function MapTypesArray(ByRef fieldTypes)
    Dim i, outArr()
    ReDim outArr(UBound(fieldTypes))
    For i = 0 To UBound(fieldTypes)
        outArr(i) = MapSapType(fieldTypes(i))
    Next
    MapTypesArray = outArr
End Function

' =============================================================================
'  FILE OUTPUT HELPERS (UTF-8 without BOM, as expected by zsectools import)
' =============================================================================

' Writes a string to a file in UTF-8 WITHOUT BOM (overwrite)
Sub SaveTextFileUtf8NoBom(ByVal filePath, ByVal content)
    Dim stream
    Set stream = CreateObject("ADODB.Stream")
    stream.Type = 2          ' adTypeText
    stream.Charset = "utf-8"
    stream.Open
    stream.WriteText content
    stream.Position = 0
    stream.Type = 1          ' adTypeBinary
    stream.Position = 3      ' skip the UTF-8 BOM
    Dim bytes
    bytes = stream.Read
    stream.Close
    Dim bin
    Set bin = CreateObject("ADODB.Stream")
    bin.Type = 1
    bin.Open
    bin.Write bytes
    bin.SaveToFile filePath, 2 ' adSaveCreateOverWrite
    bin.Close
End Sub