/** The main file. Everything in the userscript is executed from here.
 * @since 0.0.0
 */

import Overlay from './Overlay.js';
import Observers from './observers.js';
import ApiManager from './apiManager.js';
import TemplateManager from './templateManager.js';
import { consoleLog, consoleWarn } from './utils.js';

const name = GM_info.script.name.toString(); // Name of userscript
const version = GM_info.script.version.toString(); // Version of userscript
const consoleStyle = 'color: cornflowerblue;'; // The styling for the console logs

/** Injects code into the client
 * This code will execute outside of TamperMonkey's sandbox
 * @param {*} callback - The code to execute
 * @since 0.11.15
 */
function inject(callback) {
  const script = document.createElement('script');
  script.setAttribute('bm-name', name); // Passes in the name value
  script.setAttribute('bm-cStyle', consoleStyle); // Passes in the console style value
  script.textContent = `(${callback})();`;
  document.documentElement?.appendChild(script);
  script.remove();
}

/** What code to execute instantly in the client (webpage) to spy on fetch calls.
 * This code will execute outside of TamperMonkey's sandbox.
 * @since 0.11.15
 */
inject(() => {

  const script = document.currentScript; // Gets the current script HTML Script Element
  const name = script?.getAttribute('bm-name') || 'Blue Marble'; // Gets the name value that was passed in. Defaults to "Blue Marble" if nothing was found
  const consoleStyle = script?.getAttribute('bm-cStyle') || ''; // Gets the console style value that was passed in. Defaults to no styling if nothing was found
  const fetchedBlobQueue = new Map(); // Blobs being processed

  window.addEventListener('message', (event) => {
    const { source, endpoint, blobID, blobData, blink } = event.data;

    const elapsed = Date.now() - blink;

    // Since this code does not run in the userscript, we can't use consoleLog().
    console.groupCollapsed(`%c${name}%c: ${fetchedBlobQueue.size} Recieved IMAGE message about blob "${blobID}"`, consoleStyle, '');
    console.log(`Blob fetch took %c${String(Math.floor(elapsed / 60000)).padStart(2, '0')}:${String(Math.floor(elapsed / 1000) % 60).padStart(2, '0')}.${String(elapsed % 1000).padStart(3, '0')}%c MM:SS.mmm`, consoleStyle, '');
    console.log(fetchedBlobQueue);
    console.groupEnd();

    // The modified blob won't have an endpoint, so we ignore any message without one.
    if ((source == 'blue-marble') && !!blobID && !!blobData && !endpoint) {

      const callback = fetchedBlobQueue.get(blobID); // Retrieves the blob based on the UUID

      // If the blobID is a valid function...
      if (typeof callback === 'function') {

        callback(blobData); // ...Retrieve the blob data from the blobID function
      } else {
        // ...else the blobID is unexpected. We don't know what it is, but we know for sure it is not a blob. This means we ignore it.

        consoleWarn(`%c${name}%c: Attempted to retrieve a blob (%s) from queue, but the blobID was not a function! Skipping...`, consoleStyle, '', blobID);
      }

      fetchedBlobQueue.delete(blobID); // Delete the blob from the queue, because we don't need to process it again
    }
  });

  // Spys on "spontaneous" fetch requests made by the client
  const originalFetch = window.fetch; // Saves a copy of the original fetch

  // Overrides fetch
  window.fetch = async function (...args) {
    
    // Capture request details before sending
    const requestUrl = ((args[0] instanceof Request) ? args[0]?.url : args[0]) || 'ignore';
    const requestOptions = args[1] || {};

    const response = await originalFetch.apply(this, args); // Sends a fetch
    const cloned = response.clone(); // Makes a copy of the response

    // Retrieves the endpoint name. Unknown endpoint = "ignore"
    const endpointName = requestUrl;

    // Check Content-Type to only process JSON
    const contentType = cloned.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {


      // Since this code does not run in the userscript, we can't use consoleLog().
      console.log(`%c${name}%c: Sending JSON message about endpoint "${endpointName}"`, consoleStyle, '');

      // Sends a message about the endpoint it spied on
      cloned.json()
        .then(jsonData => {
          window.postMessage({
            source: 'blue-marble',
            endpoint: endpointName,
            jsonData: jsonData
          }, '*');
        })
        .catch(err => {
          console.error(`%c${name}%c: Failed to parse JSON: `, consoleStyle, '', err);
        });
    } else if (contentType.includes('image/') && (!endpointName.includes('openfreemap') && !endpointName.includes('maps'))) {
      // Fetch custom for all images but opensourcemap

      const blink = Date.now(); // Current time

      const blob = await cloned.blob(); // The original blob

      // Since this code does not run in the userscript, we can't use consoleLog().
      console.log(`%c${name}%c: ${fetchedBlobQueue.size} Sending IMAGE message about endpoint "${endpointName}"`, consoleStyle, '');

      // Returns the manipulated blob
      return new Promise((resolve) => {
        const blobUUID = crypto.randomUUID(); // Generates a random UUID

        // Store the blob while we wait for processing
        fetchedBlobQueue.set(blobUUID, (blobProcessed) => {
          // The response that triggers when the blob is finished processing

          // Creates a new response
          resolve(new Response(blobProcessed, {
            headers: cloned.headers,
            status: cloned.status,
            statusText: cloned.statusText
          }));

          // Since this code does not run in the userscript, we can't use consoleLog().
          console.log(`%c${name}%c: ${fetchedBlobQueue.size} Processed blob "${blobUUID}"`, consoleStyle, '');
        });

        window.postMessage({
          source: 'blue-marble',
          endpoint: endpointName,
          blobID: blobUUID,
          blobData: blob,
          blink: blink
        });
      }).catch(exception => {
        const elapsed = Date.now();
        console.error(`%c${name}%c: Failed to Promise blob!`, consoleStyle, '');
        console.groupCollapsed(`%c${name}%c: Details of failed blob Promise:`, consoleStyle, '');
        console.log(`Endpoint: ${endpointName}\nThere are ${fetchedBlobQueue.size} blobs processing...\nBlink: ${blink.toLocaleString()}\nTime Since Blink: ${String(Math.floor(elapsed / 60000)).padStart(2, '0')}:${String(Math.floor(elapsed / 1000) % 60).padStart(2, '0')}.${String(elapsed % 1000).padStart(3, '0')} MM:SS.mmm`);
        console.error(`Exception stack:`, exception);
        console.groupEnd();
      });

      // cloned.blob().then(blob => {
      //   window.postMessage({
      //     source: 'blue-marble',
      //     endpoint: endpointName,
      //     blobData: blob
      //   }, '*');
      // });
    }

    return response; // Returns the original response
  };
});

