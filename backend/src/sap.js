let rfcClientModule;

// Define the BAPI schemas
export const RFC_SCHEMAS = {
  'RFC_create_composite': {
    name: 'Create Composite Role',
    bapi: 'PRGN_RFC_CREATE_AGR_MULTIPLE',
    requiredFields: ['ACTIVITY_GROUP', 'ACTIVITY_GROUP_TEXT'],
    optionalFields: [],
    description: 'Create a composite SAP role',
    fixedValues: { COLLECTIVE_AGR: 'X' }
  },
  'RFC_create_single': {
    name: 'Create Single Role',
    bapi: 'PRGN_RFC_CREATE_AGR_MULTIPLE',
    requiredFields: ['ACTIVITY_GROUP', 'ACTIVITY_GROUP_TEXT'],
    optionalFields: [],
    description: 'Create a single SAP role',
    fixedValues: {}
  },
    'RFC_add_single_to_composite': {
    name: 'Add Single Role to Composite Role',
    bapi: 'PRGN_RFC_ADD_AGRS_TO_COLL_AGR',
    requiredFields: ['ACTIVITY_GROUP', 'ACTIVITY_GROUPS'],
    optionalFields: [],
    description: 'Add Single Role to Composite Role',
    fixedValues: {},
      tables: {
      'ACTIVITY_GROUPS': 'AGR_NAME'
    }
  },
      'RFC_remove_single_from_composite': {
    name: 'Remove Single Role from Composite Role',
    bapi: 'PRGN_RFC_DEL_AGRS_IN_COLL_AGR',
    requiredFields: ['ACTIVITY_GROUP', 'ACTIVITY_GROUPS'],
    optionalFields: [],
    description: 'Remove Single Role from Composite Role',
    fixedValues: {},
      tables: {
      'ACTIVITY_GROUPS': 'AGR_NAME'
    },
    successIndicator: { field: 'ACTIVITY_GROUPS', nonEmpty: true }
  },
        'RFC_delete_role': {
    name: 'Delete Role',
    bapi: 'PRGN_ACTIVITY_GROUP_DELETE',
    requiredFields: ['ACTIVITY_GROUP'],
    optionalFields: [],
    description: 'Delete Role',
    fixedValues: {ENQUEUE_AND_TRANSPORT: ' ',
                 SHOW_DIALOG: ' '}
  },
        'RFC_add_role_to_user': {
    name: 'Add roles to users',
    bapi: 'PRGN_RFC_CHANGE_USERS_IN_AGRS',
    requiredFields: ['AGR_NAME', 'UNAME', 'FROM_DAT', 'TO_DAT'],
    optionalFields: [],
    description: 'Add roles to users',
    fixedValues: {},
      tables: {
      'ADD_USERS_TO_ACTGROUPS': ['AGR_NAME', 'UNAME', 'FROM_DAT', 'TO_DAT']
    }
  },
        'RFC_del_role_from_user': {
    name: 'Remove roles from users',
    bapi: 'PRGN_RFC_CHANGE_USERS_IN_AGRS',
    requiredFields: ['AGR_NAME', 'UNAME', 'FROM_DAT', 'TO_DAT'],
    optionalFields: [],
    description: 'Remove roles from users',
    fixedValues: {},
    tables: {
      'DELETE_USERS_FROM_ACTGROUPS': ['AGR_NAME', 'UNAME', 'FROM_DAT', 'TO_DAT']
    }
  },
        'RFC_add_tcode_to_role': {
    name: 'Add tansactions to roles',
    bapi: 'PRGN_RFC_ADD_TRANSACTION',
    requiredFields: ['ACTIVITY_GROUP', 'TCODE', 'TEXT_FOR_TCODE'],
    optionalFields: [],
    description: 'Add tansactions to roles',
    fixedValues: { LOWERCASE: 'X' }
  },
        'RFC_del_tcode_from_role': {
    name: 'Remove tansactions from roles',
    bapi: 'PRGN_RFC_DELETE_TRANSACTION',
    requiredFields: ['ACTIVITY_GROUP', 'TCODE'],
    optionalFields: [],
    description: 'Remove tansactions from roles',
    fixedValues: {}
  },
        'RFC_create_user': {
    name: 'Create Users (name attr)',
    bapi: 'BAPI_USER_CREATE',
    requiredFields: ['USERNAME', 'FIRSTNAME', 'LASTNAME', 'USTYP', 'CLASS', 'GLTGV', 'GLTGB', 'BAPIPWD'],
    optionalFields: [],
    description: 'Create Users',
    fixedValues: {},
    structures: {
    'ADDRESS': ['FIRSTNAME', 'LASTNAME'],
    'LOGONDATA': ['USTYP', 'CLASS', 'GLTGV', 'GLTGB'],
    'PASSWORD': ['BAPIPWD']
    }
  },
        'RFC_change_email_user': {
    name: 'Change Users email',
    bapi: 'BAPI_USER_CHANGE',
    requiredFields: ['USERNAME', 'E_MAIL'],
    optionalFields: [],
    description: 'Change Users email',
    fixedValues: {},
    structures: {
    'ADDCOMX': [] //must be specified even if fixed-default value below is used
    },
    structureFixedValues: {
    'ADDCOMX': { 'ADSMTP': 'X' }
  },
    tables: {
      'ADDSMTP': ['E_MAIL']
    }
  },
        'RFC_change_SNC_user': {
    name: 'Change Users SNC string',
    bapi: 'BAPI_USER_CHANGE',
    requiredFields: ['USERNAME', 'PNAME', 'GUIFLAG'],
    optionalFields: [],
    description: 'Change Users SNC string',
    fixedValues: {},
    structures: {
      'SNC': ['PNAME', 'GUIFLAG'],
      'SNCX': [] //must be specified even if fixed-default value below is used
    },
    structureFixedValues: {
      'SNCX': { 'PNAME': 'X',
              'GUIFLAG': 'X'}
    }
  },
        'RFC_reset_password_user': {
    name: 'Reset password Users',
    bapi: 'BAPI_USER_CHANGE',
    requiredFields: ['USERNAME', 'BAPIPWD'], //cant use 'PRODUCTIVE_PWD' anymore. See sap note 2567311
    optionalFields: [],
    description: 'Reset password Users',
    fixedValues: {},
    structures: {
      'PASSWORD': ['BAPIPWD'],
      'PASSWORDX': [] //must be specified even if fixed-default value below is used
    },
    structureFixedValues: {
      'PASSWORDX': { 'BAPIPWD': 'X' }
    }
  }
};

