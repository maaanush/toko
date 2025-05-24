// This shows the HTML page in Figma.
figma.showUI(__html__, { width: 1000, height: 700, themeColors: true });

/**
 * Helper function to round numbers to a maximum of 3 decimal places and remove trailing zeros
 * @param {number} num - The number to round
 * @returns {number} - The rounded number
 */
function roundToMaxThreeDecimals(num) {
  if (typeof num !== 'number' || isNaN(num)) {
    return num;
  }
  
  // Round to 3 decimal places
  const rounded = Math.round(num * 1000) / 1000;
  
  // Remove trailing zeros by converting to string and back to number
  return parseFloat(rounded.toString());
}

/**
 * Helper function to convert RGB to HSL
 * @param {number} r - Red value (0-1)
 * @param {number} g - Green value (0-1)
 * @param {number} b - Blue value (0-1)
 * @returns {Object} - Object with h, s, l values
 */
function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;

  if (max === min) {
    h = s = 0; // achromatic
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100)
  };
}

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

// Set to track unresolved alias IDs that might be due to missing libraries or problematic local variables
let unresolvedAliaseIdsSuspectedMissingSource = new Set();

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
        const dtcgPayload = createSimplifiedDTCGPayload(data.raw || data);
        // Store the payload for JS code generation
        latestDtcgPayload = dtcgPayload;
        figma.ui.postMessage({
          type: 'dtcgPayload', 
          payload: dtcgPayload
        });
      } catch (error) {
        console.error("Error converting to DTCG format:", error);
        // Send error message to UI
        figma.ui.postMessage({
          type: 'error',
          message: `Failed to convert variables: ${error.message}`
        });
      }
    }).catch(error => {
      console.error("Error fetching variables:", error);
      // Send error message to UI
      figma.ui.postMessage({
        type: 'error',
        message: `Failed to fetch variables: ${error.message}`
      });
    });
  }
  
  // Handle request to generate JS code
  if (msg.type === 'request-js-code') {
    try {
      const payloadToUse = msg.payload || latestDtcgPayload;
      if (payloadToUse) {
        const jsCode = generateJSCodeFromPayload(payloadToUse);
        figma.ui.postMessage({
          type: 'jsCodePreview',
          payload: jsCode
        });
      } else {
        figma.ui.postMessage({
          type: 'error',
          message: 'No DTCG payload available. Please generate variables first.'
        });
      }
    } catch (error) {
      console.error("Error generating JS code:", error);
      figma.ui.postMessage({
        type: 'error',
        message: `Failed to generate JS code: ${error.message}`
      });
    }
  }
  
  // Handle request to generate CSS code
  if (msg.type === 'request-css-code') {
    try {
      const payloadToUse = msg.payload || latestDtcgPayload;
      if (payloadToUse) {
        const cssData = generateCSSCodeFromPayload(payloadToUse);
        figma.ui.postMessage({
          type: 'cssCodePreview',
          payload: cssData
        });
      } else {
        figma.ui.postMessage({
          type: 'error',
          message: 'No DTCG payload available. Please generate variables first.'
        });
      }
    } catch (error) {
      console.error("Error generating CSS code:", error);
      figma.ui.postMessage({
        type: 'error',
        message: `Failed to generate CSS code: ${error.message}`
      });
    }
  }
  
  // Handle request to generate Tailwind code
  if (msg.type === 'request-tailwind-code') {
    try {
      const payloadToUse = msg.payload || latestDtcgPayload;
      if (payloadToUse) {
        const tailwindData = generateTailwindCodeFromPayload(payloadToUse);
        figma.ui.postMessage({
          type: 'tailwindCodePreview',
          payload: tailwindData
        });
      } else {
        figma.ui.postMessage({
          type: 'error',
          message: 'No DTCG payload available. Please generate variables first.'
        });
      }
    } catch (error) {
      console.error("Error generating Tailwind code:", error);
      figma.ui.postMessage({
        type: 'error',
        message: `Failed to generate Tailwind code: ${error.message}`
      });
    }
  }
};

// Send an initial plugin-info message when the plugin starts
figma.ui.postMessage({
  type: 'plugin-info',
  payload: {
    message: 'Plugin loaded. Fetching variables...'
  }
});

