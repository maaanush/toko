# Figma Variables: Comprehensive Data Fetching Flow

## 1. Objective

This document outlines the detailed architecture and data flow for a Figma plugin to fetch all available variables within a Figma file. This includes:

*   **Local Variables:** Variables defined directly within the currently open Figma file.
*   **Shared (Team Library) Variables:** Variables originating from enabled team libraries.

The ultimate goal is to consolidate information about all these variables into a single, structured payload and log it to the plugin's console (`code.js`) for inspection and further processing.

## 2. Core Figma API Endpoints Involved

The following Figma Plugin API methods are central to this fetching process:

*   `figma.variables.getLocalVariableCollectionsAsync()`: Retrieves variable collections defined locally in the current file.
*   `figma.variables.getVariableByIdAsync(id: string)`: Retrieves a variable object by its local ID. This is used for both local variables and imported library variables.
*   `figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync()`: Retrieves a list of variable collections available from enabled team libraries.
*   `figma.teamLibrary.getVariablesInLibraryCollectionAsync(collectionKey: string)`: Retrieves variables within a specific library collection using its key.
*   `figma.variables.importVariableByKeyAsync(key: string)`: Imports a library variable by its key into the current document. This assigns it a local ID, making its properties accessible.

## 3. Data Fetching Strategy

The strategy involves a multi-step process to ensure all variables (local and shared) are discovered, their properties read, and then consolidated.

### 3.1. Initialization

Before fetching, initialize data structures to manage the process:

*   `allFetchedVariablesPayload`: An object that will store the final consolidated data, structured to differentiate local and library sources.
    ```javascript
    // Example structure
    let allFetchedVariablesPayload = {
      local: [], // Array of local collections with their variables
      shared: [] // Array of shared library collections with their variables
    };
    ```
*   `importedLibraryVariableIds`: A `Set` to keep track of local IDs of library variables that have been successfully imported and processed. This helps avoid redundant processing if a variable from a library is referenced multiple times or if fetching logic overlaps.
*   `variableKeyToIdMap`: A `Map` to store the mapping from a library variable's original `key` to its local `id` after successful import.
*   `variableIdToKeyMap`: A `Map` to store the reverse mapping, from a local `id` (of an imported library variable) back to its original library `key`.

### 3.2. Fetching and Processing Shared (Team Library) Variables

This is a crucial first step because importing library variables makes them resolvable like local variables.

1.  **Get Available Library Collections:**
    *   Call `await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync()`.
    *   This returns an array of `LibraryVariableCollection` objects, each representing a collection from an enabled team library.

2.  **Process Each Library Collection:**
    *   Iterate through each `libraryCollection` obtained.
    *   For each `libraryCollection`:
        *   Store its metadata (e.g., `id`, `key`, `name`, `libraryName`).
        *   Call `await figma.teamLibrary.getVariablesInLibraryCollectionAsync(libraryCollection.key)`. This returns an array of `LibraryVariable` objects within that collection.
        *   Create a structure for this library collection in `allFetchedVariablesPayload.shared`.
            ```javascript
            // Example structure for a shared collection
            const sharedCollectionData = {
              id: libraryCollection.id,
              key: libraryCollection.key,
              name: libraryCollection.name,
              libraryName: libraryCollection.libraryName,
              modes: [], // To be populated if available directly on collection, or inferred from variables
              variables: []
            };
            allFetchedVariablesPayload.shared.push(sharedCollectionData);
            ```