async function loadNodeRfc() {
  if (rfcClientModule !== undefined) {
    return rfcClientModule;
  }

  try {
    const mod = await import('node-rfc');
    rfcClientModule = mod.Client ? mod : mod.default;
  } catch {
    rfcClientModule = null;
  }

  return rfcClientModule;
}

function getSapConfig() {
  return {
    user: process.env.SAP_USER,
    passwd: process.env.SAP_PASSWORD,
    ashost: process.env.SAP_ASHOST,
    sysnr: process.env.SAP_SYSNR,
    client: process.env.SAP_CLIENT,
    lang: process.env.SAP_LANG || 'EN'
  };
}

export function mapRealmToSapConnection(realmConfig) {
  const conn = {
    user: realmConfig.sap_user,
    passwd: realmConfig.sap_password,
    ashost: realmConfig.sap_ashost,
    sysnr: realmConfig.sap_sysnr,
    client: realmConfig.sap_client,
    lang: realmConfig.sap_language || process.env.SAP_LANG || 'EN'
  };

  // Only include saprouter if it has a non-empty value.
  // An empty string would otherwise become the literal string "undefined"
  // and cause NiPGetHostByName to fail.
  const sapRouter = realmConfig.sap_router;
  if (sapRouter != null && sapRouter !== '') {
    conn.saprouter = sapRouter;
  }

  return conn;
}

function validateSapConfig(config) {
  const required = ['user', 'passwd', 'ashost', 'sysnr', 'client'];
  const missing = required.filter((k) => !config[k]);
  return missing;
}

export async function pingSap() {
  const start = Date.now();
  const config = getSapConfig();
  return pingSapWithConfig(config, start);
}

