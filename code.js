// This shows the HTML page in Figma.
figma.showUI(__html__, { width: 1000, height: 700, themeColors: true });

// Create the main object to hold all fetched variable data
let allFetchedVariablesPayload = {
  local: [], // Array of local collections with their variables
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
    // Only log the count of collections instead of the full objects
    console.log(`Found ${libraryCollections.length} library collections`);
    
    // Track errors for summary
    const errorLog = {
      importErrors: [],
      detailErrors: [],
      collectionErrors: []
    };
    
    // Iterate through each library collection
    for (const libraryCollection of libraryCollections) {
      // Reduce verbosity - only log collection names
      console.log(`Processing library collection: ${libraryCollection.name}`);
      
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
        modes: [], // Initially empty
        variables: [] // Initially empty
      };
      
      // Add this collection to the shared array
      allFetchedVariablesPayload.shared.push(sharedCollectionData);
      
      // Get variables in this library collection
      try {
        const libraryVariables = await figma.teamLibrary.getVariablesInLibraryCollectionAsync(libraryCollection.key);
        // Only log the count of variables instead of the full array
        console.log(`Found ${libraryVariables.length} variables in collection "${libraryCollection.name}"`);
        
        // Count successfully imported variables
        let importedCount = 0;
        let failedCount = 0;
        let detailFailedCount = 0;
        
        // Iterate through each variable in the collection
        for (const libraryVariable of libraryVariables) {
          // Attempt to import the library variable
          try {
            const importedVariable = await figma.variables.importVariableByKeyAsync(libraryVariable.key);
            
            // Store mappings between library key and local ID
            variableKeyToIdMap.set(libraryVariable.key, importedVariable.id);
            variableIdToKeyMap.set(importedVariable.id, libraryVariable.key);
            
            // Track imported library variable IDs (Task 13)
            importedLibraryVariableIds.add(importedVariable.id);
            
            // Task 14: Retrieve full variable object by ID
            try {
              const detailedVariable = await figma.variables.getVariableByIdAsync(importedVariable.id);
              
              // Task 15: Populate and store detailed shared variable data
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
              
              // Log with less verbosity to console
              console.error(`Failed to get detailed info for variable ${libraryVariable.name}:`, detailError.message);
              
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
            
            // Log with less verbosity to console
            console.error(`Failed to import variable ${libraryVariable.name} with key ${libraryVariable.key}:`, importError.message);
          }
        }
        
        // Log summary of imports for this collection
        console.log(`Successfully imported ${importedCount} variables from collection "${libraryCollection.name}"`);
        
        if (failedCount > 0) {
          console.warn(`Failed to import ${failedCount} variables from collection "${libraryCollection.name}"`);
        }
        
        if (detailFailedCount > 0) {
          console.warn(`Failed to get detailed info for ${detailFailedCount} variables from collection "${libraryCollection.name}"`);
        }
        
        // Reduce verbosity - only log total count, not details of individual variables
        // console.log(`Total imported library variables so far: ${importedLibraryVariableIds.size}`);
        
        // Reduce verbosity - don't log examples of stored variables
        // if (sharedCollectionData.variables.length > 0) {
        //   console.log(`First stored variable in "${libraryCollection.name}":`, {
        //     id: sharedCollectionData.variables[0].id,
        //     name: sharedCollectionData.variables[0].name,
        //     remote: sharedCollectionData.variables[0].remote,
        //     originalKey: sharedCollectionData.variables[0].originalKey
        //   });
        // }
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
        
        // Always log errors
        console.error(`Error fetching variables for collection "${libraryCollection.name}":`, variableError.message);
      }
    }
    
    // Summarize instead of logging full objects
    console.log(`Processed ${allFetchedVariablesPayload.shared.length} shared collections (${importedLibraryVariableIds.size} total variables)`);
    
    // Log error summary
    if (errorLog.importErrors.length > 0 || errorLog.detailErrors.length > 0 || errorLog.collectionErrors.length > 0) {
      console.warn(`Error Summary:
        - Import Errors: ${errorLog.importErrors.length}
        - Detail Retrieval Errors: ${errorLog.detailErrors.length}
        - Collection Fetch Errors: ${errorLog.collectionErrors.length}
      `);
      
      // Store error log in the payload for reference
      allFetchedVariablesPayload.errorLog = errorLog;
    }
    
    return libraryCollections;
  } catch (error) {
    console.error('Error fetching library collections:', error.message, error.stack);
    
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
 * Fetches and processes local variable collections
 */
async function fetchLocalCollections() {
  try {
    // Task 17: Get Local Variable Collections
    const localCollections = await figma.variables.getLocalVariableCollectionsAsync();
    console.log(`Found ${localCollections.length} local collections`);
    
    // Track counters for summary
    let totalSkippedCount = 0;
    let totalProcessedCount = 0;
    
    // Task 18: Iterate Local Collections
    for (const localCollection of localCollections) {
      console.log(`Processing local collection: ${localCollection.name} (ID: ${localCollection.id})`);
      
      // Task 19: Prepare localCollectionData Structure
      const localCollectionData = {
        id: localCollection.id,
        name: localCollection.name,
        modes: localCollection.modes.map(mode => ({ modeId: mode.modeId, name: mode.name })),
        defaultModeId: localCollection.defaultModeId,
        variables: [],
        remote: false
      };
      
      // Add this collection to the local array
      allFetchedVariablesPayload.local.push(localCollectionData);
      
      // Task 20: Iterate Local Variable IDs (with reduced logging)
      console.log(`Collection "${localCollection.name}" has ${localCollection.variableIds.length} variables`);
      
      let skippedCount = 0;
      let processedCount = 0;
      
      for (const variableId of localCollection.variableIds) {
        // Task 21: Skip Already Processed Library Variables
        if (importedLibraryVariableIds.has(variableId)) {
          skippedCount++;
          totalSkippedCount++;
          // Only log a few skipped variables to reduce console clutter
          if (skippedCount <= 2) {
            console.log(`Skipping already imported variable: ${variableId} in collection "${localCollection.name}"`);
          }
          continue;
        }
        
        processedCount++;
        totalProcessedCount++;
        
        // Task 22: Retrieve Full Local Variable Object by ID
        try {
          const detailedLocalVariable = await figma.variables.getVariableByIdAsync(variableId);
          
          // Task 23: Populate and Store Detailed Local Variable Data
          localCollectionData.variables.push({
            id: detailedLocalVariable.id,
            name: detailedLocalVariable.name,
            description: detailedLocalVariable.description,
            resolvedType: detailedLocalVariable.resolvedType,
            valuesByMode: detailedLocalVariable.valuesByMode,
            scopes: detailedLocalVariable.scopes,
            codeSyntax: detailedLocalVariable.codeSyntax,
            remote: false
          });
        } catch (error) {
          console.error(`Error fetching details for local variable ${variableId}:`, error.message);
        }
      }
      
      // Log summary instead of individual variables
      console.log(`Collection "${localCollection.name}": ${processedCount} local variables processed, ${skippedCount} library variables skipped`);
    }
    
    // Log the local collections structure for verification
    console.log(`Prepared ${allFetchedVariablesPayload.local.length} local collections (${totalProcessedCount} local variables, ${totalSkippedCount} library variables skipped)`);

    
    return localCollections;
  } catch (error) {
    console.error('Error fetching local collections:', error.message, error.stack);
    
    // Add error to payload
    if (!allFetchedVariablesPayload.errorLog) {
      allFetchedVariablesPayload.errorLog = {};
    }
    
    allFetchedVariablesPayload.errorLog.localCollectionsError = {
      phase: 'fetch-local-collections',
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
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
};

// Simple notification that plugin is ready
figma.ui.postMessage({ 
  type: 'plugin-info',
  payload: {
    message: 'Plugin loaded successfully'
  }
}); 

/**
 * Main orchestration function to fetch and process all variables
 */
async function fetchAndLogAllVariables() {
  try {
    console.log('--- Starting Variable Fetching Process ---');
    
    // Phase 2: Fetch shared (team library) variables
    console.log('Fetching shared variables...');
    await fetchSharedCollections();
    
    // Phase 3: Fetch local variables
    console.log('Fetching local variables...');
    await fetchLocalCollections();
    
    // Task 25: Log allFetchedVariablesPayload.local
    console.log('--- Local Variables ---');
    console.log(JSON.stringify(allFetchedVariablesPayload.local, null, 2));
    
    // Task 26: Log allFetchedVariablesPayload.shared
    console.log('--- Shared Library Variables ---');
    console.log(JSON.stringify(allFetchedVariablesPayload.shared, null, 2));
    console.log('--- End of Fetched Variables ---');
    
    console.log('--- Variable Fetching Complete ---');
    
    // End of orchestration function
    return allFetchedVariablesPayload;
  } catch (error) {
    // Task 27: Comprehensive error handling
    console.error('Error fetching variables:', error.message, error.stack);
    
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

// Task 28: Trigger fetchAndLogAllVariables at the global level
// This ensures the entire fetching and logging process executes when the plugin runs
fetchAndLogAllVariables().then(result => {
  console.log('Variable fetching process completed');
});