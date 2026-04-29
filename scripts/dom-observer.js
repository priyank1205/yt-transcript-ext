// scripts/dom-observer.js

let pollingInterval = null;

function observeDOM() {
    if (pollingInterval) clearInterval(pollingInterval);

    const secondary = document.querySelector('ytd-watch-flexy #secondary');
    if (secondary) {
        if (typeof injectSidebar === 'function') {
            injectSidebar(secondary);
        }
        return;
    }

    let elapsed = 0;
    pollingInterval = setInterval(() => {
        elapsed += 200;
        const sec = document.querySelector('ytd-watch-flexy #secondary');
        if (sec) {
            clearInterval(pollingInterval);
            pollingInterval = null;
            if (typeof injectSidebar === 'function') {
                injectSidebar(sec);
            }
        } else if (elapsed >= 2000) {
            clearInterval(pollingInterval);
            pollingInterval = null;
        }
    }, 200);
}

// Export functions for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    observeDOM
  };
}