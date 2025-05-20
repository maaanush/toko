# Granular Tasks for Figma Variable Data Fetching

Based on `data-fetching-flow.md`.

## Phase 1: Initialization

1.  **Task 1: Define `allFetchedVariablesPayload` Structure**
    *   **Goal:** Create the main object to hold all fetched variable data.
    *   **Action:** In `code.js`, declare `allFetchedVariablesPayload` with two empty arrays: `local` and `shared`.
    *   **Test:** Verify the object exists and has the correct initial structure.

2.  **Task 2: Initialize `importedLibraryVariableIds` Set**
    *   **Goal:** Create a set to track IDs of imported library variables.
    *   **Action:** In `code.js`, declare `importedLibraryVariableIds` and initialize it as a new `Set()`.
    *   **Test:** Verify the set exists and is empty.

3.  **Task 3: Initialize `variableKeyToIdMap` Map**
    *   **Goal:** Create a map to store library variable key to local ID mappings.
    *   **Action:** In `code.js`, declare `variableKeyToIdMap` and initialize it as a new `Map()`.
    *   **Test:** Verify the map exists and is empty.

4.  **Task 4: Initialize `variableIdToKeyMap` Map**
    *   **Goal:** Create a map to store local ID (of imported library variable) to library variable key mappings.
    *   **Action:** In `code.js`, declare `variableIdToKeyMap` and initialize it as a new `Map()`.
    *   **Test:** Verify the map exists and is empty.

## Phase 2: Fetching and Processing Shared (Team Library) Variables

5.  **Task 5: Get Available Library Variable Collections**
    *   **Goal:** Fetch the list of available library variable collections.
    *   **Action:** Create an async function (e.g., `fetchSharedCollections`). Inside it, call `await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync()`. Log the raw result to the console.
    *   **Test:** Run the function and check the console for an array of `LibraryVariableCollection` objects (or an empty array if none).

6.  **Task 6: Iterate Library Collections**
    *   **Goal:** Set up a loop to process each fetched library collection.
    *   **Action:** Modify `fetchSharedCollections`. After fetching, add a `for...of` loop to iterate through the returned `libraryCollection` array. Inside the loop, log the current `libraryCollection.name` (or `id`) to verify iteration.
    *   **Test:** Run and confirm each collection name/id is logged.

7.  **Task 7: Store Library Collection Metadata (Temporary)**
    *   **Goal:** Extract and temporarily store basic metadata for each library collection.
    *   **Action:** Inside the `libraryCollection` loop, create a temporary object and populate it with `id: libraryCollection.id`, `key: libraryCollection.key`, `name: libraryCollection.name`, and `libraryName: libraryCollection.libraryName`. Log this temporary object.
    *   **Test:** Verify the logged object contains the correct metadata for each collection.

8.  **Task 8: Get Variables in Each Library Collection**
    *   **Goal:** Fetch variables within a specific library collection.
    *   **Action:** Inside the `libraryCollection` loop, call `await figma.teamLibrary.getVariablesInLibraryCollectionAsync(libraryCollection.key)`. Log the raw result (an array of `LibraryVariable` objects).
    *   **Test:** Check console for the array of variables for each collection.

9.  **Task 9: Prepare `sharedCollectionData` Structure**
    *   **Goal:** Create the structure for the current library collection in `allFetchedVariablesPayload.shared`.
    *   **Action:** Inside the `libraryCollection` loop, create `sharedCollectionData` object with `id`, `key`, `name`, `libraryName` (from Task 7), `modes: []` (initially empty), and `variables: []`. Push this `sharedCollectionData` object to `allFetchedVariablesPayload.shared`. Log `allFetchedVariablesPayload.shared` after the loop.
    *   **Test:** Verify `allFetchedVariablesPayload.shared` contains objects with the correct structure (empty `variables` arrays for now).

10. **Task 10: Iterate Library Variables**
    *   **Goal:** Set up a nested loop to process each variable within a library collection.
    *   **Action:** Inside the `libraryCollection` loop, after fetching variables (Task 8), add another `for...of` loop to iterate through the `libraryVariable` array. Inside this nested loop, log `libraryVariable.name` (or `key`) to verify iteration.
    *   **Test:** Confirm each variable name/key is logged for each collection.

11. **Task 11: Import Library Variable by Key**
    *   **Goal:** Attempt to import each library variable.
    *   **Action:** Inside the `libraryVariable` loop, call `const importedVariable = await figma.variables.importVariableByKeyAsync(libraryVariable.key)`. Log the `importedVariable` object if successful, or any error if it fails. Use a try-catch block for this.
    *   **Test:** Observe console logs. Successful imports will show `Variable` objects; failures will show errors.

