// This shows the HTML page in Figma.
figma.showUI(__html__, { width: 1000, height: 700, themeColors: true });

// Create the main object to hold all fetched variable data
let allFetchedVariablesPayload = {
  shared: [] // Array of shared library collections with their variables
};

// Initialize a set to track IDs of imported library variables
let importedLibraryVariableIds = new Set();

// Initialize a map to store library variable key to local ID mappings
let variableKeyToIdMap = new Map();

// Initialize a map to store local ID to library variable key mappings
let variableIdToKeyMap = new Map();

/**
 * Fetches available library variable collections from team libraries
 */
async function fetchSharedCollections() {
  try {
    const libraryCollections = await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync();
    
    // Track errors for summary
    const errorLog = {
      importErrors: [],
      detailErrors: [],
      collectionErrors: []
    };
    
    // Iterate through each library collection
    for (const libraryCollection of libraryCollections) {
      // Store basic metadata for each library collection
      const collectionMetadata = {
        id: libraryCollection.id,
        key: libraryCollection.key,
        name: libraryCollection.name,
        libraryName: libraryCollection.libraryName
      };
      
      // Create the structure for this library collection in allFetchedVariablesPayload.shared
      const sharedCollectionData = {
        id: libraryCollection.id,
        key: libraryCollection.key,
        name: libraryCollection.name,
        libraryName: libraryCollection.libraryName,
        modes: [], // Will be populated later using the proper method
        defaultModeId: null, // Will be populated later
        variables: [] // Initially empty
      };
      
      // Add this collection to the shared array
      allFetchedVariablesPayload.shared.push(sharedCollectionData);
      
      // Get variables in this library collection
      try {
        const libraryVariables = await figma.teamLibrary.getVariablesInLibraryCollectionAsync(libraryCollection.key);
        
        // Count successfully imported variables
        let importedCount = 0;
        let failedCount = 0;
        let detailFailedCount = 0;
        
        // Track if we've fetched mode information for this collection
        let hasCollectionModesInfo = false;
        
        // Iterate through each variable in the collection
        for (const libraryVariable of libraryVariables) {
          // Attempt to import the library variable
          try {
            const importedVariable = await figma.variables.importVariableByKeyAsync(libraryVariable.key);
            
            // Store mappings between library key and local ID
            variableKeyToIdMap.set(libraryVariable.key, importedVariable.id);
            variableIdToKeyMap.set(importedVariable.id, libraryVariable.key);
            
            // Track imported library variable IDs
            importedLibraryVariableIds.add(importedVariable.id);
            
            // **** NEW CODE TO FETCH MODE NAMES ****
            // If we haven't fetched collection modes info yet, do it now using the collection ID from the imported variable
            if (!hasCollectionModesInfo && importedVariable.variableCollectionId) {
              try {
                // Get the full collection details using the ID from the imported variable
                const fullCollection = await figma.variables.getVariableCollectionByIdAsync(importedVariable.variableCollectionId);
                
                if (fullCollection) {
                  // Update modes and defaultModeId in our shared collection data
                  sharedCollectionData.modes = fullCollection.modes.map(mode => ({
                    modeId: mode.modeId,
                    name: mode.name
                  }));
                  sharedCollectionData.defaultModeId = fullCollection.defaultModeId;
                  
                  // Mark that we've fetched this collection's mode info
                  hasCollectionModesInfo = true;
                  
                  console.log(`Successfully fetched modes for collection "${libraryCollection.name}":`, 
                    sharedCollectionData.modes.map(m => `${m.name} (${m.modeId})`).join(', '));
                }
              } catch (modesError) {
                console.error(`Error fetching modes for collection "${libraryCollection.name}": ${modesError.message}`);
              }
            }
            
            // Retrieve full variable object by ID
            try {
              const detailedVariable = await figma.variables.getVariableByIdAsync(importedVariable.id);
              
              // Populate and store detailed shared variable data
              sharedCollectionData.variables.push({
                id: detailedVariable.id,                 // Local ID after import
                originalKey: libraryVariable.key,        // Original library key
                name: detailedVariable.name,
                description: detailedVariable.description,
                resolvedType: detailedVariable.resolvedType,
                valuesByMode: detailedVariable.valuesByMode,
                scopes: detailedVariable.scopes,
                codeSyntax: detailedVariable.codeSyntax,
                remote: true,                            // Mark as remote
                libraryName: libraryCollection.libraryName
              });
              
            } catch (detailError) {
              detailFailedCount++;
              
              // Log and store error information
              const errorInfo = {
                variableName: libraryVariable.name,
                variableKey: libraryVariable.key,
                importedId: importedVariable.id,
                collectionName: libraryCollection.name,
                errorMessage: detailError.message,
                errorPhase: 'detail-retrieval',
                timestamp: new Date().toISOString()
              };
              
              errorLog.detailErrors.push(errorInfo);
              
              // Still store basic information about the variable
              sharedCollectionData.variables.push({
                id: importedVariable.id,
                originalKey: libraryVariable.key,
                name: libraryVariable.name || 'Unknown',
                remote: true,
                libraryName: libraryCollection.libraryName,
                error: {
                  phase: 'detail-retrieval',
                  message: detailError.message
                }
              });
            }
            
            // Increment counter
            importedCount++;
          } catch (importError) {
            failedCount++;
            
            // Log and store error information
            const errorInfo = {
              variableName: libraryVariable.name,
              variableKey: libraryVariable.key,
              collectionName: libraryCollection.name,
              errorMessage: importError.message,
              errorPhase: 'import',
              timestamp: new Date().toISOString()
            };
            
            errorLog.importErrors.push(errorInfo);
          }
        }
        
        // Log summary of imports for this collection
        console.log(`Successfully imported ${importedCount} variables from collection "${libraryCollection.name}"`);
      } catch (variableError) {
        // Log and store error information
        const errorInfo = {
          collectionName: libraryCollection.name,
          collectionKey: libraryCollection.key,
          errorMessage: variableError.message,
          errorPhase: 'collection-variables-fetch',
          timestamp: new Date().toISOString()
        };
        
        errorLog.collectionErrors.push(errorInfo);
      }
    }
    
    // Store error log in the payload for reference
    if (errorLog.importErrors.length > 0 || errorLog.detailErrors.length > 0 || errorLog.collectionErrors.length > 0) {
      allFetchedVariablesPayload.errorLog = errorLog;
    }
    
    return libraryCollections;
  } catch (error) {
    // Add error to payload
    allFetchedVariablesPayload.errorLog = {
      criticalError: {
        phase: 'fetch-shared-collections',
        message: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      }
    };
    
    return [];
  }
}