3.  **Import and Retrieve Library Variables:**
    *   Iterate through each `libraryVariable` within each `libraryCollection`.
    *   For each `libraryVariable`:
        *   **Attempt to Import:** Call `await figma.variables.importVariableByKeyAsync(libraryVariable.key)`.
            *   If successful, this returns a `Variable` object (the imported variable, now with a local ID).
            *   Store the mapping: `variableKeyToIdMap.set(libraryVariable.key, importedVariable.id)` and `variableIdToKeyMap.set(importedVariable.id, libraryVariable.key)`.
            *   Add `importedVariable.id` to the `importedLibraryVariableIds` set.
        *   **Retrieve Full Variable Object:** Using the `importedVariable.id` (or `libraryVariable.id` if it's already a local ID from a previous import, though `importVariableByKeyAsync` is the robust way), call `await figma.variables.getVariableByIdAsync(importedVariable.id)`. This ensures you get the complete variable object with all its properties (name, valuesByMode, description, resolvedType, scopes, etc.).
        *   **Store Variable Data:** Add the detailed variable object to the `variables` array of its respective `sharedCollectionData`. Include metadata indicating its origin.
            ```javascript
            // Example for a shared variable
            const detailedSharedVariable = await figma.variables.getVariableByIdAsync(importedVariable.id);
            if (detailedSharedVariable) {
              sharedCollectionData.variables.push({
                id: detailedSharedVariable.id, // Local ID after import
                originalKey: libraryVariable.key, // Original library key
                name: detailedSharedVariable.name,
                description: detailedSharedVariable.description,
                resolvedType: detailedSharedVariable.resolvedType,
                valuesByMode: detailedSharedVariable.valuesByMode,
                scopes: detailedSharedVariable.scopes,
                codeSyntax: detailedSharedVariable.codeSyntax,
                remote: true, // Mark as remote
                libraryName: libraryCollection.libraryName
              });
            }
            ```
        *   **Error Handling:** If `importVariableByKeyAsync` fails (e.g., due to library permissions, network issues, or the variable no longer existing), log an error and skip that variable.

### 3.3. Fetching and Processing Local Variables

1.  **Get Local Variable Collections:**
    *   Call `await figma.variables.getLocalVariableCollectionsAsync()`.
    *   This returns an array of `VariableCollection` objects defined in the current file.

2.  **Process Each Local Collection:**
    *   Iterate through each `localCollection` obtained.
    *   Create a structure for this local collection in `allFetchedVariablesPayload.local`.
        ```javascript
        // Example structure for a local collection
        const localCollectionData = {
          id: localCollection.id,
          name: localCollection.name,
          modes: localCollection.modes.map(mode => ({ modeId: mode.modeId, name: mode.name })).
          defaultModeId: localCollection.defaultModeId,
          variables: [],
          remote: false // Mark as local
        };
        allFetchedVariablesPayload.local.push(localCollectionData);
        ```

3.  **Retrieve Local Variables:**
    *   Each `localCollection` contains an array of `variableIds`. Iterate through these IDs.
    *   For each `variableId`:
        *   **Check if Already Processed (as an imported library variable):** If `importedLibraryVariableIds.has(variableId)`, this variable was originally from a library and has already been processed. You might choose to skip it here to avoid duplication in the `local` section, or include it if you want to represent its presence in the local context explicitly (though its `remote: true` flag from the shared section should clarify its origin). *For clean separation, it's generally better to ensure library variables only appear in the \"shared\" section.*
        *   **Retrieve Full Variable Object:** Call `await figma.variables.getVariableByIdAsync(variableId)`.
        *   **Store Variable Data:** Add the detailed variable object to the `variables` array of its respective `localCollectionData`.
            ```javascript
            // Example for a local variable
            const detailedLocalVariable = await figma.variables.getVariableByIdAsync(variableId);
            if (detailedLocalVariable && !importedLibraryVariableIds.has(detailedLocalVariable.id)) { // Ensure it's truly local
              localCollectionData.variables.push({
                id: detailedLocalVariable.id,
                name: detailedLocalVariable.name,
                description: detailedLocalVariable.description,
                resolvedType: detailedLocalVariable.resolvedType,
                valuesByMode: detailedLocalVariable.valuesByMode,
                scopes: detailedLocalVariable.scopes,
                codeSyntax: detailedLocalVariable.codeSyntax,
                remote: false // Mark as local
              });
            }
            ```

### 3.4. Data Consolidation and Structure

The `allFetchedVariablesPayload` object will now contain two main arrays: `local` and `shared`.

*   **`allFetchedVariablesPayload.local`**: An array of local collection objects. Each collection object includes:
    *   `id`: Collection ID.
    *   `name`: Collection name.
    *   `modes`: Array of mode objects (`{ modeId, name }`).
    *   `defaultModeId`: The ID of the default mode.
    *   `remote`: `false`.
    *   `variables`: An array of variable objects belonging to this collection. Each variable object includes:
        *   `id`: Variable's local Figma ID.
        *   `name`: Variable name (can include `/` for grouping).
        *   `description`: Variable description.
        *   `resolvedType`: E.g., `\'COLOR\'`, `\'FLOAT\'`, `\'STRING\'`, `\'BOOLEAN\'`.
        *   `valuesByMode`: An object mapping `modeId` to the variable's value in that mode. Values can be raw (e.g., RGBA object for color, number for float) or an alias object (`{ type: \'VARIABLE_ALIAS\', id: \'variable_id_of_aliased_variable\' }`).
        *   `scopes`: Array of scopes (e.g., `\'ALL_SCOPES\'`, `\'TEXT_CONTENT\'`, `\'CORNER_RADIUS\'`).
        *   `codeSyntax`: Object defining platform-specific syntax, if any.
        *   `remote`: `false`.

*   **`allFetchedVariablesPayload.shared`**: An array of shared library collection objects. Each collection object includes:
    *   `id`: Collection ID (original ID from the library).
    *   `key`: Collection key (original key from the library).
    *   `name`: Collection name.
    *   `libraryName`: Name of the library this collection belongs to.
    *   `modes`: (This might need to be inferred or constructed similarly to local collections if not directly available on `LibraryVariableCollection`. Often, modes are defined per collection, and library variables will reference these mode IDs.)
    *   `remote`: `true`.
    *   `variables`: An array of variable objects belonging to this library collection. Each variable object includes:
        *   `id`: Variable's *local* Figma ID *after import*.
        *   `originalKey`: Variable's original key from the library.
        *   `name`, `description`, `resolvedType`, `valuesByMode`, `scopes`, `codeSyntax` (as above).
        *   `remote`: `true`.
        *   `libraryName`: Name of the library this variable belongs to.

## 4. Output to Console (`code.js`)

Once `allFetchedVariablesPayload` is fully populated, it can be logged to the console within the plugin's `code.js` (e.g., in response to a UI trigger or on plugin load).

```javascript
// In code.js

async function fetchAndLogAllVariables() {
  try {
    // ... (Implement all the fetching and processing steps from section 3) ...
    // This will result in the 'allFetchedVariablesPayload' object being populated.

    console.log('--- All Fetched Variables ---');
    console.log('Local Variables:', JSON.stringify(allFetchedVariablesPayload.local, null, 2));
    console.log('Shared Library Variables:', JSON.stringify(allFetchedVariablesPayload.shared, null, 2));
    console.log('--- End of Fetched Variables ---');

    // Optionally, send this payload to the UI if needed
    // figma.ui.postMessage({ type: \'all-variables-data\', payload: allFetchedVariablesPayload });

  } catch (error) {
    console.error('Error fetching variables:', error.message, error.stack);
    // figma.ui.postMessage({ type: \'error\', message: \'Error fetching variables: \' + error.message });
  }
}

// Example of how to trigger this:
// figma.showUI(__html__); // If you have a UI
// fetchAndLogAllVariables(); // Call directly on plugin start, or in response to a UI message
```

## 5. Considerations and Enhancements

*   **Error Handling:** Robust error handling is critical, especially for network-dependent operations like fetching library information and importing variables.
*   **Performance:** For files with a very large number of variables or many enabled libraries, the process (especially importing many variables) might take time. Consider providing feedback to the user if the process is lengthy.
*   **Mode Information for Shared Collections:** The structure `LibraryVariableCollection` might not directly provide a list of modes in the same way `VariableCollection` does. Mode information for shared variables is primarily accessed through their `valuesByMode` property. The `modes` array in `sharedCollectionData` might need to be constructed by aggregating all unique `modeId`s found across its variables and then attempting to map these IDs to mode names if such a mapping is available or inferable. Figma's API typically ensures that `valuesByMode` uses `modeId`s that are consistent within the collection's context.
*   **Alias Resolution:** The `valuesByMode` can contain aliases (`{ type: \'VARIABLE_ALIAS\', id: \'target_variable_id\' }`). The `target_variable_id` will be the local ID of the aliased variable (which could be another local variable or an imported library variable). The presented payload includes these alias objects directly. Further processing would be needed to resolve these aliases to their actual values or to a path-based reference if converting to a format like DTCG.
*   **Duplicate Handling for Imported Variables:** The use of `importedLibraryVariableIds` helps ensure that if a library variable is somehow encountered through multiple paths, it's processed consistently and its details (especially its local ID after import) are correctly mapped. The primary goal is to list it under the "shared" section with its library origin.

This detailed flow provides a comprehensive approach to gathering all variable information, clearly distinguishing their sources, and preparing it for console output or further use within the plugin.