12. **Task 12: Store Variable Mappings on Successful Import**
    *   **Goal:** If import is successful, populate `variableKeyToIdMap` and `variableIdToKeyMap`.
    *   **Action:** Inside the `try` block of Task 11, if `importedVariable` is valid, add:
        *   `variableKeyToIdMap.set(libraryVariable.key, importedVariable.id);`
        *   `variableIdToKeyMap.set(importedVariable.id, libraryVariable.key);`
        Log both maps after these operations for one variable to check.
    *   **Test:** Manually inspect the maps (or log them) to see if mappings are correctly added for a successfully imported variable.

13. **Task 13: Track Imported Library Variable IDs**
    *   **Goal:** Add the ID of the successfully imported variable to `importedLibraryVariableIds`.
    *   **Action:** If `importedVariable` is valid (Task 11), add `importedLibraryVariableIds.add(importedVariable.id);`. Log the set for one variable.
    *   **Test:** Inspect `importedLibraryVariableIds` to confirm the ID is added.

14. **Task 14: Retrieve Full Imported Variable Object by ID**
    *   **Goal:** Get the complete variable object using its new local ID.
    *   **Action:** If `importedVariable` is valid, call `const detailedSharedVariable = await figma.variables.getVariableByIdAsync(importedVariable.id);`. Log `detailedSharedVariable`.
    *   **Test:** Verify `detailedSharedVariable` contains all expected properties (name, valuesByMode, etc.).

15. **Task 15: Populate and Store Detailed Shared Variable Data**
    *   **Goal:** Add the full variable details to the `sharedCollectionData`.
    *   **Action:** If `detailedSharedVariable` is fetched successfully:
        *   Create an object containing: `id: detailedSharedVariable.id`, `originalKey: libraryVariable.key`, `name: detailedSharedVariable.name`, `description: detailedSharedVariable.description`, `resolvedType: detailedSharedVariable.resolvedType`, `valuesByMode: detailedSharedVariable.valuesByMode`, `scopes: detailedSharedVariable.scopes`, `codeSyntax: detailedSharedVariable.codeSyntax`, `remote: true`, `libraryName: libraryCollection.libraryName`.
        *   Push this object to the `variables` array of the *current* `sharedCollectionData` (from Task 9).
    *   **Test:** After processing all variables for a collection, log `sharedCollectionData.variables` to check its contents.

16. **Task 16: Implement Error Handling for Import**
    *   **Goal:** Gracefully handle failures in `importVariableByKeyAsync`.
    *   **Action:** Ensure the `catch` block from Task 11 logs an informative error message (e.g., "Failed to import variable [key]: [error message]") and allows the loop to continue to the next variable.
    *   **Test:** Test with a scenario that might cause an import failure (if possible, or simulate by providing an invalid key temporarily) and check that the error is logged and processing continues.

## Phase 3: Fetching and Processing Local Variables

17. **Task 17: Get Local Variable Collections**
    *   **Goal:** Fetch variable collections defined locally in the current file.
    *   **Action:** Create an async function (e.g., `fetchLocalCollections`). Inside it, call `await figma.variables.getLocalVariableCollectionsAsync()`. Log the raw result.
    *   **Test:** Run and check console for an array of `VariableCollection` objects.

18. **Task 18: Iterate Local Collections**
    *   **Goal:** Set up a loop to process each local collection.
    *   **Action:** Modify `fetchLocalCollections`. After fetching, add a `for...of` loop for the `localCollection` array. Log `localCollection.name` (or `id`).
    *   **Test:** Confirm each local collection name/id is logged.

19. **Task 19: Prepare `localCollectionData` Structure**
    *   **Goal:** Create the structure for the current local collection in `allFetchedVariablesPayload.local`.
    *   **Action:** Inside the `localCollection` loop:
        *   Create `localCollectionData` with `id: localCollection.id`, `name: localCollection.name`, `modes: localCollection.modes.map(mode => ({ modeId: mode.modeId, name: mode.name }))`, `defaultModeId: localCollection.defaultModeId`, `variables: []`, `remote: false`.
        *   Push `localCollectionData` to `allFetchedVariablesPayload.local`.
        Log `allFetchedVariablesPayload.local` after the loop.
    *   **Test:** Verify `allFetchedVariablesPayload.local` contains correctly structured objects.

20. **Task 20: Iterate Local Variable IDs**
    *   **Goal:** Loop through `variableIds` in each local collection.
    *   **Action:** Inside the `localCollection` loop, add a nested `for...of` loop for `localCollection.variableIds`. Log each `variableId`.
    *   **Test:** Confirm variable IDs are logged for each local collection.