export async function pingSapWithConfig(config, start = Date.now()) {
  const nodeRfc = await loadNodeRfc();
  if (!nodeRfc) {
    return {
      ok: false,
      error: 'node-rfc is not installed or SAP RFC SDK is unavailable in runtime.'
    };
  }

  const missing = validateSapConfig(config);

  if (missing.length) {
    return {
      ok: false,
      error: `Missing SAP environment variables: ${missing.join(', ')}`
    };
  }

  const client = new nodeRfc.Client(config);

  try {
    await client.open();
    const result = await client.call('RFC_PING', { });

    return {
      ok: true,
      latencyMs: Date.now() - start,
      destination: {
        ashost: config.ashost,
        sysnr: config.sysnr,
        client: config.client
      },
      rfcResult: result
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || 'SAP ping failed'
    };
  } finally {
    try {
      await client.close();
    } catch {
      // Ignore close errors in health checks.
    }
  }
}

function parseReadTableRows(readTableResult, delimiter) {
  const fields = readTableResult?.FIELDS || [];
  const dataRows = readTableResult?.DATA || [];
  const fieldNames = fields.map((f) => f.FIELDNAME);

  return {
    fields: fields.map(f => ({
      name: f.FIELDNAME,
      type: f.TYPE,
      length: parseInt(f.LENGTH, 10) || 0,
      offset: parseInt(f.OFFSET, 10) || 0
    })),
    rows: dataRows.map((entry) => {
      const raw = String(entry.WA || '');
      const values = raw.split(delimiter);
      const obj = {};
      for (let i = 0; i < fieldNames.length; i += 1) {
        obj[fieldNames[i]] = (values[i] || '').trim();
      }
      return obj;
    })
  };
}

export async function readSapTable(config, tableName, fieldsToSelect = [], rowskips = 0, rowcount = 10000, options = []) {
  const nodeRfc = await loadNodeRfc();
  if (!nodeRfc) {
    throw new Error('node-rfc is not installed or SAP RFC SDK is unavailable in runtime.');
  }

  const missing = validateSapConfig(config);
  if (missing.length) {
    throw new Error(`Missing SAP configuration values: ${missing.join(', ')}`);
  }

  const delimiter = '|';
  const client = new nodeRfc.Client(config);
  try {
    await client.open();
    
    const rfcOptions = {
      QUERY_TABLE: tableName,
      DELIMITER: delimiter,
      ROWSKIPS: rowskips,
      ROWCOUNT: rowcount,
      OPTIONS: options.map(opt => ({ TEXT: opt }))
    };

    if (fieldsToSelect.length > 0) {
      rfcOptions.FIELDS = fieldsToSelect.map(f => ({ FIELDNAME: f }));
    }

    const result = await client.call('RFC_READ_TABLE', rfcOptions);
    const parsed = parseReadTableRows(result, delimiter);

    return {
      fields: parsed.fields,
      rows: parsed.rows,
      totalCount: result?.TOTALROWS || parsed.rows.length
    };
  } finally {
    try {
      await client.close();
    } catch {
      // Ignore close errors after import.
    }
  }
}

export async function fetchUserStatistics(config, selectedAtIso, periodType = 'D') {
  const nodeRfc = await loadNodeRfc();
  if (!nodeRfc) {
    throw new Error('node-rfc is not installed or SAP RFC SDK is unavailable in runtime.');
  }

  const missing = validateSapConfig(config);
  if (missing.length) {
    throw new Error(`Missing SAP configuration values: ${missing.join(', ')}`);
  }

  // Parse date from YYYY-MM-DD format (date input, no time component).
  const selected = String(selectedAtIso || '').trim();
  const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
  const match = selected.match(datePattern);
  if (!match) {
    throw new Error('Invalid date value. Expected YYYY-MM-DD.');
  }

  const normalizedPeriodType = String(periodType || '').toUpperCase();
  if (!['M', 'D', 'W'].includes(normalizedPeriodType)) {
    throw new Error('Invalid periodType. Allowed values: M, D, W');
  }

  // PERIODSTRT is YYYYMMDD, no time component.
  const [, year, month, day] = match;
  const periodStart = `${year}${month}${day}`;

  const client = new nodeRfc.Client(config);
  try {
    await client.open();
    return await client.call('SWNC_COLLECTOR_GET_AGGREGATES', {
      PERIODTYPE: normalizedPeriodType,
      PERIODSTRT: periodStart,
      COMPONENT: 'TOTAL'
    });
  } finally {
    try {
      await client.close();
    } catch {
      // Ignore close errors after import.
    }
  }
}

