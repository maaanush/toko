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
      try {
        const dtcgPayload = convertToDTCGFormat(data);
        figma.ui.postMessage({
          type: 'dtcgPayload', 
          payload: dtcgPayload
        });
      } catch (error) {
        console.error("Error converting to DTCG format:", error);
        // Send test data if conversion fails
        sendTestPayload();
      }
    }).catch(error => {
      console.error("Error fetching variables:", error);
      // Send test data if fetching fails
      sendTestPayload();
    });
  }
};

// Function to send a test payload for development purposes
function sendTestPayload() {
  // This is a simple test payload that matches the structure expected by the UI
  const testPayload = {
    "scales": {
      "mode-1": {
        "0": {
          "$type": "number",
          "$value": 0
        },
        "1": {
          "$type": "number",
          "$value": 4
        },
        "2": {
          "$type": "number",
          "$value": 8
        },
        "3": {
          "$type": "number",
          "$value": 12
        },
        "4": {
          "$type": "number",
          "$value": 16
        },
        "5": {
          "$type": "number",
          "$value": 20
        },
        "6": {
          "$type": "number",
          "$value": 24
        }
      }
    }
  };
  
  figma.ui.postMessage({
    type: 'dtcgPayload',
    payload: testPayload
  });
}

// Simple notification that plugin is ready
figma.ui.postMessage({ 
  type: 'plugin-info',
  payload: {
    message: 'Plugin loaded successfully'
  }
}); 

// Send a simplified DTCG payload directly from the raw variable data
fetchAndLogAllVariables().then(data => {
  try {
    // Instead of using convertToDTCGFormat which has errors,
    // create a simplified direct DTCG payload
    const simplifiedPayload = createSimplifiedDTCGPayload(data);
    
    // Send the simplified payload to the UI
    figma.ui.postMessage({
      type: 'dtcgPayload',
      payload: simplifiedPayload
    });
  } catch (error) {
    console.error("Error creating simplified DTCG payload:", error);
    sendTestPayload();
  }
}).catch(error => {
  console.error("Error fetching variables:", error);
  sendTestPayload();
});

/**
 * Creates a simplified DTCG payload directly from Figma variables
 * without using the complex conversion logic that's causing errors
 */