21. **Task 21: Skip Already Processed Library Variables**
    *   **Goal:** Avoid duplicating library variables in the `local` section.
    *   **Action:** Inside the `variableId` loop, add a condition: `if (importedLibraryVariableIds.has(variableId)) { console.log('Skipping already imported variable:', variableId); continue; }`.
    *   **Test:** If a library variable was imported and its ID appears in a local collection, verify it's skipped and a log message appears.

22. **Task 22: Retrieve Full Local Variable Object by ID**
    *   **Goal:** Get the complete variable object for truly local variables.
    *   **Action:** If not skipped (Task 21), call `const detailedLocalVariable = await figma.variables.getVariableByIdAsync(variableId);`. Log `detailedLocalVariable`.
    *   **Test:** Verify `detailedLocalVariable` is fetched and logged.

23. **Task 23: Populate and Store Detailed Local Variable Data**
    *   **Goal:** Add full local variable details to `localCollectionData`.
    *   **Action:** If `detailedLocalVariable` is fetched:
        *   Create an object: `id: detailedLocalVariable.id`, `name: detailedLocalVariable.name`, `description: detailedLocalVariable.description`, `resolvedType: detailedLocalVariable.resolvedType`, `valuesByMode: detailedLocalVariable.valuesByMode`, `scopes: detailedLocalVariable.scopes`, `codeSyntax: detailedLocalVariable.codeSyntax`, `remote: false`.
        *   Push this to the `variables` array of the *current* `localCollectionData`.
    *   **Test:** After processing a local collection, log `localCollectionData.variables` to check its contents.

## Phase 4: Output and Orchestration

24. **Task 24: Create Main Orchestration Function `fetchAndLogAllVariables`**
    *   **Goal:** A single function to trigger all fetching and processing steps.
    *   **Action:** Define an `async function fetchAndLogAllVariables()`. Inside this function, call the functions/logic developed for Phase 1 (initialization, though this might be top-level), Phase 2 (shared variables), and Phase 3 (local variables) in sequence.
    *   **Test:** Call `fetchAndLogAllVariables()` and verify (through previous logs or by inspecting `allFetchedVariablesPayload` at the end) that both shared and local processing seem to complete.

25. **Task 25: Log `allFetchedVariablesPayload.local`**
    *   **Goal:** Output the consolidated local variable data.
    *   **Action:** At the end of `fetchAndLogAllVariables`, add:
        `console.log('--- Local Variables ---');`
        `console.log(JSON.stringify(allFetchedVariablesPayload.local, null, 2));`
    *   **Test:** Run and check the console for a formatted JSON output of local variables.

26. **Task 26: Log `allFetchedVariablesPayload.shared`**
    *   **Goal:** Output the consolidated shared library variable data.
    *   **Action:** In `fetchAndLogAllVariables`, after logging local variables, add:
        `console.log('--- Shared Library Variables ---');`
        `console.log(JSON.stringify(allFetchedVariablesPayload.shared, null, 2));`
        `console.log('--- End of Fetched Variables ---');`
    *   **Test:** Run and check the console for a formatted JSON output of shared variables.

27. **Task 27: Implement Top-Level Error Handling**
    *   **Goal:** Catch any unhandled errors during the entire process.
    *   **Action:** Wrap the entire body of `fetchAndLogAllVariables` in a `try...catch` block. The `catch` block should log `console.error('Error fetching variables:', error.message, error.stack);`.
    *   **Test:** Introduce a deliberate error (e.g., call a non-existent Figma API method) early in the process and verify the catch block logs the error.

28. **Task 28: Trigger `fetchAndLogAllVariables`**
    *   **Goal:** Ensure the main function is called.
    *   **Action:** At the global level of `code.js` (or appropriate plugin entry point), call `fetchAndLogAllVariables();`.
    *   **Test:** When the plugin runs, the entire fetching and logging process should execute automatically.

## Phase 5: Refinements (Future considerations, not for initial build unless trivial)

29. **Task 29: Review Mode Information for Shared Collections**
    *   **Goal:** Ensure understanding of how mode information is captured for shared variables.
    *   **Action:** (Review task) Confirm that `valuesByMode` on shared variables contains the necessary mode-specific data. The `modes` array in `sharedCollectionData` (Task 9) might remain empty or be populated later if a clear way to get shared collection mode definitions emerges. For now, capturing `valuesByMode` is key.
    *   **Test:** N/A (Review).

30. **Task 30: Verify Alias Handling**
    *   **Goal:** Confirm variable aliases are stored directly.
    *   **Action:** (Review task) Ensure that if `valuesByMode` contains an alias object (`{ type: 'VARIABLE_ALIAS', id: '...' }`), it's stored as-is in the payload. No resolution logic is needed for this phase.
    *   **Test:** N/A (Review). If test data with aliases is available, check the logged output.