// Function to execute a single RFC
export async function executeSingleRFC(sapConfig, rfcCommand, parameters) {
  const schema = RFC_SCHEMAS[rfcCommand];
  if (!schema) {
    throw new Error(`Unknown RFC command: ${rfcCommand}`);
  }

  // required parameters validation
  for (const field of schema.requiredFields) {
    if (parameters[field] === undefined || parameters[field] === null) {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  const nodeRfc = await loadNodeRfc();
  if (!nodeRfc) {
    throw new Error('node-rfc is not installed.');
  }

  const combinedParams = { ...schema.fixedValues };

  //structure handling:
  const fieldsConsumedByStructures = new Set();

  // =========================================================================
  // STRUCTURE NORMALIZER (Added to handle ADDRESS, LOGONDATA, PASSWORD, etc.)
  // =========================================================================
  const allStructureNames = new Set([
    ...Object.keys(schema.structures || {}),
    ...Object.keys(schema.structureFixedValues || {})
  ]);

  for (const structName of allStructureNames) {
    const structRow = {};
    let hasStructData = false;

    // 1. Handling fixed values of the structure
    if (schema.structureFixedValues && schema.structureFixedValues[structName]) {
      for (const [fieldName, fixedVal] of Object.entries(schema.structureFixedValues[structName])) {
        fieldsConsumedByStructures.add(fieldName);
        structRow[fieldName] = fixedVal;
        hasStructData = true;
      }
    }

    // 2. Dynamic field handling (from input parameters)
    const definition = schema.structures ? schema.structures[structName] : null;
    if (Array.isArray(definition)) {
      for (const field of definition) {
        fieldsConsumedByStructures.add(field);

        if (parameters[field] !== undefined && parameters[field] !== null) {
          let val = parameters[field];
          
          // Fix empty dates for structures
          if (typeof val === 'string' && val.trim() === '') {
            if (field.includes('_DAT') || field === 'GLTGV' || field === 'GLTGB') {
              val = '00000000';
            }
          }
          
          structRow[field] = val;
          hasStructData = true;
        }
      }
    }

    // if structure has data (fix or dynamic), assign to combined parameters
    if (hasStructData) {
      combinedParams[structName] = structRow;
    }
  }
  //========================================================================
  //END OF STRUCTURE HANDLING
  //========================================================================
  
  // Keep track of which fields end up in tables so they are NOT copied at root level
  const fieldsConsumedByTables = new Set();

  // =========================================================================
  // TABLE NORMALIZER V6 (with parameter isolation)
  // =========================================================================
  if (schema.tables) {
    for (const [tableName, definition] of Object.entries(schema.tables)) {
      const rawValue = parameters[tableName];

      // CASE A: Complex table (e.g.: ['AGR_NAME', 'UNAME', ...])
      if (Array.isArray(definition)) {
        // Register these fields so we know they belong to a table
        definition.forEach(f => fieldsConsumedByTables.add(f));

        if (Array.isArray(rawValue)) {
          combinedParams[tableName] = rawValue;
        } 
        else {
          const row = {};
          let hasData = false;
          
          for (const field of definition) {
            if (parameters[field] !== undefined && parameters[field] !== null) {
              let val = parameters[field];
              
              // Fix empty dates
              if (typeof val === 'string' && val.trim() === '') {
                if (field.includes('_DAT') || field === 'GLTGV' || field === 'GLTGB') {
                  val = '00000000';
                }
              }
              
              row[field] = val;
              hasData = true;
            }
          }
          
          combinedParams[tableName] = hasData ? [row] : [];
        }
      } 
      // CASE B: Simple table (e.g.: 'ACTIVITY_GROUP')
      else if (typeof definition === 'string') {
        fieldsConsumedByTables.add(definition);
        fieldsConsumedByTables.add(tableName);

        if (rawValue !== undefined && rawValue !== null) {
          if (typeof rawValue === 'string') {
            combinedParams[tableName] = [{ [definition]: rawValue.trim() }];
          } else if (Array.isArray(rawValue) && rawValue.length > 0 && typeof rawValue[0] === 'string') {
            combinedParams[tableName] = rawValue.map(item => ({ [definition]: item.trim() }));
          }
        } else if (parameters[definition] !== undefined) {
          combinedParams[tableName] = [{ [definition]: parameters[definition] }];
        } else {
          combinedParams[tableName] = [];
        }
      }
    }
  }

  // Copy at root level ONLY the parameters that were not absorbed by tables
  for (const [key, value] of Object.entries(parameters)) {
    if (!combinedParams[key] && !fieldsConsumedByTables.has(key) && !fieldsConsumedByStructures.has(key)) {
      combinedParams[key] = value;
    }
  }



  const client = new nodeRfc.Client(sapConfig);

  try {
    await client.open();
    
    const result = await client.call(schema.bapi, combinedParams);

    const sapReturn = result.RETURN !== undefined ? result.RETURN : (result.RESULT !== undefined ? result.RESULT : result.ERRORS);

    // Check whether there are error messages in the RETURN table
    if (sapReturn !== undefined && sapReturn !== null) {
      const returnArray = Array.isArray(sapReturn) ? sapReturn : [sapReturn];
      const getType = r => (r.TYPE ?? r.Type ?? r.type ?? '').toString();
      const getMessage = r => r.MESSAGE || r.Message || r.message || '';

      const errorEntries = returnArray.filter(r => r && ['E', 'A', 'X'].includes(getType(r)));
      if (errorEntries.length > 0) {
        const firstError = errorEntries[0];
        const errorMsg = getMessage(firstError) || `RFC ${rfcCommand} returned error type ${getType(firstError)}`;
        throw new Error(errorMsg);
      }
      // If RETURN empty, check successIndicator in schema
      if (returnArray.length === 0 && schema.successIndicator) {
        const si = schema.successIndicator;
        const indicatorValue = result[si.field];
        const isEmpty = !indicatorValue || (Array.isArray(indicatorValue) && indicatorValue.length === 0);
        if (si.nonEmpty && isEmpty) {
          throw new Error(`RFC ${rfcCommand}: operation had no effect (${si.field} is empty in response)`);
        }
      }

      const successEntries = returnArray.filter(r => r && ['S', 'I', 'W'].includes(getType(r)));
      const successMsg = successEntries.length > 0
        ? (getMessage(successEntries[0]) || `RFC ${rfcCommand} executed successfully`)
        : `RFC ${rfcCommand} executed successfully`;

      try {
        await client.call('BAPI_TRANSACTION_COMMIT', { WAIT: 'X' });
      } catch (commitErr) {
        console.error('[SAP RFC] Error during BAPI_TRANSACTION_COMMIT:', commitErr.message);
      }

      return {
        success: true,
        message: successMsg,
        data: result
      };
    }

    // No RETURN table present: check whether the result is completely empty
    // (possible sign of a silent error on some RFCs)
    const hasAnyData = Object.values(result).some(v =>
      v !== null && v !== undefined && v !== '' &&
      !(Array.isArray(v) && v.length === 0) &&
      !(typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0)
    );

    if (!hasAnyData) {
      throw new Error(`RFC ${rfcCommand} returned empty response (possible silent error)`);
    }

    try {
      await client.call('BAPI_TRANSACTION_COMMIT', { WAIT: 'X' });
    } catch (commitErr) {
      console.error('[SAP RFC] Error during BAPI_TRANSACTION_COMMIT:', commitErr.message);
    }
    
    return { 
      success: true, 
      message: `RFC ${rfcCommand} executed successfully`,
      data: result 
    };
  } catch (err) {
    console.error(`[SAP RFC ERROR] Critical execution error: ${err.message}`);
    throw new Error(`RFC execution failed: ${err.message}`);
  } finally {
    try {
      await client.close();
    } catch { /* ignore */ }
  }
}

// Function to execute an RFC batch

export async function executeBapiBatch(sapConfig, rfcCommand, rows) {
  const results = [];
  for (let i = 0; i < rows.length; i++) {
    try {
      const row = rows[i];
      // Pass the sapConfig to the single execution
      const result = await executeSingleRFC(sapConfig, rfcCommand, row);
      results.push({
        rowIndex: i + 1,
        status: 'success',
        message: result.message,
        data: result.data // Return real data from RFC
      });
    } catch (err) {
      results.push({
        rowIndex: i + 1,
        status: 'error',
        message: err.message,
        data: rows[i]
      });
    }
  }
  return results;
}

// Helper endpoint to get the schema
export function getRfcSchema(rfcCommand) {
  return RFC_SCHEMAS[rfcCommand] || null;
}

export function listAvailableRfcs() {
  return Object.keys(RFC_SCHEMAS).map(key => ({
    id: key,
    name: RFC_SCHEMAS[key].name,
    description: RFC_SCHEMAS[key].description
  }));
}
