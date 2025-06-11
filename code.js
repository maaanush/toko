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
 * Helper function to convert px to rem with proper formatting
 * @param {number} pxValue - The pixel value to convert
 * @param {number} baseFontSize - The base font size for rem calculation (default 16)
 * @returns {string} - The rem value formatted as string
 */
function convertPxToRem(pxValue, baseFontSize = 16) {
  if (typeof pxValue !== 'number' || isNaN(pxValue) || baseFontSize === 0) {
    return `${pxValue}px`; // Fallback to px if conversion fails
  }
  
  const remValue = pxValue / baseFontSize;
  const roundedRem = roundToMaxThreeDecimals(remValue);
  
  return `${roundedRem}rem`;
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
  local: [], // Array of local collections with their variables
  shared: [] // Array of shared library collections with their variables
};

// Create the main object to hold all fetched styles data
let allFetchedStylesPayload = {
  local: [] // Array of local styles organized by type
};

// Initialize a set to track IDs of imported library variables
let importedLibraryVariableIds = new Set();

// Initialize a map to store library variable key to local ID mappings
let variableKeyToIdMap = new Map();

// Initialize a map to store local ID to library variable key mappings
let variableIdToKeyMap = new Map();

// Map to track Figma variable IDs to their canonical paths for alias resolution
let variableIdToPathMap = new Map();

// Set to track unresolved alias IDs that might be due to missing libraries or problematic local variables
let unresolvedAliaseIdsSuspectedMissingSource = new Set();

// Scope categorization constants for the new consensus-based typing logic
const PIXEL_DIMENSION_SCOPES = new Set([
  'CORNER_RADIUS', 'WIDTH_HEIGHT', 'GAP', 'STROKE_WEIGHT', 
  'FONT_SIZE', 'LINE_HEIGHT', 'LETTER_SPACING', 
  'PARAGRAPH_SPACING', 'PARAGRAPH_INDENT',
  'EFFECT_RADIUS', 'EFFECT_OFFSET_X', 'EFFECT_OFFSET_Y', 'EFFECT_SPREAD'
]);

const SPECIFIC_PIXEL_DIMENSION_TYPE_MAP = new Map([
  ['FONT_SIZE', 'fontSize'],
  ['LINE_HEIGHT', 'lineHeight'],
  ['LETTER_SPACING', 'letterSpacing'],
  ['CORNER_RADIUS', 'borderRadius'],
  ['STROKE_WEIGHT', 'borderWidth']
]);

const UNITLESS_NUMERIC_SCOPES = new Set([
  'FONT_WEIGHT',
  'LAYER_OPACITY'
]);

const SPECIFIC_UNITLESS_NUMERIC_TYPE_MAP = new Map([
  ['FONT_WEIGHT', 'fontWeight'],
  ['LAYER_OPACITY', 'opacity']
]);

/**
 * Debug function to help identify problematic variables
 * @param {string} variableId - The variable ID to debug
 */
function debugVariableById(variableId) {
  console.group(`Debugging variable ID: ${variableId}`);
  
  // Check if it's in our path map
  const pathInfo = variableIdToPathMap && variableIdToPathMap.get ? variableIdToPathMap.get(variableId) : undefined;
  console.log('Path info:', pathInfo);
  
  // Check if it's a library variable
  const libraryKey = variableIdToKeyMap && variableIdToKeyMap.get ? variableIdToKeyMap.get(variableId) : undefined;
  console.log('Library key:', libraryKey);
  
  // Check if it's in unresolved set
  const isUnresolved = unresolvedAliaseIdsSuspectedMissingSource && unresolvedAliaseIdsSuspectedMissingSource.has ? unresolvedAliaseIdsSuspectedMissingSource.has(variableId) : false;
  console.log('Is unresolved:', isUnresolved);
  
  // Try to fetch the variable directly from Figma
  if (typeof figma !== 'undefined' && figma.variables) {
    figma.variables.getVariableByIdAsync(variableId)
      .then(variable => {
        console.log('Direct Figma fetch result:', variable);
      })
      .catch(error => {
        console.log('Direct Figma fetch error:', error.message);
      });
  }
  
  console.groupEnd();
}

// Make debug function available globally for console use
if (typeof window !== 'undefined') {
  window.debugVariableById = debugVariableById;
} else if (typeof global !== 'undefined') {
  global.debugVariableById = debugVariableById;
}

/**
 * Resets all global state to ensure fresh data on each run
 */
function resetPluginState() {
  // Reset the main payload
  allFetchedVariablesPayload = {
    local: [],
    shared: []
  };
  
  // Reset the styles payload
  allFetchedStylesPayload = {
    local: []
  };
  
  // Clear all tracking sets and maps
  importedLibraryVariableIds.clear();
  variableKeyToIdMap.clear();
  variableIdToKeyMap.clear();
  variableIdToPathMap.clear();
  unresolvedAliaseIdsSuspectedMissingSource.clear();
  
  console.log('Plugin state reset successfully');
}

/**
 * Fetches local variable collections from the current Figma file
 */