// Imports the CSS file from dist folder on github
const cssOverlay = GM_getResourceText("CSS-BM-File");
GM_addStyle(cssOverlay);

// Imports the Roboto Mono font family
var stylesheetLink = document.createElement('link');
stylesheetLink.href = 'https://fonts.googleapis.com/css2?family=Roboto+Mono:ital,wght@0,100..700;1,100..700&display=swap';
stylesheetLink.rel = 'preload';
stylesheetLink.as = 'style';
stylesheetLink.onload = function () {
  this.onload = null;
  this.rel = 'stylesheet';
};
document.head?.appendChild(stylesheetLink);

// CONSTRUCTORS
const observers = new Observers(); // Constructs a new Observers object
const overlayMain = new Overlay(name, version); // Constructs a new Overlay object for the main overlay
const overlayTabTemplate = new Overlay(name, version); // Constructs a Overlay object for the template tab
const templateManager = new TemplateManager(name, version, overlayMain); // Constructs a new TemplateManager object
const apiManager = new ApiManager(templateManager); // Constructs a new ApiManager object

overlayMain.setApiManager(apiManager); // Sets the API manager

const storageTemplates = JSON.parse(GM_getValue('bmTemplates', '{}'));
console.log(storageTemplates);
templateManager.importJSON(storageTemplates); // Loads the templates

buildOverlayMain(); // Builds the main overlay

overlayMain.handleDrag('#bm-overlay', '#bm-bar-drag'); // Creates dragging capability on the drag bar for dragging the overlay

apiManager.spontaneousResponseListener(overlayMain); // Reads spontaneous fetch responces

observeBlack(); // Observes the black palette color

consoleLog(`%c${name}%c (${version}) userscript has loaded!`, 'color: cornflowerblue;', '');

/** Observe the black color, and add the "Move" button.
 * @since 0.66.3
 */