// Automatically fetch and send data when the plugin UI loads
fetchAndLogAllVariables().then(data => {
  try {
    // Use createSimplifiedDTCGPayload with the raw data part of the fetched result
    const simplifiedPayload = createSimplifiedDTCGPayload(data.raw || data); // data.raw for compatibility, or data if raw is not present
    
    // Store the payload for JS code generation
    latestDtcgPayload = simplifiedPayload;
    
    figma.ui.postMessage({
      type: 'dtcgPayload',
      payload: simplifiedPayload
    });
  } catch (error) {
    console.error("Error creating simplified DTCG payload on initial load:", error);
    figma.ui.postMessage({
      type: 'error',
      message: `Failed to process variables on load: ${error.message}`
    });
  }
}).catch(error => {
  console.error("Error fetching variables on initial load:", error);
  figma.ui.postMessage({
    type: 'error',
    message: `Failed to fetch variables on load: ${error.message}`
  });
});

// Function to create a simplified DTCG-compatible payload from Figma variables data
function createSimplifiedDTCGPayload(figmaData) {
  const dtcgPayload = {};
  
  // Map to track Figma variable IDs to their canonical paths for alias resolution
  const variableIdToPathMap = new Map();
  // Clear the set at the beginning of each payload creation
  unresolvedAliaseIdsSuspectedMissingSource.clear();
  
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
    if (!info) { // Alias is unresolved
      // If the plugin has no record of importing a library variable that resulted in this local ID,
      // it's a strong candidate for a missing library or a problematic local variable.
      if (!variableIdToKeyMap.has(aliasId)) {
        unresolvedAliaseIdsSuspectedMissingSource.add(aliasId);
      }
      return `{${aliasId}}`; // Fallback if not found
    }
    
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
  
  // After processing all variables, check if there were any suspected missing sources
  if (unresolvedAliaseIdsSuspectedMissingSource.size > 0) {
    figma.ui.postMessage({
      type: 'warning-potential-missing-source',
      payload: {
        message: "Some variable aliases could not be resolved (e.g., appearing as {id}). This might be because they point to variables in Figma libraries that are not currently added to this file, or to local variables that no longer exist or are unnamed. Please check that all necessary libraries are linked to this Figma file and that all local variables are correctly defined.",
        // Optional: provide the list of IDs for advanced users or debugging
        // unresolvedIds: Array.from(unresolvedAliaseIdsSuspectedMissingSource)
      }
    });
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
        // Check if color has opacity (alpha < 1)
        if (value.a !== undefined && value.a !== 1) {
          // Use HSLA format for colors with opacity
          const hsl = rgbToHsl(value.r, value.g, value.b);
          const alpha = roundToMaxThreeDecimals(value.a);
          return `hsla(${hsl.h}, ${hsl.s}%, ${hsl.l}%, ${alpha})`;
        }
        
        // Use hex format for opaque colors
        const r = Math.round(value.r * 255).toString(16).padStart(2, '0');
        const g = Math.round(value.g * 255).toString(16).padStart(2, '0');
        const b = Math.round(value.b * 255).toString(16).padStart(2, '0');
        
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
      return isNaN(num) ? 0 : roundToMaxThreeDecimals(num);
      
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
    const simplifiedPayload = createSimplifiedDTCGPayload(allFetchedVariablesPayload);
    
    // Log the simplified payload
    console.log('--- DTCG Payload ---');
    // console.log(JSON.stringify(simplifiedPayload, null, 2));
    console.log('--- DTCG Conversion Complete ---');
    
    // End of orchestration function
    return {
      raw: allFetchedVariablesPayload,
      dtcg: simplifiedPayload
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

// Store the latest DTCG payload for JS code generation
let latestDtcgPayload = null;

/**
 * Generates JavaScript code from a DTCG payload
 * @param {Object} dtcgPayload - The DTCG payload object
 * @returns {string} - The generated JavaScript code
 */
function generateJSCodeFromPayload(dtcgPayload) {
  if (!dtcgPayload || typeof dtcgPayload !== 'object') {
    return '{}';
  }
  
  // Phase 1: Generate JS with placeholders
  const intermediateJsString = generateJSCodeRecursive(dtcgPayload, [], 0);
  
  // Phase 2: Replace placeholders with actual bracket notation
  const finalJsString = intermediateJsString.replace(/LB/g, '["').replace(/RB/g, '"]');
  
  return finalJsString;
}

/**
 * Recursively generates JavaScript code from a value
 * @param {*} currentValue - The current value being processed
 * @param {Array} pathContext - Array of keys representing the path to this value's parent
 * @param {number} indentLevel - Current indentation level for pretty printing
 * @returns {string} - The generated JavaScript code for this value
 */
function generateJSCodeRecursive(currentValue, pathContext, indentLevel) {
  const indent = '  '.repeat(indentLevel);
  const nextIndent = '  '.repeat(indentLevel + 1);
  
  // Handle null and undefined
  if (currentValue === null || currentValue === undefined) {
    return 'null';
  }
  
  // Handle primitives
  if (typeof currentValue === 'string') {
    return `'${currentValue.replace(/'/g, "\\'")}'`;
  }
  
  if (typeof currentValue === 'number' || typeof currentValue === 'boolean') {
    if (typeof currentValue === 'number') {
      return String(roundToMaxThreeDecimals(currentValue));
    }
    return String(currentValue);
  }
  
  // Handle arrays
  if (Array.isArray(currentValue)) {
    if (currentValue.length === 0) {
      return '[]';
    }
    
    const arrayElements = currentValue.map(item => 
      generateJSCodeRecursive(item, pathContext, indentLevel + 1)
    );
    
    return `[\n${nextIndent}${arrayElements.join(`,\n${nextIndent}`)}\n${indent}]`;
  }
  
  // Handle objects
  if (typeof currentValue === 'object') {
    // Check for special transformation node (DTCG token with $type and $value)
    if (currentValue.$type && currentValue.$value !== undefined) {
      const valStr = currentValue.$value;
      
      // Handle path transformation logic for values like "{colors.slate.2}"
      if (typeof valStr === 'string' && valStr.startsWith('{') && valStr.endsWith('}')) {
        // Extract inner path: "{colors.slate.2}" -> "colors.slate.2"
        const innerPath = valStr.slice(1, -1);
        const segments = innerPath.split('.');
        
        // Determine context for injection based on pathContext
        // For example, if pathContext is ['enso_colors', 'light', 'fill', 'default'],
        // we want to inject 'light' as the second segment
        let contextSegment = null;
        if (pathContext.length >= 2) {
          // Try to find a mode/theme context - typically the second level in structure
          contextSegment = pathContext[1];
        }
        
        let finalSegments;
        if (contextSegment && segments.length > 1) {
          // Inject context: ['colors', 'slate', '2'] + 'light' -> ['colors', 'light', 'slate', '2']
          finalSegments = [segments[0], contextSegment, ...segments.slice(1)];
        } else {
          finalSegments = segments;
        }
        
        // Join segments with dots to form base path
        let pathString = finalSegments.join('.');
        
        // Check if the last segment is purely numeric
        const lastSegment = finalSegments[finalSegments.length - 1];
        if (/^\d+$/.test(lastSegment)) {
          // Replace the last dot and number with LB[number]RB
          const lastDotIndex = pathString.lastIndexOf('.');
          if (lastDotIndex !== -1) {
            pathString = pathString.substring(0, lastDotIndex) + 'LB' + lastSegment + 'RB';
          }
        }
        
        return pathString;
      }
      
      // Handle literal string values (like "#16120c")
      if (typeof valStr === 'string') {
        return `'${valStr.replace(/'/g, "\\'")}'`;
      }
      
      // Handle other value types
      return generateJSCodeRecursive(valStr, pathContext, indentLevel);
    }
    
    // Regular object handling
    const keys = Object.keys(currentValue);
    if (keys.length === 0) {
      return '{}';
    }
    
    const objectEntries = keys.map(key => {
      const value = currentValue[key];
      const newPathContext = [...pathContext, key];
      
      // Format the key - quote if not a valid JS identifier
      const formattedKey = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? key : `'${key}'`;
      
      const valueCode = generateJSCodeRecursive(value, newPathContext, indentLevel + 1);
      
      return `${nextIndent}${formattedKey}: ${valueCode}`;
    });
    
    return `{\n${objectEntries.join(',\n')}\n${indent}}`;
  }
  
  // Fallback for unknown types
  return 'null';
}

/**
 * Generates CSS code from a DTCG payload
 * @param {Object} dtcgPayload - The DTCG payload object
 * @returns {Object} - Object with code and structure properties
 */
function generateCSSCodeFromPayload(dtcgPayload) {
  if (!dtcgPayload || typeof dtcgPayload !== 'object') {
    return { code: '', structure: {} };
  }
  
  const cssRules = [];
  
  // Iterate through each collection in the DTCG payload
  for (const collectionName in dtcgPayload) {
    const collection = dtcgPayload[collectionName];
    
    if (!collection || typeof collection !== 'object') continue;
    
    // Iterate through each mode in the collection
    for (const modeName in collection) {
      const modeData = collection[modeName];
      
      if (!modeData || typeof modeData !== 'object') continue;
      
      // Create CSS class selector
      const sanitizedCollectionName = sanitizeForDTCG(collectionName);
      const sanitizedModeName = sanitizeForDTCG(modeName);
      const selector = `.${sanitizedCollectionName}-${sanitizedModeName}`;
      
      // Generate CSS variables for this scope
      const variablesForScope = generateScopedCSSVariables(modeData, [], collectionName, modeName);
      
      // Only add rule if there are variables
      if (variablesForScope.length > 0) {
        const ruleContent = variablesForScope.map(variable => `  ${variable}`).join('\n');
        cssRules.push(`${selector} {\n${ruleContent}\n}`);
      }
    }
  }
  
  // Join all CSS rules
  const finalCssString = cssRules.join('\n\n');
  
  return {
    code: finalCssString,
    structure: dtcgPayload
  };
}

/**
 * Recursively generates CSS variables for a specific mode scope
 * @param {Object} dataNode - The current object being processed within the mode
 * @param {Array} currentRelativePath - Path segments relative to the current mode
 * @param {string} currentCollectionName - The collection being processed
 * @param {string} currentModeName - The mode being processed
 * @returns {Array} - Array of CSS variable declaration strings
 */
function generateScopedCSSVariables(dataNode, currentRelativePath, currentCollectionName, currentModeName) {
  const cssVariables = [];
  
  if (!dataNode || typeof dataNode !== 'object') {
    return cssVariables;
  }
  
  for (const key in dataNode) {
    const value = dataNode[key];
    
    // Check if this is a token (has $type and $value)
    if (value && typeof value === 'object' && value.$type && value.$value !== undefined) {
      // This is a token - generate CSS variable
      const variableName = `--${[...currentRelativePath, key].join('-')}`;
      
      let cssValue;
      
      // Handle alias values
      if (typeof value.$value === 'string' && value.$value.startsWith('{') && value.$value.endsWith('}')) {
        // This is an alias - resolve it using the same logic as JS generation
        cssValue = resolveCSSAlias(value.$value, currentCollectionName, currentModeName);
      } else {
        // Direct value - convert using existing function
        cssValue = convertFigmaValueToDTCG(value.$value, value.$type);
        // For CSS, ensure string values are quoted if needed
        if (typeof cssValue === 'string' && !cssValue.startsWith('#') && !cssValue.endsWith('px') && !cssValue.includes('var(')) {
          cssValue = `'${cssValue}'`;
        }
      }
      
      cssVariables.push(`${variableName}: ${cssValue};`);
    } else if (value && typeof value === 'object') {
      // This is a group - recurse deeper
      const nestedVariables = generateScopedCSSVariables(
        value, 
        [...currentRelativePath, key], 
        currentCollectionName, 
        currentModeName
      );
      cssVariables.push(...nestedVariables);
    }
  }
  
  return cssVariables;
}

/**
 * Resolves a CSS alias using the same logic as JS generation
 * @param {string} aliasString - The alias string like "{colors.slate.3}"
 * @param {string} currentCollectionName - Current collection context
 * @param {string} currentModeName - Current mode context
 * @returns {string} - CSS var() reference
 */
function resolveCSSAlias(aliasString, currentCollectionName, currentModeName) {
  // Extract inner path: "{colors.slate.3}" -> "colors.slate.3"
  const innerPath = aliasString.slice(1, -1);
  const segments = innerPath.split('.');
  
  // Use current mode as context (similar to JS generation logic)
  const contextSegment = currentModeName;
  
  let finalSegments;
  if (contextSegment && segments.length > 1) {
    // Inject context: ['colors', 'slate', '3'] + 'light' -> ['colors', 'light', 'slate', '3']
    finalSegments = [segments[0], contextSegment, ...segments.slice(1)];
  } else {
    finalSegments = segments;
  }
  
  // For CSS, we need the path relative to the target's scope
  // If finalSegments is ['colors', 'light', 'slate', '3'], 
  // the relative path within .colors-light scope would be ['slate', '3']
  if (finalSegments.length >= 3) {
    // Remove collection and mode to get relative path
    const relativePath = finalSegments.slice(2);
    return `var(--${relativePath.join('-')})`;
  } else {
    // Fallback - use the segments as-is
    return `var(--${finalSegments.join('-')})`;
  }
}

/**
 * Generates Tailwind configuration code from a DTCG payload
 * @param {Object} dtcgPayload - The DTCG payload object
 * @returns {Object} - Object with code and structure properties
 */
function generateTailwindCodeFromPayload(dtcgPayload) {
  if (!dtcgPayload || typeof dtcgPayload !== 'object') {
    return { code: '', structure: {} };
  }
  
  // Initialize Tailwind config structure
  const tailwindConfig = {
    theme: {
      extend: {}
    }
  };
  
  // Set to track processed collection-relative keys for deduplication
  const processedCollectionRelativeKeys = new Set();
  
  // Map DTCG types to Tailwind theme sections
  const dtcgTypeToTailwindSection = {
    'color': 'colors',
    'dimension': 'spacing',
    'number': 'spacing',
    'fontFamily': 'fontFamily',
    'fontWeight': 'fontWeight',
    'fontStyle': 'fontStyle',
    'fontSize': 'fontSize',
    'lineHeight': 'lineHeight',
    'letterSpacing': 'letterSpacing',
    'borderRadius': 'borderRadius',
    'borderWidth': 'borderWidth',
    'boxShadow': 'boxShadow',
    'opacity': 'opacity'
  };
  
  // Iterate through each collection in the DTCG payload
  for (const collectionName in dtcgPayload) {
    const collection = dtcgPayload[collectionName];
    
    if (!collection || typeof collection !== 'object') continue;
    
    const sanitizedCollectionName = sanitizeForDTCG(collectionName);
    
    // Iterate through each mode in the collection
    for (const modeName in collection) {
      const modeData = collection[modeName];
      
      if (!modeData || typeof modeData !== 'object') continue;
      
      // Process tokens within this mode
      collectTailwindTokensRecursive(
        modeData,
        sanitizedCollectionName,
        [],
        tailwindConfig.theme.extend,
        processedCollectionRelativeKeys,
        dtcgTypeToTailwindSection
      );
    }
  }
  
  // Generate the final code string
  const finalTailwindString = JSON.stringify(tailwindConfig, null, 2);
  
  return {
    code: finalTailwindString,
    structure: dtcgPayload
  };
}

/**
 * Recursively processes tokens and builds the Tailwind configuration
 * @param {Object} currentNode - The current object being processed within the mode
 * @param {string} sanitizedCollectionName - The sanitized collection name
 * @param {Array} currentRelativePathSegments - Path segments relative to the collection/mode
 * @param {Object} extendObject - The tailwindConfig.theme.extend object
 * @param {Set} processedKeys - Set for deduplication
 * @param {Object} typeMap - DTCG type to Tailwind section mapping
 */
function collectTailwindTokensRecursive(currentNode, sanitizedCollectionName, currentRelativePathSegments, extendObject, processedKeys, typeMap) {
  if (!currentNode || typeof currentNode !== 'object') {
    return;
  }
  
  for (const key in currentNode) {
    const tokenData = currentNode[key];
    const newRelativePathSegments = [...currentRelativePathSegments, sanitizeForDTCG(key)];
    
    // Check if this is a token (has $type and $value)
    if (tokenData && typeof tokenData === 'object' && tokenData.$type && tokenData.$value !== undefined) {
      // This is a token - process it for Tailwind
      
      // Create the relative key for this token (e.g., "type-1")
      const tailwindRelativeKey = newRelativePathSegments.join('-');
      
      // Create unique key for deduplication (e.g., "enso_colors.type-1")
      const uniqueKeyForDeduplication = `${sanitizedCollectionName}.${tailwindRelativeKey}`;
      
      // Skip if already processed (from another mode)
      if (processedKeys.has(uniqueKeyForDeduplication)) {
        continue;
      }
      
      // Add to processed keys
      processedKeys.add(uniqueKeyForDeduplication);
      
      // Create the Tailwind value (e.g., "var(--type-1)")
      const tailwindValue = `var(--${tailwindRelativeKey})`;
      
      // Get the Tailwind section based on token type
      const sectionName = typeMap[tokenData.$type];
      if (!sectionName) {
        continue; // Skip tokens with unmapped types
      }
      
      // Ensure the section exists in extend object
      if (!extendObject[sectionName]) {
        extendObject[sectionName] = {};
      }
      
      // Ensure the collection exists within the section
      if (!extendObject[sectionName][sanitizedCollectionName]) {
        extendObject[sectionName][sanitizedCollectionName] = {};
      }
      
      // Add the token to the Tailwind config
      extendObject[sectionName][sanitizedCollectionName][tailwindRelativeKey] = tailwindValue;
      
    } else if (tokenData && typeof tokenData === 'object') {
      // This is a group - recurse deeper
      collectTailwindTokensRecursive(
        tokenData,
        sanitizedCollectionName,
        newRelativePathSegments,
        extendObject,
        processedKeys,
        typeMap
      );
    }
  }
}