// Message handler for UI events
figma.ui.onmessage = msg => {
  // Simple message handling - log events but don't take complex actions yet
  console.log("Message from UI:", msg.type);
  
  // Example of responding to a specific message type
  if (msg.type === 'request-info') {
    figma.ui.postMessage({
      type: 'plugin-info',
      payload: {
        version: '1.0',
        status: 'active'
      }
    });
  }
  
  // Handle request to generate DTCG payload
  if (msg.type === 'generate-dtcg') {
    fetchAndLogAllVariables().then(data => {
      const dtcgPayload = convertToDTCGFormat(data);
      figma.ui.postMessage({
        type: 'dtcg-payload',
        payload: dtcgPayload
      });
    });
  }
};

// Simple notification that plugin is ready
figma.ui.postMessage({ 
  type: 'plugin-info',
  payload: {
    message: 'Plugin loaded successfully'
  }
}); 

/**
 * Converts Figma variable data to Design Tokens Community Group (DTCG) format
 * @param {Object} figmaData - The allFetchedVariablesPayload containing shared variables
 * @returns {Object} - Map of collection names to their DTCG formatted payloads
 */
function convertToDTCGFormat(figmaData) {
  console.log('--- Converting to DTCG Format ---');
  
  // Initialize the root DTCG object
  const dtcgPayload = {};
  
  // Map to track Figma variable IDs to their canonical information for alias resolution
  const figmaIdToCanonicalInfoMap = new Map();
  
  // Map to store mode ID to name mappings (globally)
  const globalModeIdToNameMap = new Map();
  
  // PHASE 1: Build the initial hierarchical structure and collect mode names
  
  // First, process shared collections to build the global mode name map
  console.log('Building global mode name map from shared collections...');
  for (const collection of figmaData.shared) {
    if (collection.modes && Array.isArray(collection.modes)) {
      for (const mode of collection.modes) {
        if (mode.modeId && mode.name) {
          globalModeIdToNameMap.set(mode.modeId, mode.name);
        }
      }
    }
  }
  
  // Process all shared collections
  console.log('Building initial DTCG structure...');
  
  // Process shared collections
  for (const collection of figmaData.shared) {
    // Use actual collection name directly as the top-level key (removing library name nesting)
    const collectionKey = sanitizeForDTCG(collection.name);
    
    // Create collection group in the payload
    dtcgPayload[collectionKey] = {};
    
    // Build a map of modeId to modeName for this collection
    const collectionModeIdToNameMap = new Map();
    
    // For collections with modes array, use it directly
    if (collection.modes && Array.isArray(collection.modes)) {
      for (const mode of collection.modes) {
        if (mode.modeId && mode.name) {
          collectionModeIdToNameMap.set(mode.modeId, mode.name);
        }
      }
    }
    
    // Extract unique modeIds from variables and look up names
    if (collection.variables && collection.variables.length > 0) {
      const modeIdsInCollection = new Set();
      
      // Get all unique modeIds used in this collection
      for (const variable of collection.variables) {
        if (variable.valuesByMode) {
          Object.keys(variable.valuesByMode).forEach(modeId => {
            modeIdsInCollection.add(modeId);
          });
        }
      }
      
      // Look up names for these modeIds
      for (const modeId of modeIdsInCollection) {
        // If we already have a name for this modeId within this collection, skip
        if (collectionModeIdToNameMap.has(modeId)) {
          continue;
        }
        
        // Look up in global map from shared collections
        if (globalModeIdToNameMap.has(modeId)) {
          collectionModeIdToNameMap.set(modeId, globalModeIdToNameMap.get(modeId));
        } else {
          // Fallback: create a name based on the modeId
          const generatedName = `mode_${modeId.replace(/:/g, '_')}`;
          collectionModeIdToNameMap.set(modeId, generatedName);
        }
      }
    }
    
    // Process each mode
    for (const [modeId, modeName] of collectionModeIdToNameMap.entries()) {
      // Sanitize mode name for use as a key
      const modeKey = sanitizeForDTCG(modeName);
      
      // Create mode group within collection
      dtcgPayload[collectionKey][modeKey] = {};
      
      // Process variables for this mode
      for (const variable of collection.variables || []) {
        if (!variable.valuesByMode || !(modeId in variable.valuesByMode)) {
          continue;
        }
        
        // Get variable name and split into path segments if it has slashes
        const variableName = variable.name || 'unnamed';
        const pathSegments = variableName.split('/').map(segment => sanitizeForDTCG(segment));
        
        // Get the value for this mode
        const modeValue = variable.valuesByMode[modeId];
        
        // Create the token object
        const tokenObject = {};
        
        // Add description if available
        if (variable.description) {
          tokenObject.$description = variable.description;
        }
        
        // Handle value (direct or alias)
        if (modeValue && modeValue.type === 'VARIABLE_ALIAS') {
          // Store alias information for second pass
          tokenObject._figmaAliasTargetId = modeValue.id;
          tokenObject._isAlias = true;
          tokenObject._currentModeKey = modeKey;
          tokenObject.$value = modeValue.id; // Temporary value
        } else {
          // Handle direct values based on variable type
          tokenObject.$type = mapFigmaTypeToDTCG(variable.resolvedType, variable.scopes);
          tokenObject.$value = convertFigmaValueToDTCG(modeValue, variable.resolvedType);
        }
        
        // Store canonical info for this variable ID using collection key directly (not libraryName.collectionKey)
        figmaIdToCanonicalInfoMap.set(variable.id, {
          collectionKey: collectionKey,
          hierarchicalPathSegments: pathSegments
        });
        
        // Get or create the parent object for this token
        let parentObject = dtcgPayload[collectionKey][modeKey];
        let tokenKey = pathSegments[0];
        
        // For multi-segment names, create the hierarchical structure
        if (pathSegments.length > 1) {
          // The last segment will be the token key
          tokenKey = pathSegments[pathSegments.length - 1];
          
          // Create nested objects for each segment except the last
          for (let i = 0; i < pathSegments.length - 1; i++) {
            const segment = pathSegments[i];
            parentObject[segment] = parentObject[segment] || {};
            parentObject = parentObject[segment];
          }
        }
        
        // Add the token to its parent
        parentObject[tokenKey] = tokenObject;
      }
    }
  }
  
  // PHASE 2: Resolve aliases deeply with collection-prefixed path references
  console.log('Resolving aliases deeply with collection-prefixed paths...');
  
  // Helper function to find a token object by traversing a path
  function findTokenByPath(collectionKey, modeKey, pathSegments) {
    if (!dtcgPayload[collectionKey] || 
        !dtcgPayload[collectionKey][modeKey]) {
      return null;
    }
    
    let current = dtcgPayload[collectionKey][modeKey];
    
    // Navigate through each path segment
    for (const segment of pathSegments) {
      if (!current[segment]) {
        return null;
      }
      current = current[segment];
    }
    
    return current;
  }
  
  // Helper function to resolve an alias to its ultimate target
  function resolveDeepAlias(targetFigmaId, currentModeKey, visitedIds = new Set()) {
    // Check for circular references
    if (visitedIds.has(targetFigmaId)) {
      return { error: 'circular_reference', path: null, type: null };
    }
    
    // Add current ID to visited set for this path
    const newVisited = new Set(visitedIds);
    newVisited.add(targetFigmaId);
    
    // Look up the canonical info for this target
    const targetInfo = figmaIdToCanonicalInfoMap.get(targetFigmaId);
    if (!targetInfo) {
      return { error: 'target_not_found', path: null, type: null };
    }
    
    // Find the token object in the appropriate mode
    const targetToken = findTokenByPath(
      targetInfo.collectionKey,
      currentModeKey,
      targetInfo.hierarchicalPathSegments
    );
    
    if (!targetToken) {
      return { error: 'target_not_available_in_this_mode', path: null, type: null };
    }
    
    // Check if the target is itself an alias
    if (targetToken._isAlias) {
      // Recursively resolve
      return resolveDeepAlias(targetToken._figmaAliasTargetId, currentModeKey, newVisited);
    }
    
    // Target is a direct value - construct collection-prefixed path (no library name)
    const collectionPrefixedPath = [
      targetInfo.collectionKey,
      ...targetInfo.hierarchicalPathSegments
    ].join('.');
    
    return { 
      path: collectionPrefixedPath, 
      type: targetToken.$type
    };
  }
  
  // Find and process all alias tokens
  for (const collectionKey in dtcgPayload) {
    for (const modeKey in dtcgPayload[collectionKey]) {
      processAliasesInObject(dtcgPayload[collectionKey][modeKey], modeKey, collectionKey);
    }
  }
  
  // Recursive function to find and process aliases in nested objects
  function processAliasesInObject(obj, currentModeKey, currentCollectionKey, path = []) {
    for (const key in obj) {
      const value = obj[key];
      
      // If this is an object (potential group or token)
      if (value && typeof value === 'object') {
        // Check if it's a token with an alias
        if (value._isAlias) {
          const resolution = resolveDeepAlias(value._figmaAliasTargetId, currentModeKey);
          
          if (resolution.error) {
            // Handle unresolvable alias
            value.$value = `{UNRESOLVED_ALIAS:${resolution.error}}`;
            value.$type = 'string';
          } else {
            // Set the reference to the ultimate target with collection-prefixed path
            value.$value = `{${resolution.path}}`;
            value.$type = resolution.type;
          }
          
          // Remove temporary properties
          delete value._isAlias;
          delete value._figmaAliasTargetId;
          delete value._currentModeKey;
        } 
        // Continue searching in nested objects if not a direct token
        else if (!('$value' in value)) {
          processAliasesInObject(value, currentModeKey, currentCollectionKey, [...path, key]);
        }
      }
    }
  }
  
  // PHASE 3: Split the combined payload into separate payloads per collection
  console.log('Splitting main DTCG payload into individual collection payloads...');
  
  // Create a map of collection names to their DTCG payloads
  const collectionPayloads = {};
  
  // Extract each collection's payload
  for (const collectionKey in dtcgPayload) {
    // Create a deep clone and nest it under its collection name
    collectionPayloads[collectionKey] = {
      [collectionKey]: JSON.parse(JSON.stringify(dtcgPayload[collectionKey]))
    };
    console.log(`Created individual payload for collection '${collectionKey}'`);
  }
  
  console.log('DTCG conversion complete');
  return collectionPayloads;
}

