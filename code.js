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
  
  // Phase 2: Process library variables and collections
  try {
    // Step 2.1: Fetch all libraries available to this file
    const teamLibraries = await figma.teamLibrary.getAvailableLibrariesAsync();
    
    // Step 2.2: Process each library that's actually used in this file
    for (const library of teamLibraries) {
      if (!library.usedInFile) continue;
      
      // Step 2.3: Get all variables from this library
      const libraryVariables = await figma.teamLibrary.getVariablesAsync(library.key);
      
      // Collection tracking for this library
      const processedCollectionIds = new Set();
      
      // Step 2.4: Process library variables
      for (const libraryVar of libraryVariables) {
        // Skip if we've already processed this variable key (deduplication)
        if (libraryVar.key && processedVariableKeys.has(libraryVar.key)) {
          continue;
        }
        
        // Add to variables map and mark as processed
        allVariablesMap.set(libraryVar.id, libraryVar);
        if (libraryVar.key) {
          processedVariableKeys.add(libraryVar.key);
        }
        
        // Step 2.5: Process this variable's collection if not done yet
        if (!processedCollectionIds.has(libraryVar.variableCollectionId)) {
          processedCollectionIds.add(libraryVar.variableCollectionId);
          
          // Fetch collection from the library
          const libraryCollection = await figma.teamLibrary.getVariableCollectionByIdAsync(
            library.key,
            libraryVar.variableCollectionId
          );
          
          if (libraryCollection) {
            // Only add to allCollectionsMap if not already present
            if (!allCollectionsMap.has(libraryCollection.id)) {
              allCollectionsMap.set(libraryCollection.id, libraryCollection);
            }
            
            // Only add to canonical sources if we don't already have this collection key
            // This ensures local collections take precedence over library collections
            if (libraryCollection.key && !canonicalCollectionSources.has(libraryCollection.key)) {
              canonicalCollectionSources.set(libraryCollection.key, libraryCollection);
            }
          }
        }
      }
    }
  } catch (error) {
    console.error("Error processing library variables:", error);
    // Continue with local variables only
  }
  
  // Phase 3: Build path names for all variables
  for (const [varId, variable] of allVariablesMap) {
    const collection = allCollectionsMap.get(variable.variableCollectionId);
    if (!collection) continue;
    
    // Start with collection name
    let pathName = collection.name;
    
    // Add group/variable name based on variable structure
    if (variable.resolvedType === 'GROUP') {
      // This is a group - use just the name
      pathName += `.${variable.name}`;
    } else if (variable.name.includes('/')) {
      // Handle slash-separated group names (older Figma format)
      const parts = variable.name.split('/');
      const varName = parts.pop(); // Last part is the variable name
      const groupName = parts.join('/'); // Remaining parts form the group path
      pathName += `.${groupName}.${varName}`;
    } else {
      // Simple variable without explicit group
      pathName += `.${variable.name}`;
    }
    
    // Store the full path for this variable ID
    variableIdToPathNameMap.set(varId, pathName);
  }
  
  // Phase 4: Build final structured payload
  const result = {};
  
  // Process each canonical collection (deduplicated)
  for (const [canonicalKey, collection] of canonicalCollectionSources) {
    const collectionName = collection.name;
    result[collectionName] = {};
    
    // Process each mode in this collection
    for (const mode of collection.modes) {
      const modeId = mode.modeId;
      const modeName = mode.name;
      
      // Initialize this mode in the result
      result[collectionName][modeName] = {};
      
      // Find all variables in this collection
      const collectionVars = Array.from(allVariablesMap.values())
        .filter(v => v.variableCollectionId === collection.id);
      
      // First, identify groups and organize variables
      const groupsMap = {}; // Holds variables organized by group
      const directVariables = {}; // Variables not in a group
      
      // First pass: categorize variables by group
      for (const variable of collectionVars) {
        if (variable.resolvedType === 'GROUP') {
          // This is a group definition variable
          groupsMap[variable.name] = {};
        } else if (variable.name.includes('/')) {
          // Variable with slash path indicating group membership
          const parts = variable.name.split('/');
          const varName = parts.pop();
          const groupPath = parts.join('/');
          
          // Initialize nested group structure if needed
          if (!groupsMap[groupPath]) {
            groupsMap[groupPath] = {};
          }
          
          // Process the variable's value for this mode
          const valueForMode = variable.valuesByMode?.[modeId];
          
          if (valueForMode !== undefined) {
            if (valueForMode.type === 'VARIABLE_ALIAS') {
              // For aliases, store the path to the referenced variable
              const aliasedVarId = valueForMode.id;
              const aliasPath = variableIdToPathNameMap.get(aliasedVarId) || 'unknown_path';
              groupsMap[groupPath][varName] = `$${aliasPath}`;
            } else {
              // For direct values
              groupsMap[groupPath][varName] = valueForMode;
            }
          }
        } else {
          // Direct variable (not in a group)
          const valueForMode = variable.valuesByMode?.[modeId];
          
          if (valueForMode !== undefined) {
            if (valueForMode.type === 'VARIABLE_ALIAS') {
              // For aliases, store the path to the referenced variable
              const aliasedVarId = valueForMode.id;
              const aliasPath = variableIdToPathNameMap.get(aliasedVarId) || 'unknown_path';
              directVariables[variable.name] = `$${aliasPath}`;
            } else {
              // For direct values
              directVariables[variable.name] = valueForMode;
            }
          }
        }
      }
      
      // Add direct variables to the result
      Object.assign(result[collectionName][modeName], directVariables);
      
      // Add grouped variables to the result
      Object.assign(result[collectionName][modeName], groupsMap);
    }
  }
  
  return result;
}

// Notify UI that the plugin is ready
figma.ui.postMessage({ type: 'plugin-ready' }); 