function createSimplifiedDTCGPayload(figmaData) {
  const dtcgPayload = {};
  
  // Map to track Figma variable IDs to their canonical paths for alias resolution
  const variableIdToPathMap = new Map();
  
  // First pass: collect all variable IDs and their paths
  // Process local variables
  if (figmaData.local) {
    figmaData.local.forEach(collection => {
      if (!collection || !collection.name || !collection.variables) return;
      
      const collectionKey = sanitizeForDTCG(collection.name);
      
      collection.variables.forEach(variable => {
        if (!variable || !variable.name || !variable.id) return;
        
        // Split variable name by slashes to create hierarchical structure
        const variablePathSegments = variable.name.split('/').map(segment => sanitizeForDTCG(segment));
        
        // Store path for this variable ID
        variableIdToPathMap.set(variable.id, {
          collectionKey,
          path: variablePathSegments
        });
      });
    });
  }
  
  // Process shared variables
  if (figmaData.shared && figmaData.shared.length > 0) {
    figmaData.shared.forEach(sharedCollection => {
      if (!sharedCollection || !sharedCollection.name || !sharedCollection.variables) return;
      
      const collectionKey = sanitizeForDTCG(sharedCollection.name);
      
      sharedCollection.variables.forEach(variable => {
        if (!variable || !variable.name || !variable.id) return;
        
        // Split variable name by slashes to create hierarchical structure
        const variablePathSegments = variable.name.split('/').map(segment => sanitizeForDTCG(segment));
        
        // Store path for this variable ID
        variableIdToPathMap.set(variable.id, {
          collectionKey,
          path: variablePathSegments
        });
      });
    });
  }
  
  // Helper function to resolve variable aliases to paths
  function resolveVariableAlias(aliasId) {
    const info = variableIdToPathMap.get(aliasId);
    if (!info) return `{${aliasId}}`; // Fallback if not found
    
    // Construct a path reference like {collectionName.segment1.segment2}
    return `{${[info.collectionKey, ...info.path].join('.')}}`;
  }
  
  // Second pass: build the actual payload
  // Process the local variables
  if (figmaData.local) {
    // Get collections first
    const collections = {};
    
    figmaData.local.forEach(collection => {
      if (!collection || !collection.name) return;
      
      // Initialize this collection in our payload
      const collectionKey = sanitizeForDTCG(collection.name);
      collections[collectionKey] = {};
      
      // Add modes to this collection
      if (collection.modes && collection.modes.length > 0) {
        collection.modes.forEach(mode => {
          if (!mode || !mode.name) return;
          
          // Initialize this mode in our collection
          const modeKey = sanitizeForDTCG(mode.name);
          collections[collectionKey][modeKey] = {};
        });
      } else {
        // If no modes, create a default mode
        collections[collectionKey]['mode-1'] = {};
      }
    });
    
    // Now add variables to their respective collections and modes
    figmaData.local.forEach(collection => {
      if (!collection || !collection.name || !collection.variables) return;
      
      const collectionKey = sanitizeForDTCG(collection.name);
      
      collection.variables.forEach(variable => {
        if (!variable || !variable.name || !variable.valuesByMode) return;
        
        // Split variable name by slashes to create hierarchical structure
        const variablePathSegments = variable.name.split('/').map(segment => sanitizeForDTCG(segment));
        
        // For each mode this variable has values in
        Object.entries(variable.valuesByMode).forEach(([modeId, value]) => {
          // Find the mode name for this modeId
          let modeName = 'mode-1'; // Default
          if (collection.modes) {
            const mode = collection.modes.find(m => m.modeId === modeId);
            if (mode && mode.name) {
              modeName = sanitizeForDTCG(mode.name);
            }
          }
          
          // Ensure this mode exists in the collection
          if (!collections[collectionKey][modeName]) {
            collections[collectionKey][modeName] = {};
          }
          
          // Start at the mode level
          let currentObject = collections[collectionKey][modeName];
          
          // Create nested structure for path segments (except the last one)
          for (let i = 0; i < variablePathSegments.length - 1; i++) {
            const segment = variablePathSegments[i];
            currentObject[segment] = currentObject[segment] || {};
            currentObject = currentObject[segment];
          }
          
          // The last segment is the variable name
          const variableKey = variablePathSegments[variablePathSegments.length - 1];
          
          // Process the value - handle aliases specially
          let processedValue = value;
          if (value && typeof value === 'object' && value.type === 'VARIABLE_ALIAS' && value.id) {
            // Convert alias to a proper reference string
            processedValue = resolveVariableAlias(value.id);
          }
          
          // Add the variable value to the appropriate level
          currentObject[variableKey] = {
            $type: mapFigmaTypeToDTCG(variable.resolvedType),
            $value: convertFigmaValueToDTCG(processedValue, variable.resolvedType)
          };
        });
      });
    });
    
    // Add collections to the payload
    Object.assign(dtcgPayload, collections);
  }
  
  // Process shared collections as well if they exist
  if (figmaData.shared && figmaData.shared.length > 0) {
    figmaData.shared.forEach(sharedCollection => {
      if (!sharedCollection || !sharedCollection.name) return;
      
      const collectionKey = sanitizeForDTCG(sharedCollection.name);
      dtcgPayload[collectionKey] = {};
      
      // Add modes
      if (sharedCollection.modes && sharedCollection.modes.length > 0) {
        sharedCollection.modes.forEach(mode => {
          if (!mode || !mode.name) return;
          
          const modeKey = sanitizeForDTCG(mode.name);
          dtcgPayload[collectionKey][modeKey] = {};
        });
      } else {
        // Default mode
        dtcgPayload[collectionKey]['mode-1'] = {};
      }
      
      // Add variables
      if (sharedCollection.variables && sharedCollection.variables.length > 0) {
        sharedCollection.variables.forEach(variable => {
          if (!variable || !variable.name || !variable.valuesByMode) return;
          
          // Split variable name by slashes to create hierarchical structure
          const variablePathSegments = variable.name.split('/').map(segment => sanitizeForDTCG(segment));
          
          // For each mode this variable has values in
          Object.entries(variable.valuesByMode).forEach(([modeId, value]) => {
            // Find the mode name for this modeId
            let modeName = 'mode-1'; // Default
            if (sharedCollection.modes) {
              const mode = sharedCollection.modes.find(m => m.modeId === modeId);
              if (mode && mode.name) {
                modeName = sanitizeForDTCG(mode.name);
              }
            }
            
            // Ensure this mode exists
            if (!dtcgPayload[collectionKey][modeName]) {
              dtcgPayload[collectionKey][modeName] = {};
            }
            
            // Start at the mode level
            let currentObject = dtcgPayload[collectionKey][modeName];
            
            // Create nested structure for path segments (except the last one)
            for (let i = 0; i < variablePathSegments.length - 1; i++) {
              const segment = variablePathSegments[i];
              currentObject[segment] = currentObject[segment] || {};
              currentObject = currentObject[segment];
            }
            
            // The last segment is the variable name
            const variableKey = variablePathSegments[variablePathSegments.length - 1];
            
            // Process the value - handle aliases specially
            let processedValue = value;
            if (value && typeof value === 'object' && value.type === 'VARIABLE_ALIAS' && value.id) {
              // Convert alias to a proper reference string
              processedValue = resolveVariableAlias(value.id);
            }
            
            // Add the variable value to the appropriate level
            currentObject[variableKey] = {
              $type: mapFigmaTypeToDTCG(variable.resolvedType),
              $value: convertFigmaValueToDTCG(processedValue, variable.resolvedType)
            };
          });
        });
      }
    });
  }
  
  // If we didn't find any variables, ensure we have at least one collection
  if (Object.keys(dtcgPayload).length === 0) {
    dtcgPayload.scales = {
      'mode-1': {}
    };
  }
  
  return dtcgPayload;
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
 * Converts a Figma value to DTCG format
 */
function convertFigmaValueToDTCG(value, figmaType) {
  // Handle null values
  if (value === null || value === undefined) {
    return null;
  }
  
  // Special handling for VARIABLE_ALIAS type
  if (value && typeof value === 'object' && value.type === 'VARIABLE_ALIAS') {
    // For aliases, use a reference format {id}
    // Ideally, this would be converted to a proper path, but for now
    // we'll use a simple reference format with the variable ID
    return `{${value.id}}`;
  }
  
  // Handle different types of Figma values
  switch (figmaType) {
    case 'COLOR':
      // If it's a color object with RGB components
      if (value && typeof value === 'object' && value.r !== undefined) {
        // Convert RGB values (0-1) to hex string
        const r = Math.round(value.r * 255).toString(16).padStart(2, '0');
        const g = Math.round(value.g * 255).toString(16).padStart(2, '0');
        const b = Math.round(value.b * 255).toString(16).padStart(2, '0');
        
        // Include alpha if it's not 1
        if (value.a !== undefined && value.a !== 1) {
          const a = Math.round(value.a * 255).toString(16).padStart(2, '0');
          return `#${r}${g}${b}${a}`;
        }
        
        return `#${r}${g}${b}`;
      }
      
      // For color values in other formats (like hex strings or references)
      return value;
      
    case 'BOOLEAN':
      return !!value;
      
    case 'STRING':
      return String(value);
      
    case 'FLOAT':
    case 'NUMBER':
      // Ensure the value is a number
      const num = parseFloat(value);
      return isNaN(num) ? 0 : num;
      
    default:
      // For any other types, return the value as-is
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