/**
 * Sanitizes a string for use as a key in DTCG format
 * @param {string} name - Original name
 * @returns {string} - Sanitized name
 */
function sanitizeForDTCG(name) {
  if (!name) return 'unnamed';
  
  // Replace spaces with hyphens and remove invalid characters
  return name
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9\-_]/g, '')
    .toLowerCase();
}

/**
 * Maps Figma variable types to DTCG types
 * @param {string} figmaResolvedType - Figma variable type (e.g., COLOR, FLOAT)
 * @returns {string} - DTCG type
 */
function mapFigmaTypeToDTCG(figmaResolvedType, variableScopes = []) {
  if (!figmaResolvedType) return 'string'; // Default for safety

  // Handle COLOR type
  if (figmaResolvedType === 'COLOR') {
    return 'color';
  }

  // Handle BOOLEAN type
  if (figmaResolvedType === 'BOOLEAN') {
    return 'string'; // DTCG doesn't have a native boolean; will be "true" or "false"
  }

  // Handle STRING type
  if (figmaResolvedType === 'STRING') {
    if (variableScopes.includes('FONT_FAMILY')) {
      return 'fontFamily';
    }
    // For string-based font weights like "Bold", "Regular"
    if (variableScopes.includes('FONT_WEIGHT')) {
      return 'fontWeight';
    }
    return 'string';
  }

  // Handle FLOAT type (Figma's representation for numbers)
  if (figmaResolvedType === 'FLOAT') {
    // For number-based font weights like 400, 700
    if (variableScopes.includes('FONT_WEIGHT')) {
      return 'fontWeight';
    }

    // Check for scopes that imply a dimension
    const dimensionScopes = [
      'FONT_SIZE', 'WIDTH_HEIGHT', 'GAP', 'CORNER_RADIUS', 'BORDER_WIDTH',
      'LINE_HEIGHT', 'LETTER_SPACING', 'SPACING',
      'PADDING_TOP', 'PADDING_RIGHT', 'PADDING_BOTTOM', 'PADDING_LEFT',
      'MARGIN_TOP', 'MARGIN_RIGHT', 'MARGIN_BOTTOM', 'MARGIN_LEFT',
      'MIN_WIDTH', 'MAX_WIDTH', 'MIN_HEIGHT', 'MAX_HEIGHT'
    ];
    if (dimensionScopes.some(scope => variableScopes.includes(scope))) {
      return 'dimension';
    }
    
    // Default for FLOAT if not a fontWeight or dimension
    return 'number';
  }

  // Fallback for any other unknown figmaResolvedType
  return 'string';
}

