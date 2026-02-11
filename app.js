window.addEventListener('DOMContentLoaded', async () => {
    // [Requirement 1] Prevent Double Initialization
    // Guard clause to ensure the startup sequence runs only once per page load.
    if (window.titanAppInitialized) {
        console.warn("Titan System already initialized. Skipping duplicate sequence.");
        return;
    }
    window.titanAppInitialized = true;

    // TITAN CORE: STARTUP SEQUENCE
    
    // 1. Initialize System State & Bind UI Listeners
    // We delegate to System.init() because it must bind the new HTML form events
    // and execute the secure 'rotate_session' handshake.
    if (typeof System !== 'undefined' && System.init) {
        await System.init();
    } else {
        console.error("Titan System Core missing or failed to load.");
        if (typeof UI !== 'undefined' && UI.switchView) {
            UI.switchView('view-login');
        }
    }

    // Note: Legacy sessionStorage logic ('nexquiz_room_id') is removed.
    // Titan v4.0 uses Server-Side Sessions and the Lobby system.
});