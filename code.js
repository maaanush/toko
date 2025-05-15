// This shows the HTML page in Figma.
figma.showUI(__html__, { width: 1000, height: 700, themeColors: true });

// Enable access to team libraries
figma.clientStorage.getAsync('accessToken').then(accessToken => {
  if (accessToken) {
    figma.teamLibrary.setAccessToken(accessToken);
  }
});

// Main message handler for plugin communication
figma.ui.onmessage = async (msg) => {
  if (msg.type === 'fetch-variables') {
    try {
      const payload = await buildVariablesPayload();
      figma.ui.postMessage({ 
        type: 'variables-data', 
        payload 
      });
    } catch (error) {
      figma.ui.postMessage({ 
        type: 'error', 
        message: `Error fetching variables: ${error.message}` 
      });
    }
  } else if (msg.type === 'close-plugin') {
    figma.closePlugin();
  }
};

// Main function to build the variables payload
async function buildVariablesPayload() {
  // Phase 0: Setup and initialization
  const allVariablesMap = new Map(); // Map<string, Variable>
  const allCollectionsMap = new Map(); // Map<string, VariableCollection>
  const canonicalCollectionSources = new Map(); // Map<string, VariableCollection>
  const variableIdToPathNameMap = new Map(); // Map<string, string>
  const processedVariableKeys = new Set(); // Set<string>
  
  // Phase 1: Process local collections and their variables first
  const localCollections = await figma.variables.getLocalVariableCollectionsAsync();
  const allLocalVariables = await figma.variables.getLocalVariablesAsync();
  
  // Step 1.1: Process each local collection
  for (const localCol of localCollections) {
    // Store it as the canonical source
    if (localCol.key) {
      // It's publishable/published
      canonicalCollectionSources.set(localCol.key, localCol);
    } else {
      // Purely local
      canonicalCollectionSources.set(localCol.id, localCol);
    }
    
    // Add to allCollectionsMap
    allCollectionsMap.set(localCol.id, localCol);
    
    // Fetch variables for this local collection
    const localVariablesInCollection = allLocalVariables
      .filter(v => v.variableCollectionId === localCol.id);
    
    // Process each variable in this collection
    for (const localVar of localVariablesInCollection) {
      // Deduplication check
      if (localVar.key && processedVariableKeys.has(localVar.key)) {
        // This variable (by its global key) has already been processed
        continue;
      } else if (localVar.key) {
        processedVariableKeys.add(localVar.key);
      }
      
      // Add to map
      allVariablesMap.set(localVar.id, localVar);
    }
  }
  
  // Step 1.2: Process Library Collections and Their Variables
  try {
    // Get available library variable collections (metadata)
    const libraryCollectionMetas = await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync();
    
    // Process each library collection
    for (const libColMeta of libraryCollectionMetas) {
      // Deduplication Check (Collections)
      if (canonicalCollectionSources.has(libColMeta.key)) {
        // This library collection corresponds to an already processed local collection
        // We prefer the local version as it's more "live" for the current file
        const existingCollection = canonicalCollectionSources.get(libColMeta.key);
        
        // We'll map this library collection's ID to the existing local collection's ID
        // to ensure variables from this library are imported and added if not present via local processing
        
        // Note: We don't need to do anything special here, as we're using the variable.key for
        // deduplication, not the collection ID. Variables will be handled in the next loop.
      } else {
        // This is a distinct library collection not originating from a local one in this file
        // We need to fetch its full VariableCollection object
        
        // Strategy: Import one variable from it to get a variableCollectionId, then fetch the collection
        const tempLibVars = await figma.teamLibrary.getVariablesInLibraryCollectionAsync(libColMeta.key);
        
        if (tempLibVars.length > 0) {
          try {
            const anImportedVar = await figma.variables.importVariableByKeyAsync(tempLibVars[0].key);
            const fullLibraryCollection = await figma.variables.getVariableCollectionByIdAsync(anImportedVar.variableCollectionId);
            
            if (fullLibraryCollection) {
              canonicalCollectionSources.set(fullLibraryCollection.key, fullLibraryCollection);
              allCollectionsMap.set(fullLibraryCollection.id, fullLibraryCollection);
            }
          } catch (e) {
            console.error(`Error importing variable to fetch collection details for ${libColMeta.name}:`, e);
          }
        }
      }
      
      // Fetch all variables metadata from this library collection
      const libraryVariablesMeta = await figma.teamLibrary.getVariablesInLibraryCollectionAsync(libColMeta.key);
      
      // Process each library variable
      for (const libVarMeta of libraryVariablesMeta) {
        // Deduplication Check (Variables)
        if (processedVariableKeys.has(libVarMeta.key)) {
          // This variable has already been processed. Skip.
          continue;
        }
        
        processedVariableKeys.add(libVarMeta.key);
        
        // Import the library variable to get its full Variable object and local ID
        try {
          const importedVariable = await figma.variables.importVariableByKeyAsync(libVarMeta.key);
          allVariablesMap.set(importedVariable.id, importedVariable);
          
          // Ensure its collection is in allCollectionsMap if somehow missed
          if (!allCollectionsMap.has(importedVariable.variableCollectionId)) {
            const col = await figma.variables.getVariableCollectionByIdAsync(importedVariable.variableCollectionId);
            if (col) allCollectionsMap.set(col.id, col);
          }
        } catch (importError) {
          console.error(`Error importing library variable ${libVarMeta.name} (key: ${libVarMeta.key}):`, importError);
        }
      }
    }
  } catch (error) {
    console.error("Error processing library collections:", error);
    // Continue with local variables only
  }
  
  // Phase 2: Building Derived Helper Maps
  
  // Step 2.1: Populate variableIdToPathNameMap
  for (const [variableId, variable] of allVariablesMap) {
    const collection = allCollectionsMap.get(variable.variableCollectionId);
    
    if (collection) {
      // Construct path by replacing slashes with dots
      let pathName = `${collection.name}.${variable.name.replace(/\//g, '.')}`;
      
      // Apply transformation for numeric endings using a special marker that won't get escaped
      // Instead of ["4"] use BRACKET_OPEN4BRACKET_CLOSE that we can later target specifically
      pathName = pathName.replace(/\.([0-9]+)$/, '.BRACKET_OPEN$1BRACKET_CLOSE');
      
      variableIdToPathNameMap.set(variableId, pathName);
    }
  }
  
  // Phase 3: Generating the Structured Payload
  
  // Objective: Iterate through the processed collections, modes, and variables 
  // to build the final nested JSON structure.
  
  const finalPayload = {};
  
  // Step 3.1: Iterate through Unique Canonical Collections
  for (const collection of canonicalCollectionSources.values()) {
    finalPayload[collection.name] = {};
    
    // Check if the collection has only one mode
    if (collection.modes.length === 1) {
      // Skip the mode name for single-mode collections
      let currentCollectionPayload = finalPayload[collection.name];
      const singleMode = collection.modes[0];
      
      // Step 3.3: Filter variables belonging to this collection
      for (const variable of allVariablesMap.values()) {
        if (variable.variableCollectionId === collection.id) {
          // This variable belongs to the current collection
          
          // Step 3.4: Determine Variable Grouping and Name
          const nameParts = variable.name.split('/');
          const varName = nameParts.pop(); // Last part is the variable name
          let targetGroup = currentCollectionPayload;
          
          // Iterate through group parts
          nameParts.forEach(groupPart => {
            if (!targetGroup[groupPart]) {
              targetGroup[groupPart] = {};
            }
            targetGroup = targetGroup[groupPart];
          });
          
          // Step 3.5: Get Value or Alias Path
          const valueOrPath = getValueOrAliasPath(
            variable.id,
            singleMode.modeId, // Use the single mode ID
            allVariablesMap,
            allCollectionsMap,
            variableIdToPathNameMap,
            figma
          );
          
          if (varName) { // Ensure varName is not undefined
            targetGroup[varName] = valueOrPath;
          }
        }
      }
    } else {
      // Original logic for multi-mode collections
      // Step 3.2: For each collection, iterate through its modes
      for (const mode of collection.modes) {
        finalPayload[collection.name][mode.name] = {};
        let currentModePayload = finalPayload[collection.name][mode.name];
        
        // Step 3.3: Filter variables belonging to this collection
        for (const variable of allVariablesMap.values()) {
          if (variable.variableCollectionId === collection.id) {
            // This variable belongs to the current collection
            
            // Step 3.4: Determine Variable Grouping and Name
            const nameParts = variable.name.split('/');
            const varName = nameParts.pop(); // Last part is the variable name
            let targetGroup = currentModePayload;
            
            // Iterate through group parts
            nameParts.forEach(groupPart => {
              if (!targetGroup[groupPart]) {
                targetGroup[groupPart] = {};
              }
              targetGroup = targetGroup[groupPart];
            });
            
            // Step 3.5: Get Value or Alias Path
            const valueOrPath = getValueOrAliasPath(
              variable.id,
              mode.modeId,
              allVariablesMap,
              allCollectionsMap,
              variableIdToPathNameMap,
              figma
            );
            
            if (varName) { // Ensure varName is not undefined
              targetGroup[varName] = valueOrPath;
            }
          }
        }
      }
    }
  }
  
  return finalPayload;
}

