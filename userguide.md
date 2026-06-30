# ZSecTools User Guide

## Table of Contents

- [Introduction](#introduction)
- [Health Checks](#health-checks)
- [SAP Realms](#sap-realms)
- [Import SAP Tables](#import-sap-tables)
- [Reports](#reports)
- [RFC Execution](#rfc-execution)
- [SOD & Audit](#sod--audit)

## Introduction

ZSecTools is a browser-based application for SAP security administration and Segregation of Duties (SOD) analysis. It connects to one or more SAP systems via RFC, lets you import and manage authorization-related data, run mass administration tasks (such as batch RFC execution for users and roles), and perform SOD risk analysis against a configurable rule matrix.

The application is organized into sections, accessible from the side panel: **Health Checks**, **SAP Realms**, **Import SAP Tables**, **Reports**, **RFC Execution**, and **SOD & Audit**. With the exception of Health Checks and SAP Realms, every section requires an active SAP Realm to be selected first.

## Health Checks

This section lets you verify that the application's prerequisites are correctly installed and working: backend availability, database connectivity, and the SAP NW RFC SDK setup. You can also save the SDK path here, which is persisted in the database and applied automatically on backend startup. Please restart application if on Windows (no needs in Linux or Docker container). Keep in mind you still need to use Linux SAP SDK with Docker running on Windows.

Before running an SAP connectivity check (`RFCPING`), select an active realm in the [SAP Realms](#sap-realms) section. The ping check verifies that the machine running the backend can actually reach the selected SAP system over the network and that the provided credentials are valid.

## SAP Realms

A "Realm" represents a single SAP system you want to connect to. In this section you can create, edit, and delete as many realms as you need, each with its own connection details (application server, system number, client, credentials, and language).

Always verify that the machine running the backend can reach the SAP system referenced by the selected realm — you can confirm this with an RFC ping from the [Health Checks](#health-checks) section.

Selecting an active realm here is **mandatory** to use every other section of the application (Import SAP Tables, Reports, RFC Execution, SOD & Audit).

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

## RFC Execution

This section allows you to run mass operations against SAP, such as bulk user or role changes, by executing the same RFC call repeatedly for a list of input rows.

The application expects a **tab-separated CSV file** as input. The exact column layout expected depends on the RFC action you select from the dropdown menu: once you pick an action, the application displays the required field layout directly in the UI, so you always know which columns your CSV file needs to contain before uploading it.

After uploading the file and reviewing the preview, click **Execute RFC Batch** to run the operation against every row of the input file. The application reports execution results per row, including any errors encountered.

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
