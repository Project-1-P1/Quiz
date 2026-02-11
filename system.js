const System = {
    state: {
        user: null,
        session_id: null,
        role: null,
        mode: 'login', // 'login' or 'signup'
        isInitialized: false // [Requirement 1] Guard flag
    },

    // Initialize System & Listeners
    init: async () => {
        // [Requirement 1] Prevent multiple executions
        if (System.state.isInitialized) {
            console.warn("System.init() called multiple times. Skipping.");
            return;
        }
        System.state.isInitialized = true;

        // 1. Bind UI Events
        const authForm = document.getElementById('auth-form');
        if (authForm) authForm.addEventListener('submit', System.authenticate);
        
        const toggleBtn = document.getElementById('toggle-auth-mode');
        if (toggleBtn) toggleBtn.addEventListener('click', System.toggleMode);
        
        // Bind Logout buttons (Lobby & Admin)
        const logoutHandler = () => System.logout();
        const btnLobbyLogout = document.getElementById('btn-logout');
        const btnAdminLogout = document.getElementById('admin-logout');
        if (btnLobbyLogout) btnLobbyLogout.addEventListener('click', logoutHandler);
        if (btnAdminLogout) btnAdminLogout.addEventListener('click', logoutHandler);

        // 2. Check Active Session
        const { data: { session } } = await sb.auth.getSession();
        if (session) {
            System.state.user = session.user;
            System.connect(); // Run handshake
        } else {
            UI.switchView('view-login');
        }

        // 3. Listen for Auth Changes (Auto-redirect)
        sb.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_IN' && !System.state.user && session) {
                System.state.user = session.user;
                System.connect();
            } else if (event === 'SIGNED_OUT') {
                window.location.reload();
            }
        });
    },

    // Handle Login/Signup Form Submission
    authenticate: async (e) => {
        e.preventDefault();
        const email = document.getElementById('log-email').value;
        const password = document.getElementById('log-password').value;
        
        if (!email || !password) return UI.toast("Credentials required", "warning");

        UI.toggleBtnLoading('btn-login', true);

        try {
            let error;
            if (System.state.mode === 'signup') {
                // Auto-creates player row via SQL trigger 'handle_new_user'
                const { error: err } = await sb.auth.signUp({ email, password });
                error = err;
                if (!error) UI.toast("Identity Created. Logging in...", "success");
            } else {
                const { error: err } = await sb.auth.signInWithPassword({ email, password });
                error = err;
            }

            if (error) throw error;
            // success handled by onAuthStateChange listener
        } catch (err) {
            console.error("Auth Error:", err);
            UI.toast(err.message || "Authentication Failed", "error");
            UI.toggleBtnLoading('btn-login', false);
        }
    },

    // Secure Handshake (Rotate Session)
    connect: async () => {
        UI.toast("Establishing Secure Link...", "info");

        try {
            // 1. Call RPC to rotate session & get role
            // This enforces single-device login and returns the session_id needed for scoring
            const { data, error } = await sb.rpc('rotate_session');

            if (error) throw error;
            if (data.status === 'error') throw new Error(data.message);

            // 2. Store Critical Session Data
            System.state.session_id = data.session_id;
            
            // 3. Route based on RPC response
            if (data.status === 'admin_session_rotated') {
                // ADMIN FLOW
                System.state.role = 'admin';
                UI.toast("Command Access Granted", "success");
                UI.switchView('view-admin');
                if(window.Admin && Admin.init) Admin.init(); 
            } else {
                // PLAYER FLOW
                System.state.role = 'player';
                UI.toast("Agent Link Active", "success");
                
                // [Requirement 1] Route ONLY to Lobby
                UI.switchView('view-lobby');
                
                // [Requirement 2 & 5] Removed Candidate.init(). 
                // Delegated to Lobby Logic.
                if (window.Lobby && typeof Lobby.init === 'function') {
                    Lobby.init();
                }
            }

        } catch (err) {
            console.error("Handshake Error:", err);
            UI.toast("Security Handshake Failed: " + err.message, "error");
            await sb.auth.signOut();
            UI.toggleBtnLoading('btn-login', false);
        }
    },

    // Toggle Login/Signup UI
    toggleMode: () => {
        System.state.mode = System.state.mode === 'login' ? 'signup' : 'login';
        const btn = document.getElementById('btn-login');
        const link = document.getElementById('toggle-auth-mode');
        
        if (System.state.mode === 'login') {
            btn.innerText = "Authenticate";
            link.innerText = "New Agent? Initialize Identity";
        } else {
            btn.innerText = "Initialize Identity";
            link.innerText = "Have an ID? Authenticate";
        }
    },

    // Secure Logout
    logout: async () => {
        try {
            // Invalidate session on server first
            if(System.state.user) await sb.rpc('logout_user'); 
        } catch(e) { console.error(e); }
        await sb.auth.signOut();
    }
};

// [Requirement 2] Auto-start removed. Initialization is now strictly handled by app.js.