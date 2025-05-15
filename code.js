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
      const { finalPayload, allVariablesMap, allCollectionsMap } = await buildVariablesPayload();
      
      // Generate CSS string from the final payload
      const cssOutput = generateCssVariablesString(finalPayload, allVariablesMap, allCollectionsMap);
      
      // Generate Tailwind config string
      const tailwindOutput = await generateTailwindConfigString(finalPayload, allVariablesMap, allCollectionsMap);
      
      figma.ui.postMessage({ 
        type: 'variables-data', 
        payload: {
          jsObjectData: finalPayload,
          cssString: cssOutput,
          tailwindString: tailwindOutput
        }
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
  // to build the final nested JS object structure.
  
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
  
  return { finalPayload, allVariablesMap, allCollectionsMap };
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

// CSS Variables Generation Helper Functions

/**
 * Determines the appropriate Tailwind theme category for a Figma variable
 * @param {Object} variable - The Figma variable object
 * @param {string} variablePath - The path of the variable (for context)
 * @return {string|null} The Tailwind category or null if uncategorized
 */
function getTailwindCategory(variable, variablePath) {
  const type = variable.resolvedType;
  const path = variablePath.toLowerCase();

  // Primary categorization based on resolvedType
  if (type === 'COLOR') {
    return 'colors';
  }

  if (type === 'STRING') {
    if (path.includes('font-family') || path.includes('fontfamily') || 
        path.includes('typeface') || path.includes('font') && path.includes('family')) {
      return 'fontFamily';
    }
    // Other string categories could be added here if identified
    return null; // Uncategorized string
  }

  if (type === 'FLOAT') {
    // Spacing related
    if (path.includes('spacing') || path.includes('padding') || path.includes('margin') || 
        path.includes('gap') || path.includes('inset') || 
        (path.includes('size') && !path.includes('font') && !path.includes('text'))) {
      return 'spacing';
    }
    
    // Typography related
    if (path.includes('font-size') || path.includes('fontsize') || path.includes('text-size')) {
      return 'fontSize';
    }
    
    if (path.includes('line-height') || path.includes('lineheight') || path.includes('leading')) {
      return 'lineHeight';
    }
    
    if (path.includes('font-weight') || path.includes('fontweight') || 
        (path.includes('font') && path.includes('weight'))) {
      return 'fontWeight';
    }
    
    if (path.includes('letter-spacing') || path.includes('letterspacing') || path.includes('tracking')) {
      return 'letterSpacing';
    }
    
    // Border related
    if (path.includes('radius') || (path.includes('corner') && path.includes('radius'))) {
      return 'borderRadius';
    }
    
    if (path.includes('border-width') || path.includes('borderwidth') || path.includes('stroke-width')) {
      return 'borderWidth';
    }
    
    // Other numeric properties
    if (path.includes('opacity') || path.includes('alpha')) {
      return 'opacity';
    }
    
    if (path.includes('z-index') || path.includes('zindex') || path.includes('layer') || 
        path.includes('depth')) {
      return 'zIndex';
    }
  }
  
  // Boolean values typically don't map to Tailwind theme scales
  if (type === 'BOOLEAN') {
    return null;
  }
  
  return null; // Default: uncategorized
}

/**
 * Converts a string to kebab-case
 * @param {string} str - The string to convert
 * @return {string} Kebab-cased string
 */
function toKebabCase(str) {
  if (!str) return '';
  return String(str)
    .replace(/\//g, '-') // Replace slashes with hyphens first
    .replace(/[\s_]+/g, '-') // Replace spaces and underscores with hyphens
    .replace(/([a-z])([A-Z])/g, '$1-$2') // camelCase to kebab-case
    .toLowerCase();
}

/**
 * Generates a CSS variable name
 * @param {string[]} variablePathParts - Parts of the variable path
 * @param {string} collectionName - The collection name
 * @param {boolean} isCanonicalName - Whether to include the collection name prefix
 * @return {string} The CSS variable name
 */
function generateCssVarName(variablePathParts, collectionName, isCanonicalName) {
  const cleanedPathParts = variablePathParts.map(part => {
    // Convert part to string to ensure .replace method is available
    const partStr = String(part);
    return partStr.replace(/BRACKET_OPEN(\w+)BRACKET_CLOSE/g, '$1');
  });
  const kebabPath = cleanedPathParts.map(p => toKebabCase(p)).join('-');
  
  if (isCanonicalName) {
    const kebabCollectionName = toKebabCase(collectionName);
    return `--${kebabCollectionName}-${kebabPath}`;
  }
  return `--${kebabPath}`;
}

/**
 * Formats a value for CSS, applying appropriate units
 * @param {*} value - The value to format
 * @param {string} variableName - The variable name
 * @return {string} The formatted CSS value
 */
function formatCssValue(value, variableName, pathContext) {
  if (typeof value === 'number') {
    const lowerVarName = variableName ? toKebabCase(variableName) : '';
    const unitlessKeywords = ['opacity', 'font-weight', 'order', 'z-index', 'scale', 'fw', 'op', 'weight'];
    
    // Special case for font-weight values (which are often just numbers like 400, 500, 600)
    if (pathContext && 
        (pathContext.includes('font-weight') || 
         (pathContext.includes('typography') && pathContext.includes('weight')))) {
      return String(value);
    }
    
    // Also handle standard font weight values
    if (typeof value === 'number' && 
        [100, 200, 300, 400, 500, 600, 700, 800, 900].includes(value) && 
        /^[0-9]+$/.test(variableName)) {
      return String(value);
    }
    
    let isUnitless = false;
    for (const keyword of unitlessKeywords) {
      if (lowerVarName.includes(keyword)) {
        isUnitless = true;
        break;
      }
    }

    if (isUnitless) {
      return String(value);
    } else {
      return `${value}px`; // All numbers including lineHeight get px units
    }
  }
  
  // If it's a string (like a color or font name)
  if (typeof value === 'string') {
    // Ensure strings that aren't color functions (like font names with spaces) are quoted
    if (!value.match(/^(#|rgb|hsl|var\(--)/) && value.includes(' ')) {
      return `"${value}"`;
    }
    return value;
  }
  
  return String(value); // Fallback for any other type
}

/**
 * Parse a Figma variable path into collection name and path parts
 * @param {string} figmaPath - The Figma path notation
 * @return {Object} Object with targetCollectionName and targetAliasPathParts
 */
function parseFigmaPath(figmaPath) {
  const parts = figmaPath.split('.');
  const targetCollectionName = parts.shift(); // First part is collection
  // Handle ["NUM"] notation if present in parts
  const targetAliasPathParts = parts.map(part => part.replace(/\["(\w+)"\]$/, '$1'));
  return { targetCollectionName, targetAliasPathParts };
}

/**
 * Generate a CSS string from Figma variables
 * @param {Object} payload - The variables payload
 * @param {Map} allVariablesMap - Map of variable IDs to variables
 * @param {Map} allCollectionsMap - Map of collection IDs to collections
 * @return {string} The CSS string
 */
function generateCssVariablesString(payload, allVariablesMap, allCollectionsMap) {
  let cssString = "";
  
  // Collection of all CSS variables by their scope
  const scopeVariables = {
    root: [], // Variables for :root
    themes: {} // Variables for each theme (collection-mode)
  };
  
  // Function to process variables object recursively
  function processVariablesObject(obj, collectionName, collectionId, modeName, pathPrefixParts, isCanonicalContext) {
    const result = [];
    
    for (const key of Object.keys(obj)) {
      const value = obj[key];
      const currentPathParts = [...pathPrefixParts, key];
      
      // If it's an alias
      if (value && typeof value === 'object' && value.__isAliasPath === true) {
        // Parse the alias path
        const { targetCollectionName, targetAliasPathParts } = parseFigmaPath(value.path);
        
        // Determine if it's a reference to the same collection
        const isSameCollection = targetCollectionName === collectionName;
        
        // Create the CSS variable name for this variable itself - always without collection prefix
        const cssVarName = generateCssVarName(currentPathParts, collectionName, false);
        
        // Generate the target variable name for the var() reference
        const targetVarName = generateCssVarName(
          targetAliasPathParts,
          targetCollectionName,
          !isSameCollection || isCanonicalContext // Use canonical name if target is from a different collection
        );
        
        // Create the CSS declaration
        result.push(`  ${cssVarName}: var(${targetVarName});`);
      }
      // If it's a direct value (not an object or is a special formatted object)
      else if (value === null || typeof value !== 'object' || 
               (value && (value.__isAliasPathError || Object.prototype.toString.call(value) === '[object Object]' && 
                Object.keys(value).length === 0))) {
        // Always use false for isCanonicalName to ensure no collection prefix on LHS
        const cssVarName = generateCssVarName(currentPathParts, collectionName, false);
        // Create a context string for parent path detection
        const pathContext = currentPathParts.map(p => toKebabCase(p)).join('-');
        
        // Special handling for numeric font weights
        let cssVarValue;
        if (pathContext.includes('typography-font') && pathContext.includes('weight') && 
            typeof value === 'number' && [100, 200, 300, 400, 500, 600, 700, 800, 900].includes(value)) {
          cssVarValue = String(value); // Ensure font-weight values are unitless
        } else {
          cssVarValue = formatCssValue(value, key, pathContext);
        }
        result.push(`  ${cssVarName}: ${cssVarValue};`);
      }
      // If it's a nested group object
      else if (typeof value === 'object') {
        // Recursively process the nested group
        const nestedResult = processVariablesObject(
          value, 
          collectionName, 
          collectionId, 
          modeName, 
          currentPathParts, 
          isCanonicalContext
        );
        result.push(...nestedResult);
      }
    }
    
    return result;
  }
  
  // Analyze collections and modes
  const collectionNames = Object.keys(payload);
  const numCollections = collectionNames.length;
  let singleCollectionName = numCollections === 1 ? collectionNames[0] : null;
  let modesForSingleCollection = singleCollectionName ? Object.keys(payload[singleCollectionName]) : [];
  let numModesInSingleCollection = modesForSingleCollection.length;

  // Helper to get collectionId
  function getCollectionIdByName(name) {
    for (const [id, col] of allCollectionsMap.entries()) {
      if (col.name === name) return id;
    }
    return null; 
  }
  
  // Process variables based on collections and modes count
  if (numCollections === 1) {
    const collName = singleCollectionName;
    const collId = getCollectionIdByName(collName);

    if (numModesInSingleCollection === 1) {
      // Scenario: 1 Collection, 1 Mode -> All to :root
      const modeName = modesForSingleCollection[0];
      const modeObject = payload[collName][modeName];
      const rootVars = processVariablesObject(
        modeObject, collName, collId, modeName, [], false // LHS always short name
      );
      scopeVariables.root.push(...rootVars);
    } else if (numModesInSingleCollection === 2) {
      // Scenario: 1 Collection, 2 Modes -> Mode 1 to :root, Mode 2 to class
      const mode1Name = modesForSingleCollection[0];
      const mode1Object = payload[collName][mode1Name];
      const rootVars = processVariablesObject(
        mode1Object, collName, collId, mode1Name, [], false // LHS always short name
      );
      scopeVariables.root.push(...rootVars);

      const mode2Name = modesForSingleCollection[1];
      const mode2Object = payload[collName][mode2Name];
      const themeClassName = `${toKebabCase(collName)}-${toKebabCase(mode2Name)}`;
      const themeVars = processVariablesObject(
        mode2Object, collName, collId, mode2Name, [], false // LHS always short name
      );
      if (themeVars.length > 0) {
        scopeVariables.themes[themeClassName] = themeVars;
      }
    } else { // numModesInSingleCollection > 2
      // Scenario: 1 Collection, >2 Modes -> All to classes, no :root
      for (const modeName of modesForSingleCollection) {
        const modeObject = payload[collName][modeName];
        const themeClassName = `${toKebabCase(collName)}-${toKebabCase(modeName)}`;
        const themeVars = processVariablesObject(
          modeObject, collName, collId, modeName, [], false // LHS always short name
        );
        if (themeVars.length > 0) {
          if (!scopeVariables.themes[themeClassName]) scopeVariables.themes[themeClassName] = [];
          scopeVariables.themes[themeClassName].push(...themeVars);
        }
      }
    }
  } else { // numCollections > 1
    // Scenario: Multiple Collections -> All to classes, no :root
    for (const collName of collectionNames) {
      const collId = getCollectionIdByName(collName);
      const modesForCurrentCollection = Object.keys(payload[collName]);
      for (const modeName of modesForCurrentCollection) {
        const modeObject = payload[collName][modeName];
        const themeClassName = `${toKebabCase(collName)}-${toKebabCase(modeName)}`;
        const themeVars = processVariablesObject(
          modeObject, collName, collId, modeName, [], false // LHS always short name
        );
        if (themeVars.length > 0) {
          if (!scopeVariables.themes[themeClassName]) scopeVariables.themes[themeClassName] = [];
          scopeVariables.themes[themeClassName].push(...themeVars);
        }
      }
    }
  }
  
  // Build the CSS string
  
  // Add :root variables
  if (scopeVariables.root.length > 0) {
    cssString += ":root {\n";
    cssString += scopeVariables.root.join('\n');
    cssString += "\n}\n\n";
  }
  
  // Add theme class variables
  for (const themeName in scopeVariables.themes) {
    if (scopeVariables.themes[themeName].length > 0) {
      cssString += `.${themeName} {\n`;
      cssString += scopeVariables.themes[themeName].join('\n');
      cssString += "\n}\n\n";
    }
  }
  
  return cssString;
}

/**
 * Generates a Tailwind CSS configuration string from Figma variables
 * @param {Object} finalPayload - The structured variable payload
 * @param {Map} allVariablesMap - Map of variable IDs to variables
 * @param {Map} allCollectionsMap - Map of collection IDs to collections
 * @return {string} The Tailwind config string
 */
async function generateTailwindConfigString(finalPayload, allVariablesMap, allCollectionsMap) {
  console.log("[Tailwind] Starting Tailwind config generation");
  console.log(`[Tailwind] finalPayload collections: ${Object.keys(finalPayload).join(', ')}`);
  console.log(`[Tailwind] allVariablesMap size: ${allVariablesMap.size}`);
  
  const tailwindThemeExtend = {
    colors: {},
    spacing: {},
    fontSize: {},
    fontFamily: {},
    fontWeight: {},
    lineHeight: {},
    borderRadius: {},
    borderWidth: {},
    opacity: {},
    letterSpacing: {},
    zIndex: {}
  };
  
  // Build a path-to-variable lookup map for efficiency
  const pathToVariableMap = new Map();
  for (const variable of allVariablesMap.values()) {
    pathToVariableMap.set(variable.name, variable);
  }
  
  // Recursive function to process variables in the same order as CSS
  function processTailwindVariables(obj, path = []) {
    for (const key of Object.keys(obj)) {
      const value = obj[key];
      const currentPath = [...path, key];
      
      // If it's a leaf node (actual variable value)
      if (value === null || typeof value !== 'object' || 
          value.__isAliasPath || value.__isAliasPathError || 
          Object.keys(value).length === 0) {
        // It's a variable - get its full path for categorization
        const fullPath = currentPath.join('/');
        const tailwindKey = toKebabCase(fullPath);
        
        // Find the original variable to get its type for categorization
        const originalVariable = pathToVariableMap.get(fullPath);
        
        if (originalVariable) {
          console.log(`[Tailwind] Found exact match for path: ${fullPath}`);
          const category = getTailwindCategory(originalVariable, fullPath);
          
          if (category && tailwindThemeExtend[category]) {
            // Add to the appropriate category in Tailwind
            const cssVarName = `--${tailwindKey}`;
            tailwindThemeExtend[category][tailwindKey] = `var(${cssVarName})`;
            console.log(`[Tailwind] Added to category ${category}: ${tailwindKey} = var(${cssVarName})`);
          } else {
            console.warn(`[Tailwind] No suitable category found for: ${fullPath}, type: ${originalVariable.resolvedType}`);
          }
        } else {
          console.log(`[Tailwind] No exact match for path: ${fullPath}, trying fuzzy match...`);
          // If no match by exact path, try finding a variable that ends with this path
          // This is needed because sometimes the Figma variable name might not include the full path
          let found = false;
          for (const [varPath, variable] of pathToVariableMap.entries()) {
            if (varPath.endsWith('/' + fullPath.split('/').pop())) {
              const category = getTailwindCategory(variable, fullPath);
              
              if (category && tailwindThemeExtend[category]) {
                const cssVarName = `--${tailwindKey}`;
                tailwindThemeExtend[category][tailwindKey] = `var(${cssVarName})`;
                console.log(`[Tailwind] Found fuzzy match: ${varPath} for ${fullPath}, added to ${category}`);
                found = true;
                break;
              }
            }
          }
          
          if (!found) {
            console.warn(`[Tailwind] Could not find variable for path: ${fullPath}`);
          }
        }
      } else {
        // It's a group - recurse
        processTailwindVariables(value, currentPath);
      }
    }
  }
  
  // Process collections in the same order as CSS
  for (const collectionName of Object.keys(finalPayload)) {
    const collectionObj = finalPayload[collectionName];
    
    // If collection has modes
    if (typeof collectionObj === 'object' && Object.keys(collectionObj).length > 0) {
      // Check if collection has modes or is a single-mode collection
      if (Object.values(collectionObj)[0] && typeof Object.values(collectionObj)[0] === 'object') {
        // Multi-mode collection
        // Process each mode
        for (const modeName of Object.keys(collectionObj)) {
          const modeObj = collectionObj[modeName];
          processTailwindVariables(modeObj);
        }
      } else {
        // Single-mode collection (mode name is skipped)
        processTailwindVariables(collectionObj);
      }
    }
  }
  
  // Remove empty categories
  for (const catKey in tailwindThemeExtend) {
    if (Object.keys(tailwindThemeExtend[catKey]).length === 0) {
      delete tailwindThemeExtend[catKey];
    }
  }
  
  // Generate the comment block for the Tailwind config
  const commentBlock = `/**
 * Tailwind CSS Configuration generated from Figma Variables
 *
 * This configuration extends the default Tailwind theme by mapping
 * design tokens from your Figma file to CSS custom properties.
 *
 * How it works:
 * - Figma variable names are transformed
 *   into Tailwind keys.
 * - These keys are then assigned a CSS var() function pointing to the
 *   corresponding concise CSS custom property .
 *
 * This allows your Tailwind utilities to be dynamically themed by the
 * CSS custom properties which can change based on applied theme classes
 * derived from your Figma modes.
 *
 * Generated by Toko - Figma to Code Plugin
 */`;
  
  // Construct the final Tailwind config string
  let tailwindConfigString = `${commentBlock}\n\n`;
  tailwindConfigString += `module.exports = {\n`;
  tailwindConfigString += `  theme: {\n`;
  
  // Ensure 'extend' itself is only added if there's content
  if (Object.keys(tailwindThemeExtend).length > 0) {
    // Convert the extend object to a string with proper formatting and indentation
    tailwindConfigString += `    extend: ${JSON.stringify(tailwindThemeExtend, null, 2).replace(/\n/g, '\n    ')}\n`;
  } else {
    // If tailwindThemeExtend is empty, output an empty extend object
    tailwindConfigString += `    extend: {}\n`;
  }
  
  tailwindConfigString += `  }\n`;
  tailwindConfigString += `};\n`;
  
  return tailwindConfigString;
}

// Notify UI that the plugin is ready
figma.ui.postMessage({ type: 'plugin-ready' }); 