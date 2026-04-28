// scripts/dom-observer.js

// Function to observe DOM changes using MutationObserver
function observeDOM() {
    const secondary = document.querySelector('ytd-watch-flexy #secondary');
    if (secondary) {
        // If secondary element is already available, call the injectSidebar function from ui-builder.js
        if (typeof injectSidebar === 'function') {
            injectSidebar(secondary);
        }
        return;
    }
    
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === 1 && node.querySelector && node.querySelector('ytd-watch-flexy #secondary')) {
                    const secondary = node.querySelector('ytd-watch-flexy #secondary');
                    if (secondary) {
                        // Call the injectSidebar function from ui-builder.js
                        if (typeof injectSidebar === 'function') {
                            injectSidebar(secondary);
                        }
                        observer.disconnect();
                    }
                }
            });
        });
    });
    
    observer.observe(document.body, { childList: true, subtree: true });
}

// Export functions for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    observeDOM,
    // injectSidebar is now only defined in ui-builder.js
  };
}