// Phase 4: Helper Functions

// Step 4.1: getValueOrAliasPath Function
function getValueOrAliasPath(
  variableId,
  modeId,
  allVariablesMap,
  allCollectionsMap,
  variableIdToPathNameMap,
  figma,
  visited = new Set() // For cycle detection if you were deep resolving
) {
  const variable = allVariablesMap.get(variableId);
  if (!variable) {
    return `[Error: Variable ID ${variableId} not found in map]`;
  }

  const valueInMode = variable.valuesByMode[modeId];

  if (valueInMode && typeof valueInMode === 'object' && 'type' in valueInMode && valueInMode.type === 'VARIABLE_ALIAS') {
    const aliasTargetId = valueInMode.id;
    const aliasPath = variableIdToPathNameMap.get(aliasTargetId);
    if (aliasPath) {
      // Return a special object for alias paths
      return { __isAliasPath: true, path: aliasPath };
    } else {
      // Fallback: try to construct path on the fly (less ideal, should be pre-populated)
      const aliasedVar = allVariablesMap.get(aliasTargetId);
      if (aliasedVar) {
        const aliasedCol = allCollectionsMap.get(aliasedVar.variableCollectionId);
        if (aliasedCol) {
          // Construct path and handle numeric endings with the special marker
          let fallbackPath = `${aliasedCol.name}.${aliasedVar.name.replace(/\//g, '.')}`;
          fallbackPath = fallbackPath.replace(/\.([0-9]+)$/, '.BRACKET_OPEN$1BRACKET_CLOSE');
          // Ensure it's returned as part of the special alias object
          return { __isAliasPath: true, path: fallbackPath };
        }
      }
      return { __isAliasPathError: true, message: `[Error: Could not determine path for alias ID ${aliasTargetId}]` };
    }
  } else {
    // It's a direct value (e.g., color object, number, string)
    // Check if it's a Figma color object (with r, g, b, a properties)
    if (valueInMode && typeof valueInMode === 'object' && 
        'r' in valueInMode && 'g' in valueInMode && 'b' in valueInMode && 'a' in valueInMode) {
      
      // Helper function to convert 0-1 float to 0-255 int
      const to255 = (v) => Math.round(v * 255);
      const r = to255(valueInMode.r);
      const g = to255(valueInMode.g);
      const b = to255(valueInMode.b);
      const a = valueInMode.a;

      if (a >= 0.999) { // Consider fully opaque
        // Convert to hex
        const toHex = (c) => c.toString(16).padStart(2, '0');
        return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
      } else {
        // Convert RGB to HSL and format as hsla string
        const rgbToHsl = (r, g, b) => {
          // Convert RGB to 0-1 range
          r /= 255;
          g /= 255;
          b /= 255;
          
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
          
          // Convert to degrees, percentage, percentage
          return {
            h: Math.round(h * 360),
            s: Math.round(s * 100),
            l: Math.round(l * 100)
          };
        };
        
        const { h, s, l } = rgbToHsl(r, g, b);
        return `hsla(${h}, ${s}%, ${l}%, ${a.toFixed(2)})`;
      }
    } else if (typeof valueInMode === 'number') {
      // Check if it's a float that needs rounding
      if (!Number.isInteger(valueInMode)) {
        // Try to find the shortest clean representation
        // First try with 1 decimal place
        if (Math.abs(valueInMode - parseFloat(valueInMode.toFixed(1))) < 1e-9) {
          return parseFloat(valueInMode.toFixed(1));
        }
        // Then try with 2 decimal places
        else if (Math.abs(valueInMode - parseFloat(valueInMode.toFixed(2))) < 1e-9) {
          return parseFloat(valueInMode.toFixed(2));
        }
        // Default to 3 decimal places for most cases
        else {
          return parseFloat(valueInMode.toFixed(3));
        }
      }
    }
    
    return valueInMode;
  }
}

// Notify UI that the plugin is ready
figma.ui.postMessage({ type: 'plugin-ready' }); 