async function fetchLocalCollections() {
  try {
    const localCollections = await figma.variables.getLocalVariableCollectionsAsync();
    const currentDocumentName = figma.root.name; // Get the current document's name
    
    console.log('Found local collections:', localCollections.length);
    
    for (const collection of localCollections) {
      // Create the structure for this local collection
      const localCollectionData = {
        id: collection.id,
        name: collection.name,
        libraryName: currentDocumentName, // Add the document name here
        modes: collection.modes.map(mode => ({
          modeId: mode.modeId,
          name: mode.name
        })),
        defaultModeId: collection.defaultModeId,
        variables: []
      };
      
      // Get all variables in this collection
      for (const variableId of collection.variableIds) {
        try {
          const variable = await figma.variables.getVariableByIdAsync(variableId);
          
          if (variable) {
            localCollectionData.variables.push({
              id: variable.id,
              name: variable.name,
              description: variable.description,
              resolvedType: variable.resolvedType,
              scopes: variable.scopes,
              valuesByMode: variable.valuesByMode,
              codeSyntax: variable.codeSyntax,
              remote: false // Mark as local
            });
          }
        } catch (variableError) {
          console.warn(`Failed to fetch local variable ${variableId}:`, variableError);
        }
      }
      
      // Add this collection to the local array
      allFetchedVariablesPayload.local.push(localCollectionData);
    }
    
    console.log('Successfully fetched local collections:', allFetchedVariablesPayload.local.length);
    
  } catch (error) {
    console.error('Error fetching local collections:', error);
    
    // Add error to payload
    if (!allFetchedVariablesPayload.errorLog) {
      allFetchedVariablesPayload.errorLog = {};
    }
    
    allFetchedVariablesPayload.errorLog.localCollectionError = {
      phase: 'fetchLocalCollections',
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    };
  }
}

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
                  sharedCollectionData.localDocumentId = fullCollection.id; // Store the local document ID of this shared collection instance
                  
                  // Mark that we've fetched this collection's mode info
                  hasCollectionModesInfo = true;
                } else {
                  console.warn(`getVariableCollectionByIdAsync for ${importedVariable.variableCollectionId} returned null/undefined for shared collection ${sharedCollectionData.name}`);
                }
              } catch (modesError) {
                console.error(`Error fetching full collection details for ${sharedCollectionData.name} (local ID ${importedVariable.variableCollectionId}):`, modesError.message);
                const errorInfo = {
                  collectionName: sharedCollectionData.name,
                  collectionKey: sharedCollectionData.key,
                  attemptedLocalCollectionId: importedVariable.variableCollectionId,
                  errorMessage: modesError.message,
                  errorPhase: 'shared-collection-local-instance-fetch',
                  timestamp: new Date().toISOString()
                };
                if (!errorLog.detailErrors) errorLog.detailErrors = [];
                errorLog.detailErrors.push(errorInfo);
                // sharedCollectionData.localDocumentId will remain unset if this fetch fails.
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
                scopes: detailedVariable.scopes,         // Add scopes property
                valuesByMode: detailedVariable.valuesByMode,
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

/**
 * Fetches local styles from the current Figma file
 */
async function fetchLocalStyles() {
  try {
    const currentDocumentName = figma.root.name; // Get the current document's name
    
    console.log('Fetching local styles...');
    
    // Fetch all types of local styles
    const [paintStyles, textStyles, effectStyles, gridStyles] = await Promise.all([
      figma.getLocalPaintStylesAsync(),
      figma.getLocalTextStylesAsync(), 
      figma.getLocalEffectStylesAsync(),
      figma.getLocalGridStylesAsync()
    ]);
    
    console.log('Found styles:', {
      paint: paintStyles.length,
      text: textStyles.length,
      effect: effectStyles.length,
      grid: gridStyles.length
    });
    
    // Create the structure for local styles
    const localStylesData = {
      documentName: currentDocumentName,
      paint: [],
      text: [],
      effect: [],
      grid: []
    };
    
    // Process paint styles
    paintStyles.forEach(style => {
      try {
        // For paint styles, we need to check each individual paint for bound variables
        const processedPaints = style.paints.map(paint => {
          if (paint.type === 'SOLID') {
            return {
              type: paint.type,
              color: paint.color,
              opacity: paint.opacity,
              boundVariables: paint.boundVariables || {}
            };
          }
          return paint; // Return other paint types as-is
        });

        localStylesData.paint.push({
          id: style.id,
          name: style.name,
          description: style.description,
          type: style.type,
          paints: processedPaints, // Use the processed paints with boundVariables
          remote: style.remote,
          key: style.key
        });
      } catch (error) {
        console.warn(`Failed to process paint style ${style.id}:`, error);
      }
    });
    
    // Process text styles
    textStyles.forEach(style => {
      try {
        localStylesData.text.push({
          id: style.id,
          name: style.name,
          description: style.description,
          type: style.type,
          fontName: style.fontName,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          lineHeight: style.lineHeight,
          letterSpacing: style.letterSpacing,
          fills: style.fills,
          textCase: style.textCase,
          textDecoration: style.textDecoration,
          remote: style.remote,
          key: style.key,
          boundVariables: style.boundVariables || {} // Capture bound variables for the whole text style
        });
      } catch (error) {
        console.warn(`Failed to process text style ${style.id}:`, error);
      }
    });
    
    // Process effect styles
    effectStyles.forEach(style => {
      try {
         // For effect styles, we also need to check each individual effect
         const processedEffects = style.effects.map(effect => {
          return Object.assign({}, effect, { boundVariables: effect.boundVariables || {} });
        });

        localStylesData.effect.push({
          id: style.id,
          name: style.name,
          description: style.description,
          type: style.type,
          effects: processedEffects, // Use processed effects with boundVariables
          remote: style.remote,
          key: style.key
        });
      } catch (error) {
        console.warn(`Failed to process effect style ${style.id}:`, error);
      }
    });
    
    // Process grid styles
    gridStyles.forEach(style => {
      try {
        const processedGrids = style.layoutGrids.map(grid => {
          return Object.assign({}, grid, { boundVariables: grid.boundVariables || {} });
        });

        localStylesData.grid.push({
          id: style.id,
          name: style.name,
          description: style.description,
          type: style.type,
          layoutGrids: processedGrids, // Use processed grids with boundVariables
          remote: style.remote,
          key: style.key
        });
      } catch (error) {
        console.warn(`Failed to process grid style ${style.id}:`, error);
      }
    });
    
    // Add this styles collection to the local array
    allFetchedStylesPayload.local.push(localStylesData);
    
    console.log('Successfully fetched local styles:', allFetchedStylesPayload.local);
    
  } catch (error) {
    console.error('Error fetching local styles:', error);
    
    // Add error to payload
    if (!allFetchedStylesPayload.errorLog) {
      allFetchedStylesPayload.errorLog = {};
    }
    
    allFetchedStylesPayload.errorLog.localStylesError = {
      phase: 'fetchLocalStyles',
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Main orchestration function to fetch and process all styles
 */
async function fetchAndLogAllStyles() {
  try {
    // Reset styles state to ensure fresh data
    allFetchedStylesPayload = {
      local: []
    };
    
    console.log('Starting styles fetch process...');
    
    // Fetch local styles
    console.log('Fetching local styles...');
    await fetchLocalStyles();
    
    // Log summary of what was fetched
    const totalStyles = allFetchedStylesPayload.local.reduce((sum, styleGroup) => {
      return sum + (styleGroup.paint && styleGroup.paint.length ? styleGroup.paint.length : 0) + 
                  (styleGroup.text && styleGroup.text.length ? styleGroup.text.length : 0) + 
                  (styleGroup.effect && styleGroup.effect.length ? styleGroup.effect.length : 0) + 
                  (styleGroup.grid && styleGroup.grid.length ? styleGroup.grid.length : 0);
    }, 0);
    
    console.log(`Styles fetch complete: ${totalStyles} total styles`);
    
    // Log the final fetched payload
    console.log('Final fetched styles payload:', allFetchedStylesPayload);
    
    console.log('Styles processing completed successfully');
    
    return allFetchedStylesPayload;
  } catch (error) {
    console.error('Error in fetchAndLogAllStyles:', error);
    
    // Add error to payload if it exists
    if (!allFetchedStylesPayload.errorLog) {
      allFetchedStylesPayload.errorLog = {};
    }
    
    allFetchedStylesPayload.errorLog.orchestrationError = {
      phase: 'fetchAndLogAllStyles',
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    };
    
    return allFetchedStylesPayload;
  }
}

/**
 * Creates a nested object structure from a flat list of styles based on their names.
 * Slashes in names are used as delimiters for nesting, creating a tree-like object.
 * This is useful for UI renderings like a side tree.
 * @param {Object} stylesPayload - The payload from `fetchAndLogAllStyles` containing flat lists of styles.
 * @returns {Object} - An object with styles organized in a nested structure by category (paint, text, etc.).
 */
function createNestedStylesPayload(stylesPayload) {
  const nestedStyles = {};

  const processStyles = (styles, category) => {
    if (!styles || styles.length === 0) return;

    nestedStyles[category] = nestedStyles[category] || {};

    styles.forEach(style => {
      // Trim and filter out empty segments that might result from leading/trailing/double slashes
      const pathSegments = style.name.split('/').map(s => s.trim()).filter(Boolean);
      
      if (pathSegments.length === 0) return;

      let currentLevel = nestedStyles[category];

      pathSegments.forEach((segment, index) => {
        if (index === pathSegments.length - 1) {
          // This is the leaf node. It holds the style properties.
          // Check for conflict: if a group with this name already exists.
          if (currentLevel[segment] && typeof currentLevel[segment] === 'object' && !currentLevel[segment].id) {
            // It's a group. Add the style object as a special property.
            // This handles cases where a style name is a prefix of another (e.g., "Button" and "Button/Primary").
            currentLevel[segment]._style = style;
          } else {
            currentLevel[segment] = style;
          }
        } else {
          // This is a path segment (a group).
          // Check for conflict: if a style with this name already exists.
          if (currentLevel[segment] && currentLevel[segment].id) {
            // It's a style. Convert it into a group and store the style under '_style'.
            const existingStyle = currentLevel[segment];
            currentLevel[segment] = {
              _style: existingStyle
            };
          } else if (!currentLevel[segment]) {
            // No conflict, just create the group.
            currentLevel[segment] = {};
          }
          // Move to the next level in the hierarchy.
          currentLevel = currentLevel[segment];
        }
      });
    });
  };

  if (stylesPayload && stylesPayload.local) {
    stylesPayload.local.forEach(styleGroup => {
      processStyles(styleGroup.paint, 'paint');
      processStyles(styleGroup.text, 'text');
      processStyles(styleGroup.effect, 'effect');
      processStyles(styleGroup.grid, 'grid');
    });
  }

  // Check if we only have one category with content
  const categoriesWithContent = Object.keys(nestedStyles).filter(key => 
    nestedStyles[key] && Object.keys(nestedStyles[key]).length > 0
  );

  // If only one category has content, return its content directly (flatten)
  if (categoriesWithContent.length === 1) {
    return nestedStyles[categoriesWithContent[0]];
  }

  // If multiple categories or no content, return the full structure
  return nestedStyles;
}

// Message handler for UI events
figma.ui.onmessage = msg => {
  // Simple message handling - log events but don't take complex actions yet
  
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
    (async () => {
      try {
        const data = await fetchAndLogAllVariables();
        const dtcgPayload = await createSimplifiedDTCGPayload(data.raw || data);
        // Store the payload for JS code generation
        latestDtcgPayload = dtcgPayload;
        // Store the raw variables payload for text styles JS generation
        latestRawVariablesPayload = data.raw || data;
        figma.ui.postMessage({
          type: 'dtcgPayload', 
          payload: dtcgPayload
        });
      } catch (error) {
        // Send error message to UI
        figma.ui.postMessage({
          type: 'error',
          message: `Failed to fetch or convert variables: ${error.message}`
        });
      }
    })();
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
      figma.ui.postMessage({
        type: 'error',
        message: `Failed to generate Tailwind code: ${error.message}`
      });
    }
  }

  // Handle request to generate text styles JS code
  if (msg.type === 'request-text-styles-js-code') {
    try {
      if (latestStylesPayload && latestRawVariablesPayload) {
        const jsCode = generateJSCodeFromTextStyles(latestStylesPayload, latestRawVariablesPayload);
        figma.ui.postMessage({
          type: 'textStylesJsCodePreview',
          payload: jsCode
        });
      } else {
        figma.ui.postMessage({
          type: 'error',
          message: 'No styles or variables data available. Please generate both styles and variables first.'
        });
      }
    } catch (error) {
      figma.ui.postMessage({
        type: 'error',
        message: `Failed to generate text styles JS code: ${error.message}`
      });
    }
  }

  // Handle request to generate styles JS code from filtered payload
  if (msg.type === 'request-styles-js-code') {
    try {
      const filteredStylesPayload = msg.payload;
      if (filteredStylesPayload && latestRawVariablesPayload) {
        const jsCode = generateJSCodeFromTextStyles(filteredStylesPayload, latestRawVariablesPayload);
        figma.ui.postMessage({
          type: 'stylesJsCodePreview',
          payload: jsCode
        });
      } else {
        figma.ui.postMessage({
          type: 'error',
          message: 'No styles selected or variables data unavailable. Please generate variables first and select some styles.'
        });
      }
    } catch (error) {
      figma.ui.postMessage({
        type: 'error',
        message: `Failed to generate styles JS code: ${error.message}`
      });
    }
  }

  // Handle request to generate styles payload
  if (msg.type === 'generate-styles') {
    (async () => {
      try {
        const stylesData = await fetchAndLogAllStyles();
        const nestedStylesData = createNestedStylesPayload(stylesData);
        // Store the styles payload for text styles JS generation
        latestStylesPayload = nestedStylesData;
        console.log('Nested styles payload:', nestedStylesData);
        figma.ui.postMessage({
          type: 'stylesPayload', 
          payload: nestedStylesData
        });
      } catch (error) {
        // Send error message to UI
        figma.ui.postMessage({
          type: 'error',
          message: `Failed to fetch styles: ${error.message}`
        });
      }
    })();
  }

  // GitHub Authentication Handlers
  if (msg.type === 'CHECK_GITHUB_AUTH') {
    checkGitHubAuthStatus();
  }

  if (msg.type === 'CHECK_GITHUB_AUTH_FOR_EXPORT') {
    checkGitHubAuthForExport();
  }

  if (msg.type === 'CHECK_GITHUB_AUTH_FOR_MODAL') {
    checkGitHubAuthForModal();
  }

  if (msg.type === 'AUTHENTICATE_GITHUB') {
    authenticateWithGitHub(msg.payload.pat);
  }

  if (msg.type === 'DISCONNECT_GITHUB') {
    disconnectGitHub();
  }

  // GitHub API Handlers for Export Modal
  if (msg.type === 'GET_GITHUB_REPOS') {
    getGitHubRepositories();
  }

  if (msg.type === 'GET_GITHUB_BRANCHES') {
    getGitHubBranches(msg.payload.repo);
  }

  if (msg.type === 'GET_GITHUB_FILES') {
    getGitHubFiles(msg.payload.repo, msg.payload.branch);
  }

  if (msg.type === 'EXPORT_TO_GITHUB') {
    exportToGitHub(msg.payload);
  }

  // Handle request to generate styles JS code
  if (msg.type === 'request-styles-js-code') {
    try {
      if (latestStylesPayload && latestRawVariablesPayload) {
        const jsCode = generateJSCodeFromTextStyles(msg.payload, latestRawVariablesPayload);
        figma.ui.postMessage({
          type: 'stylesJsCodePreview',
          payload: jsCode
        });
      } else {
        figma.ui.postMessage({
          type: 'error',
          message: 'No styles or variables data available. Please generate both styles and variables first.'
        });
      }
    } catch (error) {
      figma.ui.postMessage({
        type: 'error',
        message: `Failed to generate styles JS code: ${error.message}`
      });
    }
  }

  // Handle request to generate styles CSS code
  if (msg.type === 'request-styles-css-code') {
    try {
      if (latestStylesPayload && latestRawVariablesPayload) {
        const cssCode = generateCSSCodeFromTextStyles(msg.payload, latestRawVariablesPayload);
        figma.ui.postMessage({
          type: 'stylesCssCodePreview',
          payload: cssCode
        });
      } else {
        figma.ui.postMessage({
          type: 'error',
          message: 'No styles or variables data available. Please generate both styles and variables first.'
        });
      }
    } catch (error) {
      figma.ui.postMessage({
        type: 'error',
        message: `Failed to generate styles CSS code: ${error.message}`
      });
    }
  }

  // Handle REM settings update
  if (msg.type === 'UPDATE_REM_SETTING') {
    (async () => {
      try {
        const { useRem, baseFontSize } = msg.payload || {};
        
        useRemUnits = useRem !== undefined ? useRem : false;
        remBaseFontSize = baseFontSize !== undefined ? baseFontSize : 16;
        
        await saveRemSettings();
        
        // Send update confirmation first
        figma.ui.postMessage({
          type: 'REM_SETTING_UPDATED',
          payload: {
            useRemUnits,
            remBaseFontSize,
            message: `REM conversion ${useRemUnits ? 'enabled' : 'disabled'}${useRemUnits ? ` (base: ${remBaseFontSize}px)` : ''}`
          }
        });
        
        // Trigger clean data refresh (no state preservation)
        await refreshDataWithCleanReset();
        
        console.log('REM settings updated and data refreshed with clean reset:', { useRemUnits, remBaseFontSize });
      } catch (error) {
        console.error('Error updating REM settings:', error);
        figma.ui.postMessage({
          type: 'error',
          message: 'Failed to update REM settings'
        });
      }
    })();
  }

  // Handle request for current REM settings
  if (msg.type === 'REQUEST_REM_SETTINGS') {
    figma.ui.postMessage({
      type: 'REM_SETTINGS_STATUS',
      payload: {
        useRemUnits,
        remBaseFontSize
      }
    });
  }
};

// Send an initial plugin-info message when the plugin starts
figma.ui.postMessage({
  type: 'plugin-info',
  payload: {
    message: 'Plugin loaded. Fetching variables and styles...'
  }
});

// Automatically fetch and send data when the plugin UI loads
(async () => {
  try {
    // Load REM settings first
    await loadRemSettings();
    
    // Send initial REM settings to UI
    figma.ui.postMessage({
      type: 'REM_SETTINGS_STATUS',
      payload: {
        useRemUnits,
        remBaseFontSize
      }
    });

    // Fetch variables
    const data = await fetchAndLogAllVariables();
    // Use createSimplifiedDTCGPayload with the raw data part of the fetched result
    const simplifiedPayload = await createSimplifiedDTCGPayload(data.raw || data); // data.raw for compatibility, or data if raw is not present
    
    // Store the payload for JS code generation
    latestDtcgPayload = simplifiedPayload;
    
    // Store the raw variables payload for text styles JS generation
    latestRawVariablesPayload = data.raw || data;
    
    figma.ui.postMessage({
      type: 'dtcgPayload',
      payload: simplifiedPayload
    });

    // Fetch styles
    const stylesData = await fetchAndLogAllStyles();
    const nestedStylesData = createNestedStylesPayload(stylesData);
    
    // Store the styles payload for text styles JS generation
    latestStylesPayload = nestedStylesData;
    
    console.log('Initial nested styles payload:', nestedStylesData);
    figma.ui.postMessage({
      type: 'stylesPayload', 
      payload: nestedStylesData
    });

  } catch (error) {
    figma.ui.postMessage({
      type: 'error',
      message: `Failed to fetch or process data on load: ${error.message}`
    });
  }
})();

/**
 * Determines the DTCG type based on variable's resolved type and scopes using consensus logic
 * @param {Object} variable - The variable object with resolvedType and scopes
 * @returns {string} - DTCG type
 */
function resolveDTCGType(variable) {
  if (!variable || !variable.resolvedType) {
    return 'number'; // Default fallback
  }

  const resolvedType = variable.resolvedType;

  // Handle specific types first
  if (resolvedType === 'COLOR') {
    return 'color';
  }

  if (resolvedType === 'STRING') {
    // Heuristic for fontFamily: check variable name if it's a string type
    if (variable.name && (variable.name.toLowerCase().includes('fontfamily') || variable.name.toLowerCase().includes('font-family'))) {
      return 'fontFamily';
    }
    return 'string'; // Default for other strings
  }

  if (resolvedType === 'BOOLEAN') {
    return 'string'; // DTCG doesn't have native boolean
  }

  if (resolvedType === 'FLOAT') {
    const scopes = variable.scopes || [];
    
    // Initialize counters and tracking
    let pixelDimensionScopeMatchCount = 0;
    let unitlessNumericScopeMatchCount = 0;
    const matchedPixelDimensionScopes = new Set();
    const matchedUnitlessNumericScopes = new Set();

    // Categorize scopes
    for (const scope of scopes) {
      if (PIXEL_DIMENSION_SCOPES.has(scope)) {
        pixelDimensionScopeMatchCount++;
        matchedPixelDimensionScopes.add(scope);
      } else if (UNITLESS_NUMERIC_SCOPES.has(scope)) {
        unitlessNumericScopeMatchCount++;
        matchedUnitlessNumericScopes.add(scope);
      }
    }

    // Decision logic based on scope categories
    
    // A. Purely Pixel-Dimensional Intent
    if (pixelDimensionScopeMatchCount > 0 && unitlessNumericScopeMatchCount === 0) {
      if (pixelDimensionScopeMatchCount === 1) {
        const singleScope = matchedPixelDimensionScopes.values().next().value;
        if (SPECIFIC_PIXEL_DIMENSION_TYPE_MAP.has(singleScope)) {
          return SPECIFIC_PIXEL_DIMENSION_TYPE_MAP.get(singleScope);
        }
      }
      // Multiple pixel-dimensional scopes, or single general one (like GAP)
      return 'dimension';
    }

    // B. Purely Unitless-Numeric Intent
    if (unitlessNumericScopeMatchCount > 0 && pixelDimensionScopeMatchCount === 0) {
      if (unitlessNumericScopeMatchCount === 1) {
        const singleScope = matchedUnitlessNumericScopes.values().next().value;
        if (SPECIFIC_UNITLESS_NUMERIC_TYPE_MAP.has(singleScope)) {
          return SPECIFIC_UNITLESS_NUMERIC_TYPE_MAP.get(singleScope);
        }
      }
      // Multiple unitless scopes, or one not in the specific map
      return 'number';
    }

    // C. Mixed Intent (Pixel-Dimensional AND Unitless-Numeric Scopes Present)
    if (pixelDimensionScopeMatchCount > 0 && unitlessNumericScopeMatchCount > 0) {
      return 'number'; // Default for mixed intent
    }

    // D. Fallback Logic (No categorized scopes matched)
    
    // Apply name-based fontWeight heuristic for FLOATs
    if (variable.name && (variable.name.toLowerCase().includes('fontweight') || variable.name.toLowerCase().includes('font-weight'))) {
      return 'fontWeight';
    }

    // Handle general scopes like ALL_SCOPES, TEXT_CONTENT
    const generalScopes = ['ALL_SCOPES', 'TEXT_CONTENT'];
    if (scopes.some(scope => generalScopes.includes(scope))) {
      return 'number';
    }

    // Final fallback
    return 'number';
  }
  
  // Fallback for any unknown types
  return 'number';
}

/**
 * Converts a Figma value to DTCG format
 * @param {*} value - The value to convert
 * @param {string} figmaType - Figma variable type
 * @param {string} dtcgType - DTCG type
 */
function convertFigmaValueToDTCG(value, figmaType, dtcgType) {
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
      const roundedNum = isNaN(num) ? 0 : roundToMaxThreeDecimals(num);
      
      // Define types that require px units (or rem if setting is enabled)
      const TYPES_REQUIRING_PX = new Set([
        'dimension', 
        'fontSize', 
        'lineHeight', 
        'letterSpacing', 
        'borderRadius', 
        'borderWidth'
      ]);
      
      // Add px/rem units for dimensional types
      if (TYPES_REQUIRING_PX.has(dtcgType)) {
        // Use rem conversion if enabled, otherwise use px
        if (useRemUnits) {
          return convertPxToRem(roundedNum, remBaseFontSize);
        } else {
          return `${roundedNum}px`;
        }
      }
      
      // Return unitless for number, fontWeight, opacity, etc.
      return roundedNum;
      
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
    // Reset all state to ensure fresh data
    resetPluginState();
    
    console.log('Starting variable fetch process...');
    
    // Fetch local variables first
    console.log('Fetching local variables...');
    await fetchLocalCollections();
    
    // Fetch shared (team library) variables
    console.log('Fetching shared variables...');
    await fetchSharedCollections();
    
    // Log summary of what was fetched
    const localCount = allFetchedVariablesPayload.local.reduce((sum, collection) => sum + (collection.variables && collection.variables.length ? collection.variables.length : 0), 0);
    const sharedCount = allFetchedVariablesPayload.shared.reduce((sum, collection) => sum + (collection.variables && collection.variables.length ? collection.variables.length : 0), 0);
    console.log(`Fetch complete: ${localCount} local variables, ${sharedCount} shared variables`);
    
    // Log the final fetched payload before DTCG conversion
    console.log('Final fetched variables payload:', allFetchedVariablesPayload);
    
    // Convert fetched variables to DTCG format
    console.log('Converting to DTCG format...');
    const simplifiedPayload = await createSimplifiedDTCGPayload(allFetchedVariablesPayload);
    
    console.log('Variable processing completed successfully');
    
    // End of orchestration function
    return {
      raw: allFetchedVariablesPayload,
      dtcg: simplifiedPayload
    };
  } catch (error) {
    console.error('Error in fetchAndLogAllVariables:', error);
    
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

// Store the latest raw variables payload for text styles JS generation
let latestRawVariablesPayload = null;

// Store the latest styles payload for text styles JS generation  
let latestStylesPayload = null;

// REM conversion settings
let useRemUnits = false;
let remBaseFontSize = 16; // Default base font size for rem calculations

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
      let effectiveValue = currentValue.$value;

      // Handle path transformation logic for ALIASES (e.g., "{colors.slate.2}")
      if (typeof effectiveValue === 'string' && effectiveValue.startsWith('{') && effectiveValue.endsWith('}')) {
        // Extract inner path: "{colors.slate.2}" -> "colors.slate.2"
        const innerPath = effectiveValue.slice(1, -1);
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
      
      // If effectiveValue is a number
      if (typeof effectiveValue === 'number') {
        return String(effectiveValue);
      }
      
      // Handle literal string values
      if (typeof effectiveValue === 'string') {
        return `'${effectiveValue.replace(/'/g, "\'")}'`;
      }
      
      // Handle other value types that might be in $value
      return generateJSCodeRecursive(effectiveValue, pathContext, indentLevel);
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
        cssValue = convertFigmaValueToDTCG(value.$value, value.$type, value.$type);
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

/**
 * Function to create a simplified DTCG-compatible payload from Figma variables data
 * @param {Object} figmaData - The Figma variables data object
 * @returns {Object} - The generated DTCG payload
 */
async function createSimplifiedDTCGPayload(figmaData) {
  const dtcgPayload = {};
  
  // Clear the maps at the beginning of each payload creation
  variableIdToPathMap.clear();
  unresolvedAliaseIdsSuspectedMissingSource.clear();
  
  // Track processed collection signatures for de-duplication
  const processedCollectionSignatures = new Set();
  // Track used collection names for conflict detection
  const usedCollectionNames = new Map(); // name -> {libraryName, finalKey}
  
  // Helper function to determine final collection key with minimal suffix
  function getFinalCollectionKey(collectionName, libraryName) {
    const sCollectionName = sanitizeForDTCG(collectionName);
    const sLibraryName = sanitizeForDTCG(libraryName || 'unnamed-library');
    
    // Check if this exact name is available
    if (!usedCollectionNames.has(sCollectionName)) {
      // Name is available - use original
      usedCollectionNames.set(sCollectionName, { libraryName: sLibraryName, finalKey: sCollectionName });
      return sCollectionName;
    }
    
    // Name conflict - check if it's the same library (shouldn't happen due to de-dup, but safety check)
    const existing = usedCollectionNames.get(sCollectionName);
    if (existing.libraryName === sLibraryName) {
      return existing.finalKey; // Same library, return existing key
    }
    
    // Different library - need suffix
    const suffixedKey = `${sCollectionName}-${sLibraryName}`;
    usedCollectionNames.set(suffixedKey, { libraryName: sLibraryName, finalKey: suffixedKey });
    return suffixedKey;
  }
  
  // First pass: collect all variable IDs and their paths
  // Process local variables
  if (figmaData.local) {
    console.log('Processing local variables for path mapping...');
    figmaData.local.forEach(collection => {
      if (!collection || !collection.name || !collection.variables) return;
      
      const sCollectionName = sanitizeForDTCG(collection.name);
      const sLibraryName = sanitizeForDTCG(collection.libraryName || 'unnamed-library');
      const collectionSignature = sLibraryName + '::' + sCollectionName;
      
      // Skip if already processed (duplicate)
      if (processedCollectionSignatures.has(collectionSignature)) {
        return;
      }
      
      const payloadCollectionKey = getFinalCollectionKey(collection.name, collection.libraryName);
      console.log(`Processing collection: ${collection.name} (${payloadCollectionKey})`);
      
      collection.variables.forEach(variable => {
        if (!variable || !variable.name || !variable.id) return;
        
        // Split variable name by slashes to create hierarchical structure
        const variablePathSegments = variable.name.split('/').map(segment => sanitizeForDTCG(segment));
        
        // Store path for this variable ID using final collection key
        variableIdToPathMap.set(variable.id, {
          collectionKey: payloadCollectionKey,
          path: variablePathSegments
        });
      });
    });
  }
  
  // Process shared variables
  if (figmaData.shared && figmaData.shared.length > 0) {
    console.log('Processing shared variables for path mapping...');
    figmaData.shared.forEach(sharedCollection => {
      if (!sharedCollection || !sharedCollection.name || !sharedCollection.variables) {
        console.warn('Skipping a shared collection due to missing name or variables array:', sharedCollection);
        return;
      }
      
      const sCollectionName = sanitizeForDTCG(sharedCollection.name);
      const sLibraryName = sanitizeForDTCG(sharedCollection.libraryName || 'unnamed-library');
      const collectionSignature = sLibraryName + '::' + sCollectionName;
      
      // Skip if already processed (duplicate)
      if (processedCollectionSignatures.has(collectionSignature)) {
        console.log(`Path mapping: Skipping shared collection '${sharedCollection.name}' from library '${sharedCollection.libraryName}' as it (or its local equivalent) has already been processed for path mapping.`);
        return;
      }
      processedCollectionSignatures.add(collectionSignature);
      
      const payloadCollectionKey = getFinalCollectionKey(sharedCollection.name, sharedCollection.libraryName);
      console.log(`Path mapping: Processing shared collection: ${sharedCollection.name} (Library: ${sharedCollection.libraryName}, Final Key: ${payloadCollectionKey})`);
      
      sharedCollection.variables.forEach(variable => {
        try {
          if (!variable || !variable.id) {
            console.warn(`Path mapping: Skipping shared variable in ${payloadCollectionKey} due to missing variable object or ID:`, variable);
            return;
          }
          // Ensure variable.name is a string before splitting
          const varName = typeof variable.name === 'string' ? variable.name : '';
          const variablePathSegments = varName.split('/').map(segment => sanitizeForDTCG(segment));
          
          variableIdToPathMap.set(variable.id, {
            collectionKey: payloadCollectionKey,
            path: variablePathSegments
          });
          // Optional: Uncomment to confirm every successful mapping
          // console.log(`Path mapping: Mapped shared variable ID ${variable.id} (Name: ${varName}) to path ${payloadCollectionKey}.${variablePathSegments.join('.')}`);
        } catch (e) {
          console.error(`Path mapping: ERROR processing shared variable ID ${variable && variable.id ? variable.id : 'UNKNOWN_ID'} (Name: ${variable && variable.name ? variable.name : 'UNKNOWN_NAME'}) in collection ${payloadCollectionKey}:`, e.message, e.stack);
        }
      });
    });
  }
  
  // Reset tracking for second pass
  processedCollectionSignatures.clear();
  usedCollectionNames.clear();
  
  // Helper function to resolve variable aliases to paths
  async function resolveVariableAlias(aliasId) {
    // Step 1: Try direct lookup in variableIdToPathMap
    let info = variableIdToPathMap.get(aliasId);
    
    if (!info) {
      // Step 2: Use getVariableByIdAsync to resolve library variable ID to local ID
      try {
        const resolvedVariable = await figma.variables.getVariableByIdAsync(aliasId);
        if (resolvedVariable && resolvedVariable.id) {
          info = variableIdToPathMap.get(resolvedVariable.id);
          if (info) {
            console.log(`Resolved library alias ${aliasId} to local ID ${resolvedVariable.id}`);
          }
        }
      } catch (error) {
        console.warn(`Failed to resolve alias ${aliasId}: ${error.message}`);
      }
    }
    
    if (!info) {
      // Add to unresolved if still not found
      const hasAnyVariables = variableIdToPathMap.size > 0;
      if (hasAnyVariables) {
        unresolvedAliaseIdsSuspectedMissingSource.add(aliasId);
      }
      return `{${aliasId}}`;
    }
    
    return `{${[info.collectionKey, ...info.path].join('.')}}`;
  }

  // Helper function to find a variable object by ID in the figmaData
  function findVariableById(variableId, figmaData) {
    // Search in local collections
    if (figmaData.local) {
      for (const collection of figmaData.local) {
        if (collection.variables) {
          for (const variable of collection.variables) {
            if (variable.id === variableId) {
              return variable;
            }
          }
        }
      }
    }
    
    // Search in shared collections
    if (figmaData.shared) {
      for (const collection of figmaData.shared) {
        if (collection.variables) {
          for (const variable of collection.variables) {
            if (variable.id === variableId) {
              return variable;
            }
          }
        }
      }
    }
    
    return null;
  }

  // Second pass: build the actual payload
  // Process the local variables first
  if (figmaData.local) {
    for (const collection of figmaData.local) {
      if (!collection || !collection.name) continue;
      
      const sCollectionName = sanitizeForDTCG(collection.name);
      const sLibraryName = sanitizeForDTCG(collection.libraryName || 'unnamed-library');
      const collectionSignature = sLibraryName + '::' + sCollectionName;
      
      // De-duplication check
      if (processedCollectionSignatures.has(collectionSignature)) {
        console.log(`Skipping duplicate local collection '${collection.name}' from library '${collection.libraryName}'.`);
        continue;
      }
      
      // Add to processed signatures
      processedCollectionSignatures.add(collectionSignature);
      
      // Get final collection key with minimal suffix logic
      const payloadCollectionKey = getFinalCollectionKey(collection.name, collection.libraryName);
      
      // Initialize this collection in our payload
      dtcgPayload[payloadCollectionKey] = {};
      
      // Add modes to this collection
      if (collection.modes && collection.modes.length > 0) {
        collection.modes.forEach(mode => {
          if (!mode || !mode.name) return;
          
          // Initialize this mode in our collection
          const modeKey = sanitizeForDTCG(mode.name);
          dtcgPayload[payloadCollectionKey][modeKey] = {};
        });
      } else {
        // If no modes, create a default mode
        dtcgPayload[payloadCollectionKey]['mode-1'] = {};
      }
      
      // Now add variables to their respective modes
      if (collection.variables) {
        for (const variable of collection.variables) {
          if (!variable || !variable.name || !variable.valuesByMode) continue;
          
          // Split variable name by slashes to create hierarchical structure
          const variablePathSegments = variable.name.split('/').map(segment => sanitizeForDTCG(segment));
          
          // For each mode this variable has values in
          for (const [modeId, value] of Object.entries(variable.valuesByMode)) {
            // Find the mode name for this modeId
            let modeName = 'mode-1'; // Default
            if (collection.modes) {
              const mode = collection.modes.find(m => m.modeId === modeId);
              if (mode && mode.name) {
                modeName = sanitizeForDTCG(mode.name);
              }
            }
            
            // Ensure this mode exists in the collection
            if (!dtcgPayload[payloadCollectionKey][modeName]) {
              dtcgPayload[payloadCollectionKey][modeName] = {};
            }
            
            // Start at the mode level
            let currentObject = dtcgPayload[payloadCollectionKey][modeName];
            
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
              processedValue = await resolveVariableAlias(value.id);
            }

            // Use the new scope-based type resolution
            const dtcgType = resolveDTCGType(variable);
            
            // This is a literal value - convert it using the existing function
            let finalValue;
            if (typeof processedValue === 'string' && processedValue.startsWith('{') && processedValue.endsWith('}')) {
              // This is a resolved alias reference - use it directly without conversion
              finalValue = processedValue;
            } else {
              // This is a literal value - convert it using the existing function
              finalValue = convertFigmaValueToDTCG(processedValue, variable.resolvedType, dtcgType);
            }

            currentObject[variableKey] = {
              $type: dtcgType,
              $value: finalValue
            };
          }
        }
      }
    }
  }
  
  // Process shared collections with de-duplication
  if (figmaData.shared && figmaData.shared.length > 0) {
    for (const sharedCollection of figmaData.shared) {
      if (!sharedCollection || !sharedCollection.name) continue;
      
      const sCollectionName = sanitizeForDTCG(sharedCollection.name);
      const sLibraryName = sanitizeForDTCG(sharedCollection.libraryName || 'unnamed-library');
      const collectionSignature = sLibraryName + '::' + sCollectionName;
      
      // De-duplication check
      if (processedCollectionSignatures.has(collectionSignature)) {
        console.log(`Skipping shared collection '${sharedCollection.name}' from library '${sharedCollection.libraryName}' as it (or its local equivalent) has already been processed.`);
        continue;
      }
      
      // Add to processed signatures
      processedCollectionSignatures.add(collectionSignature);
      
      // Get final collection key with minimal suffix logic
      const payloadCollectionKey = getFinalCollectionKey(sharedCollection.name, sharedCollection.libraryName);
      
      dtcgPayload[payloadCollectionKey] = {};
      
      // Add modes
      if (sharedCollection.modes && sharedCollection.modes.length > 0) {
        sharedCollection.modes.forEach(mode => {
          if (!mode || !mode.name) return;
          
          const modeKey = sanitizeForDTCG(mode.name);
          dtcgPayload[payloadCollectionKey][modeKey] = {};
        });
      } else {
        // Default mode
        dtcgPayload[payloadCollectionKey]['mode-1'] = {};
      }
      
      // Add variables
      if (sharedCollection.variables && sharedCollection.variables.length > 0) {
        for (const variable of sharedCollection.variables) {
          if (!variable || !variable.name || !variable.valuesByMode) continue;
          
          // Split variable name by slashes to create hierarchical structure
          const variablePathSegments = variable.name.split('/').map(segment => sanitizeForDTCG(segment));
          
          // For each mode this variable has values in
          for (const [modeId, value] of Object.entries(variable.valuesByMode)) {
            // Find the mode name for this modeId
            let modeName = 'mode-1'; // Default
            if (sharedCollection.modes) {
              const mode = sharedCollection.modes.find(m => m.modeId === modeId);
              if (mode && mode.name) {
                modeName = sanitizeForDTCG(mode.name);
              }
            }
            
            // Ensure this mode exists
            if (!dtcgPayload[payloadCollectionKey][modeName]) {
              dtcgPayload[payloadCollectionKey][modeName] = {};
            }
            
            // Start at the mode level
            let currentObject = dtcgPayload[payloadCollectionKey][modeName];
            
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
              processedValue = await resolveVariableAlias(value.id);
            }

            // Use the new scope-based type resolution
            const dtcgType = resolveDTCGType(variable);
            
            // This is a literal value - convert it using the existing function
            let finalValue;
            if (typeof processedValue === 'string' && processedValue.startsWith('{') && processedValue.endsWith('}')) {
              // This is a resolved alias reference - use it directly without conversion
              finalValue = processedValue;
            } else {
              // This is a literal value - convert it using the existing function
              finalValue = convertFigmaValueToDTCG(processedValue, variable.resolvedType, dtcgType);
            }

            currentObject[variableKey] = {
              $type: dtcgType,
              $value: finalValue
            };
          }
        }
      }
    }
  }
  
  // If we didn't find any variables, ensure we have at least one collection
  if (Object.keys(dtcgPayload).length === 0) {
    dtcgPayload['default-tokens'] = {
      'mode-1': {}
    };
  }
  
  // After processing all variables, check if there were any suspected missing sources
  if (unresolvedAliaseIdsSuspectedMissingSource.size > 0) {
    // Gather statistics for better debugging
    const totalLocalVariables = figmaData.local ? 
      figmaData.local.reduce((sum, collection) => sum + (collection.variables && collection.variables.length ? collection.variables.length : 0), 0) : 0;
    const totalSharedVariables = figmaData.shared ? 
      figmaData.shared.reduce((sum, collection) => sum + (collection.variables && collection.variables.length ? collection.variables.length : 0), 0) : 0;
    const totalResolvedVariables = variableIdToPathMap.size;
    
    console.warn('Variable resolution summary:', {
      totalLocalVariables,
      totalSharedVariables,
      totalResolvedVariables,
      unresolvedAliases: unresolvedAliaseIdsSuspectedMissingSource.size,
      unresolvedIds: Array.from(unresolvedAliaseIdsSuspectedMissingSource)
    });
    
    // Only show warning if we have a significant number of unresolved aliases
    // or if the ratio of unresolved to resolved is concerning
    const unresolvedRatio = unresolvedAliaseIdsSuspectedMissingSource.size / Math.max(totalResolvedVariables, 1);
    
    if (unresolvedAliaseIdsSuspectedMissingSource.size >= 3 || unresolvedRatio > 0.1) {
      figma.ui.postMessage({
        type: 'warning-potential-missing-source',
        payload: {
          message: `Found ${unresolvedAliaseIdsSuspectedMissingSource.size} unresolved variable aliases out of ${totalResolvedVariables} total variables. This might indicate missing libraries or deleted variables. Check the browser console for specific variable IDs.`,
          details: {
            unresolvedCount: unresolvedAliaseIdsSuspectedMissingSource.size,
            totalVariables: totalResolvedVariables,
            localVariables: totalLocalVariables,
            sharedVariables: totalSharedVariables
          }
        }
      });
    } else {
      // Minor issues - just log to console
      console.warn(`Found ${unresolvedAliaseIdsSuspectedMissingSource.size} minor unresolved aliases - likely not a significant issue.`);
    }
  } else {
    console.log('All variable aliases resolved successfully!');
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
 * @param {string} figmaResolvedType - The resolved type from Figma
 * @returns {string} - DTCG type
 */
function mapFigmaTypeToDTCG(figmaResolvedType) {
  const typeMap = {
    'COLOR': 'color',
    'FLOAT': 'dimension',
    'STRING': 'string',
    'BOOLEAN': 'string' // Map to string since DTCG doesn't have native boolean
  };
  
  return typeMap[figmaResolvedType] || 'string';
}

// GitHub Authentication Functions

/**
 * Check current GitHub authentication status
 */
async function checkGitHubAuthStatus() {
  try {
    const storedPat = await figma.clientStorage.getAsync('githubPat');
    const storedUsername = await figma.clientStorage.getAsync('githubUsername');
    
    if (storedPat) {
      // Verify the token is still valid
      const isValid = await validateGitHubPAT(storedPat);
      if (isValid) {
        figma.ui.postMessage({
          type: 'GITHUB_AUTH_STATUS',
          payload: {
            isAuthenticated: true,
            username: storedUsername || 'Unknown'
          }
        });
      } else {
        // Token is invalid, clear stored data
        await figma.clientStorage.setAsync('githubPat', null);
        await figma.clientStorage.setAsync('githubUsername', null);
        figma.ui.postMessage({
          type: 'GITHUB_AUTH_STATUS',
          payload: {
            isAuthenticated: false
          }
        });
      }
    } else {
      figma.ui.postMessage({
        type: 'GITHUB_AUTH_STATUS',
        payload: {
          isAuthenticated: false
        }
      });
    }
  } catch (error) {
    console.error('Error checking GitHub auth status:', error);
    figma.ui.postMessage({
      type: 'GITHUB_AUTH_STATUS',
      payload: {
        isAuthenticated: false
      }
    });
  }
}

/**
 * Check GitHub authentication status for export
 */
async function checkGitHubAuthForExport() {
  try {
    const storedPat = await figma.clientStorage.getAsync('githubPat');
    
    if (storedPat) {
      // Verify the token is still valid
      const isValid = await validateGitHubPAT(storedPat);
      if (isValid) {
        // User is authenticated, proceed with export flow (to be implemented)
        figma.ui.postMessage({
          type: 'GITHUB_EXPORT_READY',
          payload: {
            message: 'Ready to export to GitHub'
          }
        });
      } else {
        // Token is invalid, require re-authentication
        await figma.clientStorage.setAsync('githubPat', null);
        await figma.clientStorage.setAsync('githubUsername', null);
        figma.ui.postMessage({
          type: 'GITHUB_AUTH_REQUIRED_FOR_EXPORT',
          payload: {
            message: 'GitHub authentication required'
          }
        });
      }
    } else {
      // No token stored, require authentication
      figma.ui.postMessage({
        type: 'GITHUB_AUTH_REQUIRED_FOR_EXPORT',
        payload: {
          message: 'GitHub authentication required'
        }
      });
    }
  } catch (error) {
    console.error('Error checking GitHub auth for export:', error);
    figma.ui.postMessage({
      type: 'GITHUB_AUTH_REQUIRED_FOR_EXPORT',
      payload: {
        message: 'GitHub authentication required'
      }
    });
  }
}

/**
 * Authenticate with GitHub using Personal Access Token
 * @param {string} pat - Personal Access Token
 */
async function authenticateWithGitHub(pat) {
  try {
    // Validate the PAT by making a request to GitHub API
    const userInfo = await validateGitHubPAT(pat, true);
    
    if (userInfo) {
      // Store the PAT and username
      await figma.clientStorage.setAsync('githubPat', pat);
      await figma.clientStorage.setAsync('githubUsername', userInfo.login);
      
      figma.ui.postMessage({
        type: 'GITHUB_AUTH_SUCCESS',
        payload: {
          username: userInfo.login
        }
      });
    } else {
      figma.ui.postMessage({
        type: 'GITHUB_AUTH_ERROR',
        payload: {
          error: 'Invalid GitHub Personal Access Token. Please check your token and try again.'
        }
      });
    }
  } catch (error) {
    console.error('GitHub authentication error:', error);
    figma.ui.postMessage({
      type: 'GITHUB_AUTH_ERROR',
      payload: {
        error: error.message || 'Authentication failed. Please check your internet connection and try again.'
      }
    });
  }
}

/**
 * Disconnect from GitHub by clearing stored credentials
 */
async function disconnectGitHub() {
  try {
    await figma.clientStorage.setAsync('githubPat', null);
    await figma.clientStorage.setAsync('githubUsername', null);
    
    figma.ui.postMessage({
      type: 'GITHUB_DISCONNECTED',
      payload: {
        message: 'Successfully disconnected from GitHub'
      }
    });
  } catch (error) {
    console.error('Error disconnecting from GitHub:', error);
    figma.ui.postMessage({
      type: 'error',
      message: 'Failed to disconnect from GitHub'
    });
  }
}

/**
 * Validate GitHub Personal Access Token
 * @param {string} pat - Personal Access Token
 * @param {boolean} returnUserInfo - Whether to return user info or just validation status
 * @returns {Promise<boolean|Object>} - Validation status or user info object
 */
async function validateGitHubPAT(pat, returnUserInfo = false) {
  try {
    console.log('Validating GitHub PAT, returnUserInfo:', returnUserInfo);
    
    const response = await fetch('https://api.github.com/user', {
      method: 'GET',
      headers: {
        'Authorization': `token ${pat}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Toko-Figma-Plugin'
      }
    });

    console.log('PAT validation response status:', response.status);

    if (response.ok) {
      if (returnUserInfo) {
        const userInfo = await response.json();
        console.log('PAT validation successful for user:', userInfo.login);
        return userInfo;
      } else {
        console.log('PAT validation successful');
        return true;
      }
    } else {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error('GitHub PAT validation failed:', response.status, errorText);
      return false;
    }
  } catch (error) {
    console.error('Network error validating GitHub PAT:', error);
    if (returnUserInfo) {
      return null;
    } else {
      return false;
    }
  }
}

/**
 * Check GitHub authentication status for export modal
 */
async function checkGitHubAuthForModal() {
  try {
    const storedPat = await figma.clientStorage.getAsync('githubPat');
    const storedUsername = await figma.clientStorage.getAsync('githubUsername');
    
    console.log('Checking auth for modal - PAT exists:', !!storedPat, 'Username:', storedUsername);
    
    if (storedPat) {
      // Verify the token is still valid
      const userInfo = await validateGitHubPAT(storedPat, true);
      if (userInfo) {
        console.log('Auth verified for user:', userInfo.login);
        // Update stored username if needed
        if (userInfo.login !== storedUsername) {
          await figma.clientStorage.setAsync('githubUsername', userInfo.login);
        }
        
        figma.ui.postMessage({
          type: 'GITHUB_AUTH_SUCCESS_FOR_MODAL',
          payload: {
            message: 'Authentication verified',
            username: userInfo.login
          }
        });
      } else {
        console.log('Token validation failed');
        // Token is invalid, require re-authentication
        await figma.clientStorage.setAsync('githubPat', null);
        await figma.clientStorage.setAsync('githubUsername', null);
        figma.ui.postMessage({
          type: 'GITHUB_AUTH_REQUIRED_FOR_MODAL',
          payload: {
            message: 'GitHub authentication required - token invalid'
          }
        });
      }
    } else {
      console.log('No token stored');
      // No token stored, require authentication
      figma.ui.postMessage({
        type: 'GITHUB_AUTH_REQUIRED_FOR_MODAL',
        payload: {
          message: 'GitHub authentication required - no token'
        }
      });
    }
  } catch (error) {
    console.error('Error checking GitHub auth for modal:', error);
    figma.ui.postMessage({
      type: 'GITHUB_AUTH_REQUIRED_FOR_MODAL',
      payload: {
        message: 'GitHub authentication required - error occurred'
      }
    });
  }
}

/**
 * Get GitHub repositories for the authenticated user
 */
async function getGitHubRepositories() {
  try {
    const storedPat = await figma.clientStorage.getAsync('githubPat');
    const storedUsername = await figma.clientStorage.getAsync('githubUsername');
    
    console.log('Getting repositories with username:', storedUsername);
    
    if (!storedPat) {
      console.error('No PAT found');
      figma.ui.postMessage({
        type: 'GITHUB_AUTH_REQUIRED_FOR_MODAL',
        payload: {
          message: 'GitHub authentication required'
        }
      });
      return;
    }

    const response = await fetch('https://api.github.com/user/repos?type=all&sort=updated&per_page=100', {
      method: 'GET',
      headers: {
        'Authorization': `token ${storedPat}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Toko-Figma-Plugin'
      }
    });

    console.log('GitHub repos API response status:', response.status);

    if (response.ok) {
      const repos = await response.json();
      console.log('Fetched repos count:', repos.length);
      
      const repoData = repos.map(repo => ({
        name: repo.name,
        fullName: repo.full_name,
        private: repo.private,
        defaultBranch: repo.default_branch
      }));

      figma.ui.postMessage({
        type: 'GITHUB_REPOS_LOADED',
        payload: {
          repos: repoData
        }
      });
    } else {
      const errorText = await response.text();
      console.error('GitHub API error:', response.status, errorText);
      
      const errorData = errorText ? JSON.parse(errorText) : {};
      figma.ui.postMessage({
        type: 'GITHUB_API_ERROR',
        payload: {
          error: errorData.message || `Failed to fetch repositories (${response.status})`
        }
      });
    }
  } catch (error) {
    console.error('Error fetching GitHub repositories:', error);
    figma.ui.postMessage({
      type: 'GITHUB_API_ERROR',
      payload: {
        error: 'Network error while fetching repositories'
      }
    });
  }
}

/**
 * Get GitHub branches for a specific repository
 * @param {string} repoName - Repository name
 */
async function getGitHubBranches(repoName) {
  try {
    const storedPat = await figma.clientStorage.getAsync('githubPat');
    const storedUsername = await figma.clientStorage.getAsync('githubUsername');
    
    if (!storedPat || !storedUsername) {
      figma.ui.postMessage({
        type: 'GITHUB_AUTH_REQUIRED_FOR_MODAL',
        payload: {
          message: 'GitHub authentication required'
        }
      });
      return;
    }

    const response = await fetch(`https://api.github.com/repos/${storedUsername}/${repoName}/branches?per_page=100`, {
      method: 'GET',
      headers: {
        'Authorization': `token ${storedPat}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Toko-Figma-Plugin'
      }
    });

    if (response.ok) {
      const branches = await response.json();
      const branchData = branches.map(branch => ({
        name: branch.name,
        sha: branch.commit.sha
      }));

      figma.ui.postMessage({
        type: 'GITHUB_BRANCHES_LOADED',
        payload: {
          branches: branchData
        }
      });
    } else {
      const errorData = await response.json().catch(() => ({}));
      figma.ui.postMessage({
        type: 'GITHUB_API_ERROR',
        payload: {
          error: errorData.message || 'Failed to fetch branches'
        }
      });
    }
  } catch (error) {
    console.error('Error fetching GitHub branches:', error);
    figma.ui.postMessage({
      type: 'GITHUB_API_ERROR',
      payload: {
        error: 'Network error while fetching branches'
      }
    });
  }
}

/**
 * Get all files in a GitHub repository branch with full paths (supporting folders)
 * @param {string} repoName - Repository name
 * @param {string} branchName - Branch name
 */
async function getGitHubFiles(repoName, branchName) {
  try {
    const storedPat = await figma.clientStorage.getAsync('githubPat');
    const storedUsername = await figma.clientStorage.getAsync('githubUsername');
    
    if (!storedPat || !storedUsername) {
      figma.ui.postMessage({
        type: 'GITHUB_AUTH_REQUIRED_FOR_MODAL',
        payload: {
          message: 'GitHub authentication required'
        }
      });
      return;
    }

    // First, get the branch information to get the tree SHA
    const branchResponse = await fetch(`https://api.github.com/repos/${storedUsername}/${repoName}/git/refs/heads/${branchName}`, {
      method: 'GET',
      headers: {
        'Authorization': `token ${storedPat}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Toko-Figma-Plugin'
      }
    });

    if (!branchResponse.ok) {
      const errorData = await branchResponse.json().catch(() => ({}));
      figma.ui.postMessage({
        type: 'GITHUB_API_ERROR',
        payload: {
          error: errorData.message || 'Failed to fetch branch information'
        }
      });
      return;
    }

    const branchInfo = await branchResponse.json();
    const commitSha = branchInfo.object.sha;

    // Get the commit to find the tree SHA
    const commitResponse = await fetch(`https://api.github.com/repos/${storedUsername}/${repoName}/git/commits/${commitSha}`, {
      method: 'GET',
      headers: {
        'Authorization': `token ${storedPat}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Toko-Figma-Plugin'
      }
    });

    if (!commitResponse.ok) {
      const errorData = await commitResponse.json().catch(() => ({}));
      figma.ui.postMessage({
        type: 'GITHUB_API_ERROR',
        payload: {
          error: errorData.message || 'Failed to fetch commit information'
        }
      });
      return;
    }

    const commitInfo = await commitResponse.json();
    const treeSha = commitInfo.tree.sha;

    // Now get the entire tree recursively
    const treeResponse = await fetch(`https://api.github.com/repos/${storedUsername}/${repoName}/git/trees/${treeSha}?recursive=1`, {
      method: 'GET',
      headers: {
        'Authorization': `token ${storedPat}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Toko-Figma-Plugin'
      }
    });

    if (treeResponse.ok) {
      const treeData = await treeResponse.json();
      
      // Filter for files only (not trees/directories) and relevant file types
      const fileData = treeData.tree
        .filter(item => item.type === 'blob') // blob = file, tree = directory
        .filter(file => {
          const fileName = file.path.toLowerCase();
          return fileName.endsWith('.json') || 
                 fileName.endsWith('.js') || 
                 fileName.endsWith('.css') ||
                 fileName.endsWith('.ts') ||
                 fileName.endsWith('.config.js');
        })
        .map(file => ({
          name: file.path, // Use full path as name for display
          path: file.path, // Keep full path
          sha: file.sha
        }))
        .sort((a, b) => a.path.localeCompare(b.path)); // Sort alphabetically by path

      figma.ui.postMessage({
        type: 'GITHUB_FILES_LOADED',
        payload: {
          files: fileData
        }
      });
    } else {
      const errorData = await treeResponse.json().catch(() => ({}));
      figma.ui.postMessage({
        type: 'GITHUB_API_ERROR',
        payload: {
          error: errorData.message || 'Failed to fetch repository tree'
        }
      });
    }
  } catch (error) {
    console.error('Error fetching GitHub files:', error);
    figma.ui.postMessage({
      type: 'GITHUB_API_ERROR',
      payload: {
        error: 'Network error while fetching files'
      }
    });
  }
}

/**
 * Export content to GitHub
 * @param {Object} exportData - Export configuration
 */
async function exportToGitHub(exportData) {
  try {
    const storedPat = await figma.clientStorage.getAsync('githubPat');
    const storedUsername = await figma.clientStorage.getAsync('githubUsername');
    
    if (!storedPat || !storedUsername) {
      figma.ui.postMessage({
        type: 'GITHUB_AUTH_REQUIRED_FOR_MODAL',
        payload: {
          message: 'GitHub authentication required'
        }
      });
      return;
    }

    const { repository, branch, fileName, content, isNewRepo, isNewBranch, contentType } = exportData;

    // Step 1: Create repository if needed
    if (isNewRepo) {
      await createGitHubRepository(repository, storedPat);
    }

    // Step 2: Create branch if needed
    if (isNewBranch) {
      await createGitHubBranch(repository, branch, storedPat, storedUsername);
    }

    // Step 3: Create or update file
    await createOrUpdateGitHubFile(repository, branch, fileName, content, storedPat, storedUsername);

    figma.ui.postMessage({
      type: 'GITHUB_EXPORT_SUCCESS',
      payload: {
        message: `Successfully exported to ${repository}/${fileName}`
      }
    });

  } catch (error) {
    console.error('Error exporting to GitHub:', error);
    figma.ui.postMessage({
      type: 'GITHUB_EXPORT_ERROR',
      payload: {
        error: error.message || 'Export failed. Please try again.'
      }
    });
  }
}

/**
 * Create a new GitHub repository
 * @param {string} repoName - Repository name
 * @param {string} pat - Personal Access Token
 */
async function createGitHubRepository(repoName, pat) {
  const response = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: {
      'Authorization': `token ${pat}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'Toko-Figma-Plugin',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: repoName,
      description: 'Design tokens exported from Figma using Toko',
      private: false,
      auto_init: true
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || 'Failed to create repository');
  }
}

/**
 * Create a new GitHub branch
 * @param {string} repoName - Repository name
 * @param {string} branchName - Branch name
 * @param {string} pat - Personal Access Token
 * @param {string} username - GitHub username
 */
async function createGitHubBranch(repoName, branchName, pat, username) {
  // First, get the default branch SHA
  const defaultBranchResponse = await fetch(`https://api.github.com/repos/${username}/${repoName}`, {
    method: 'GET',
    headers: {
      'Authorization': `token ${pat}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'Toko-Figma-Plugin'
    }
  });

  if (!defaultBranchResponse.ok) {
    throw new Error('Failed to get repository information');
  }

  const repoInfo = await defaultBranchResponse.json();
  const defaultBranch = repoInfo.default_branch;

  // Get the SHA of the default branch
  const branchResponse = await fetch(`https://api.github.com/repos/${username}/${repoName}/git/refs/heads/${defaultBranch}`, {
    method: 'GET',
    headers: {
      'Authorization': `token ${pat}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'Toko-Figma-Plugin'
    }
  });

  if (!branchResponse.ok) {
    throw new Error('Failed to get default branch information');
  }

  const branchInfo = await branchResponse.json();
  const sha = branchInfo.object.sha;

  // Create the new branch
  const createBranchResponse = await fetch(`https://api.github.com/repos/${username}/${repoName}/git/refs`, {
    method: 'POST',
    headers: {
      'Authorization': `token ${pat}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'Toko-Figma-Plugin',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      ref: `refs/heads/${branchName}`,
      sha: sha
    })
  });

  if (!createBranchResponse.ok) {
    const errorData = await createBranchResponse.json().catch(() => ({}));
    throw new Error(errorData.message || 'Failed to create branch');
  }
}

/**
 * Custom base64 encoding function for Figma plugin environment
 * @param {string} str - The string to encode
 * @returns {string} - Base64 encoded string
 */
function base64Encode(str) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  let i = 0;
  
  // Convert string to UTF-8 bytes
  const utf8Bytes = [];
  for (let j = 0; j < str.length; j++) {
    const charCode = str.charCodeAt(j);
    if (charCode < 0x80) {
      utf8Bytes.push(charCode);
    } else if (charCode < 0x800) {
      utf8Bytes.push(0xc0 | (charCode >> 6));
      utf8Bytes.push(0x80 | (charCode & 0x3f));
    } else if (charCode < 0xd800 || charCode >= 0xe000) {
      utf8Bytes.push(0xe0 | (charCode >> 12));
      utf8Bytes.push(0x80 | ((charCode >> 6) & 0x3f));
      utf8Bytes.push(0x80 | (charCode & 0x3f));
    } else {
      // Surrogate pair
      j++;
      const surrogate = 0x10000 + (((charCode & 0x3ff) << 10) | (str.charCodeAt(j) & 0x3ff));
      utf8Bytes.push(0xf0 | (surrogate >> 18));
      utf8Bytes.push(0x80 | ((surrogate >> 12) & 0x3f));
      utf8Bytes.push(0x80 | ((surrogate >> 6) & 0x3f));
      utf8Bytes.push(0x80 | (surrogate & 0x3f));
    }
  }
  
  // Base64 encode the UTF-8 bytes
  while (i < utf8Bytes.length) {
    const byte1 = utf8Bytes[i++];
    const byte2 = i < utf8Bytes.length ? utf8Bytes[i++] : 0;
    const byte3 = i < utf8Bytes.length ? utf8Bytes[i++] : 0;
    
    const bitmap = (byte1 << 16) | (byte2 << 8) | byte3;
    
    result += chars.charAt((bitmap >> 18) & 63);
    result += chars.charAt((bitmap >> 12) & 63);
    result += i - 2 < utf8Bytes.length ? chars.charAt((bitmap >> 6) & 63) : '=';
    result += i - 1 < utf8Bytes.length ? chars.charAt(bitmap & 63) : '=';
  }
  
  return result;
}

/**
 * Create or update a file in GitHub
 * @param {string} repoName - Repository name
 * @param {string} branchName - Branch name
 * @param {string} fileName - File name
 * @param {string} content - File content
 * @param {string} pat - Personal Access Token
 * @param {string} username - GitHub username
 */
async function createOrUpdateGitHubFile(repoName, branchName, fileName, content, pat, username) {
  const encodedContent = base64Encode(content);
  let existingFileSha = null;
  let commitMessage = '';

  // Check if file already exists
  try {
    const fileResponse = await fetch(`https://api.github.com/repos/${username}/${repoName}/contents/${fileName}?ref=${branchName}`, {
      method: 'GET',
      headers: {
        'Authorization': `token ${pat}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Toko-Figma-Plugin'
      }
    });

    if (fileResponse.ok) {
      const fileData = await fileResponse.json();
      existingFileSha = fileData.sha;
      commitMessage = `Update ${fileName}`;
    }
  } catch (error) {
    // File doesn't exist, which is fine for creation
  }

  if (!existingFileSha) {
    commitMessage = `Add ${fileName} (exported from Figma using Toko)`;
  }

  // Create or update the file
  const requestBody = {
    message: commitMessage,
    content: encodedContent,
    branch: branchName
  };
  
  // Add SHA if file exists (for updates)
  if (existingFileSha) {
    requestBody.sha = existingFileSha;
  }

  const updateResponse = await fetch(`https://api.github.com/repos/${username}/${repoName}/contents/${fileName}`, {
    method: 'PUT',
    headers: {
      'Authorization': `token ${pat}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'Toko-Figma-Plugin',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  if (!updateResponse.ok) {
    const errorData = await updateResponse.json().catch(() => ({}));
    throw new Error(errorData.message || 'Failed to create/update file');
  }
}

/**
 * Generates JavaScript code from text styles payload
 * @param {Object} stylesPayload - The nested styles payload
 * @param {Object} rawVariablesPayload - The raw variables payload for finding bound variables
 * @returns {string} - The generated JavaScript code
 */
function generateJSCodeFromTextStyles(stylesPayload, rawVariablesPayload) {
  if (!stylesPayload || typeof stylesPayload !== 'object') {
    return '{}';
  }

  // Extract text styles from the nested payload
  const textStyles = stylesPayload.text || stylesPayload;
  
  if (!textStyles || typeof textStyles !== 'object') {
    return '{}';
  }

  const jsObject = {};
  
  // Process each text style
  processTextStylesRecursive(textStyles, jsObject, [], rawVariablesPayload);
  
  // Generate JS code using the same logic as variables
  const intermediateJsString = generateJSCodeRecursive(jsObject, [], 0);
  const finalJsString = intermediateJsString.replace(/LB/g, '["').replace(/RB/g, '"]');
  
  return finalJsString;
}

/**
 * Recursively processes text styles and builds the JavaScript object
 * @param {Object} currentNode - Current node in the styles tree
 * @param {Object} targetObject - Target object to build
 * @param {Array} currentPath - Current path in the tree
 * @param {Object} rawVariablesPayload - Raw variables payload for finding bound variables
 */
function processTextStylesRecursive(currentNode, targetObject, currentPath, rawVariablesPayload) {
  if (!currentNode || typeof currentNode !== 'object') {
    return;
  }

  for (const key in currentNode) {
    const value = currentNode[key];
    
    // Check if this is a text style object (has style properties)
    if (value && typeof value === 'object' && value.type === 'TEXT') {
      // This is a text style - convert it to JS object
      const styleObject = convertTextStyleToJSObject(value, rawVariablesPayload);
      targetObject[key] = styleObject;
    } else if (value && typeof value === 'object' && !value.type) {
      // This is a group - recurse deeper
      targetObject[key] = {};
      processTextStylesRecursive(value, targetObject[key], [...currentPath, key], rawVariablesPayload);
    }
  }
}

/**
 * Converts a single text style to a JavaScript object with variable references
 * @param {Object} textStyle - The text style object
 * @param {Object} rawVariablesPayload - Raw variables payload for finding bound variables
 * @returns {Object} - JavaScript object representing the text style
 */
function convertTextStyleToJSObject(textStyle, rawVariablesPayload) {
  const jsStyle = {};
  
  // Handle fontFamily
  if (textStyle.fontName && textStyle.fontName.family) {
    const fontFamilyRef = findVariableReference('fontFamily', textStyle.fontName.family, textStyle.boundVariables, rawVariablesPayload);
    jsStyle.fontFamily = fontFamilyRef || `'${textStyle.fontName.family}'`;
  }
  
  // Handle fontSize
  if (textStyle.fontSize !== undefined) {
    const fontSizeRef = findVariableReference('fontSize', textStyle.fontSize, textStyle.boundVariables, rawVariablesPayload);
    jsStyle.fontSize = fontSizeRef || `'${textStyle.fontSize}px'`;
  }
  
  // Handle lineHeight
  if (textStyle.lineHeight !== undefined) {
    const lineHeightRef = findVariableReference('lineHeight', textStyle.lineHeight, textStyle.boundVariables, rawVariablesPayload);
    if (lineHeightRef) {
      jsStyle.lineHeight = lineHeightRef;
    } else {
      // Handle different lineHeight types
      if (typeof textStyle.lineHeight === 'object' && textStyle.lineHeight.unit) {
        if (textStyle.lineHeight.unit === 'PIXELS') {
          jsStyle.lineHeight = `'${textStyle.lineHeight.value}px'`;
        } else if (textStyle.lineHeight.unit === 'PERCENT') {
          jsStyle.lineHeight = `'${textStyle.lineHeight.value}%'`;
        } else {
          jsStyle.lineHeight = textStyle.lineHeight.value;
        }
      } else {
        jsStyle.lineHeight = textStyle.lineHeight;
      }
    }
  }
  
  // Handle letterSpacing
  if (textStyle.letterSpacing !== undefined) {
    const letterSpacingRef = findVariableReference('letterSpacing', textStyle.letterSpacing, textStyle.boundVariables, rawVariablesPayload);
    if (letterSpacingRef) {
      jsStyle.letterSpacing = letterSpacingRef;
    } else {
      // Handle different letterSpacing types
      if (typeof textStyle.letterSpacing === 'object' && textStyle.letterSpacing.unit) {
        if (textStyle.letterSpacing.unit === 'PIXELS') {
          jsStyle.letterSpacing = `'${textStyle.letterSpacing.value}px'`;
        } else if (textStyle.letterSpacing.unit === 'PERCENT') {
          jsStyle.letterSpacing = `'${textStyle.letterSpacing.value}%'`;
        } else {
          jsStyle.letterSpacing = textStyle.letterSpacing.value;
        }
      } else {
        jsStyle.letterSpacing = textStyle.letterSpacing;
      }
    }
  }
  
  // Handle fontWeight
  if (textStyle.fontName && textStyle.fontName.style) {
    const fontWeightRef = findVariableReference('fontWeight', textStyle.fontName.style, textStyle.boundVariables, rawVariablesPayload);
    if (fontWeightRef) {
      jsStyle.fontWeight = fontWeightRef;
    } else {
      // Map font weight to numeric value and try to find variable
      const numericWeight = mapFontWeight(textStyle.fontName.style);
      const weightRef = findVariableByValue('fontWeight', numericWeight, rawVariablesPayload);
      jsStyle.fontWeight = weightRef || numericWeight;
    }
  }
  
  return jsStyle;
}

/**
 * Maps font weight names to numeric values
 * @param {string|number} fontWeight - Font weight value
 * @returns {number} - Numeric font weight
 */
function mapFontWeight(fontWeight) {
  if (typeof fontWeight === 'number') {
    return fontWeight;
  }
  
  const weightMap = {
    'Thin': 100,
    'Extra Light': 200,
    'Light': 300,
    'Regular': 400,
    'Medium': 500,
    'Semi Bold': 600,
    'Bold': 700,
    'Extra Bold': 800,
    'Black': 900
  };
  
  return weightMap[fontWeight] || 400;
}

/**
 * Finds a variable reference for a given property and value
 * @param {string} propertyType - Type of property (fontSize, fontWeight, etc.)
 * @param {*} value - The value to find
 * @param {Object} boundVariables - Bound variables from the style
 * @param {Object} rawVariablesPayload - Raw variables payload
 * @returns {string|null} - Variable reference or null
 */
function findVariableReference(propertyType, value, boundVariables, rawVariablesPayload) {
  // First, check if there's a direct bound variable for this property
  if (boundVariables && boundVariables[propertyType]) {
    const variableId = boundVariables[propertyType].id;
    return findVariablePathById(variableId, rawVariablesPayload);
  }
  
  // If no bound variable, try to find by value
  return findVariableByValue(propertyType, value, rawVariablesPayload);
}

/**
 * Finds a variable by its ID and returns the JavaScript path
 * @param {string} variableId - Variable ID to find
 * @param {Object} rawVariablesPayload - Raw variables payload
 * @returns {string|null} - JavaScript path or null
 */
function findVariablePathById(variableId, rawVariablesPayload) {
  // Search through all collections and variables
  const collections = [...(rawVariablesPayload.local || []), ...(rawVariablesPayload.shared || [])];
  
  for (const collection of collections) {
    if (!collection.variables) continue;
    
    for (const variable of collection.variables) {
      if (variable.id === variableId) {
        // Build the path: collectionName.variableName
        const collectionName = sanitizeForDTCG(collection.name);
        const variablePath = variable.name.split('/').map(segment => sanitizeForDTCG(segment));
        
        // Handle numeric segments
        let pathString = [collectionName, ...variablePath].join('.');
        const lastSegment = variablePath[variablePath.length - 1];
        if (/^\d+$/.test(lastSegment)) {
          const lastDotIndex = pathString.lastIndexOf('.');
          if (lastDotIndex !== -1) {
            pathString = pathString.substring(0, lastDotIndex) + 'LB' + lastSegment + 'RB';
          }
        }
        
        return pathString;
      }
    }
  }
  
  return null;
}

/**
 * Finds a variable by its value and property type
 * @param {string} propertyType - Type of property to search for
 * @param {*} targetValue - Value to find
 * @param {Object} rawVariablesPayload - Raw variables payload
 * @returns {string|null} - Variable reference or null
 */
function findVariableByValue(propertyType, targetValue, rawVariablesPayload) {
  const collections = [...(rawVariablesPayload.local || []), ...(rawVariablesPayload.shared || [])];
  
  for (const collection of collections) {
    if (!collection.variables) continue;
    
    for (const variable of collection.variables) {
      // Check if this variable matches our property type by name or scopes
      const variableName = variable.name.toLowerCase();
      const scopes = variable.scopes || [];
      
      let isMatchingType = false;
      
      // Check by property type and scopes
      if (propertyType === 'fontWeight' && (
        variableName.includes('fontweight') || 
        variableName.includes('font-weight') ||
        scopes.includes('FONT_WEIGHT')
      )) {
        isMatchingType = true;
      } else if (propertyType === 'fontSize' && (
        variableName.includes('fontsize') || 
        variableName.includes('font-size') ||
        scopes.includes('FONT_SIZE')
      )) {
        isMatchingType = true;
      } else if (propertyType === 'lineHeight' && (
        variableName.includes('lineheight') || 
        variableName.includes('line-height') ||
        scopes.includes('LINE_HEIGHT')
      )) {
        isMatchingType = true;
      } else if (propertyType === 'letterSpacing' && (
        variableName.includes('letterspacing') || 
        variableName.includes('letter-spacing') ||
        scopes.includes('LETTER_SPACING')
      )) {
        isMatchingType = true;
      } else if (propertyType === 'fontFamily' && (
        variableName.includes('fontfamily') || 
        variableName.includes('font-family')
      )) {
        isMatchingType = true;
      }
      
      if (!isMatchingType) continue;
      
      // Check if any mode has the target value
      for (const [modeId, value] of Object.entries(variable.valuesByMode || {})) {
        if (value === targetValue || 
           (typeof value === 'string' && value === String(targetValue))) {
          // Build the path
          const collectionName = sanitizeForDTCG(collection.name);
          const variablePath = variable.name.split('/').map(segment => sanitizeForDTCG(segment));
          
          let pathString = [collectionName, ...variablePath].join('.');
          const lastSegment = variablePath[variablePath.length - 1];
          if (/^\d+$/.test(lastSegment)) {
            const lastDotIndex = pathString.lastIndexOf('.');
            if (lastDotIndex !== -1) {
              pathString = pathString.substring(0, lastDotIndex) + 'LB' + lastSegment + 'RB';
            }
          }
          
          return pathString;
        }
      }
    }
  }
  
  return null;
}

/**
 * Generate CSS code from text styles payload
 */
function generateCSSCodeFromTextStyles(stylesPayload, rawVariablesPayload) {
  console.log("Generating CSS code from text styles:", stylesPayload);
  
  if (!stylesPayload || Object.keys(stylesPayload).length === 0) {
    return {
      code: '',
      structure: {}
    };
  }

  // Generate CSS classes
  let cssCode = '/* Generated Text Styles CSS */\n';
  cssCode += '/* This CSS contains utility classes for your Figma text styles. */\n';
  cssCode += '/* CSS variables are defined in the Variables tab and referenced here with var() syntax. */\n\n';
  
  const cssClasses = {};
  
  // Process the styles payload recursively
  processCSSStylesRecursive(stylesPayload, cssClasses, [], rawVariablesPayload);
  
  // Convert cssClasses object to CSS string
  const classNames = Object.keys(cssClasses).sort(); // Sort for consistent output
  
  for (const className of classNames) {
    const styles = cssClasses[className];
    cssCode += `.${className} {\n`;
    
    // Sort properties for consistent output
    const properties = Object.keys(styles).sort();
    for (const property of properties) {
      cssCode += `  ${property}: ${styles[property]};\n`;
    }
    
    cssCode += '}\n\n';
  }
  
  return {
    code: cssCode,
    structure: cssClasses
  };
}

/**
 * Process styles recursively for CSS generation
 */
function processCSSStylesRecursive(currentNode, targetObject, currentPath, rawVariablesPayload) {
  if (!currentNode || typeof currentNode !== 'object') {
    return;
  }

  // Process each key-value pair in the current object
  for (const key in currentNode) {
    const value = currentNode[key];
    const newPath = [...currentPath, key];
    
    // Check if this is a style object (has an id property)
    if (value && typeof value === 'object' && value.id) {
      // This is a style - convert to CSS
      // Create a semantic CSS class name with text- prefix
      const rawClassName = newPath.join('-').toLowerCase();
      // Clean up the class name to follow CSS conventions
      const cssClassName = 'text-' + rawClassName
        .replace(/[^a-z0-9-]/g, '-')  // Replace invalid characters with hyphens
        .replace(/-+/g, '-')          // Collapse multiple hyphens
        .replace(/^-|-$/g, '');       // Remove leading/trailing hyphens
      
      const cssProperties = convertTextStyleToCSSObject(value, rawVariablesPayload);
      
      if (Object.keys(cssProperties).length > 0) {
        targetObject[cssClassName] = cssProperties;
      }
    } else if (value && typeof value === 'object' && !value.id) {
      // This is a group - recurse into it
      processCSSStylesRecursive(value, targetObject, newPath, rawVariablesPayload);
    }
  }
}

/**
 * Convert a text style to CSS properties object
 */
function convertTextStyleToCSSObject(textStyle, rawVariablesPayload) {
  const cssStyle = {};

  // Helper function to convert variable path to CSS variable format
  function formatCSSVariable(variablePath) {
    if (!variablePath) return null;
    // Convert dot notation to kebab-case and wrap in var()
    const cssVarName = '--' + variablePath.replace(/\./g, '-').toLowerCase();
    return `var(${cssVarName})`;
  }

  // Handle font family
  if (textStyle.fontName && textStyle.fontName.family) {
    const fontFamilyRef = findVariableReference('fontFamily', textStyle.fontName.family, textStyle.boundVariables, rawVariablesPayload);
    if (fontFamilyRef) {
      cssStyle['font-family'] = formatCSSVariable(fontFamilyRef);
    } else {
      cssStyle['font-family'] = `"${textStyle.fontName.family}", sans-serif`;
    }
  }

  // Handle font weight
  if (textStyle.fontName && textStyle.fontName.style) {
    const fontWeightRef = findVariableReference('fontWeight', textStyle.fontName.style, textStyle.boundVariables, rawVariablesPayload);
    if (fontWeightRef) {
      cssStyle['font-weight'] = formatCSSVariable(fontWeightRef);
    } else {
      // Map font weight to numeric value and try to find variable
      const numericWeight = mapFontWeight(textStyle.fontName.style);
      const weightRef = findVariableByValue('fontWeight', numericWeight, rawVariablesPayload);
      cssStyle['font-weight'] = weightRef ? formatCSSVariable(weightRef) : numericWeight;
    }
  }

  // Handle font size
  if (textStyle.fontSize !== undefined) {
    const fontSizeRef = findVariableReference('fontSize', textStyle.fontSize, textStyle.boundVariables, rawVariablesPayload);
    if (fontSizeRef) {
      cssStyle['font-size'] = formatCSSVariable(fontSizeRef);
    } else {
      const sizeRef = findVariableByValue('fontSize', textStyle.fontSize, rawVariablesPayload);
      cssStyle['font-size'] = sizeRef ? formatCSSVariable(sizeRef) : `${textStyle.fontSize}px`;
    }
  }

  // Handle line height
  if (textStyle.lineHeight && textStyle.lineHeight.value !== undefined) {
    const lineHeightRef = findVariableReference('lineHeight', textStyle.lineHeight.value, textStyle.boundVariables, rawVariablesPayload);
    if (lineHeightRef) {
      cssStyle['line-height'] = formatCSSVariable(lineHeightRef);
    } else {
      const heightRef = findVariableByValue('lineHeight', textStyle.lineHeight.value, rawVariablesPayload);
      if (heightRef) {
        cssStyle['line-height'] = formatCSSVariable(heightRef);
      } else {
        if (textStyle.lineHeight.unit === 'PERCENT') {
          cssStyle['line-height'] = (textStyle.lineHeight.value / 100);
        } else {
          cssStyle['line-height'] = `${textStyle.lineHeight.value}px`;
        }
      }
    }
  }

  // Handle letter spacing
  if (textStyle.letterSpacing && textStyle.letterSpacing.value !== undefined) {
    const letterSpacingRef = findVariableReference('letterSpacing', textStyle.letterSpacing.value, textStyle.boundVariables, rawVariablesPayload);
    if (letterSpacingRef) {
      cssStyle['letter-spacing'] = formatCSSVariable(letterSpacingRef);
    } else {
      const spacingRef = findVariableByValue('letterSpacing', textStyle.letterSpacing.value, rawVariablesPayload);
      if (spacingRef) {
        cssStyle['letter-spacing'] = formatCSSVariable(spacingRef);
      } else {
        if (textStyle.letterSpacing.unit === 'PERCENT') {
          cssStyle['letter-spacing'] = `${textStyle.letterSpacing.value}%`;
        } else {
          cssStyle['letter-spacing'] = `${textStyle.letterSpacing.value}px`;
        }
      }
    }
  }

  // Handle text decoration
  if (textStyle.textDecoration) {
    if (textStyle.textDecoration === 'UNDERLINE') {
      cssStyle['text-decoration'] = 'underline';
    } else if (textStyle.textDecoration === 'STRIKETHROUGH') {
      cssStyle['text-decoration'] = 'line-through';
    } else if (textStyle.textDecoration === 'NONE') {
      cssStyle['text-decoration'] = 'none';
    }
  }

  // Handle text case
  if (textStyle.textCase) {
    if (textStyle.textCase === 'UPPER') {
      cssStyle['text-transform'] = 'uppercase';
    } else if (textStyle.textCase === 'LOWER') {
      cssStyle['text-transform'] = 'lowercase';
    } else if (textStyle.textCase === 'TITLE') {
      cssStyle['text-transform'] = 'capitalize';
    } else if (textStyle.textCase === 'ORIGINAL') {
      cssStyle['text-transform'] = 'none';
    }
  }

  return cssStyle;
}

/**
 * Load rem conversion settings from storage
 */
async function loadRemSettings() {
  try {
    const storedUseRem = await figma.clientStorage.getAsync('useRemUnits');
    const storedBaseFontSize = await figma.clientStorage.getAsync('remBaseFontSize');
    
    useRemUnits = storedUseRem !== null ? storedUseRem : false;
    remBaseFontSize = storedBaseFontSize !== null ? storedBaseFontSize : 16;
    
    console.log('Loaded rem settings:', { useRemUnits, remBaseFontSize });
  } catch (error) {
    console.error('Error loading rem settings:', error);
    useRemUnits = false;
    remBaseFontSize = 16;
  }
}

/**
 * Save rem conversion settings to storage
 */
async function saveRemSettings() {
  try {
    await figma.clientStorage.setAsync('useRemUnits', useRemUnits);
    await figma.clientStorage.setAsync('remBaseFontSize', remBaseFontSize);
    console.log('Saved rem settings:', { useRemUnits, remBaseFontSize });
  } catch (error) {
    console.error('Error saving rem settings:', error);
  }
}

/**
 * Refresh all data while preserving UI state
 */
async function refreshDataWithPreservedState() {
  try {
    // Step 1: Request UI to save its current state
    figma.ui.postMessage({
      type: 'SAVE_UI_STATE_FOR_REFRESH',
      payload: {
        message: 'Applying new unit settings...'
      }
    });
    
    // Step 2: Re-fetch and regenerate all data with new settings
    console.log('Refreshing data with new REM settings...');
    
    // Re-fetch variables
    const variablesData = await fetchAndLogAllVariables();
    const refreshedDtcgPayload = await createSimplifiedDTCGPayload(variablesData.raw || variablesData);
    
    // Update stored payloads
    latestDtcgPayload = refreshedDtcgPayload;
    latestRawVariablesPayload = variablesData.raw || variablesData;
    
    // Re-fetch styles
    const stylesData = await fetchAndLogAllStyles();
    const refreshedNestedStylesData = createNestedStylesPayload(stylesData);
    
    // Update stored styles payload
    latestStylesPayload = refreshedNestedStylesData;
    
    // Step 3: Send refreshed data to UI with restoration instruction
    figma.ui.postMessage({
      type: 'DATA_REFRESHED_RESTORE_STATE',
      payload: {
        dtcgPayload: refreshedDtcgPayload,
        stylesPayload: refreshedNestedStylesData,
        message: 'Settings applied successfully!'
      }
    });
    
    console.log('Data refresh with state preservation completed');
    
  } catch (error) {
    console.error('Error during data refresh:', error);
    figma.ui.postMessage({
      type: 'error',
      message: 'Failed to refresh data. Please try again.'
    });
  }
}

/**
 * Refresh all data with clean reset (no state preservation)
 */
async function refreshDataWithCleanReset() {
  try {
    // Step 1: Re-fetch and regenerate all data with new settings
    console.log('Refreshing data with clean reset...');
    
    // Re-fetch variables
    const variablesData = await fetchAndLogAllVariables();
    const refreshedDtcgPayload = await createSimplifiedDTCGPayload(variablesData.raw || variablesData);
    
    // Update stored payloads
    latestDtcgPayload = refreshedDtcgPayload;
    latestRawVariablesPayload = variablesData.raw || variablesData;
    
    // Re-fetch styles
    const stylesData = await fetchAndLogAllStyles();
    const refreshedNestedStylesData = createNestedStylesPayload(stylesData);
    
    // Update stored styles payload
    latestStylesPayload = refreshedNestedStylesData;
    
    // Step 2: Send refreshed data to UI with clean reset instruction
    figma.ui.postMessage({
      type: 'DATA_REFRESHED_CLEAN_RESET',
      payload: {
        dtcgPayload: refreshedDtcgPayload,
        stylesPayload: refreshedNestedStylesData,
        message: `Unit conversion ${useRemUnits ? 'enabled' : 'disabled'} - tree reset`
      }
    });
    
    console.log('Data refresh with clean reset completed');
    
  } catch (error) {
    console.error('Error during clean data refresh:', error);
    figma.ui.postMessage({
      type: 'error',
      message: 'Failed to refresh data. Please try again.'
    });
  }
}
