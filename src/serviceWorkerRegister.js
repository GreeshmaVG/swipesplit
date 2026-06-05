// Register COI service worker for SharedArrayBuffer support
export function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    // Get the base URL from the HTML meta tag or window
    const baseUrl = import.meta.env.BASE_URL || '/';
    const swPath = baseUrl + 'coi-serviceworker.js';
    
    navigator.serviceWorker.register(swPath)
      .then(registration => {
        console.log('Service Worker registered:', registration);
      })
      .catch(err => {
        console.warn('Service Worker registration failed:', err);
      });
  }
}
