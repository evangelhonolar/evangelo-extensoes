// Background service worker
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

  // Handle missing video download from Drive
  if (request.action === 'downloadFromDrive') {
    handleDownloadFromDrive(request.fileName)
      .then((downloadedPath) => sendResponse({ success: true, filePath: downloadedPath }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
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

/**
 * Busca e baixa o arquivo de vídeo do Google Drive
 */
async function handleDownloadFromDrive(fileName) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, async (token) => {
      if (chrome.runtime.lastError || !token) {
        return reject(new Error('Erro de autenticação: ' + (chrome.runtime.lastError?.message || 'Token não obtido')));
      }

      try {
        const folderId = '1k54QCOoCtwd74oo6SE30BWoNyfj51Pem';
        const query = `'${folderId}' in parents and name='${fileName}' and trashed=false`;
        const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`;

        const searchRes = await fetch(searchUrl, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!searchRes.ok) {
          throw new Error(`Erro ao buscar no Drive: ${searchRes.statusText}`);
        }

        const data = await searchRes.json();
        if (!data.files || data.files.length === 0) {
          throw new Error(`Vídeo "${fileName}" não encontrado na pasta do Drive.`);
        }

        const fileId = data.files[0].id;
        const downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;

        // Iniciar download
        chrome.downloads.download({
          url: downloadUrl,
          filename: fileName,
          saveAs: false,
          headers: [{ name: 'Authorization', value: `Bearer ${token}` }]
        }, (downloadId) => {
          if (chrome.runtime.lastError) {
            return reject(new Error('Erro ao iniciar download: ' + chrome.runtime.lastError.message));
          }

          // Aguardar conclusão
          const listener = (delta) => {
            if (delta.id === downloadId) {
              if (delta.state && delta.state.current === 'complete') {
                chrome.downloads.onChanged.removeListener(listener);
                // Obter caminho local do arquivo
                chrome.downloads.search({ id: downloadId }, (results) => {
                  if (results && results.length > 0) {
                    resolve(results[0].filename);
                  } else {
                    reject(new Error('Download concluído, mas o caminho do arquivo não foi encontrado.'));
                  }
                });
              } else if (delta.state && delta.state.current === 'interrupted') {
                chrome.downloads.onChanged.removeListener(listener);
                reject(new Error('Download interrompido.'));
              }
            }
          };
          chrome.downloads.onChanged.addListener(listener);
        });

      } catch (error) {
        reject(error);
      }
    });
  });
}

// Configure side panel to open on action click
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));