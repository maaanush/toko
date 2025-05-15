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
      const pathName = `${collection.name}.${variable.name.replace(/\//g, '.')}`;
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
      return `$${aliasPath}`; // Return the pre-calculated path name with $ prefix
    } else {
      // Fallback: try to construct path on the fly (less ideal, should be pre-populated)
      const aliasedVar = allVariablesMap.get(aliasTargetId);
      if (aliasedVar) {
        const aliasedCol = allCollectionsMap.get(aliasedVar.variableCollectionId);
        if (aliasedCol) {
          return `$${aliasedCol.name}.${aliasedVar.name.replace(/\//g, '.')}`;
        }
      }
      return `[Error: Could not determine path for alias ID ${aliasTargetId}]`;
    }
  } else {
    // It's a direct value (e.g., color object, number, string)
    return valueInMode;
  }
}

// Notify UI that the plugin is ready
figma.ui.postMessage({ type: 'plugin-ready' }); 