let scannedItems = [];
let html5Qrcode = null;
let audioContext = null;

// Initialize audio context on first user interaction
document.addEventListener('click', () => {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
});

function playBeep() {
    if (!audioContext) return;
    
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(1000, audioContext.currentTime); // 1000Hz beep
    
    gainNode.gain.setValueAtTime(0, audioContext.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.3, audioContext.currentTime + 0.01); // Increased from 0.1 to 0.3
    gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.1); // Slightly longer fade out
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.1); // Matched duration with fade out
}

async function debugLog(message, data = null) {
    const debugInfo = {
        message,
        data,
        browserInfo: {
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            vendor: navigator.vendor,
            language: navigator.language
        }
    };

    try {
        await fetch('/debug', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(debugInfo)
        });
    } catch (err) {
        console.warn('Failed to send debug info to server:', err);
    }
}

async function startScanner() {
    try {
        await debugLog('Starting scanner initialization');
        
        // Always create a new instance
        if (html5Qrcode) {
            await debugLog('Cleaning up existing scanner instance');
            await cleanup();
        }

        const config = {
            fps: 30,  // Increased from 10 to 30 for faster scanning
            qrbox: { width: 250, height: 250 },
            aspectRatio: 1.0,
            formatsToSupport: [
                Html5QrcodeSupportedFormats.QR_CODE,
                Html5QrcodeSupportedFormats.EAN_13,
                Html5QrcodeSupportedFormats.EAN_8,
                Html5QrcodeSupportedFormats.CODE_128,
                Html5QrcodeSupportedFormats.CODE_39,
                Html5QrcodeSupportedFormats.UPC_A,
                Html5QrcodeSupportedFormats.UPC_E,
                Html5QrcodeSupportedFormats.CODABAR,
                Html5QrcodeSupportedFormats.ITF
            ],
            experimentalFeatures: {
                useBarCodeDetectorIfSupported: true
            },
            rememberLastUsedCamera: true,
            supportedScanTypes: [Html5QrcodeScanType.SCAN_TYPE_CAMERA],
            videoConstraints: {
                frameRate: { ideal: 30, min: 15 },  // Prefer higher framerates
                facingMode: { ideal: "environment" },  // Prefer back camera
                width: { ideal: 1280 },  // Optimal resolution for most devices
                height: { ideal: 720 }
            }
        };

        // Create instance immediately
        html5Qrcode = new Html5Qrcode("reader");
        
        // Start camera detection in parallel with instance creation
        const [cameras] = await Promise.all([
            Html5Qrcode.getCameras(),
            debugLog('Created scanner instance')
        ]);

        await debugLog('Found cameras', { 
            count: cameras.length,
            available: cameras.map(c => ({
                id: c.id,
                label: c.label
            }))
        });

        if (!cameras || cameras.length === 0) {
            throw new Error('No cameras found on the device');
        }
        
        // Try to find back camera first
        const backCamera = cameras.find(camera => 
            camera.label.toLowerCase().includes('back') || 
            camera.label.toLowerCase().includes('rear') ||
            camera.label.toLowerCase().includes('environment')
        );

        // Camera selection order: back camera -> first camera
        const selectedCamera = backCamera || cameras[0];
        
        await debugLog('Selected camera', { 
            id: selectedCamera.id,
            label: selectedCamera.label,
            isBack: !!backCamera
        });

        try {
            await debugLog('Starting camera scan');
            await html5Qrcode.start(
                { deviceId: selectedCamera.id },
                config,
                onScanSuccess,
                onScanFailure
            );
            await debugLog('Camera scan started successfully');
        } catch (err) {
            await debugLog('Failed to start with selected camera, trying fallback', { error: err });
            // Fallback to basic environment facing mode
            await html5Qrcode.start(
                { facingMode: "environment" },
                config,
                onScanSuccess,
                onScanFailure
            );
            await debugLog('Camera scan started with fallback configuration');
        }
    } catch (err) {
        await debugLog('Error in startScanner', { 
            error: {
                name: err.name,
                message: err.message,
                stack: err.stack
            }
        });
        if (html5Qrcode) {
            await cleanup();
        }
        throw err;
    }
}

async function onScanSuccess(decodedText, decodedResult) {
    // Log scan quality metrics
    await debugLog('Scan success details', {
        text: decodedText,
        format: decodedResult.result.format,
        quality: decodedResult.result
    });

    if (!scannedItems.includes(decodedText)) {
        playBeep();
        scannedItems.unshift(decodedText); // Add to beginning of array
        updateScannedList();
    }
}

function onScanFailure(error) {
    // Only log every 100th failure to avoid spam
    if (Math.random() < 0.01) {
        debugLog('Scan failure', { error });
    }
}

function updateScannedList() {
    const listElement = document.getElementById('scanned-list');
    const shareButton = document.getElementById('share-button');
    
    if (!listElement) return;
    
    // Show/hide containers based on items
    const hasItems = scannedItems.length > 0;
    listElement.style.display = hasItems ? 'block' : 'none';
    if (shareButton) {
        shareButton.style.display = hasItems ? 'block' : 'none';
    }

    // Only update content if there are items
    if (hasItems) {
        const items = scannedItems.map((item, index) => `
            <div class="scanned-item">
                <span>${item}</span>
                <button onclick="removeItem(${index})">×</button>
            </div>
        `).join('');
        
        listElement.innerHTML = items;
    }
}

function removeItem(index) {
    scannedItems.splice(index, 1);
    updateScannedList();
}

