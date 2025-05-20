// This shows the HTML page in Figma.
figma.showUI(__html__, { width: 1000, height: 700, themeColors: true });

// Create the main object to hold all fetched variable data
let allFetchedVariablesPayload = {
  local: [], // Array of local collections with their variables
  shared: [] // Array of shared library collections with their variables
};

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