/**
 * Converts Figma variable values to DTCG format
 * @param {*} value - Figma variable value
 * @param {string} figmaType - Figma variable type
 * @returns {*} - DTCG formatted value
 */
function convertFigmaValueToDTCG(value, figmaType) {
  if (value === undefined || value === null) return '';
  
  switch (figmaType) {
    case 'COLOR':
      // Figma colors are usually {r, g, b, a} objects with values from 0-1
      if (value && typeof value === 'object' && 'r' in value) {
        return {
          colorSpace: 'srgb',
          components: [
            parseFloat(value.r.toFixed(4)),
            parseFloat(value.g.toFixed(4)),
            parseFloat(value.b.toFixed(4))
          ],
          alpha: 'a' in value ? parseFloat(value.a.toFixed(4)) : 1
        };
      }
      return value;
      
    case 'BOOLEAN':
      return String(value);
      
    case 'FLOAT':
    case 'NUMBER':
    case 'INTEGER':
      // Ensure numeric values are actually numbers
      if (typeof value === 'string') {
        return parseFloat(value) || 0;
      }
      return typeof value === 'number' ? value : 0;
      
    case 'STRING':
      // Ensure string values are actually strings
      return String(value);
      
    default:
      return value;
  }
}

/**
 * Main orchestration function to fetch and process all variables
 */