async function shareList() {
    if (!scannedItems.length) return;
    
    try {
        const text = scannedItems.join('\n');
        
        if (navigator.share) {
            await navigator.share({
                title: 'Scanned Items',
                text: text
            });
            await debugLog('Shared list using native share');
        } else {
            // Fallback to clipboard
            await navigator.clipboard.writeText(text);
            await debugLog('Copied list to clipboard (share not available)');
        }
    } catch (err) {
        await debugLog('Error sharing list', { error: err });
    }
}

async function cleanup() {
    if (html5Qrcode) {
        try {
            await debugLog('Starting cleanup');
            if (html5Qrcode.isScanning) {
                await html5Qrcode.stop();
                await debugLog('Scanner stopped');
            }
            await html5Qrcode.clear();
            await debugLog('Scanner cleared');
            html5Qrcode = null;
        } catch (error) {
            await debugLog('Cleanup failed', { error });
        }
    }
}

// Camera availability detection and handling
async function handleCameraAvailability() {
    try {
        await debugLog('Checking camera availability');
        
        const cameraContainer = document.getElementById('camera-container');
        const alternativeInputContainer = document.getElementById('alternative-input-container');
        
        if (!('mediaDevices' in navigator) || !('enumerateDevices' in navigator.mediaDevices)) {
            await debugLog('Media Devices API not supported');
            return handleNoCameraAvailable();
        }
        
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cameras = devices.filter(device => device.kind === 'videoinput');
        
        if (cameras.length === 0) {
            await debugLog('No cameras found');
            return handleNoCameraAvailable();
        }
        
        try {
            // Attempt to get camera access
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            
            // Camera is available and accessible
            cameraContainer.style.display = 'block';
            alternativeInputContainer.style.display = 'none';
            
            // Start the scanner with the camera
            await startScanner();
        } catch (accessError) {
            // Camera exists but access was denied
            await debugLog('Camera access denied', accessError);
            handleNoCameraAvailable();
        }
    } catch (error) {
        await debugLog('Camera availability check failed', error);
        handleNoCameraAvailable();
    }
}

function handleNoCameraAvailable() {
    const cameraContainer = document.getElementById('camera-container');
    const alternativeInputContainer = document.getElementById('alternative-input-container');
    
    // Hide camera container
    cameraContainer.style.display = 'none';
    
    // Show alternative input with dark theme
    alternativeInputContainer.style.display = 'block';
    alternativeInputContainer.innerHTML = `
        <input 
            type="text" 
            id="manual-input" 
            class="form-control"
            placeholder="Enter text"
            autofocus
        >
        <button id="manual-submit" class="action-button mt-2">Submit Code</button>
    `;
    
    // Add event listeners for manual input
    const manualInput = document.getElementById('manual-input');
    const manualSubmit = document.getElementById('manual-submit');
    
    manualSubmit.addEventListener('click', handleManualInput);
    manualInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            handleManualInput();
        }
    });

    // Add onblur event to refocus after 250ms
    manualInput.addEventListener('blur', (event) => {
        // Prevent default blur behavior
        event.preventDefault();
        
        // Use requestAnimationFrame for more reliable refocusing
        requestAnimationFrame(() => {
            manualInput.focus({ preventScroll: true });
        });
    });

    // Ensure input gets focus
    manualInput.focus({ preventScroll: true });
}

async function handleManualInput() {
    const manualInput = document.getElementById('manual-input');
    const inputValue = manualInput.value.trim();
    
    if (inputValue) {
        try {
            // Process the manually entered code
            await debugLog('Manual code entered', { code: inputValue });
            
            // Check if the item is not already in the list
            if (!scannedItems.includes(inputValue)) {
                playBeep();
                scannedItems.unshift(inputValue); // Add to beginning of array
                updateScannedList();
            }
            
            // Always clear the input and refocus, regardless of whether the item was new
            manualInput.value = '';
            manualInput.focus({ preventScroll: true });
        } catch (error) {
            // Log the full error details
            await debugLog('Manual input processing error', {
                errorMessage: error.message,
                errorStack: error.stack,
                inputValue: inputValue
            });
            
            // Optional: Show a user-friendly error message
            console.error('Failed to process manual input:', error);
        }
    }
}

// Modify the document load event to use camera availability check
document.addEventListener('DOMContentLoaded', async () => {
    await handleCameraAvailability();
});

// Add error handler
window.addEventListener('error', async (event) => {
    await debugLog('Global error occurred', { error: event.error });
});

// Retry initialization if camera permission changes
navigator.permissions?.query({ name: 'camera' })
    .then(permissionStatus => {
        permissionStatus.onchange = async () => {
            await debugLog('Camera permission status changed', { state: permissionStatus.state });
            if (permissionStatus.state === 'granted') {
                await startScanner();
            }
        };
    })
    .catch(err => debugLog('Permission query not supported', { error: err }));

// Handle page visibility change
document.addEventListener('visibilitychange', async () => {
    await debugLog(`Visibility changed. Hidden: ${document.hidden}`);
    if (document.hidden) {
        await cleanup();
    } else {
        await startScanner();
    }
});

// Clean up when page is unloaded
window.addEventListener('beforeunload', cleanup);

// Initialize share button handler
window.addEventListener('load', () => {
    const shareButton = document.getElementById('share-button');
    if (shareButton) {
        shareButton.addEventListener('click', shareList);
        debugLog('Share button handler added');
    }
});
