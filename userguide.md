# ZSecTools User Guide

## Table of Contents

- [Introduction](#introduction)
- [SAP Realms](#sap-realms)
- [Import SAP Tables](#import-sap-tables)
- [Reports](#reports)
- [RFC Execution](#rfc-execution)
- [SOD & Audit](#sod--audit)
- [Coverage](#coverage)
- [Settings](#settings)
  - [General](#general)
  - [Health Checks](#health-checks)
- [Technical Connection Information](#technical-connection-information)
  - [User ID and Connection](user-id-and-connection)
  - [Authorizations](#authorizations)
- [Extraction Information](#extraction-information)

## Introduction

ZSecTools is a browser-based application for SAP security administration and Segregation of Duties (SOD) analysis. It connects to one or more SAP systems via RFC, lets you import and manage authorization-related data, run mass administration tasks (such as batch RFC execution for users and roles), and perform SOD risk analysis against a configurable rule matrix.

The application is organized into sections, accessible from the side panel: **SAP Realms**, **Import SAP Tables**, **Reports**, **RFC Execution**, **SOD & Audit**, **Coverage**, and **Settings** (which includes **Health Checks**). In the side panel, all section buttons are disabled until an active SAP Realm is selected, with the exception of **SAP Realms** and **Settings**, which are always available

## SAP Realms

A "Realm" represents a single SAP system you want to connect to. In this section you can create, edit, and delete as many realms as you need, each with its own connection details (application server, system number, client, credentials, and language).

Always verify that the machine running the backend can reach the SAP system referenced by the selected realm — you can confirm this with an RFC ping by using the **Test connection (RFCPING)** button.

Selecting an active realm here is **mandatory** to use every other section of the application.

Please also pay attention to **Realm reference date** field: it should match the SAP tables download date, because it will be used as a reference for calculating users and roles validity.
> **Note**: Users and roles validity is calculated using **Build additional infos** (see [Import SAP Tables](#import-sap-tables)): remember to update it if you are using an already existing realm to import SAP tables multiple times on different days!

## Import SAP Tables

This section lets you download the SAP tables that the application relies on, directly from the currently selected realm.

The list of tables that can be downloaded is controlled by the `SAP-TABLE-LIST.txt` configuration file in the project root. You can edit this file to add or remove tables according to your needs. From the UI, you can then select or deselect, on each run, which of the listed tables to actually download.

For most of the application's features to work correctly, it is recommended to download at least the default tables listed in `SAP-TABLE-LIST.txt`, with the exception of the `RSEC*` tables (specific to SAP BW) and `TBTCP` / `TBTCO`, which are optional and only relevant for specific use cases.

Buttons available in this section:

- **Download selected Tables from SAP**: downloads the currently selected tables from the active SAP realm and stores them locally.
- **Export TXT**: exports the locally stored tables as `.txt` files, useful for backup or for transferring data between environments without a direct SAP connection.
- **Import TXT**: imports previously exported `.txt` table files back into the local database.
- **Select All / Deselect All**: quickly select or deselect every table in the list.
- **Build additional infos**: builds internal helper tables that several features of the application depend on, most notably the [Reports](#reports) section. This button should be run after downloading the relevant SAP tables and, ideally, after downloading user statistics as well.
- **Download Statistics / Export Statistics TXT / Import Statistics TXT**: equivalent download/export/import actions, but for SAP user usage statistics rather than table data.

## Reports

This section provides a collection of ready-to-use reports. Some of them mirror reports available from the SAP `SUIM` transaction, while others are additional reports built specifically for this application, not directly available in standard SAP transactions.

Reports are generated from the locally imported tables (see [Import SAP Tables](#import-sap-tables)), so make sure the relevant tables — and, where needed, the additional infos — have been downloaded and built beforehand.

Select a report from dropdown menu (reports content is self-explanatory), run it with button **Execute query**, wait for results, and then you can export to a CSV file.

## RFC Execution

This section allows you to run mass operations against SAP, such as bulk user or role changes, by executing the same RFC call repeatedly for a list of input rows.

The application expects a **tab-separated CSV file** as input. The exact column layout expected depends on the RFC action you select from the dropdown menu: once you pick an action, the application displays the required field layout directly in the UI, so you always know which columns your CSV file needs to contain before uploading it.

After uploading the file and reviewing the preview, click **Execute RFC Batch** to run the operation against every row of the input file. The application reports execution results per row, including any errors encountered.

When uploading an input file, the application checks the first line (header) match the **Required fields** schema (and if not, it refuses to upload it); please copy-paste this for creating header in input file, do not consider the example below in which every header is modified in order to make it more explanatory. **Example** box shows for each RFC Command the expected data values (such as datefrom-dateto that should be YYYYMMDD).

## SOD & Audit

This section allows you to run Segregation of Duties (SOD) analysis and SAP security audits using a configurable risk matrix.

An example matrix is provided in the `sodMatrixExample.zip` file in the project root. Its main purpose is to document the exact file layout the application expects when importing a rule matrix — the format is closely modeled on the one used by SAP GRC Access Control (on-premise).

The section is organized into the following panels:

### Rule Matrix

- **Ruleset dropdown**: selects which ruleset (rule matrix) is currently active for the analysis.
- **Import**: imports a rule matrix from files matching the expected layout (see `sodMatrixExample.zip`) into the selected ruleset.
- **Export**: exports the currently selected ruleset back to files in the same layout.
- **Delete Ruleset**: deletes the currently selected ruleset and all of its rules.
- **Delete SOD (All)**: deletes all SOD-related data (every ruleset and every rule) from the application.

### Analysis Selection and Run

- **Element Type / Element ID**: select whether you want to analyze users or roles, and which specific element(s) to include.
- **Add element**: adds the selected element(s) to the list of elements to be analyzed.
- **Analysis Level**: selects the depth of the analysis to be performed.
- **Run Analysis**: runs the SOD analysis against the elements added so far, using the currently selected ruleset.

### Results Preview & Export

- **Refresh**: reloads the results table with the latest analysis output.
- **Export results**: exports the analysis results to a CSV file.

### Selected Elements

- **Clear elements**: removes all elements currently queued for analysis, letting you start a new selection from scratch.

The typical workflow for this section is: import the rule matrix, select the ruleset to use, add the elements you want to analyze with **Add element**, run the analysis with **Run Analysis**, then review and export the results.

## Coverage

The **Coverage Analysis** section allows you to evaluate role assignments against actual transaction usage. This helps identify over-allocated roles, missing access, or required security adjustments for analyzed users.

### Overview & Core Logic

This analysis is specifically tailored for business users. Therefore, **only transactions explicitly present in role menus are evaluated**; any access granted via ranges or wildcards in the `S_TCODE` authorization object is intentionally excluded.

The analysis follows this workflow:
1. **Define Users**: Specify the targeted users to analyze.
2. **Define Role Assignments**: Load or import the candidate role-to-user mappings to test.
3. **Fetch Usage Data**: The system retrieves historical transaction execution statistics for each user.
4. **Evaluate Proposed Coverage**: Checks if executed transactions are covered by the candidate role mappings provided in Step 2.
5. **Evaluate As-Is Coverage**: Checks if executed transactions are covered by the user's current ("as-is") role assignments in the database.
6. **Generate Results**: Outputs the final coverage matrix for comparison.

---

### Understanding Analysis Results

While most coverage statuses are self-explanatory, note the following key states:

* **`01-COVERED`**: The transaction is covered by the proposed role assignments.
* **`02-MISSING`**: The transaction is **not** covered by the proposed role assignments, but it **is** covered by the user's current ("as-is") roles. Removing these roles would result in lost access for actively used transactions.
* **`03-EXTRA`**: The proposed roles grant access to transactions that the user has never executed in the retrieved usage statistics.
* **`04-ALREADY-MISSING`**: The executed transaction is covered neither by the proposed roles nor by the user's current ("as-is") role assignments. This indicates one of two scenarios:
  * The transaction assignment was revoked from the user between the start of the collected usage period and the execution of this analysis.
  * The transaction access is currently granted via range or wildcard values in `S_TCODE` rather than an explicit menu entry.

> **Note**: If you run an analysis using the actual current assignments (e.g., loaded via **Get as-is roles from DB**), you should expect **no `02-MISSING` status** in the results—only `COVERED` or `ALREADY-MISSING`.

---

### 1. Users to Analyze Panel

Define the scope of users you wish to include in the coverage check.

* **User ID Input**: Input a specific User ID or use SQL wildcards (`%` and `_`) to select multiple users (e.g., `ZTEST%`).
* **Add user**: Executes a search/filter and adds matching users to the analysis queue.
* **Upload CSV/TSV File**: Select a local CSV, TSV, or TXT file containing user data to load.
* **Import users**: Uploads and imports the selected user file into the temporary analysis buffer (expected fields: userid,firstName,lastName).
* **Export users**: Downloads a CSV file containing the currently loaded list of users to analyze.
* **Clear**: Clears all loaded users from the current workspace.

---

### 2. Role Assignments Panel

Manage the roles assigned to the targeted users for comparison.

* **Get as-is roles from DB**: Automatically populates existing role assignments for the targeted users directly from the DB.
* **Upload CSV/TSV File**: Select a local file containing user-to-role mappings.
* **Import roles**: Uploads and imports the role assignments file into the temporary buffer (expected fields: userid,agr_name,agr_description).
* **Export roles**: Downloads a CSV file containing all currently active role assignments in the buffer.
* **Clear**: Clears all loaded role assignments from the workspace.

---

### 3. Results Panel

Run the analysis and review the coverage metrics.

* **Run Coverage Analysis**: Triggers the background processing engine to evaluate transaction logs against role definitions for all loaded users.
* **Refresh**: Reloads the results table view with the latest status from the backend (usually not necessary).
* **Export CSV**: Exports the full coverage results matrix into a formatted CSV file.

#### Coverage Result Indicators
The analysis classifies results into distinct status categories for quick review: see [Understanding Analysis Results](#understanding-analysis-results)

## Settings

The Settings section groups application-level configuration and diagnostics. It is organized into two sub-sections: **General** and **Health Checks**.

### General

Work in progress. General application settings (such as appearance/theme options) will be available here in a future release.

### Health Checks

This section lets you verify that the application's prerequisites are correctly installed and working: backend availability, database connectivity, and the SAP NW RFC SDK setup. You can also save the SDK path here, which is persisted in the database and applied automatically on backend startup. Please restart application if on Windows (no needs in Linux or Docker container). Keep in mind you still need to use Linux SAP SDK with Docker running on Windows.

Before running an SAP connectivity check (`RFCPING`), select an active realm in the [SAP Realms](#sap-realms) section. The ping check verifies that the machine running the backend can actually reach the selected SAP system over the network and that the provided credentials are valid.

---

## Technical Connection Information

### User ID and Connection

The program uses the standard SAP library (`sapnco.dll` or `sapnco.so`) which provides the classes necessary for developing interface programs (RFC connections) in a Windows/Linux environment.

The default connection occurs on port `36[SID]` via RFC (this is a standard SAP behavior, you cannot change it).

For RFC calls, it is necessary to provide the program with the credentials of a valid user (interactive mode is not required), therefore one of the following SAP user types: **B (System)** or **A (Dialog)** or **S (Service)**. User type **B (System)** is recommended.

Type **C (Communication)** is not applicable as the classes dedicated to self-service password changes are not available.

### Authorizations

The connection user must have the following minimum authorizations assigned, please consider anyway to use `ZSECTOOLS.SAP` role as it has been fully tested. The following list is for documentation only proposals:

**Object 1: S_RFC**
- **ACTVT:** 16
- **RFC_NAME:**
  - DDIF_FIELDINFO_GET
  - RFCPING
  - RFC_FUNCTION_SEARCH
  - RFC_METADATA_GET
  - RFC_READ_TABLE
  - SWNC_COLLECTOR_GET_AGGREGATES
- **RFC_TYPE:** *

**Object 2: S_TABU_DIS**
- **ACTVT:** 03
- **DICBERCLS:**
  - &NC&
  - BWC
  - FC01
  - MCOR
  - PA
  - PC
  - SA
  - SC
  - SPWD
  - SS

**Object 3: S_TABU_NAM**
- **ACTVT:** 03
- **TABLE:** (see next point [Extraction Information](#extraction-information)). In our case, all values listed in the first column "Table" should be entered in this authorization field (at least mandatory ones).

**Object 4: S_TOOLS_EX**
- **AUTH:** S_TOOLS_EX_A

## Extraction Information

The tables extracted by the program are as follows (this list may change in future releases):

| Table | Table Group | Table Description | Mandatory |
|-------|-------------|-------------------|-----------|
| AGR_DEFINE | SS | Role definition | YES |
| AGR_AGRS | SS | Roles in Composite Roles | YES |
| AGR_1250 | SS | Authorization data for the activity group | YES |
| AGR_1251 | SS | Authorization data for the activity group | YES |
| AGR_1252 | SS | Organizational elements for authorizations | YES |
| AGR_1016 | SS | Current Subprofiles for Single Roles | YES |
| AGR_TEXTS | SS | File Structure for Hierarchical Menu - Customer | YES |
| AGR_TCODES | SS | Assignment of roles to Tcodes | YES |
| AGR_FLAGS | SS | Role attributes | YES |
| AGR_HIER | SS | Table for Structure Information for Menu | YES |
| AGR_HIERT | SS | Role menu texts | YES |
| AGR_USERS | SS | Assignment of roles to users | YES |
| AGR_DATEU | SC | Personal settings for roles | YES |
| AGR_TIME | SS | Time Stamp for Role (Menu, Profile, Authorizations) | YES |
| AGR_LSD |  | Role attributes | YES |
| AGR_BUFFI | SS | Internet Links for a Role | YES |
| ADCP | SA | Person/Address Assignment (Business Address Services) | YES |
| ADR6 | SA | E-Mail Addresses (Business Address Services) | YES |
| ADRP | SA | Persons (Business Address Services) | YES |
| DF14L | SS | Application Components | NO |
| DF14T | SS | Business Application Component Names | NO |
| HRP1000 | SC | Infotype 1000 DB Table | NO |
| HRP1001 | SC | Infotype 1001 DB Table | NO |
| TADIR | SS | Directory of Repository Objects | YES |
| TBTCO | SC | Job Status Overview Table | NO |
| TBTCP | SC | Background Job Step Overview | NO |
| TDEVC | SS | Packages | YES |
| USORG | SS | Org. levels for profile generator | YES |
| USORG_DB |  | Generated Table for View | YES |
| USVART | SS | Possible authorization fields as variables | YES |
| USR01 | SC | User master record (runtime data) | YES |
| USR02 | SPWD | Logon Data (Kernel-Side Use) | YES |
| USREFUS |  | Reference user for internet applications | YES |
| UST04 | SA | User masters | YES |
| UST10S | SS | User master: Single profiles | YES |
| UST10C | SS | User master: Composite profiles | YES |
| UST12 | SS | User master: Authorizations | YES |
| USR21 | SA | User Name/Address Key Assignment | YES |
| USGRP | SC | User Groups | YES |
| USGRPT | SC | Text table for USGRP (User groups) | YES |
| USGRP_USER |  | Assignment of Users to User Groups | YES |
| USR06 | SA | Additional Data per User | YES |
| PA0001 | PA | HR Master Record: Infotype 0001 (Org. Assignment) | NO |
| PA0002 | PA | HR Master Record: Infotype 0002 (Personal Data) | NO |
| PA0105 | PA | HR Master Record: Infotype 0105 (Communications) | NO |
| T001 | FC01 | Company Codes | YES |
| T001W | MCOR | Plants/Branches | YES |
| T777P | PC | Plan Versions | YES |
| T778P | PC | Plan Versions | YES |
| TOBJ | SS | Authorization Objects | YES |
| TOBJT | SS | Short Texts for Authorization Objects | YES |
| TSTC | SS | SAP Transaction Codes | YES |
| TSTCT | SS | Transaction Code Texts | YES |
| TSTCP | SS | Parameters for Transactions | YES |
| USOBT_C | SC | Relation Transaction > Auth. Object (Customer) | NO |
| USOBX_C | SC | Check Table for Table USOBT_C | NO |
| RSECHIE |  | Status of Authorization Hierarchies | NO (BW only) |
| RSECHIE_STRING |  | Status of Authorization Hierarchies | NO (BW only) |
| RSECTXT | BWC | Authorization Texts | NO (BW only) |
| RSECVAL |  | Authorization Value Status | NO (BW only) |
| RSECVAL_STRING |  | Authorization Value Status | NO (BW only) |
| RSECBIAU |  | Header Table for TLOGO BI Authorization BIAU | NO (BW only) |
| RSECUSERAUTH |  | BI AS Authorizations: Assignment of User Auth | NO (BW only) |
| RSECUSERAUTH_CL |  | BI AS Authorizations: Assignment of User Auth (Change Log) | NO (BW only) |
| RSECHIE_CL |  | Authorization Hierarchies Changes Change Log | NO (BW only) |
| RSECTXT_CL |  | Change Documents for Document Texts | NO (BW only) |
| RSECVAL_CL |  | Authorization Value Change (Change Log) | NO (BW only) |

Access to these tables occurs in **read-only mode** via the standard SAP function module `RFC_READ_TABLE`.

Additionally, **daily, weekly or monthly aggregated usage statistics** are extracted, whose database can be accessed in SAP via transaction `ST03N` (function module `SWNC_COLLECTOR_GET_AGGREGATES`).

**Non-mandatory tables** are not necessary for analysis purposes and could be extracted only for specific needs.
