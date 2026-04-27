// scripts/dom-observer.js

// Function to observe DOM changes using MutationObserver
function observeDOM() {
    const secondary = document.querySelector('ytd-watch-flexy #secondary');
    if (secondary) {
        injectSidebar(secondary);
        return;
    }
    
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === 1 && node.querySelector && node.querySelector('ytd-watch-flexy #secondary')) {
                    const secondary = node.querySelector('ytd-watch-flexy #secondary');
                    if (secondary) {
                        injectSidebar(secondary);
                        observer.disconnect();
                    }
                }
            });
        });
    });
    
    observer.observe(document.body, { childList: true, subtree: true });
}