function observeBlack() {
  const observer = new MutationObserver((mutations, observer) => {

    const black = document.querySelector('#color-1'); // Attempt to retrieve the black color element for anchoring

    if (!black) { return; } // Black color does not exist yet. Kills iteself

    let move = document.querySelector('#bm-button-move'); // Tries to find the move button

    // If the move button does not exist, we make a new one
    if (!move) {
      move = document.createElement('button');
      move.id = 'bm-button-move';
      move.textContent = 'Move ↑';
      move.className = 'btn btn-soft';
      move.onclick = function () {
        const roundedBox = this.parentNode.parentNode.parentNode.parentNode; // Obtains the rounded box
        const shouldMoveUp = (this.textContent == 'Move ↑');
        roundedBox.parentNode.className = roundedBox.parentNode.className.replace(shouldMoveUp ? 'bottom' : 'top', shouldMoveUp ? 'top' : 'bottom'); // Moves the rounded box to the top
        roundedBox.style.borderTopLeftRadius = shouldMoveUp ? '0px' : 'var(--radius-box)';
        roundedBox.style.borderTopRightRadius = shouldMoveUp ? '0px' : 'var(--radius-box)';
        roundedBox.style.borderBottomLeftRadius = shouldMoveUp ? 'var(--radius-box)' : '0px';
        roundedBox.style.borderBottomRightRadius = shouldMoveUp ? 'var(--radius-box)' : '0px';
        this.textContent = shouldMoveUp ? 'Move ↓' : 'Move ↑';
      }

      // Attempts to find the "Paint Pixel" element for anchoring
      const paintPixel = black.parentNode.parentNode.parentNode.parentNode.querySelector('h2');

      paintPixel.parentNode?.appendChild(move); // Adds the move button
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

/** Deploys the overlay to the page with minimize/maximize functionality.
 * Creates a responsive overlay UI that can toggle between full-featured and minimized states.
 * 
 * Parent/child relationships in the DOM structure below are indicated by indentation.
 * @since 0.58.3
 */
function buildOverlayMain() {
  let isMinimized = false; // Overlay state tracker (false = maximized, true = minimized)

  overlayMain.addDiv({ 'id': 'bm-overlay', 'style': 'top: 10px; right: 75px;' })
    .addDiv({ 'id': 'bm-contain-header' })
    .addDiv({ 'id': 'bm-bar-drag' }).buildElement()
    .addImg({ 'alt': 'Blue Marble Icon - Click to minimize/maximize', 'src': 'https://raw.githubusercontent.com/SwingTheVine/Wplace-BlueMarble/main/dist/assets/Favicon.png', 'style': 'cursor: pointer;' },
      (instance, img) => {
        /** Click event handler for overlay minimize/maximize functionality.
         * 
         * Toggles between two distinct UI states:
         * 1. MINIMIZED STATE (60×76px):
         *    - Shows only the Blue Marble icon and drag bar
         *    - Hides all input fields, buttons, and status information
         *    - Applies fixed dimensions for consistent appearance
         *    - Repositions icon with 3px right offset for visual centering
         * 
         * 2. MAXIMIZED STATE (responsive):
         *    - Restores full functionality with all UI elements
         *    - Removes fixed dimensions to allow responsive behavior
         *    - Resets icon positioning to default alignment
         *    - Shows success message when returning to maximized state
         * 
         * @param {Event} event - The click event object (implicit)
         */
        img.addEventListener('click', () => {
          isMinimized = !isMinimized; // Toggle the current state

          const overlay = document.querySelector('#bm-overlay');
          const header = document.querySelector('#bm-contain-header');
          const dragBar = document.querySelector('#bm-bar-drag');
          const coordsContainer = document.querySelector('#bm-contain-coords');
          const coordsButton = document.querySelector('#bm-button-coords');
          const createButton = document.querySelector('#bm-button-create');
          const enableButton = document.querySelector('#bm-button-enable');
          const disableButton = document.querySelector('#bm-button-disable');
          const coordInputs = document.querySelectorAll('#bm-contain-coords input');

          // Pre-restore original dimensions when switching to maximized state
          // This ensures smooth transition and prevents layout issues
          if (!isMinimized) {
            overlay.style.width = "auto";
            overlay.style.maxWidth = "300px";
            overlay.style.minWidth = "200px";
            overlay.style.padding = "10px";
          }

          // Define elements that should be hidden/shown during state transitions
          // Each element is documented with its purpose for maintainability
          const elementsToToggle = [
            '#bm-overlay h1',                    // Main title "Blue Marble"
            '#bm-contain-userinfo',              // User information section (username, droplets, level)
            '#bm-overlay hr',                    // Visual separator lines
            '#bm-contain-automation > *:not(#bm-contain-coords)', // Automation section excluding coordinates
            '#bm-input-file-template',           // Template file upload interface
            '#bm-contain-buttons-action',        // Action buttons container
            `#${instance.outputStatusId}`,       // Main status log textarea for user feedback
            '#bm-autofill-output'                // Auto-fill specific output textarea
          ];

          // Apply visibility changes to all toggleable elements
          elementsToToggle.forEach(selector => {
            const elements = document.querySelectorAll(selector);
            elements.forEach(element => {
              element.style.display = isMinimized ? 'none' : '';
            });
          });
          // Handle coordinate container and button visibility based on state
          if (isMinimized) {
            // ==================== MINIMIZED STATE CONFIGURATION ====================
            // In minimized state, we hide ALL interactive elements except the icon and drag bar
            // This creates a clean, unobtrusive interface that maintains only essential functionality

            // Hide coordinate input container completely
            if (coordsContainer) {
              coordsContainer.style.display = 'none';
            }

            // Hide coordinate button (pin icon)
            if (coordsButton) {
              coordsButton.style.display = 'none';
            }

            // Hide create template button
            if (createButton) {
              createButton.style.display = 'none';
            }

            // Hide enable templates button
            if (enableButton) {
              enableButton.style.display = 'none';
            }

            // Hide disable templates button
            if (disableButton) {
              disableButton.style.display = 'none';
            }

            // Hide all coordinate input fields individually (failsafe)
            coordInputs.forEach(input => {
              input.style.display = 'none';
            });

            // Apply fixed dimensions for consistent minimized appearance
            // These dimensions were chosen to accommodate the icon while remaining compact
            overlay.style.width = '60px';    // Fixed width for consistency
            overlay.style.height = '76px';   // Fixed height (60px + 16px for better proportions)
            overlay.style.maxWidth = '60px';  // Prevent expansion
            overlay.style.minWidth = '60px';  // Prevent shrinking
            overlay.style.padding = '8px';    // Comfortable padding around icon

            // Apply icon positioning for better visual centering in minimized state
            // The 3px offset compensates for visual weight distribution
            img.style.marginLeft = '3px';

            // Configure header layout for minimized state
            header.style.textAlign = 'center';
            header.style.margin = '0';
            header.style.marginBottom = '0';

            // Ensure drag bar remains visible and properly spaced
            if (dragBar) {
              dragBar.style.display = '';
              dragBar.style.marginBottom = '0.25em';
            }
          } else {
            // ==================== MAXIMIZED STATE RESTORATION ====================
            // In maximized state, we restore all elements to their default functionality
            // This involves clearing all style overrides applied during minimization

            // Restore coordinate container to default state
            if (coordsContainer) {
              coordsContainer.style.display = '';           // Show container
              coordsContainer.style.flexDirection = '';     // Reset flex layout
              coordsContainer.style.justifyContent = '';    // Reset alignment
              coordsContainer.style.alignItems = '';        // Reset alignment
              coordsContainer.style.gap = '';               // Reset spacing
              coordsContainer.style.textAlign = '';         // Reset text alignment
              coordsContainer.style.margin = '';            // Reset margins
            }

            // Restore coordinate button visibility
            if (coordsButton) {
              coordsButton.style.display = '';
            }

            // Restore create button visibility and reset positioning
            if (createButton) {
              createButton.style.display = '';
              createButton.style.marginTop = '';
            }

            // Restore enable button visibility and reset positioning
            if (enableButton) {
              enableButton.style.display = '';
              enableButton.style.marginTop = '';
            }

            // Restore disable button visibility and reset positioning
            if (disableButton) {
              disableButton.style.display = '';
              disableButton.style.marginTop = '';
            }

            // Restore all coordinate input fields
            coordInputs.forEach(input => {
              input.style.display = '';
            });

            // Reset icon positioning to default (remove minimized state offset)
            img.style.marginLeft = '';

            // Restore overlay to responsive dimensions
            overlay.style.padding = '10px';

            // Reset header styling to defaults
            header.style.textAlign = '';
            header.style.margin = '';
            header.style.marginBottom = '';

            // Reset drag bar spacing
            if (dragBar) {
              dragBar.style.marginBottom = '0.5em';
            }

            // Remove all fixed dimensions to allow responsive behavior
            // This ensures the overlay can adapt to content changes
            overlay.style.width = '';
            overlay.style.height = '';
          }

          // ==================== ACCESSIBILITY AND USER FEEDBACK ====================
          // Update accessibility information for screen readers and tooltips

          // Update alt text to reflect current state for screen readers and tooltips
          img.alt = isMinimized ?
            'Blue Marble Icon - Minimized (Click to maximize)' :
            'Blue Marble Icon - Maximized (Click to minimize)';

          // No status message needed - state change is visually obvious to users
        });
      }
    ).buildElement()
    .addHeader(1, { 'textContent': name }).buildElement()
    .buildElement()

    .addHr().buildElement()

    .addDiv({ 'id': 'bm-contain-userinfo' })
    .addP({ 'id': 'bm-user-name', 'textContent': 'Username:' }).buildElement()
    .addP({ 'id': 'bm-user-droplets', 'textContent': 'Droplets:' }).buildElement()
    .addP({ 'id': 'bm-user-nextlevel', 'textContent': 'Next level in...' }).buildElement()
    .buildElement()

    .addHr().buildElement()

    .addDiv({ 'id': 'bm-contain-automation' })
    // .addCheckbox({'id': 'bm-input-stealth', 'textContent': 'Stealth', 'checked': true}).buildElement()
    // .addButtonHelp({'title': 'Waits for the website to make requests, instead of sending requests.'}).buildElement()
    // .addBr().buildElement()
    // .addCheckbox({'id': 'bm-input-possessed', 'textContent': 'Possessed', 'checked': true}).buildElement()
    // .addButtonHelp({'title': 'Controls the website as if it were possessed.'}).buildElement()
    // .addBr().buildElement()
    .addDiv({ 'id': 'bm-contain-coords' })
    .addButton({ 'id': 'bm-button-coords', 'className': 'bm-help', 'style': 'margin-top: 0;', 'innerHTML': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 6"><circle cx="2" cy="2" r="2"></circle><path d="M2 6 L3.7 3 L0.3 3 Z"></path><circle cx="2" cy="2" r="0.7" fill="white"></circle></svg></svg>' },
      (instance, button) => {
        button.onclick = () => {
          const coords = instance.apiManager?.coordsTilePixel; // Retrieves the coords from the API manager
          if (!coords?.[0]) {
            instance.handleDisplayError('Coordinates are malformed! Did you try clicking on the canvas first?');
            return;
          }
          instance.updateInnerHTML('bm-input-tx', coords?.[0] || '');
          instance.updateInnerHTML('bm-input-ty', coords?.[1] || '');
          instance.updateInnerHTML('bm-input-px', coords?.[2] || '');
          instance.updateInnerHTML('bm-input-py', coords?.[3] || '');
        }
      }
    ).buildElement()
    .addInput({ 'type': 'number', 'id': 'bm-input-tx', 'placeholder': 'Tl X', 'min': 0, 'max': 2047, 'step': 1, 'required': true }).buildElement()
    .addInput({ 'type': 'number', 'id': 'bm-input-ty', 'placeholder': 'Tl Y', 'min': 0, 'max': 2047, 'step': 1, 'required': true }).buildElement()
    .addInput({ 'type': 'number', 'id': 'bm-input-px', 'placeholder': 'Px X', 'min': 0, 'max': 2047, 'step': 1, 'required': true }).buildElement()
    .addInput({ 'type': 'number', 'id': 'bm-input-py', 'placeholder': 'Px Y', 'min': 0, 'max': 2047, 'step': 1, 'required': true }).buildElement()
    .buildElement()
    .addInputFile({ 'id': 'bm-input-file-template', 'textContent': 'Upload Template', 'accept': 'image/png, image/jpeg, image/webp, image/bmp, image/gif' }).buildElement()
    .addDiv({ 'id': 'bm-contain-buttons-template' })
    .addButton({ 'id': 'bm-button-enable', 'textContent': 'Enable' }, (instance, button) => {
      button.onclick = () => {
        instance.apiManager?.templateManager?.setTemplatesShouldBeDrawn(true);
        instance.handleDisplayStatus(`Enabled templates!`);
        // Enable auto-fill button when templates are enabled
        const autoFillBtn = document.querySelector('#bm-button-autofill');
        if (autoFillBtn && instance.apiManager?.templateManager?.templatesArray.length && instance.apiManager?.templateManager?.templatesShouldBeDrawn) {
          autoFillBtn.disabled = false;
        }
      }
    }).buildElement()
    .addButton({ 'id': 'bm-button-create', 'textContent': 'Create' }, (instance, button) => {
      button.onclick = async () => {
        const input = document.querySelector('#bm-input-file-template');

        const coordTlX = document.querySelector('#bm-input-tx');
        if (!coordTlX.checkValidity()) { coordTlX.reportValidity(); instance.handleDisplayError('Coordinates are malformed! Did you try clicking on the canvas first?'); return; }
        const coordTlY = document.querySelector('#bm-input-ty');
        if (!coordTlY.checkValidity()) { coordTlY.reportValidity(); instance.handleDisplayError('Coordinates are malformed! Did you try clicking on the canvas first?'); return; }
        const coordPxX = document.querySelector('#bm-input-px');
        if (!coordPxX.checkValidity()) { coordPxX.reportValidity(); instance.handleDisplayError('Coordinates are malformed! Did you try clicking on the canvas first?'); return; }
        const coordPxY = document.querySelector('#bm-input-py');
        if (!coordPxY.checkValidity()) { coordPxY.reportValidity(); instance.handleDisplayError('Coordinates are malformed! Did you try clicking on the canvas first?'); return; }

        // Kills itself if there is no file
        if (!input?.files[0]) { instance.handleDisplayError(`No file selected!`); return; }

        await templateManager.createTemplate(input.files[0], input.files[0]?.name.replace(/\.[^/.]+$/, ''), [Number(coordTlX.value), Number(coordTlY.value), Number(coordPxX.value), Number(coordPxY.value)]);

        // Enable auto-fill button if templates are enabled
        const autoFillBtn = document.querySelector('#bm-button-autofill');
        if (autoFillBtn && instance.apiManager?.templateManager?.templatesShouldBeDrawn && instance.apiManager?.templateManager?.templatesArray.length) {
          autoFillBtn.disabled = false;
        }

        instance.handleDisplayStatus(`Drew to canvas!`);
      }
    }).buildElement()
    .addButton({ 'id': 'bm-button-disable', 'textContent': 'Disable' }, (instance, button) => {
      button.onclick = () => {
        instance.apiManager?.templateManager?.setTemplatesShouldBeDrawn(false);
        instance.handleDisplayStatus(`Disabled templates!`);
        // Disable auto-fill button when templates are disabled
        const autoFillBtn = document.querySelector('#bm-button-autofill');
        if (autoFillBtn) {
          autoFillBtn.disabled = true;
        }
      }
    }).buildElement()
    .addButton({ 'id': 'bm-button-autofill', 'textContent': 'Auto Fill', 'disabled': true }, (instance, button) => {
      let isRunning = false;
      const placedPixels = new Set();
      const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

      // Helper function to update auto-fill output textarea
      const updateAutoFillOutput = (message) => {
        const textarea = document.querySelector('#bm-autofill-output');
        if (textarea) {
          const timestamp = new Date().toLocaleTimeString();
          const newContent = `[${timestamp}] ${message}`;
          if (textarea.value) {
            textarea.value = newContent + '\n' + textarea.value;
          } else {
            textarea.value = newContent;
          }
          // Limit to last 20 lines to prevent excessive memory usage
          const lines = textarea.value.split('\n');
          if (lines.length > 20) {
            textarea.value = lines.slice(0, 20).join('\n');
          }
          textarea.scrollTop = 0; // Scroll to top to show latest messages
        }
      };

      // Helper function to find elements in shadow DOM
      function findInAllShadowRoots(selector) {
        const results = [];
        
        // Check regular DOM first
        results.push(...document.querySelectorAll(selector));
        
        // Recursively check all shadow roots
        function checkShadowRoots(root) {
          const allElements = root.querySelectorAll('*');
          
          allElements.forEach(element => {
            if (element.shadowRoot) {
              // Check inside this shadow root
              results.push(...element.shadowRoot.querySelectorAll(selector));
              // Recursively check nested shadow roots
              checkShadowRoots(element.shadowRoot);
            }
          });
        }
        
        checkShadowRoots(document);
        return results;
      }

      // Helper function to check for captcha and wait infinitely until cleared
      const checkAndWaitForCaptcha = async () => {
        let waitCount = 0;
        
        while (true) {
          // Check for Cloudflare captcha in shadow DOM
          const shadowCaptchaElements = findInAllShadowRoots('.cf-turnstile, .cf-challenge, .cloudflare-captcha, .captcha-container, .captcha-modal, .captcha-overlay, [data-captcha], cf-chl-widget-eru7g');
          
          // Check if any captcha is present and visible
          let captchaVisible = false;
          
          // Check shadow DOM captchas
          shadowCaptchaElements.forEach(element => {
            if (element && element.style.display !== 'none' && element.offsetParent !== null) {
              captchaVisible = true;
            }
          });
          
          if (!captchaVisible) {
            // No captcha present or all captchas are hidden
            if (waitCount > 0) {
              updateAutoFillOutput('✅ Captcha cleared! Continuing...');
            }
            return true;
          }
          
          // Captcha is present and visible
          waitCount++;
          const waitTime = waitCount * 30; // Total wait time in seconds
          updateAutoFillOutput(`🔒 Cloudflare captcha detected in shadow DOM! Waiting (${waitTime}s total)... Please solve the captcha.`);
          console.log(`Cloudflare captcha detected in shadow DOM, waiting attempt ${waitCount} (${waitTime}s total)...`);
          
          // Wait 30 seconds before checking again
          await new Promise(resolve => setTimeout(resolve, 30000));
        }
      };

      // Color mapping from the website's color palette
      const colorMap = {
        0: [0, 0, 0, 0],        // Transparent
        1: [0, 0, 0, 255],      // Black
        2: [60, 60, 60, 255],   // Dark Gray
        3: [120, 120, 120, 255], // Gray
        4: [210, 210, 210, 255], // Light Gray
        5: [255, 255, 255, 255], // White
        6: [96, 0, 24, 255],    // Deep Red
        7: [237, 28, 36, 255],  // Red
        8: [255, 127, 39, 255], // Orange
        9: [246, 170, 9, 255],  // Gold
        10: [249, 221, 59, 255], // Yellow
        11: [255, 250, 188, 255], // Light Yellow
        12: [14, 185, 104, 255], // Dark Green
        13: [19, 230, 123, 255], // Green
        14: [135, 255, 94, 255], // Light Green
        15: [12, 129, 110, 255], // Dark Teal
        16: [16, 174, 166, 255], // Teal
        17: [19, 225, 190, 255], // Light Teal
        18: [40, 80, 158, 255],  // Dark Blue
        19: [64, 147, 228, 255], // Blue
        20: [96, 247, 242, 255], // Cyan
        21: [107, 80, 246, 255], // Indigo
        22: [153, 177, 251, 255], // Light Indigo
        23: [120, 12, 153, 255], // Dark Purple
        24: [170, 56, 185, 255], // Purple
        25: [224, 159, 249, 255], // Light Purple
        26: [203, 0, 122, 255],  // Dark Pink
        27: [236, 31, 128, 255], // Pink
        28: [243, 141, 169, 255], // Light Pink
        29: [104, 70, 52, 255],  // Dark Brown
        30: [149, 104, 42, 255], // Brown
        31: [248, 178, 119, 255], // Beige
        32: [170, 170, 170, 255], // Medium Gray
        33: [165, 14, 30, 255],  // Dark Red
        34: [250, 128, 114, 255], // Light Red
        35: [228, 92, 26, 255],  // Dark Orange
        36: [214, 181, 148, 255], // Light Tan
        37: [156, 132, 49, 255], // Dark Goldenrod
        38: [197, 173, 49, 255], // Goldenrod
        39: [232, 212, 95, 255], // Light Goldenrod
        40: [74, 107, 58, 255],  // Dark Olive
        41: [90, 148, 74, 255],  // Olive
        42: [132, 197, 115, 255], // Light Olive
        43: [15, 121, 159, 255], // Dark Cyan
        44: [187, 250, 242, 255], // Light Cyan
        45: [125, 199, 255, 255], // Light Blue
        46: [77, 49, 184, 255],  // Dark Indigo
        47: [74, 66, 132, 255],  // Dark Slate Blue
        48: [122, 113, 196, 255], // Slate Blue
        49: [181, 174, 241, 255], // Light Slate Blue
        50: [219, 164, 99, 255], // Light Brown
        51: [209, 128, 81, 255], // Dark Beige
        52: [255, 197, 165, 255], // Light Beige
        53: [155, 82, 73, 255],  // Dark Peach
        54: [209, 128, 120, 255], // Peach
        55: [250, 182, 164, 255], // Light Peach
        56: [123, 99, 82, 255],  // Dark Tan
        57: [156, 132, 107, 255], // Tan
        58: [51, 57, 65, 255],   // Dark Slate
        59: [109, 117, 141, 255], // Slate
        60: [179, 185, 209, 255], // Light Slate
        61: [109, 100, 63, 255], // Dark Stone
        62: [148, 140, 107, 255], // Stone
        63: [205, 197, 158, 255]  // Light Stone
      };

      async function getOwnedColors() {
        try {
          updateAutoFillOutput('🔍 Checking owned colors...');
          
          // // Step 0: Check for captcha presence before proceeding
          // const captchaCleared = await checkAndWaitForCaptcha();
          // if (!captchaCleared) {
          //   return []; // Captcha blocking, cannot proceed
          // }
          
          // Step 1: Click the paint mode button
          const paintButton = document.evaluate('/html/body/div[1]/div[1]/div[6]/button', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
          if (!paintButton) {
            updateAutoFillOutput('❌ Paint mode button not found');
            console.error('Paint mode button not found');
            return [];
          }

          paintButton.click();
          updateAutoFillOutput('✅ Clicked paint mode button');
          console.log('Clicked paint mode button');

          // Wait for the UI to update
          await new Promise(resolve => setTimeout(resolve, 500));

          // Step 2: Get the color palette container
          const colorPalette = document.evaluate('/html/body/div[1]/div[1]/div[8]/div/div/div[3]/div', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
          if (!colorPalette) {
            updateAutoFillOutput('❌ Color palette container not found');
            console.error('Color palette container not found');
            return [];
          }

          updateAutoFillOutput('✅ Found color palette container');
          console.log('Found color palette container');

          // Step 3: Parse all color divs and identify unlocked colors
          const ownedColorIds = [];
          const colorDivs = colorPalette.querySelectorAll('div.tooltip');

          updateAutoFillOutput(`📊 Found ${colorDivs.length} colors to check`);
          console.log(`Found ${colorDivs.length} color divs to check`);

          colorDivs.forEach((colorDiv, index) => {
            // Get the color button inside this div
            const colorButton = colorDiv.querySelector('button[id^="color-"]');
            if (colorButton) {
              const colorId = parseInt(colorButton.id.replace('color-', ''));

              // Check if this color is locked by looking for SVG presence
              // Locked colors have an SVG (lock icon), owned colors don't have an SVG
              const hasSVG = colorButton.querySelector('svg') !== null;
              const isLocked = hasSVG;

              if (!isLocked) {
                ownedColorIds.push(colorId);
              }
            }
          });

          updateAutoFillOutput(`✅ Analysis complete: ${ownedColorIds.length} owned, ${colorDivs.length - ownedColorIds.length} locked`);
          return ownedColorIds.sort((a, b) => a - b);

        } catch (error) {
          updateAutoFillOutput(`❌ Error checking colors: ${error.message}`);
          console.error('Error determining owned colors:', error);
          return [];
        }
      }

      // Function to get RGB values from color ID
      const getColorFromId = (colorId) => colorMap[colorId] || [0, 0, 0, 255];

      // Function to find closest color ID from RGB values
      const getColorIdFromRGB = (r, g, b, a) => {
        if (a === 0) return 0; // Transparent

        let minDistance = Infinity;
        let closestColorId = 1; // Default to black

        for (const [colorId, [cr, cg, cb]] of Object.entries(colorMap)) {
          if (colorId === '0') continue; // Skip transparent
          const distance = Math.sqrt((r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2);
          if (distance < minDistance) {
            minDistance = distance;
            closestColorId = parseInt(colorId);
          }
        }
        return closestColorId;
      };

      // Function to fetch current chunk data from the website
      const fetchChunkData = async (chunkX, chunkY) => {
        try {
          const response = await fetch(`https://backend.wplace.live/files/s0/tiles/${chunkX}/${chunkY}.png`);
          if (!response.ok) {
            console.log(`Chunk ${chunkX},${chunkY} not found or empty`);
            return null;
          }
          const blob = await response.blob();
          return await createImageBitmap(blob);
        } catch (error) {
          console.warn(`Failed to fetch chunk ${chunkX},${chunkY}:`, error);
          return null;
        }
      };

      const getNextPixels = async (count, ownedColors = []) => {
        const chunkGroups = {}; // Store pixels grouped by chunk
        if (!instance.apiManager?.templateManager?.templatesArray?.length) return [];

        const template = instance.apiManager.templateManager.templatesArray[0];
        const chunkedBitmaps = template.chunked;
        if (!chunkedBitmaps) {
          instance.handleDisplayError("Template has no pixel data (chunked property is missing).");
          return [];
        }

        // Convert ownedColors array to Set for faster lookup
        const ownedColorsSet = new Set(ownedColors);

        // Sort the chunk keys to ensure consistent processing order
        const sortedChunkKeys = Object.keys(chunkedBitmaps).sort();

        // Cache for fetched chunks to avoid multiple requests
        const chunkCache = new Map();

        // Process ALL pixels first, regardless of count
        for (const key of sortedChunkKeys) {
          const bitmap = chunkedBitmaps[key];
          if (!bitmap) continue;

          // Parse the key: "chunkX,chunkY,tilePixelX,tilePixelY"
          const parts = key.split(',').map(Number);
          const [chunkX, chunkY, tilePixelX, tilePixelY] = parts;

          // Print out the chunk and tile coordinate data
          console.log(`Processing tile - ChunkX: ${chunkX}, ChunkY: ${chunkY}, TileCoordX: ${tilePixelX}, TileCoordY: ${tilePixelY}`);

          // Fetch current chunk data if not already cached
          const chunkKey = `${chunkX},${chunkY}`;
          if (!chunkCache.has(chunkKey)) {
            const currentChunk = await fetchChunkData(chunkX, chunkY);
            chunkCache.set(chunkKey, currentChunk);
          }
          const currentChunk = chunkCache.get(chunkKey);

          // Create an OffscreenCanvas to read the template bitmap pixel data
          const templateCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          const templateCtx = templateCanvas.getContext('2d');
          templateCtx.drawImage(bitmap, 0, 0);
          const templateImageData = templateCtx.getImageData(0, 0, bitmap.width, bitmap.height);

          // Create canvas for current chunk data if it exists
          let currentImageData = null;
          if (currentChunk) {
            const currentCanvas = new OffscreenCanvas(currentChunk.width, currentChunk.height);
            const currentCtx = currentCanvas.getContext('2d');
            currentCtx.drawImage(currentChunk, 0, 0);
            currentImageData = currentCtx.getImageData(0, 0, currentChunk.width, currentChunk.height);
          }


          // Scan each pixel in the template bitmap - NO EARLY BREAKS
          // Start at (1,1) and step by 3 to skip the 3x3 grid pattern with transparency
          for (let y = 1; y < bitmap.height; y += 3) {
            for (let x = 1; x < bitmap.width; x += 3) {
              // Check template pixel
              const templatePixelIndex = (y * bitmap.width + x) * 4;
              const templateAlpha = templateImageData.data[templatePixelIndex + 3];
              if (templateAlpha === 0) {
                continue; // Skip transparent pixels in template
              }

              // Get template pixel color
              const templateR = templateImageData.data[templatePixelIndex];
              const templateG = templateImageData.data[templatePixelIndex + 1];
              const templateB = templateImageData.data[templatePixelIndex + 2];
              const templateColorId = getColorIdFromRGB(templateR, templateG, templateB, templateAlpha);

              // Skip pixels with colors we don't own
              if (ownedColors.length > 0 && !ownedColorsSet.has(templateColorId)) {
                // console.log(`🔒 SKIPPING pixel at (${absX}, ${absY}) - Color ${templateColorId} not owned`);
                continue;
              }

              // Calculate "crushed down" coordinates - convert 3x3 grid position to logical position
              const logicalX = Math.floor((x - 1) / 3); // Convert bitmap x to logical x (0, 1, 2, ...)
              const logicalY = Math.floor((y - 1) / 3); // Convert bitmap y to logical y (0, 1, 2, ...)

              // Calculate final logical coordinates relative to the chunk
              const finalLogicalX = tilePixelX + logicalX;
              const finalLogicalY = tilePixelY + logicalY;
              const pixelKey = `${chunkX},${chunkY},${finalLogicalX},${finalLogicalY}`;

              // Check if pixel is already placed correctly
              let needsPlacement = true;
              if (currentImageData) {
                // Make sure we're within bounds of the current chunk
                if (finalLogicalX >= 0 && finalLogicalX < currentImageData.width &&
                  finalLogicalY >= 0 && finalLogicalY < currentImageData.height) {
                  // Check current pixel color at this position
                  const currentPixelIndex = (finalLogicalY * currentImageData.width + finalLogicalX) * 4;
                  const currentR = currentImageData.data[currentPixelIndex];
                  const currentG = currentImageData.data[currentPixelIndex + 1];
                  const currentB = currentImageData.data[currentPixelIndex + 2];
                  const currentAlpha = currentImageData.data[currentPixelIndex + 3];
                  const currentColorId = getColorIdFromRGB(currentR, currentG, currentB, currentAlpha);
                  
                  // If the current pixel already matches the template color, skip it
                  if (currentColorId === templateColorId) {
                    needsPlacement = false;
                  }
                }
              }

              // Add pixels that need placement to the chunk group
              if (needsPlacement && !placedPixels.has(pixelKey)) {
                const chunkKey = `${chunkX},${chunkY}`;
                if (!chunkGroups[chunkKey]) {
                  chunkGroups[chunkKey] = {
                    chunkCoords: [chunkX, chunkY],
                    pixels: []
                  };
                }
                chunkGroups[chunkKey].pixels.push([finalLogicalX, finalLogicalY, templateColorId]);
              }
            }
          }
        }

        // Convert chunk groups to the desired format and apply count limit
        const result = [];
        let totalPixelsAdded = 0;
        
        for (const chunkKey in chunkGroups) {
          const chunkGroup = chunkGroups[chunkKey];
          const pixelsToAdd = chunkGroup.pixels.slice(0, count - totalPixelsAdded);
          
          if (pixelsToAdd.length > 0) {
            result.push([chunkGroup.chunkCoords, pixelsToAdd]);
            totalPixelsAdded += pixelsToAdd.length;
          }
          
          if (totalPixelsAdded >= count) break;
        }

        const totalPixelsFound = Object.values(chunkGroups).reduce((sum, group) => sum + group.pixels.length, 0);
        console.log(`\n📊 SUMMARY: Found ${totalPixelsFound} total pixels that need placement (filtered by ${ownedColors.length} owned colors), returning ${totalPixelsAdded} pixels`);

        return result;
      };

      const placePixelsWithInterceptor = async (chunkCoords, pixels) => {
        if (!pixels || pixels.length === 0) return;
        const originalFetch = unsafeWindow.fetch;
        let interceptionActive = true;

        const [chunkX, chunkY] = chunkCoords;

        return new Promise(async (resolve, reject) => {
          unsafeWindow.fetch = async (...args) => {
            const url = args[0];
            const options = args[1] || {};
            const method = (options.method || 'GET').toUpperCase();

            if (!interceptionActive) {
              return originalFetch.apply(unsafeWindow, args);
            }

            if (method === 'POST' && typeof url === 'string' && url.includes('/pixel/')) {
              try {
                const originalBody = JSON.parse(options.body);
                const token = originalBody['t'];
                if (!token) {
                  throw new Error("Could not find security token 't'");
                }

                const newBody = {
                  colors: pixels.map(([, , colorId]) => colorId),
                  coords: pixels.flatMap(([logicalX, logicalY]) => [logicalX, logicalY]),
                  t: token
                };

                const newUrl = `https://backend.wplace.live/s0/pixel/${chunkX}/${chunkY}`;
                const newOptions = { ...options, body: JSON.stringify(newBody) };

                interceptionActive = false;
                unsafeWindow.fetch = originalFetch;
                const result = await originalFetch.call(unsafeWindow, newUrl, newOptions);
                resolve(result);

              } catch (e) {
                interceptionActive = false;
                unsafeWindow.fetch = originalFetch;
                reject(e);
              }
            } else {
              return originalFetch.apply(unsafeWindow, args);
            }
          };

          // Trigger the paint process
          try {

            const canvas = document.querySelector('.maplibregl-canvas');
            if (!canvas) throw new Error("Could not find the map canvas.");

            const clickX = window.innerWidth / 2;
            const clickY = window.innerHeight / 2;
            const events = ['mousedown', 'click', 'mouseup'];
            for (const type of events) {
              const event = new MouseEvent(type, { clientX: clickX, clientY: clickY, bubbles: true });
              canvas.dispatchEvent(event);
              await sleep(50);
            }

            const finalButton = document.evaluate('/html/body/div/div[1]/div[8]/div/div/div[3]/div[1]/button', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
            if (!finalButton) throw new Error("Could not find the final paint button.");
            finalButton.click();
          } catch (error) {
            unsafeWindow.fetch = originalFetch;
            reject(error);
          }
        });
      };


      button.onclick = async () => {
        consoleLog("looking for captcha")
        checkAndWaitForCaptcha()
        if (isRunning) {
          isRunning = false;
          button.textContent = 'Auto Fill';
          instance.handleDisplayStatus('Auto fill stopped.');
          updateAutoFillOutput('⏹️ Auto-fill stopped by user');
          return;
        }

        if (!instance.apiManager?.templateManager?.templatesArray.length || !instance.apiManager?.templateManager?.templatesShouldBeDrawn) {
          instance.handleDisplayStatus('No active template to auto fill!');
          updateAutoFillOutput('❌ No active template available');
          return;
        }

        isRunning = true;
        button.textContent = 'Stop Fill';
        instance.handleDisplayStatus('Starting auto fill...');
        updateAutoFillOutput('🚀 Auto-fill started!');

        while (isRunning) {
          try {
            const charges = instance.apiManager?.charges;
            if (!charges) {
              instance.handleDisplayStatus('Waiting for charge data...');
              await sleep(5000);
              continue;
            }

            if (charges.count < charges.max) {
              // Calculate exact wait time based on decimal portion and charges needed
              const chargesNeeded = charges.max - Math.floor(charges.count);
              const decimalPortion = charges.count - Math.floor(charges.count);
              const cooldownMs = charges.cooldownMs || 30000;
              
              // Calculate time until next full charge
              const timeToNextCharge = Math.ceil((1 - decimalPortion) * cooldownMs);
              
              // Calculate total wait time for all needed charges
              const totalWaitTime = timeToNextCharge + ((chargesNeeded - 1) * cooldownMs);
              
              updateAutoFillOutput(`⏱️ Precise timing: ${charges.count.toFixed(3)}/${charges.max} charges, waiting ${(totalWaitTime/1000).toFixed(1)}s`);
              instance.handleDisplayStatus(`Waiting for charges... (${charges.count.toFixed(3)}/${charges.max}). Precise wait: ${(totalWaitTime/1000).toFixed(1)}s`);
              
              // Wait with progress updates every 5 seconds
              const startTime = Date.now();
              const endTime = startTime + totalWaitTime;
              
              while (Date.now() < endTime && isRunning) {
                const remaining = Math.max(0, endTime - Date.now());
                const remainingSeconds = (remaining / 1000).toFixed(1);
                
                instance.handleDisplayStatus(`Waiting for charges... (${charges.count.toFixed(3)}/${charges.max}). Time remaining: ${remainingSeconds}s`);
                updateAutoFillOutput(`⏳ Charging... ${remainingSeconds}s remaining`);
                
                // Sleep for 5 seconds or until the end time, whichever is shorter
                await sleep(Math.min(5000, remaining));
              }
              
              if (!isRunning) break; // Exit if stopped during wait
              continue;
            }

            // Get owned colors before finding pixels
            instance.handleDisplayStatus('Checking owned colors...');
            const ownedColors = await getOwnedColors();
            if (ownedColors.length === 0) {
              instance.handleDisplayError('No owned colors found! Retrying in 10s...');
              await sleep(10000);
              continue;
            }

            const pixelsToPlaceCount = charges.count;
            instance.handleDisplayStatus(`Charges available (${charges.count}/${charges.max}). Finding up to ${pixelsToPlaceCount} pixels from ${ownedColors.length} owned colors...`);
            const chunkGroups = await getNextPixels(pixelsToPlaceCount, ownedColors);

            if (chunkGroups.length === 0) {
              isRunning = false;
              button.textContent = 'Auto Fill';
              instance.handleDisplayStatus('Template completed! All pixels with owned colors have been placed.');
              updateAutoFillOutput('🎉 Template completed! All owned color pixels placed.');
              break;
            }

            // Calculate total pixels to place
            const totalPixels = chunkGroups.reduce((sum, group) => sum + group[1].length, 0);
            instance.handleDisplayStatus(`Placing ${totalPixels} pixels in ${chunkGroups.length} chunk(s)...`);
            updateAutoFillOutput(`🎯 Found ${totalPixels} pixels to place in ${chunkGroups.length} chunks`);

            for (const chunkGroup of chunkGroups) {
              if (!isRunning) break;
              
              const [chunkCoords, pixels] = chunkGroup;
              const [chunkX, chunkY] = chunkCoords;
              
              instance.handleDisplayStatus(`Placing ${pixels.length} pixels in chunk ${chunkX},${chunkY}...`);
              await placePixelsWithInterceptor(chunkCoords, pixels);
              pixels.forEach(([logicalX, logicalY]) => placedPixels.add(`${chunkX},${chunkY},${logicalX},${logicalY}`));
              instance.handleDisplayStatus(`Placed ${pixels.length} pixels in chunk ${chunkX},${chunkY}.`);
              updateAutoFillOutput(`✅ Placed ${pixels.length} pixels in chunk (${chunkX},${chunkY})`);
              await sleep(500); // Small delay between chunk requests
            }

            if (isRunning) {
              instance.handleDisplayStatus(`Finished placing batch of ${totalPixels} pixels.`);
              updateAutoFillOutput(`🎯 Batch complete: ${totalPixels} pixels placed`);
            }

            // Wait a short moment before the next cycle
            await sleep(1000);

          } catch (error) {
            console.error('Error during auto fill cycle:', error);
            instance.handleDisplayError(`Error: ${error.message}. Retrying in 10s.`);
            updateAutoFillOutput(`❌ Error: ${error.message}. Retrying in 10s...`);
            await sleep(10000);
          }
        }
      };
    }).buildElement()
    .buildElement()
    .addTextarea({ 'id': overlayMain.outputStatusId, 'placeholder': `Status: Sleeping...\nVersion: ${version}`, 'readOnly': true }).buildElement()
    .addTextarea({ 'id': 'bm-autofill-output', 'placeholder': 'Auto-Fill Output:\nWaiting for auto-fill to start...', 'readOnly': true }).buildElement()
    .addDiv({ 'id': 'bm-contain-buttons-action' })
    .addDiv()
    // .addButton({'id': 'bm-button-teleport', 'className': 'bm-help', 'textContent': '✈'}).buildElement()
    // .addButton({'id': 'bm-button-favorite', 'className': 'bm-help', 'innerHTML': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><polygon points="10,2 12,7.5 18,7.5 13.5,11.5 15.5,18 10,14 4.5,18 6.5,11.5 2,7.5 8,7.5" fill="white"></polygon></svg>'}).buildElement()
    // .addButton({'id': 'bm-button-templates', 'className': 'bm-help', 'innerHTML': '🖌'}).buildElement()
    .addButton({ 'id': 'bm-button-convert', 'className': 'bm-help', 'innerHTML': '🎨', 'title': 'Template Color Converter' },
      (instance, button) => {
        button.addEventListener('click', () => {
          window.open('https://pepoafonso.github.io/color_converter_wplace/', '_blank', 'noopener noreferrer');
        });
      }).buildElement()
    .buildElement()
    .addSmall({ 'textContent': 'Made by SwingTheVine', 'style': 'margin-top: auto;' }).buildElement()
    .buildElement()
    .buildElement()
    .buildOverlay(document.body);
}

function buildOverlayTabTemplate() {
  overlayTabTemplate.addDiv({ 'id': 'bm-tab-template', 'style': 'top: 20%; left: 10%;' })
    .addDiv()
    .addDiv({ 'className': 'bm-dragbar' }).buildElement()
    .addButton({ 'className': 'bm-button-minimize', 'textContent': '↑' },
      (instance, button) => {
        button.onclick = () => {
          let isMinimized = false;
          if (button.textContent == '↑') {
            button.textContent = '↓';
          } else {
            button.textContent = '↑';
            isMinimized = true;
          }


        }
      }
    ).buildElement()
    .buildElement()
    .buildElement()
    .buildOverlay();
}