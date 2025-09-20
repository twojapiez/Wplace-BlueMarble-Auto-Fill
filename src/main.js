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
                const roundedBox = this.parentNode.parentNode.parentNode; // Obtains the rounded box
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

    overlayMain.addDiv({ 'id': 'bm-overlay', 'style': 'top: 10px; left: 50px;' })
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
                        '#bm-contain-protection-delay',      // Protection delay spinner
                        '#bm-contain-charge-limit',          // Charge limit spinner
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
        .addDiv({ 'id': 'bm-contain-protection-delay', 'style': 'display: flex; align-items: center; gap: 0.5ch; margin-top: 0.5em;' })
        .addP({ 'textContent': 'Protect Delay:', 'style': 'margin: 0; white-space: nowrap;' }).buildElement()
        .addDiv({ 'id': 'bm-spinner-container', 'style': 'display: flex; align-items: center;' })
        .addButton({ 'id': 'bm-button-delay-decrease', 'textContent': '-', 'style': 'width: 24px; height: 24px; padding: 0; border-radius: 4px 0 0 4px; border: 1px solid #ccc; font-size: 16px; line-height: 1; margin: 0;' }, (instance, button) => {
            button.onclick = () => {
                const input = document.querySelector('#bm-input-protection-delay');
                let value = parseInt(input.value) || 0;
                if (value > 0) {
                    value--;
                    input.value = value;
                    const secondsDisplay = document.querySelector('#bm-delay-seconds');
                    if (secondsDisplay) {
                        secondsDisplay.textContent = `(${value * 30}s)`;
                    }
                }
            };
        }).buildElement()
        .addInput({ 'type': 'number', 'id': 'bm-input-protection-delay', 'value': '0', 'min': '0', 'max': '60', 'step': '1', 'style': 'width: 50px; text-align: center; border: 1px solid #ccc; border-left: 0; border-right: 0; border-radius: 0; margin: 0; height: 24px;' }, (instance, input) => {
            input.oninput = () => {
                let value = parseInt(input.value) || 0;
                if (value < 0) {
                    value = 0;
                    input.value = value;
                }
                if (value > 60) {
                    value = 60;
                    input.value = value;
                }
                const secondsDisplay = document.querySelector('#bm-delay-seconds');
                if (secondsDisplay) {
                    secondsDisplay.textContent = `(${value * 30}s)`;
                }
            };
        }).buildElement()
        .addButton({ 'id': 'bm-button-delay-increase', 'textContent': '+', 'style': 'width: 24px; height: 24px; padding: 0; border-radius: 0 4px 4px 0; border: 1px solid #ccc; font-size: 16px; line-height: 1; margin: 0;' }, (instance, button) => {
            button.onclick = () => {
                const input = document.querySelector('#bm-input-protection-delay');
                let value = parseInt(input.value) || 0;
                if (value < 60) {
                    value++;
                    input.value = value;
                    const secondsDisplay = document.querySelector('#bm-delay-seconds');
                    if (secondsDisplay) {
                        secondsDisplay.textContent = `(${value * 30}s)`;
                    }
                }
            };
        }).buildElement()
        .addSmall({ 'id': 'bm-delay-seconds', 'textContent': '(0s)', 'style': 'margin-left: 0.5ch;' }).buildElement()
        .buildElement()
        .buildElement()
        .addDiv({ 'id': 'bm-contain-charge-limit', 'style': 'display: flex; align-items: center; gap: 0.5ch; margin-top: 0.5em;' })
        .addP({ 'textContent': 'Charge Limit:', 'style': 'margin: 0; white-space: nowrap;' }).buildElement()
        .addDiv({ 'id': 'bm-charge-spinner-container', 'style': 'display: flex; align-items: center;' })
        .addButton({ 'id': 'bm-button-charge-decrease', 'textContent': '−', 'style': 'width: 24px; height: 24px; padding: 0; border-radius: 4px 0 0 4px; border: 1px solid #ccc; font-size: 16px; line-height: 1; margin: 0;' }, (instance, button) => {
            button.onclick = () => {
                const input = document.querySelector('#bm-input-charge-limit');
                const chargeLimitDisplay = document.querySelector('#bm-charge-limit-display');

                // Check if charge max has changed and update UI
                if (instance.apiManager?.charges?.max) {
                    const currentMax = Math.floor(instance.apiManager.charges.max);
                    if (parseInt(input.max) !== currentMax) {
                        input.max = currentMax;
                        if (chargeLimitDisplay) {
                            chargeLimitDisplay.textContent = `/${currentMax}`;
                        }
                    }
                }

                let value = parseInt(input.value) || 1;
                if (value > 1) {
                    value--;
                    input.value = value;
                }
            };
        }).buildElement()
        .addInput({ 'type': 'number', 'id': 'bm-input-charge-limit', 'value': '10', 'min': '1', 'max': '10', 'step': '1', 'style': 'width: 50px; text-align: center; border: 1px solid #ccc; border-left: 0; border-right: 0; border-radius: 0; margin: 0; height: 24px;' }, (instance, input) => {
            // Initialize with user's current max charges or default to 10
            const userCharges = instance.apiManager?.charges;
            if (userCharges && userCharges.max) {
                input.max = userCharges.max;
                input.value = Math.min(parseInt(input.value) || 10, userCharges.max);

                // Update the display as well
                const chargeLimitDisplay = document.querySelector('#bm-charge-limit-display');
                if (chargeLimitDisplay) {
                    chargeLimitDisplay.textContent = `/${userCharges.max}`;
                }
            }

            input.oninput = () => {
                const chargeLimitDisplay = document.querySelector('#bm-charge-limit-display');

                // Check if charge max has changed and update UI
                if (instance.apiManager?.charges?.max) {
                    const currentMax = Math.floor(instance.apiManager.charges.max);
                    if (parseInt(input.max) !== currentMax) {
                        input.max = currentMax;
                        if (chargeLimitDisplay) {
                            chargeLimitDisplay.textContent = `/${currentMax}`;
                        }
                    }
                }

                let value = parseInt(input.value) || 1;
                const maxCharges = parseInt(input.max) || 10;
                if (value < 1) {
                    value = 1;
                    input.value = value;
                }
                if (value > maxCharges) {
                    value = maxCharges;
                    input.value = value;
                }
            };
        }).buildElement()
        .addButton({ 'id': 'bm-button-charge-increase', 'textContent': '+', 'style': 'width: 24px; height: 24px; padding: 0; border-radius: 0 4px 4px 0; border: 1px solid #ccc; font-size: 16px; line-height: 1; margin: 0;' }, (instance, button) => {
            button.onclick = () => {
                const input = document.querySelector('#bm-input-charge-limit');
                const chargeLimitDisplay = document.querySelector('#bm-charge-limit-display');

                // Check if charge max has changed and update UI
                if (instance.apiManager?.charges?.max) {
                    const currentMax = Math.floor(instance.apiManager.charges.max);
                    if (parseInt(input.max) !== currentMax) {
                        input.max = currentMax;
                        if (chargeLimitDisplay) {
                            chargeLimitDisplay.textContent = `/${currentMax}`;
                        }
                    }
                }

                let value = parseInt(input.value) || 1;
                const maxCharges = parseInt(input.max) || 10;
                if (value < maxCharges) {
                    value++;
                    input.value = value;
                }
            };
        }).buildElement()
        .addSmall({ 'id': 'bm-charge-limit-display', 'textContent': 'N/A', 'style': 'margin-left: 0.5ch;' }).buildElement()
        .buildElement()
        .buildElement()
        .buildElement()
        .addInputFile({ 'id': 'bm-input-file-template', 'textContent': 'Upload Template', 'accept': 'image/png, image/jpeg, image/webp, image/bmp, image/gif' }, (instance, input) => {
            input.addEventListener('change', (event) => {
                const file = event.target.files[0];
                if (!file) return;

                const fileName = file.name;
                console.log(`AUTOFILL: Parsing filename for coordinates: ${fileName}`);

                // Remove file extension
                const nameWithoutExtension = fileName.replace(/\.[^/.]+$/, '');

                // Look for pattern with 4 numbers (1-4 digits each) separated by hyphens
                // Example: example-1075-705-668-256-deface-border
                const coordinatePattern = /(\d{1,4})-(\d{1,4})-(\d{1,4})-(\d{1,4})/;
                const match = nameWithoutExtension.match(coordinatePattern);

                if (match) {
                    const [, tlX, tlY, pxX, pxY] = match;
                    console.log(`AUTOFILL: Found coordinates in filename: TlX=${tlX}, TlY=${tlY}, PxX=${pxX}, PxY=${pxY}`);

                    // Populate the coordinate input fields
                    const tlXInput = document.querySelector('#bm-input-tx');
                    const tlYInput = document.querySelector('#bm-input-ty');
                    const pxXInput = document.querySelector('#bm-input-px');
                    const pxYInput = document.querySelector('#bm-input-py');

                    if (tlXInput) tlXInput.value = tlX;
                    if (tlYInput) tlYInput.value = tlY;
                    if (pxXInput) pxXInput.value = pxX;
                    if (pxYInput) pxYInput.value = pxY;

                    instance.handleDisplayStatus(`📍 Auto-populated coordinates from filename: (${tlX},${tlY}) to (${pxX},${pxY})`);

                    // Automatically click the Create button after populating coordinates
                    const createButton = document.querySelector('#bm-button-create');
                    if (createButton) {
                        console.log(`AUTOFILL: Auto-clicking Create button after coordinate population`);
                        setTimeout(() => {
                            createButton.click();
                            instance.handleDisplayStatus(`🚀 Auto-created template with coordinates from filename`);
                        }, 100); // Small delay to ensure coordinates are set
                    }
                } else {
                    console.log(`AUTOFILL: No coordinate pattern found in filename: ${fileName}`);
                }
            });
        }).buildElement()
        .addDiv({ 'id': 'bm-contain-buttons-template' })
        .addButton({ 'id': 'bm-button-enable', 'textContent': 'Enable' }, (instance, button) => {
            button.onclick = () => {
                instance.apiManager?.templateManager?.setTemplatesShouldBeDrawn(true);
                instance.handleDisplayStatus(`Enabled templates!`);
                // Enable auto-fill button when templates are enabled
                const autoFillBtn = document.querySelector('#bm-button-autofill');
                const modeBtn = document.querySelector('#bm-button-mode');
                const protectBtn = document.querySelector('#bm-button-protect');
                if (instance.apiManager?.templateManager?.templatesArray.length && instance.apiManager?.templateManager?.templatesShouldBeDrawn) {
                    if (autoFillBtn) {
                        autoFillBtn.disabled = false;
                    }
                    if (modeBtn) {
                        modeBtn.disabled = false;
                    }
                    if (protectBtn) {
                        protectBtn.disabled = false;
                    }

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

                instance.handleDisplayStatus(`Drew to canvas!`);
            }
        }).buildElement()
        .addButton({ 'id': 'bm-button-disable', 'textContent': 'Disable' }, (instance, button) => {
            button.onclick = () => {
                instance.apiManager?.templateManager?.setTemplatesShouldBeDrawn(false);
                instance.handleDisplayStatus(`Disabled templates!`);
                // Disable auto-fill button when templates are disabled
                const autoFillBtn = document.querySelector('#bm-button-autofill');
                const modeBtn = document.querySelector('#bm-button-mode');
                const protectBtn = document.querySelector('#bm-button-protect');
                if (autoFillBtn) {
                    autoFillBtn.disabled = true;
                }
                if (modeBtn) {
                    modeBtn.disabled = true;
                }
                if (protectBtn) {
                    protectBtn.disabled = true;
                }
            }
        }).buildElement()
        .addButton({ 'id': 'bm-button-autofill', 'textContent': 'Auto Fill', 'disabled': true }, (instance, button) => {
            // ========== CLEAN AUTO-FILL ARCHITECTURE ==========

            class AutoFillManager {
                constructor(instance, button) {
                    this.instance = instance;
                    this.button = button;
                    this.state = {
                        isRunning: false,
                        mode: 'IDLE', // 'IDLE', 'FILLING', 'PROTECTING', 'WAITING_CHARGES'
                        lastCycleTime: 0
                    };
                    this.config = {
                        maxRetries: 3,
                        chargeWaitInterval: 10000,
                        protectionCheckInterval: 10000,
                        cycleDelay: 20000
                    };
                    this.placedPixels = new Set();
                    this.protectionInterval = null;
                    this.protectionCheckInProgress = false;
                    this.protectionRepairInProgress = false;
                    this.pixelPlacer = new PixelPlacer();
                    this.chargeManager = new ChargeManager(instance.apiManager);
                }

                sleep(ms) {
                    return new Promise(resolve => setTimeout(resolve, ms));
                }

                updateUI(message, buttonText = null) {
                    updateAutoFillOutput(message);
                    if (buttonText) this.button.textContent = buttonText;
                }

                showError(message) {
                    console.log(`AUTOFILL: ${message}`);
                    this.updateUI(message);
                }

                setState(mode) {
                    this.state.mode = mode;
                    console.log(`AUTOFILL: State changed to ${mode}`);
                }

                validateTemplate() {
                    return this.instance.apiManager?.templateManager?.templatesArray.length &&
                        this.instance.apiManager?.templateManager?.templatesShouldBeDrawn;
                }

                updateChargeLimitUI() {
                    const chargeLimitInput = document.querySelector('#bm-input-charge-limit');
                    const chargeLimitDisplay = document.querySelector('#bm-charge-limit-display');

                    if (chargeLimitInput && this.instance.apiManager?.charges?.max) {
                        const userMaxCharges = Math.floor(this.instance.apiManager.charges.max);
                        chargeLimitInput.max = userMaxCharges;

                        // Ensure current value doesn't exceed new max
                        const currentValue = parseInt(chargeLimitInput.value) || 1;
                        if (currentValue > userMaxCharges) {
                            chargeLimitInput.value = userMaxCharges;
                        }

                        // Update display text
                        if (chargeLimitDisplay) {
                            chargeLimitDisplay.textContent = `/${userMaxCharges}`;
                        }
                    }
                }

                async refreshUserData() {
                    try {
                        const userData = await this.instance.apiManager.fetchUserData();
                        if (userData) {
                            console.log('AUTOFILL: Fetched fresh user data');

                            // Update charge limit UI with the latest max charges
                            this.updateChargeLimitUI();
                            // Dispatch a custom event so other parts of the script can react
                            document.dispatchEvent(new CustomEvent('bmUserDataRefreshed'));
                        } else {
                            console.warn('AUTOFILL: Failed to fetch fresh user data, continuing with cached data');
                        }
                    } catch (error) {
                        console.error('AUTOFILL: Error fetching fresh user data:', error);
                    }
                }

                async start() {
                    if (this.state.isRunning) {
                        // If we're running (including protection mode), stop everything
                        console.log("AUTOFILL: Already running, stopping current operation");
                        return this.stop();
                    }

                    if (!this.validateTemplate()) {
                        return this.showError('❌ No active template available');
                    }

                    await this.refreshUserData();
                    this.state.isRunning = true;
                    this.setState('FILLING');
                    this.updateUI('🚀 Auto-fill started!', 'Stop Fill');

                    this.runMainLoop();
                }

                stop() {
                    console.log("AUTOFILL: User requested stop");
                    this.state.isRunning = false;
                    this.setState('IDLE');
                    this.clearProtectionMode();

                    // Clean up UI elements that might be open from protection mode
                    this.cleanupUI();

                    this.updateUI('⏹️ Auto-fill stopped by user', 'Auto Fill');
                }

                cleanupUI() {
                    try {
                        // Close paint menu if it's open
                        const parentDiv = document.querySelector('.relative.px-3');
                        if (parentDiv) {
                            const closeButton = parentDiv.querySelector('.btn.btn-circle.btn-sm svg path[d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"]')?.closest('button');
                            if (closeButton) {
                                console.log("AUTOFILL: Closing paint menu during cleanup");
                                closeButton.click();
                            }
                        }
                    } catch (error) {
                        console.log("AUTOFILL: Error during UI cleanup:", error);
                    }
                }

                clearProtectionMode() {
                    if (this.protectionInterval) {
                        console.log("AUTOFILL: Clearing protection interval ID:", this.protectionInterval);
                        clearInterval(this.protectionInterval);
                        this.protectionInterval = null;
                        this.protectionCheckInProgress = false;
                        this.protectionRepairInProgress = false;
                        window.bmProtectionInterval = null;
                        console.log("AUTOFILL: Protection interval cleared and stopped");
                        this.updateUI('🛡️ Protection mode stopped');
                    } else {
                        console.log("AUTOFILL: No protection interval to clear");
                    }
                }

                async runMainLoop() {
                    while (this.state.isRunning) {
                        try {
                            // Skip cycle if protection is actively repairing damage
                            if (this.protectionRepairInProgress) {
                                console.log("AUTOFILL: Skipping main loop cycle - protection repair in progress");
                                await this.sleep(5000); // Wait 5s before checking again
                                continue;
                            }

                            this.state.lastCycleTime = Date.now();
                            await this.executeCycle();
                        } catch (error) {
                            console.error('AUTOFILL: Cycle error:', error);
                            this.updateUI(`❌ Error: ${error.message}. Retrying in 10s...`);
                            await this.sleep(10000);
                        }
                    }
                }

                async executeCycle() {
                    console.log(`AUTOFILL: Starting cycle in ${this.state.mode} mode`);
                    const cycleResult = await this.analyzeSituation();
                    console.log(`D_AUTOFILL: Cycle result action: ${cycleResult.action}`);

                    switch (cycleResult.action) {
                        case 'PLACE_PIXELS':
                            await this.placePixels(cycleResult.pixels.chunkGroups);
                            break;
                        case 'WAIT_FOR_CHARGES':
                            await this.waitForCharges(cycleResult.waitTime, cycleResult.pixelsNeeded);
                            break;
                        case 'START_PROTECTION':
                            this.startProtectionMode();
                            break;
                        case 'CONTINUE_PROTECTION':
                            await this.sleep(this.config.protectionCheckInterval);
                            break;
                        case 'COMPLETE':
                            this.complete();
                            break;
                    }
                }

                async analyzeSituation() {
                    await this.refreshUserData()
                    const charges = this.instance.apiManager?.charges;

                    if (!charges) {
                        return { action: 'WAIT_FOR_CHARGES', waitTime: 5000 };
                    }

                    const pixelsToPlace = await this.getPixelsToPlace();

                    if (pixelsToPlace.totalRemainingPixels === 0) {
                        if (window.bmProtectMode) {
                            return this.state.mode === 'PROTECTING'
                                ? { action: 'CONTINUE_PROTECTION' }
                                : { action: 'START_PROTECTION' };
                        } else {
                            return { action: 'COMPLETE' };
                        }
                    }

                    const totalPixelCount = pixelsToPlace.totalRemainingPixels;
                    console.log(`D_AUTOFILL: Before charge check - chunks: ${pixelsToPlace.length}, totalPixels: ${totalPixelCount}, charges:`, charges);

                    // Always wait for charges if needed
                    if (this.chargeManager.shouldWaitForCharges(charges, totalPixelCount)) {
                        const waitTime = this.chargeManager.calculateWaitTime(charges, totalPixelCount);
                        console.log(`D_AUTOFILL: Waiting for charges - waitTime: ${waitTime}ms`);
                        // Return pixelsNeeded so the wait loop can adapt if the user changes the charge limit
                        return { action: 'WAIT_FOR_CHARGES', waitTime, pixelsNeeded: totalPixelCount };
                    }

                    console.log(`D_AUTOFILL: Proceeding to place ${totalPixelCount} pixels in ${pixelsToPlace.chunkGroups.length} chunks`);
                    return { action: 'PLACE_PIXELS', pixels: pixelsToPlace };
                }

                async getPixelsToPlace() {
                    await this.refreshUserData();
                    const charges = Math.floor(this.instance.apiManager?.charges?.count || 0);
                    const bitmap = this.instance.apiManager?.extraColorsBitmap || 0;
                    const ownedColors = getOwnedColorsFromBitmap(bitmap);

                    if (ownedColors.length === 0) {
                        console.log("AUTOFILL: No owned colors found");
                        return [];
                    }

                    const pixelResult = await getNextPixels(charges || 1, ownedColors);
                    updateProgressDisplay(pixelResult.totalRemainingPixels);

                    console.log(`D_AUTOFILL: getPixelsToPlace - Charge Count: ${charges || 0}, Chunkgroup.length: ${pixelResult.chunkGroups?.length || 0} chunks, totalPixels: ${pixelResult.totalRemainingPixels}`);

                    return pixelResult;
                }

                async placePixels(chunkGroups) {
                    this.setState('FILLING');
                    console.log(`AUTOFILL: Placing pixels in ${chunkGroups.length} chunks`);
                    this.updateUI(`🎯 Found ${chunkGroups.reduce((sum, chunk) => sum + chunk[1].length, 0)} pixels to place`);

                    // Clear any cached context at the start of a new paint operation to ensure fresh context
                    if (this.pixelPlacer.cachedRequestContext) {
                        console.log("AUTOFILL: Starting fresh paint operation - clearing cached context");
                        this.pixelPlacer.clearCachedRequestContext();
                    }

                    for (let i = 0; i < chunkGroups.length && this.state.isRunning; i++) {
                        await this.pixelPlacer.placeChunk(chunkGroups[i], i === 0);
                    }

                    this.updateUI('✅ Pixel placement completed');
                    await this.sleep(this.config.cycleDelay);
                }

                async waitForCharges(waitTime, pixelsNeeded) {
                    this.setState('WAITING_CHARGES');

                    // Initial snapshot
                    let charges = this.instance.apiManager?.charges;

                    // Get user-defined charge limit input element (may change during wait)
                    const chargeLimitInput = document.querySelector('#bm-input-charge-limit');

                    // Compute initial chargeLimit value (fallback to API max or 10)
                    let chargeLimit = parseInt(chargeLimitInput?.value || (charges?.max ? Math.floor(charges.max) : 10));

                    console.log(`AUTOFILL: Waiting ${(waitTime / 1000).toFixed(1)}s for charges (${charges?.count?.toFixed(2)}/${chargeLimit})`);
                    this.updateUI(`⏱️ Waiting ${this.formatTime(waitTime / 1000)} for charges`);

                    let endTime = Date.now() + waitTime;
                    let iterations = 0;

                    while (Date.now() < endTime && this.state.isRunning) {
                        iterations++;

                        // Every iteration, re-read user input and (periodically) refresh API data so we can adapt
                        const inputVal = parseInt(chargeLimitInput?.value || '') || null;
                        if (inputVal !== null) {
                            // If the user has changed the input, update chargeLimit
                            if (inputVal !== chargeLimit) {
                                chargeLimit = inputVal;
                                console.log(`AUTOFILL: Detected charge limit input change -> ${chargeLimit}`);
                            }
                        }

                        // Periodically refresh API data to get updated charge count and recharge timers
                        if (iterations % 5 === 0) {
                            await this.refreshUserData();
                            charges = this.instance.apiManager?.charges;
                        }

                        // If charges meet or exceed the (possibly updated) user-defined limit, exit early
                        const currentCount = charges?.count || 0;
                        if (currentCount >= chargeLimit) {
                            console.log('AUTOFILL: Charge limit reached during wait, proceeding');
                            this.updateUI('✅ Charge limit reached - proceeding!');
                            return;
                        }

                        // Recalculate how long we should wait based on fresh state.
                        const recalculated = this.chargeManager.calculateWaitTime(charges || { count: 0, rechargeTime: 30000, max: chargeLimit }, pixelsNeeded);

                        // If recalculated wait exceeds remaining time, extend endTime to wait the longer duration
                        const remainingNow = Math.max(0, endTime - Date.now());
                        if (recalculated > remainingNow) {
                            endTime = Date.now() + recalculated;
                            console.log(`AUTOFILL: Extending wait to ${recalculated}ms based on updated inputs/state`);
                        }

                        const remaining = Math.max(0, endTime - Date.now());
                        this.updateUI(`⏳ Charging ${this.formatTime(remaining / 1000)} remaining`);
                        await this.sleep(Math.min(1000, remaining));
                    }
                }

                startProtectionMode() {
                    if (this.state.mode === 'PROTECTING') return;

                    this.setState('PROTECTING');
                    this.updateUI('🛡️ Protection mode active - monitoring template', 'Stop Fill');

                    // Set up protection interval to check every 10 seconds
                    this.protectionInterval = setInterval(async () => {
                        try {
                            // Only run if we're still in protection mode and not already checking
                            if (this.state.mode === 'PROTECTING' && !this.protectionCheckInProgress) {
                                this.protectionCheckInProgress = true;
                                await this.checkForDamage();
                                this.protectionCheckInProgress = false;
                            }
                        } catch (error) {
                            console.error('AUTOFILL: Protection check error:', error);
                            this.updateUI(`❌ Protection error: ${error.message}`);
                            this.protectionCheckInProgress = false;
                        }
                    }, 10000); // 10 seconds as requested

                    window.bmProtectionInterval = this.protectionInterval;
                    console.log("AUTOFILL: Protection interval started - checking every 10 seconds (ID:", this.protectionInterval, ")");
                }

                async checkForDamage() {
                    console.log("AUTOFILL: Checking template integrity... (protection mode:", this.state.mode, ")");
                    this.updateUI('🔍 Checking template integrity...');

                    const bitmap = this.instance.apiManager?.extraColorsBitmap || 0;
                    const ownedColors = getOwnedColorsFromBitmap(bitmap);

                    if (ownedColors.length === 0) {
                        console.log("AUTOFILL: No owned colors for protection check");
                        this.updateUI('⚠️ No owned colors found for protection check');
                        return;
                    }

                    // Check for damaged/griefed pixels by getting all pixels that need to be placed
                    const damageResult = await getNextPixels(0, ownedColors);
                    if (damageResult.totalRemainingPixels > 0) {
                        console.log(`AUTOFILL: Found ${damageResult.totalRemainingPixels} pixels that need protection!`);
                        this.updateUI(`🚨 Template griefed! ${damageResult.totalRemainingPixels} pixels need fixing!`);

                        // Set repair in progress flag IMMEDIATELY to prevent main loop interference
                        this.protectionRepairInProgress = true;
                        console.log("AUTOFILL: Protection repair process started - main loop will pause");

                        try {
                            // Get protection delay from spinner input
                            const protectionDelayInput = document.querySelector('#bm-input-protection-delay');
                            const protectionDelayValue = parseInt(protectionDelayInput?.value || '0');
                            const protectionDelayMs = protectionDelayValue * 30000; // Multiply by 30 seconds (30000ms)

                            console.log("AUTOFILL: Protection delay set to " + protectionDelayMs);

                            if (protectionDelayMs > 0) {
                                console.log(`AUTOFILL: Protection delay active - waiting ${protectionDelayValue * 30} seconds before repairing`);
                                this.updateUI(`⏰ Protection delay: waiting ${protectionDelayValue * 30}s before fixing...`);
                                await this.sleep(protectionDelayMs);

                                // Recheck for damage after the delay - someone else might have fixed it
                                console.log("AUTOFILL: Rechecking template integrity after protection delay...");
                                this.updateUI('🔍 Rechecking template integrity after delay...');
                                const recheckResult = await getNextPixels(0, ownedColors);

                                if (recheckResult.totalRemainingPixels === 0) {
                                    console.log("AUTOFILL: Template was fixed by others during delay - no repair needed");
                                    this.updateUI('✅ Template was fixed by others during delay - no action needed');
                                    return; // Exit early, no repair needed
                                } else if (recheckResult.totalRemainingPixels < damageResult.totalRemainingPixels) {
                                    console.log(`AUTOFILL: Partial repair by others during delay - ${recheckResult.totalRemainingPixels} pixels still need fixing (was ${damageResult.totalRemainingPixels})`);
                                    this.updateUI(`🔧 Partial repair by others - ${recheckResult.totalRemainingPixels} pixels still need fixing`);
                                } else {
                                    console.log(`AUTOFILL: Damage unchanged after delay - ${recheckResult.totalRemainingPixels} pixels still need fixing`);
                                    this.updateUI(`🔧 Damage confirmed after delay - ${recheckResult.totalRemainingPixels} pixels need fixing`);
                                }
                            }

                            await this.refreshUserData();
                            const charges = this.instance.apiManager?.charges;
                            if (charges && Math.floor(charges.count) > 0) {
                                const pixelsToFix = Math.min(Math.floor(charges.count), damageResult.totalRemainingPixels);
                                console.log(`AUTOFILL: Attempting to fix ${pixelsToFix} pixels with ${Math.floor(charges.count)} charges`);
                                this.updateUI(`🔧 Fixing ${pixelsToFix} pixels with available charges...`);

                                // Use existing architecture - get and place pixels
                                const repairPixels = await this.getPixelsToPlace();
                                if (repairPixels.totalRemainingPixels > 0) {
                                    await this.placePixels(repairPixels.chunkGroups);

                                    console.log("AUTOFILL: Protection repair completed");
                                    this.updateUI('✅ Protection repair completed');

                                    // Wait for ghost pixels to clear
                                    console.log("AUTOFILL: Waiting 10s for Ghost Pixels to clear");
                                    this.updateUI('⌚ Waiting 10s for Ghost Pixels to clear');
                                    await this.sleep(10000);
                                }
                            } else {
                                console.log("AUTOFILL: No charges available for immediate fixing");
                                this.updateUI('⚠️ Grief detected but no charges available for fixing');
                            }
                        } finally {
                            // Always clear the repair flag even if errors occur
                            this.protectionRepairInProgress = false;
                            console.log("AUTOFILL: Protection repair finished - main loop can resume");
                        }
                    } else {
                        console.log("AUTOFILL: Template is intact");
                        this.updateUI('✅ Template protection check: All pixels intact');
                    }
                }

                complete() {
                    console.log("AUTOFILL: Template completed - checking protection mode setting");
                    this.state.isRunning = false;
                    updateProgressDisplay(0); // Show completion

                    if (window.bmProtectMode) {
                        console.log("AUTOFILL: Protection mode enabled - starting protection monitoring");
                        this.updateUI('🎉 Template completed! Starting protection mode...');
                        this.startProtectionMode();
                    } else {
                        console.log("AUTOFILL: Protection mode disabled - stopping completely");
                        this.setState('IDLE');
                        this.updateUI('🎉 Template completed! All owned color pixels placed.', 'Auto Fill');
                    }
                }

                formatTime(seconds) {
                    const h = Math.floor(seconds / 3600);
                    const m = Math.floor((seconds % 3600) / 60);
                    const s = Math.floor(seconds % 60);
                    return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
                        : `${m}:${s.toString().padStart(2, '0')}`;
                }
            }

            class PixelPlacer {
                constructor() {
                    this.retryCount = 0;
                    this.maxRetries = 3;
                    this.cachedRequestContext = null;
                    this.contextTimestamp = null;
                    this.contextMaxAge = 10000; // 10 seconds context validity
                }

                isRequestContextValid() {
                    if (!this.cachedRequestContext || !this.contextTimestamp) return false;
                    const age = Date.now() - this.contextTimestamp;
                    return age < this.contextMaxAge;
                }

                clearCachedRequestContext() {
                    this.cachedRequestContext = null;
                    this.contextTimestamp = null;
                    console.log("AUTOFILL: Cleared cached request context");
                }

                async placeChunk(chunkGroup, isFirstChunk = false) {
                    const [chunkCoords, pixels] = chunkGroup;
                    const [chunkX, chunkY] = chunkCoords;

                    console.log(`AUTOFILL: Processing chunk ${chunkX},${chunkY} with ${pixels.length} pixels`);

                    if (isFirstChunk || !this.isRequestContextValid()) {
                        // First chunk or no valid context - use full paint menu + interception
                        console.log(isFirstChunk ? "AUTOFILL: First chunk - opening paint menu and capturing request context" : "AUTOFILL: No valid context - opening paint menu");
                        await this.openPaintMenu();
                        
                        // Use interceptor for first chunk to capture full request context
                        const result = await this.placePixelsWithInterceptor(chunkCoords, pixels, 0, (requestContext) => {
                            this.cachedRequestContext = requestContext;
                            this.contextTimestamp = Date.now();
                            console.log(`AUTOFILL: ✅ Captured complete request context from first chunk (token length: ${requestContext.token?.length || 'N/A'})`);
                        });
                        
                        return result;
                    } else {
                        // Subsequent chunks - use cached request context directly
                        console.log(`AUTOFILL: Reusing cached request context for chunk ${chunkX},${chunkY}`);
                        
                        try {
                            return await this.placePixelsWithCachedContext(chunkCoords, pixels);
                        } catch (error) {
                            // If cached context fails, fall back to full interception method
                            if (error.message.includes('Authentication failed') || error.message.includes('No valid cached')) {
                                console.log(`AUTOFILL: Cached context failed for chunk ${chunkX},${chunkY}, falling back to interception method`);
                                this.clearCachedRequestContext();
                                await this.openPaintMenu();
                                return await this.placePixelsWithInterceptor(chunkCoords, pixels, 0);
                            }
                            throw error;
                        }
                    }
                }

                async openPaintMenu() {
                    const paintButtonResult = await waitForElement(
                        '.btn.btn-primary.btn-lg.sm\\:btn-xl.relative.z-30',
                        { maxWaitTime: 100, checkEnabled: true, sleepInterval: 200, logPrefix: 'AUTOFILL' }
                    );

                    if (!paintButtonResult.success) {
                        throw new Error(`Could not find paint button: ${paintButtonResult.reason}`);
                    }

                    paintButtonResult.element.click();
                    console.log("AUTOFILL: Paint menu opened");
                }

                async placePixelsWithCachedContext(chunkCoords, pixels, retryCount = 0) {
                    if (!pixels || pixels.length === 0) return;
                    const [chunkX, chunkY] = chunkCoords;

                    if (!this.isRequestContextValid()) {
                        throw new Error("No valid cached request context available");
                    }

                    console.log(`AUTOFILL: Using cached request context for chunk ${chunkX},${chunkY}`);

                    // Clone the cached request options to avoid modifying the original
                    const requestOptions = JSON.parse(JSON.stringify(this.cachedRequestContext.requestOptions));
                    
                    // Update the body with new pixel data while keeping the original token
                    const originalBody = JSON.parse(this.cachedRequestContext.originalBody);
                    const newBody = {
                        ...originalBody,
                        colors: pixels.map(([, , colorId]) => colorId),
                        coords: pixels.flatMap(([logicalX, logicalY]) => [logicalX, logicalY])
                    };
                    
                    requestOptions.body = JSON.stringify(newBody);
                    const url = `https://backend.wplace.live/s0/pixel/${chunkX}/${chunkY}`;

                    try {
                        const response = await fetch(url, requestOptions);

                        // Check for context invalidation responses
                        if (response.status === 401 || response.status === 403) {
                            console.log(`AUTOFILL: Cached request context appears invalid (${response.status}), clearing cache`);
                            this.clearCachedRequestContext();
                            throw new Error(`Authentication failed with cached context: ${response.status}`);
                        }

                        // Check for rate limiting
                        if (response.status === 429) {
                            console.log(`AUTOFILL: Rate limited (429) on chunk ${chunkX},${chunkY}. Waiting 30s before retry...`);
                            updateAutoFillOutput(`⏰ Rate limited! Waiting 30s before retry (attempt ${retryCount + 1})...`);
                            await new Promise(resolve => setTimeout(resolve, 30000));
                            updateAutoFillOutput(`🔄 Retrying pixel placement for chunk ${chunkX},${chunkY}...`);
                            return await this.placePixelsWithCachedContext(chunkCoords, pixels, retryCount + 1);
                        }

                        if (!response.ok) {
                            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                        }

                        console.log(`AUTOFILL: ✅ Successfully placed ${pixels.length} pixels using cached request context`);
                        return response;

                    } catch (error) {
                        // If it's an auth error, clear the context and let the caller handle fallback
                        if (error.message.includes('Authentication failed')) {
                            throw error;
                        }

                        console.error(`AUTOFILL: Error placing pixels with cached request context:`, error);
                        throw error;
                    }
                }

                async placePixelsWithInterceptor(chunkCoords, pixels, retryCount = 0, onContextCaptured = null) {
                    if (!pixels || pixels.length === 0) return;
                    const [chunkX, chunkY] = chunkCoords;

                    const requestBodyBuilder = (originalBody, token, url, originalRequest) => {
                        // Call the context callback if provided (for caching)
                        if (onContextCaptured && typeof onContextCaptured === 'function') {
                            // Store the complete request context including the actual request options
                            const requestContext = {
                                token: token,
                                originalBody: JSON.stringify(originalBody),
                                requestOptions: JSON.parse(JSON.stringify(originalRequest)), // Deep clone to avoid references
                                originalUrl: url
                            };

                            onContextCaptured(requestContext);
                        }
                        
                        const newBody = {
                            colors: pixels.map(([, , colorId]) => colorId),
                            coords: pixels.flatMap(([logicalX, logicalY]) => [logicalX, logicalY]),
                            t: token
                        };
                        const newUrl = `https://backend.wplace.live/s0/pixel/${chunkX}/${chunkY}`;
                        return { newBody, newUrl };
                    };

                    const triggerAction = async () => {
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
                        console.log("AUTOFILL: Starting...")

                        // Wait for the final pixel placement button to be ready
                        const finalButtonResult = await waitForElement(
                            '.btn.btn-primary.btn-lg.sm\\:btn-xl.relative',
                            {
                                maxWaitTime: 100,
                                checkEnabled: true,
                                sleepInterval: 200,
                                logPrefix: 'AUTOFILL',
                                description: 'final pixel placement button',
                                contextInfo: ''
                            }
                        );

                        if (!finalButtonResult.success) {
                            // Attempt to gracefully close the paint menu before failing
                            try {
                                console.warn('AUTOFILL: Final paint button not found or disabled - attempting to close paint menu');
                                updateAutoFillOutput('⚠️ Final paint button missing or disabled - trying to close paint menu...');

                                // Common close selectors used by the paint UI
                                const closeSelectors = [
                                    '.btn.btn-secondary',
                                    '.modal-close',
                                    '.close',
                                    '[aria-label="Close"]',
                                    '.btn.btn-outline' // fallback
                                ];

                                // Try clicking the first visible close button
                                for (const sel of closeSelectors) {
                                    const el = document.querySelector(sel);
                                    if (el) {
                                        try {
                                            el.click();
                                            console.log(`AUTOFILL: Clicked close element (${sel})`);
                                            await sleep(150);
                                            break;
                                        } catch (e) { /* ignore click failures */ }
                                    }
                                }

                                // Dispatch Escape key as a fallback
                                try {
                                    const escEvent = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true });
                                    document.dispatchEvent(escEvent);
                                    console.log('AUTOFILL: Dispatched Escape key to close modal');
                                    await sleep(150);
                                } catch (e) { /*C ignore */ }

                                // Click on the canvas to defocus any modal
                                const canvas = document.querySelector('.maplibregl-canvas');
                                if (canvas) {
                                    try {
                                        canvas.click();
                                        console.log('AUTOFILL: Clicked canvas to close any overlays');
                                        await sleep(150);
                                    } catch (e) { }
                                }
                            } catch (innerErr) {
                                console.warn('AUTOFILL: Error while attempting to close paint menu', innerErr);
                            }

                            throw new Error(`Could not find or enable final paint button: ${finalButtonResult.reason}`);
                        }

                        console.log("AUTOFILL: Final button is ready - clicking now");
                        finalButtonResult.element.click();
                    };

                    try {
                        const result = await interceptFetchRequest(requestBodyBuilder, triggerAction, "AUTOFILL");

                        // Check for rate limiting (429 status code)
                        if (result.status === 429) {
                            console.log(`AUTOFILL: Rate limited (429) on chunk ${chunkX},${chunkY}. Waiting 30s before retry...`);
                            updateAutoFillOutput(`⏰ Rate limited! Waiting 30s before retry (attempt ${retryCount + 1})...`);
                            await new Promise(resolve => setTimeout(resolve, 30000));
                            updateAutoFillOutput(`🔄 Retrying pixel placement for chunk ${chunkX},${chunkY}...`);
                            return await this.placePixelsWithInterceptor(chunkCoords, pixels, retryCount + 1);
                        }

                        return result;
                    } catch (error) {
                        throw error;
                    }
                }
            }

            class ChargeManager {
                constructor(apiManager) {
                    this.apiManager = apiManager;
                }

                shouldWaitForCharges(charges, pixelsNeeded) {
                    // Get user-defined charge limit
                    const chargeLimitInput = document.querySelector('#bm-input-charge-limit');
                    const chargeLimit = parseInt(chargeLimitInput?.value || charges.max);

                    if (charges.count >= chargeLimit) return false;
                    const currentCharges = Math.floor(charges.count);
                    const shouldWait = pixelsNeeded > currentCharges;
                    console.log(`D_AUTOFILL: shouldWaitForCharges - pixelsNeeded: ${pixelsNeeded}, currentCharges: ${currentCharges}, charges.count: ${charges.count}, chargeLimit: ${chargeLimit}, shouldWait: ${shouldWait}`);
                    return shouldWait;
                }

                calculateWaitTime(charges, pixelsNeeded) {
                    // Get user-defined charge limit
                    const chargeLimitInput = document.querySelector('#bm-input-charge-limit');
                    const chargeLimit = parseInt(chargeLimitInput?.value || charges.max);

                    const currentCharges = Math.floor(charges.count);
                    // Cap the needed charges at the user-defined charge limit (not max charges)
                    const targetCharges = Math.min(pixelsNeeded, chargeLimit);
                    const chargesNeeded = targetCharges - currentCharges;
                    const partialCharge = charges.count - Math.floor(charges.count);
                    const chargeRate = charges.rechargeTime || 30000; // 30s default

                    console.log(`D_AUTOFILL: calculateWaitTime - pixelsNeeded: ${pixelsNeeded}, targetCharges: ${targetCharges}, currentCharges: ${currentCharges}, chargesNeeded: ${chargesNeeded}, chargeLimit: ${chargeLimit}`);

                    // If we need less than 1 additional charge, just wait for the current partial charge to complete
                    if (chargesNeeded <= 1) {
                        const timeForCurrentCharge = Math.ceil((1 - partialCharge) * chargeRate);
                        console.log(`D_AUTOFILL: calculateWaitTime - need ${chargesNeeded} more charges, waiting ${timeForCurrentCharge}ms for current charge`);
                        return timeForCurrentCharge;
                    }

                    // Calculate time for current charge + time for remaining full charges
                    const timeForCurrentCharge = Math.ceil((1 - partialCharge) * chargeRate);
                    const timeForRemainingCharges = (chargesNeeded - 1) * chargeRate;
                    const totalWaitTime = timeForCurrentCharge + timeForRemainingCharges;

                    console.log(`D_AUTOFILL: calculateWaitTime - need ${chargesNeeded} more charges, waiting ${totalWaitTime}ms total`);
                    return totalWaitTime;
                }
            }

            // ========== UTILITY FUNCTIONS ==========
            const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
            const placedPixels = new Set();
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

            // Helper function to format seconds as hh:mm:ss
            const formatTime = (seconds) => {
                const hours = Math.floor(seconds / 3600);
                const minutes = Math.floor((seconds % 3600) / 60);
                const secs = Math.floor(seconds % 60);
                return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
            };

            // Helper function to update auto-fill output textarea
            const updateAutoFillOutput = (message) => {
                const textarea = document.querySelector('#bm-autofill-output');
                if (textarea) {
                    const timestamp = new Date().toLocaleTimeString();
                    const newContent = `[${timestamp}] ${message}`;
                    textarea.value = newContent + '\n';
                    // Limit to last 20 lines to prevent excessive memory usage
                    const lines = textarea.value.split('\n');
                    if (lines.length > 20) {
                        textarea.value = lines.slice(0, 20).join('\n');
                    }
                    textarea.scrollTop = 0; // Scroll to top to show latest messages
                }
            };

            // Helper function to update progress display textarea
            const updateProgressDisplay = (remainingPixels) => {
                const textarea = document.querySelector('#bm-progress-display');
                const estimatedTimeSeconds = remainingPixels * 30
                if (textarea) {
                    let content = `Remaining Pixels: ${remainingPixels.toLocaleString()}`;

                    if (estimatedTimeSeconds !== null && estimatedTimeSeconds > 0) {
                        content += `\nEstimated Time: ${formatTime(estimatedTimeSeconds)}`;
                    } else {
                        content += '\nEstimated Time: N/A';
                    }

                    textarea.value = content;
                }
            };

            // Helper function to wait for an element to be available and optionally enabled
            const waitForElement = async (selector, options = {}) => {
                const {
                    maxWaitTime = 100, // Maximum wait time in seconds
                    checkEnabled = false, // Whether to check if element is enabled
                    sleepInterval = 200, // How long to wait between checks (ms)
                    logPrefix = 'AUTOFILL', // Prefix for console logs
                    description = 'element', // Description for user feedback
                    contextInfo = '' // Additional context info for messages
                } = options;

                let element = document.querySelector(selector);
                let waitCount = 0;

                console.log(`${logPrefix}: Looking for ${description}${contextInfo}...`);
                updateAutoFillOutput(`🔍 Looking for ${description}${contextInfo}...`);

                // Wait until the element is available and optionally enabled
                while ((!element || (checkEnabled && element.disabled)) && waitCount < maxWaitTime) {
                    waitCount++;
                    const waitMessage = `${logPrefix}: Waiting for ${description} to be ready${contextInfo}... (${waitCount}s/${maxWaitTime}s)`;
                    console.log(waitMessage);
                    updateAutoFillOutput(`⏳ Waiting for ${description} to be ready${contextInfo}... (${waitCount}s/${maxWaitTime}s)`);
                    await sleep(sleepInterval);

                    // Re-query the element in case the DOM changed
                    element = document.querySelector(selector);
                }

                // Check for failure conditions
                if (!element) {
                    const errorMessage = `❌ ${description} not found after waiting${contextInfo}`;
                    updateAutoFillOutput(errorMessage);
                    console.error(`${logPrefix}: ${description} not found after waiting${contextInfo}`);
                    return { success: false, element: null, reason: 'not_found' };
                }

                if (checkEnabled && element.disabled) {
                    const errorMessage = `❌ ${description} still disabled after waiting${contextInfo}`;
                    updateAutoFillOutput(errorMessage);
                    console.error(`${logPrefix}: ${description} still disabled after waiting${contextInfo}`);
                    return { success: false, element, reason: 'disabled' };
                }

                // Success
                const successMessage = `✅ ${description} is ready${contextInfo}`;
                updateAutoFillOutput(successMessage);
                console.log(`${logPrefix}: ${description} is ready${contextInfo}`);
                return { success: true, element, reason: 'ready' };
            };


            /**
            * Decodes the extraColorsBitmap decimal value to determine which colors are owned.
            * Handles both the original positive integer format and the new format that uses
            * a negative number as a bitmask for colors 32-63.
            * @param {number} extraColorsBitmap - The decimal representation for colors 32-63.
            * @returns {number[]} Array of color IDs that are owned.
            */
            function getOwnedColorsFromBitmap(extraColorsBitmap) {
                const ownedColors = new Set();

                for (let i = 0; i < 32; i++) {
                    ownedColors.add(i);
                }


                if (extraColorsBitmap) {
                    if (extraColorsBitmap < 0) extraColorsBitmap = extraColorsBitmap >>> 0;

                    for (let i = 0; i < 32; i++) {
                        if ((extraColorsBitmap & (1 << i)) !== 0) {
                            ownedColors.add(i + 32);
                        }
                    }
                }

                return Array.from(ownedColors).sort((a, b) => a - b);
            }

            // Function to fetch current chunk data from the website
            const fetchChunkData = async (chunkX, chunkY) => {
                try {
                    const response = await fetch(`https://backend.wplace.live/files/s0/tiles/${chunkX}/${chunkY}.png`);
                    if (!response.ok) {
                        console.log(`AUTOFILL: Chunk ${chunkX},${chunkY} not found or empty`);
                        return null;
                    }
                    const blob = await response.blob();
                    return await createImageBitmap(blob);
                } catch (error) {
                    console.warn(`AUTOFILL: Failed to fetch chunk ${chunkX},${chunkY}:`, error);
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

                // OPTIMIZATION 10: Cache color distance calculations for RGB->ColorID conversion
                const colorDistanceCache = new Map();
                const getColorIdFromRGBCached = (r, g, b, a) => {
                    if (a === 0) return 0; // Transparent

                    // Check for special #deface color (222, 250, 206) - place transparent pixels
                    if (r === 222 && g === 250 && b === 206) {
                        return 0; // Return transparent
                    }

                    const key = `${r},${g},${b}`;
                    if (colorDistanceCache.has(key)) {
                        return colorDistanceCache.get(key);
                    }

                    let minDistanceSquared = Infinity; // Use squared distance to avoid sqrt
                    let closestColorId = 1; // Default to black

                    for (const [colorId, [cr, cg, cb]] of Object.entries(colorMap)) {
                        if (colorId === '0') continue; // Skip transparent
                        // Use squared distance to avoid expensive sqrt operation
                        const distanceSquared = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
                        if (distanceSquared < minDistanceSquared) {
                            minDistanceSquared = distanceSquared;
                            closestColorId = parseInt(colorId);
                        }
                    }

                    colorDistanceCache.set(key, closestColorId);
                    return closestColorId;
                };

                // Sort the chunk keys to ensure consistent processing order
                const sortedChunkKeys = Object.keys(chunkedBitmaps).sort();

                // OPTIMIZATION 1: Cache for both fetched chunks and processed coordinate data
                const chunkCache = new Map();
                const coordCache = new Map(); // Cache parsed coordinates to avoid repeated string splitting
                const imageDataCache = new Map(); // Cache processed ImageData objects

                // Pre-parse all coordinates for better performance
                sortedChunkKeys.forEach(key => {
                    if (!coordCache.has(key)) {
                        coordCache.set(key, key.split(',').map(Number));
                    }
                });

                // Collect ALL pixels that exist in the template (for edge detection)
                const allTemplatePixels = new Set();
                // Collect ALL pixels that need placement
                const allPixelsToPlace = [];

                // OPTIMIZATION 11: Pre-calculate template bounds for automatic edge detection
                let templateBounds = {
                    minGlobalX: Infinity,
                    maxGlobalX: -Infinity,
                    minGlobalY: Infinity,
                    maxGlobalY: -Infinity
                };

                // OPTIMIZATION 2: Parallel chunk fetching - identify unique chunks first
                const uniqueChunks = new Set();
                for (const key of sortedChunkKeys) {
                    const parts = coordCache.get(key);
                    const [chunkX, chunkY] = parts;
                    const chunkKey = `${chunkX},${chunkY}`;
                    uniqueChunks.add(chunkKey);
                }

                // Fetch all chunks in parallel instead of sequentially
                const chunkFetchPromises = Array.from(uniqueChunks).map(async (chunkKey) => {
                    const currentChunk = await fetchChunkData(...chunkKey.split(',').map(Number));
                    return { chunkKey, currentChunk };
                });

                const chunkResults = await Promise.all(chunkFetchPromises);
                chunkResults.forEach(({ chunkKey, currentChunk }) => {
                    chunkCache.set(chunkKey, currentChunk);
                });

                // Get current mode early for potential early termination
                const modeBtn = document.querySelector('#bm-button-mode');
                const currentMode = modeBtn ? modeBtn.textContent.replace('Mode: ', '') : 'Random';
                const canEarlyTerminate = currentMode !== 'Scan'; // Can't early terminate in scan mode due to sorting requirements

                // OPTIMIZATION 17: Smart sampling for very large templates
                const templateSize = sortedChunkKeys.length;
                const isLargeTemplate = templateSize > 50; // Consider 50+ chunks as large
                const targetSampleSize = Math.min(count * 3, 10000); // Adaptive sampling based on need
                const shouldSample = isLargeTemplate && canEarlyTerminate && count < 1000;
                let processedChunks = 0;

                // Process pixels with smart sampling for large templates
                outerLoop: for (const key of sortedChunkKeys) {
                    const bitmap = chunkedBitmaps[key];
                    if (!bitmap) continue;

                    // OPTIMIZATION 18: Skip chunks intelligently for large templates
                    if (shouldSample) {
                        processedChunks++;
                        // Process every nth chunk based on template size and requirements
                        const skipInterval = Math.max(1, Math.floor(templateSize / (targetSampleSize / 100)));
                        if (processedChunks % skipInterval !== 0 && allPixelsToPlace.length > count) {
                            continue; // Skip this chunk if we already have enough pixels
                        }
                    }

                    // OPTIMIZATION 3: Use cached coordinate parsing
                    const parts = coordCache.get(key);
                    const [chunkX, chunkY, tilePixelX, tilePixelY] = parts;

                    console.log(`AUTOFILL: Processing tile - ChunkX: ${chunkX}, ChunkY: ${chunkY}, TileCoordX: ${tilePixelX}, TileCoordY: ${tilePixelY}`);

                    // Get cached chunk data
                    const chunkKey = `${chunkX},${chunkY}`;
                    const currentChunk = chunkCache.get(chunkKey);

                    // OPTIMIZATION 4: Cache processed ImageData to avoid repeated getImageData calls
                    let templateImageData;
                    if (!imageDataCache.has(key)) {
                        const templateCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
                        const templateCtx = templateCanvas.getContext('2d');
                        templateCtx.drawImage(bitmap, 0, 0);
                        templateImageData = templateCtx.getImageData(0, 0, bitmap.width, bitmap.height);
                        imageDataCache.set(key, templateImageData);
                    } else {
                        templateImageData = imageDataCache.get(key);
                    }

                    // Create canvas for current chunk data if it exists (cache by chunkKey)
                    let currentImageData = null;
                    if (currentChunk) {
                        const currentChunkCacheKey = `${chunkKey}_imagedata`;
                        if (!imageDataCache.has(currentChunkCacheKey)) {
                            const currentCanvas = new OffscreenCanvas(currentChunk.width, currentChunk.height);
                            const currentCtx = currentCanvas.getContext('2d');
                            currentCtx.drawImage(currentChunk, 0, 0);
                            currentImageData = currentCtx.getImageData(0, 0, currentChunk.width, currentChunk.height);
                            imageDataCache.set(currentChunkCacheKey, currentImageData);
                        } else {
                            currentImageData = imageDataCache.get(currentChunkCacheKey);
                        }
                    }

                    // OPTIMIZATION 5: Pre-calculate array bounds and use direct access
                    const templateData = templateImageData.data;
                    const currentData = currentImageData ? currentImageData.data : null;
                    const templateWidth = bitmap.width;
                    const currentWidth = currentImageData ? currentImageData.width : 0;
                    const currentHeight = currentImageData ? currentImageData.height : 0;

                    // Scan each pixel with optimized array operations
                    // Start at (1,1) and step by 3 to skip the 3x3 grid pattern with transparency
                    for (let y = 1; y < bitmap.height; y += 3) {
                        const baseTemplateIndex = y * templateWidth * 4; // Pre-calculate base index for row
                        for (let x = 1; x < bitmap.width; x += 3) {
                            // OPTIMIZATION 6: Direct index calculation instead of repeated multiplication
                            const templatePixelIndex = baseTemplateIndex + (x * 4);
                            const templateAlpha = templateData[templatePixelIndex + 3];
                            if (templateAlpha === 0) {
                                continue; // Skip transparent pixels in template
                            }

                            // Get template pixel color using direct array access
                            const templateR = templateData[templatePixelIndex];
                            const templateG = templateData[templatePixelIndex + 1];
                            const templateB = templateData[templatePixelIndex + 2];
                            const templateColorId = getColorIdFromRGBCached(templateR, templateG, templateB, templateAlpha);

                            // OPTIMIZATION 7: Pre-calculate coordinate divisions to avoid repeated Math.floor calls
                            const logicalX = (x - 1) / 3 | 0; // Bitwise OR for faster integer conversion
                            const logicalY = (y - 1) / 3 | 0;

                            // Calculate final logical coordinates relative to the chunk
                            const finalLogicalX = tilePixelX + logicalX;
                            const finalLogicalY = tilePixelY + logicalY;

                            // OPTIMIZATION 12: Calculate global coordinates once for bounds and pixel key
                            const globalX = (chunkX * 1000) + finalLogicalX;
                            const globalY = (chunkY * 1000) + finalLogicalY;

                            // Update template bounds
                            templateBounds.minGlobalX = Math.min(templateBounds.minGlobalX, globalX);
                            templateBounds.maxGlobalX = Math.max(templateBounds.maxGlobalX, globalX);
                            templateBounds.minGlobalY = Math.min(templateBounds.minGlobalY, globalY);
                            templateBounds.maxGlobalY = Math.max(templateBounds.maxGlobalY, globalY);

                            const pixelKey = `${chunkX},${chunkY},${finalLogicalX},${finalLogicalY}`;

                            // Add ALL template pixels to our comprehensive set (for edge detection)
                            allTemplatePixels.add(pixelKey);

                            // Skip pixels with colors we don't own
                            if (ownedColors.length > 0 && !ownedColorsSet.has(templateColorId)) {
                                // console.log(`🔒 SKIPPING pixel at (${absX}, ${absY}) - Color ${templateColorId} not owned`);
                                continue;
                            }

                            // Check if pixel is already placed correctly with optimized bounds checking
                            let needsPlacement = true;
                            if (currentData && finalLogicalX >= 0 && finalLogicalX < currentWidth &&
                                finalLogicalY >= 0 && finalLogicalY < currentHeight) {
                                // OPTIMIZATION 8: Direct index calculation for current pixel
                                const currentPixelIndex = (finalLogicalY * currentWidth + finalLogicalX) * 4;
                                const currentR = currentData[currentPixelIndex];
                                const currentG = currentData[currentPixelIndex + 1];
                                const currentB = currentData[currentPixelIndex + 2];
                                const currentAlpha = currentData[currentPixelIndex + 3];
                                const currentColorId = getColorIdFromRGBCached(currentR, currentG, currentB, currentAlpha);

                                // If the current pixel already matches the template color, skip it
                                if (currentColorId === templateColorId) {
                                    needsPlacement = false;
                                }
                            }

                            // Add pixels that need placement to our collection
                            if (needsPlacement && !placedPixels.has(pixelKey)) {
                                // OPTIMIZATION 13: Pre-allocate pixel object with global coordinates for later use
                                allPixelsToPlace.push({
                                    chunkX,
                                    chunkY,
                                    finalLogicalX,
                                    finalLogicalY,
                                    templateColorId,
                                    pixelKey,
                                    globalX, // Pre-computed for edge detection
                                    globalY  // Pre-computed for edge detection
                                });

                                // OPTIMIZATION 9: Early termination for non-scan modes when we have enough pixels
                                if (canEarlyTerminate && allPixelsToPlace.length >= count * 2) {
                                    console.log(`AUTOFILL: Early termination - found ${allPixelsToPlace.length} pixels (target: ${count})`);
                                    break outerLoop;
                                }
                            }
                        }
                    }
                }

                // Helper function to check if a pixel is on the edge of the template - ULTRA OPTIMIZED VERSION
                const isEdgePixel = (pixel) => {
                    // OPTIMIZATION 14: Use pre-computed global coordinates to avoid recalculation
                    const globalX = pixel.globalX;
                    const globalY = pixel.globalY;

                    // OPTIMIZATION 15: Automatic boundary detection - pixels at template bounds are always edges
                    if (globalX === templateBounds.minGlobalX || globalX === templateBounds.maxGlobalX ||
                        globalY === templateBounds.minGlobalY || globalY === templateBounds.maxGlobalY) {
                        return true; // Boundary pixels are automatically edges
                    }

                    // OPTIMIZATION 2: Use static arrays to avoid array creation overhead
                    // Check cardinal directions first (catches ~80% of edges with 50% fewer checks)
                    const cardinalOffsets = [
                        [0, -1],  // Top
                        [-1, 0],  // Left  
                        [1, 0],   // Right
                        [0, 1]    // Bottom
                    ];

                    // OPTIMIZATION 3: Use direct array iteration instead of for...of (faster in V8)
                    for (let i = 0; i < 4; i++) {
                        const dx = cardinalOffsets[i][0];
                        const dy = cardinalOffsets[i][1];
                        const neighGlobalX = globalX + dx;
                        const neighGlobalY = globalY + dy;

                        // OPTIMIZATION 4: Use bitwise operations for division by 1000 (faster than Math.floor for positive numbers)
                        const neighChunkX = neighGlobalX >= 0 ? (neighGlobalX / 1000) | 0 : Math.floor(neighGlobalX / 1000);
                        const neighChunkY = neighGlobalY >= 0 ? (neighGlobalY / 1000) | 0 : Math.floor(neighGlobalY / 1000);

                        // OPTIMIZATION 5: Direct calculation instead of subtraction
                        const neighLogicalX = neighGlobalX - (neighChunkX * 1000);
                        const neighLogicalY = neighGlobalY - (neighChunkY * 1000);

                        // OPTIMIZATION 19: Efficient neighbor key generation using string interpolation
                        const neighborKey = neighChunkX + ',' + neighChunkY + ',' + neighLogicalX + ',' + neighLogicalY;

                        if (!allTemplatePixels.has(neighborKey)) {
                            return true; // Missing cardinal neighbor = definitely edge
                        }
                    }

                    // OPTIMIZATION 6: Only check diagonals if all cardinal neighbors exist
                    // Use static array to avoid recreation overhead
                    const diagonalOffsets = [
                        [-1, -1], // Top-left
                        [1, -1],  // Top-right  
                        [-1, 1],  // Bottom-left
                        [1, 1]    // Bottom-right
                    ];

                    // Same optimizations for diagonal checks
                    for (let i = 0; i < 4; i++) {
                        const dx = diagonalOffsets[i][0];
                        const dy = diagonalOffsets[i][1];
                        const neighGlobalX = globalX + dx;
                        const neighGlobalY = globalY + dy;

                        const neighChunkX = neighGlobalX >= 0 ? (neighGlobalX / 1000) | 0 : Math.floor(neighGlobalX / 1000);
                        const neighChunkY = neighGlobalY >= 0 ? (neighGlobalY / 1000) | 0 : Math.floor(neighGlobalY / 1000);
                        const neighLogicalX = neighGlobalX - (neighChunkX * 1000);
                        const neighLogicalY = neighGlobalY - (neighChunkY * 1000);

                        const neighborKey = neighChunkX + ',' + neighChunkY + ',' + neighLogicalX + ',' + neighLogicalY;

                        if (!allTemplatePixels.has(neighborKey)) {
                            return true; // Missing diagonal neighbor = edge
                        }
                    }

                    return false; // All 8 neighbors exist = interior pixel
                };

                // Run edge detection once and store results
                const edgePixels = [];
                const nonEdgePixels = [];

                for (const pixel of allPixelsToPlace) {
                    if (isEdgePixel(pixel)) {
                        edgePixels.push(pixel);
                    } else {
                        nonEdgePixels.push(pixel);
                    }
                }

                // Sort pixels based on selected mode
                let prioritizedPixels = [];

                if (currentMode === 'Scan') {
                    // OPTIMIZATION 16: Use pre-computed global coordinates for sorting
                    const sortedEdgePixels = edgePixels.sort((a, b) => {
                        if (a.globalY !== b.globalY) return a.globalY - b.globalY;
                        return a.globalX - b.globalX;
                    });
                    const sortedNonEdgePixels = nonEdgePixels.sort((a, b) => {
                        if (a.globalY !== b.globalY) return a.globalY - b.globalY;
                        return a.globalX - b.globalX;
                    });

                    // Edge pixels first, then non-edge pixels
                    prioritizedPixels = [...sortedEdgePixels, ...sortedNonEdgePixels];
                    console.log(`AUTOFILL: 📏 Scan mode: ${edgePixels.length} edge pixels first, then ${nonEdgePixels.length} non-edge pixels (both in scanline order)`);
                } else { // Random mode
                    // Shuffle both arrays randomly
                    const shuffleArray = (array) => {
                        const shuffled = [...array];
                        for (let i = shuffled.length - 1; i > 0; i--) {
                            const j = Math.floor(Math.random() * (i + 1));
                            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
                        }
                        return shuffled;
                    };

                    prioritizedPixels = [...shuffleArray(edgePixels), ...shuffleArray(nonEdgePixels)];
                    console.log(`AUTOFILL: 🎲 Random mode: ${edgePixels.length} edge pixels first (randomized), then ${nonEdgePixels.length} inner pixels (randomized)`);
                }

                // Group pixels by chunk and apply count limit
                let totalPixelsAdded = 0;
                for (const pixel of prioritizedPixels) {
                    if (totalPixelsAdded >= count) break;

                    const chunkKey = `${pixel.chunkX},${pixel.chunkY}`;
                    if (!chunkGroups[chunkKey]) {
                        chunkGroups[chunkKey] = {
                            chunkCoords: [pixel.chunkX, pixel.chunkY],
                            pixels: []
                        };
                    }
                    chunkGroups[chunkKey].pixels.push([pixel.finalLogicalX, pixel.finalLogicalY, pixel.templateColorId]);
                    totalPixelsAdded++;
                }


                console.log(`AUTOFILL: \n📊 SUMMARY: Found ${allPixelsToPlace.length} total pixels that need placement (filtered by ${ownedColors.length} owned colors), returning ${totalPixelsAdded} pixels (${edgePixels.length} edge priority)`);

                // Return both the chunk groups and the total remaining pixels count
                return {
                    // Convert chunk groups to the desired format
                    chunkGroups: Object.values(chunkGroups).map(group => [group.chunkCoords, group.pixels]),
                    totalRemainingPixels: allPixelsToPlace.length,
                    totalPixels: allTemplatePixels.size
                };
            };

            // Helper function to intercept fetch requests for pixel placement
            const interceptFetchRequest = async (requestBodyBuilder, triggerAction, logPrefix = "REQUEST") => {
                const originalFetch = unsafeWindow.fetch;
                let interceptionActive = true;

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
                                console.log(`AUTOFILL: Intercepting fetch request`);
                                const originalBody = JSON.parse(options.body);
                                const token = originalBody['t'];
                                if (!token) {
                                    throw new Error("Could not find security token 't'");
                                }

                                // Build the new request body using the provided builder function, passing original request
                                const { newBody, newUrl } = requestBodyBuilder(originalBody, token, url, options);
                                const newOptions = { ...options, body: JSON.stringify(newBody) };

                                interceptionActive = false;
                                unsafeWindow.fetch = originalFetch;
                                console.log(`AUTOFILL: Sending modified request`);
                                const result = await originalFetch.call(unsafeWindow, newUrl || url, newOptions);
                                resolve(result);
                                return result;
                            } catch (e) {
                                interceptionActive = false;
                                unsafeWindow.fetch = originalFetch;
                                console.error(`${logPrefix}: Error during interception:`, e);
                                reject(e);
                            }
                        } else {
                            return originalFetch.apply(unsafeWindow, args);
                        }
                    };

                    // Execute the trigger action that will cause the fetch request
                    try {
                        await triggerAction();
                    } catch (error) {
                        unsafeWindow.fetch = originalFetch;
                        reject(error);
                    }
                });
            };



            // ========== MAIN IMPLEMENTATION ==========
            const autoFillManager = new AutoFillManager(instance, button);

            // Store reference to manager in button for other components to access
            button.autoFillManager = autoFillManager;

            button.onclick = async () => {
                await autoFillManager.start();
            };
        }).buildElement().addButton({ 'id': 'bm-button-mode', 'textContent': 'Mode: Scan', 'disabled': true }, (instance, button) => {
            const modes = ['Scan', 'Random'];
            let currentModeIndex = 0;

            button.onclick = () => {
                currentModeIndex = (currentModeIndex + 1) % modes.length;
                button.textContent = `Mode: ${modes[currentModeIndex]}`;
            };
        }).buildElement()
        .addButton({ 'id': 'bm-button-protect', 'textContent': 'Protect: Off', 'disabled': true }, (instance, button) => {
            let isProtectModeOn = false;

            button.onclick = () => {
                // Check if AutoFillManager is in protection mode and stop it
                const autoFillBtn = document.querySelector('#bm-button-autofill');
                if (autoFillBtn && autoFillBtn.autoFillManager && autoFillBtn.autoFillManager.state.mode === 'PROTECTING') {
                    console.log("AUTOFILL: Stopping active protection mode");
                    autoFillBtn.autoFillManager.stop();
                }

                isProtectModeOn = !isProtectModeOn;
                button.textContent = `Protect: ${isProtectModeOn ? 'On' : 'Off'}`;
                instance.handleDisplayStatus(`🛡️ Protection mode ${isProtectModeOn ? 'enabled' : 'disabled'}`);

                // Store the protect mode state globally so auto-fill can access it
                window.bmProtectMode = isProtectModeOn;
            };
        }).buildElement()
        .buildElement()
        .addTextarea({ 'id': overlayMain.outputStatusId, 'placeholder': `Status: Sleeping...\nVersion: ${version}`, 'readOnly': true }).buildElement()
        .addTextarea({ 'id': 'bm-autofill-output', 'placeholder': 'Auto-Fill Output:\nWaiting for auto-fill to start...', 'readOnly': true }).buildElement()
        .addTextarea({ 'id': 'bm-progress-display', 'placeholder': 'Progress:\nWaiting for template analysis...', 'readOnly': true }).buildElement()
        .addDiv({ 'id': 'bm-contain-buttons-action' })
        .addDiv()
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

    // Enable / Disable Auto Fill button based on if we have a template and if it should be drawn or not
    setTimeout(() => {
        const autoFillBtn = document.querySelector('#bm-button-autofill');
        const modeBtn = document.querySelector('#bm-button-mode');
        const protectBtn = document.querySelector('#bm-button-protect');
        if (overlayMain.apiManager?.templateManager?.templatesArray.length && overlayMain.apiManager?.templateManager?.templatesShouldBeDrawn) {
            if (autoFillBtn) autoFillBtn.disabled = false;
            if (modeBtn) modeBtn.disabled = false;
            if (protectBtn) protectBtn.disabled = false;
        } else {
            if (autoFillBtn) autoFillBtn.disabled = true;
            if (modeBtn) modeBtn.disabled = true;
            if (protectBtn) protectBtn.disabled = true;
        }

        // Update charge limit display with current charge max from API manager
        const chargeLimitInput = document.querySelector('#bm-input-charge-limit');
        const chargeLimitDisplay = document.querySelector('#bm-charge-limit-display');
        if (chargeLimitInput && chargeLimitDisplay && overlayMain.apiManager?.charges?.max) {
            const currentMax = Math.floor(overlayMain.apiManager.charges.max <= 120 ? overlayMain.apiManager.charges.max : 120);
            // Update input attributes and display to reflect API max
            chargeLimitInput.max = currentMax;
            chargeLimitInput.value = currentMax; // set the input value to the API max as requested
            chargeLimitDisplay.textContent = `/${currentMax}`;
        }
    }, 1000)
}