async function fetchAndLogAllVariables() {
  try {
    // Fetch shared (team library) variables - this is the only source of variables now
    await fetchSharedCollections();
    
    // Convert fetched variables to DTCG format
    console.log('--- Converting to DTCG Format ---');
    const collectionPayloads = convertToDTCGFormat(allFetchedVariablesPayload);
    
    // Log individual collection payloads instead of one massive payload
    console.log('--- Individual Collection DTCG Payloads ---');
    for (const collectionName in collectionPayloads) {
      console.log(`Collection: ${collectionName}`);
      console.log(JSON.stringify(collectionPayloads[collectionName], null, 2));
      console.log('----------------------------');
    }
    
    console.log('--- DTCG Conversion Complete ---');
    
    // End of orchestration function
    return {
      raw: allFetchedVariablesPayload,
      dtcg: collectionPayloads
    };
  } catch (error) {
    // Add error to payload if it exists
    if (!allFetchedVariablesPayload.errorLog) {
      allFetchedVariablesPayload.errorLog = {};
    }
    
    allFetchedVariablesPayload.errorLog.orchestrationError = {
      phase: 'fetchAndLogAllVariables',
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    };
    
    return allFetchedVariablesPayload;
  }
}

// Trigger fetchAndLogAllVariables at the global level
// This ensures the entire fetching and logging process executes when the plugin runs
fetchAndLogAllVariables().then(result => {
  // Execution completed
});