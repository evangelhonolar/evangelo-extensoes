// Background service worker
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed');
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Handle replay progress updates
  if (request.action === 'replayProgress' || request.action === 'replayComplete') {
    // Forward to popup
    chrome.runtime.sendMessage(request).catch(() => {
      // Popup might not be open
    });
    return;
  }

  // Handle file upload via debugger
  if (request.action === 'uploadFile') {
    handleFileUpload(request.tabId || sender.tab.id, request.selector, request.filePath)
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true; // Keep channel open for async response
  }

  // Handle Auth Token request (proxy for content script)
  if (request.action === 'getAuthToken') {
    chrome.identity.getAuthToken({ interactive: request.interactive }, (token) => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true, token: token });
      }
    });
    return true; // Keep channel open
  }
});

/**
 * Handles file upload using chrome.debugger API
 */
async function handleFileUpload(tabId, selector, filePath) {
  const debugcee = { tabId: tabId };

  try {
    // 1. Attach debugger
    await chrome.debugger.attach(debugcee, "1.3");
    console.log(`Debugger attached to tab ${tabId}`);

    // 2. Enable DOM
    await chrome.debugger.sendCommand(debugcee, "DOM.enable");

    // 3. Get Document Root
    const { root } = await chrome.debugger.sendCommand(debugcee, "DOM.getDocument");

    // 4. Find the file input element
    // Note: selector must be a simple CSS selector supported by querySelector
    // We expect content.js to pass a valid CSS selector string
    const { nodeId } = await chrome.debugger.sendCommand(debugcee, "DOM.querySelector", {
      nodeId: root.nodeId,
      selector: selector
    });

    if (!nodeId) {
      throw new Error(`Element not found via debugger: ${selector}`);
    }

    // 5. Set files
    // DOM.setFileInputFiles takes a list of files and node ID
    await chrome.debugger.sendCommand(debugcee, "DOM.setFileInputFiles", {
      nodeId: nodeId,
      files: [filePath] // files must be array
    });

    console.log(`File set successfully: ${filePath}`);

  } catch (error) {
    console.error("Debugger error:", error);
    throw error;
  } finally {
    // 6. Detach debugger always
    try {
      await chrome.debugger.detach(debugcee);
      console.log(`Debugger detached from tab ${tabId}`);
    } catch (e) {
      // Ignore detach errors (e.g., if tab closed)
    }
  }
}
